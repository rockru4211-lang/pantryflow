-- This migration never grants or restores device authorization. Only the existing
-- manager-only device.authorize operation can do so; staff choice requires it.
-- A choice belongs to an authenticated session, never to all users of a browser.
-- Legacy clients and manager device authorizations retain their existing policy.
alter table private.app_device_sessions add column if not exists device_choice text
 check (device_choice in ('PERSONAL','SHARED'));

create or replace function private.app_device_policy(p_store uuid,p_device uuid) returns jsonb
 language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'authorized',coalesce(d.revoked_at is null and d.authorized_at is not null,false),
 'device_type',coalesce(ds.device_choice,d.device_type,'SHARED'),
 'remember_device',coalesce((s.settings->>'remember_device')::boolean,true),
 'reauth_days',case when ds.device_choice='PERSONAL' and d.authorized_at is not null and d.revoked_at is null and d.device_type='PERSONAL' and coalesce((s.settings->>'reauth_days')::int,7)<>0 then 30 else coalesce((s.settings->>'reauth_days')::int,7) end,
 'idle_minutes',case when ds.device_choice='SHARED' then 15 else null end,
 'choice_required',ds.device_choice is null and d.revoked_at is null,
 'personal_allowed',coalesce((s.settings->>'remember_device')::boolean,true) and coalesce((s.settings->>'reauth_days')::int,7)<>0 and d.revoked_at is null and d.authorized_at is not null and d.device_type='PERSONAL',
 'can_authorize_personal',coalesce((s.settings->>'remember_device')::boolean,true) and coalesce((s.settings->>'reauth_days')::int,7)<>0 and d.revoked_at is null and coalesce(private.app_role(p_store),'') in ('OWNER','SUPERVISOR'))
 from (select p_store store_id) x left join private.app_settings s on s.store_id=x.store_id
 left join private.app_devices d on d.store_id=x.store_id and d.id=p_device
 left join private.app_device_sessions ds on ds.store_id=x.store_id and ds.device_id=p_device
 and ds.session_id=nullif(auth.jwt()->>'session_id','')::uuid
$$;

create or replace function private.app_session_valid(p_store uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select case when nullif(auth.jwt()->>'session_id','') is null then true else exists(
 select 1 from auth.sessions se
 left join private.app_session_access a on a.session_id=se.id and a.store_id=p_store
 left join private.app_settings st on st.store_id=p_store
 left join private.app_device_sessions ds on ds.session_id=se.id and ds.store_id=p_store
 left join private.app_devices device on device.id=ds.device_id and device.store_id=p_store
 where se.id=(auth.jwt()->>'session_id')::uuid and se.user_id=auth.uid()
 and (ds.device_choice is distinct from 'PERSONAL' or (device.authorized_at is not null and device.revoked_at is null and device.device_type='PERSONAL' and coalesce((st.settings->>'remember_device')::boolean,true) and coalesce((st.settings->>'reauth_days')::int,7)<>0))
 and now()<
 (case when ds.device_choice is not null then coalesce((select max(x.last_active_at) from private.app_session_access x where x.session_id=se.id and x.user_id=se.user_id),se.created_at)
 else coalesce(a.last_active_at,se.created_at) end)
 +case when ds.device_choice='SHARED' then interval '15 minutes'
 when ds.device_choice='PERSONAL' and device.authorized_at is not null and device.revoked_at is null and device.device_type='PERSONAL' and coalesce((st.settings->>'remember_device')::boolean,true) and coalesce((st.settings->>'reauth_days')::int,7)<>0 then interval '30 days'
 else make_interval(days=>greatest(coalesce((st.settings->>'reauth_days')::int,7),1)) end
 and not exists(select 1 from private.app_device_sessions revoked join private.app_devices d on d.id=revoked.device_id and d.store_id=revoked.store_id
 where revoked.session_id=se.id and revoked.store_id=p_store and d.revoked_at is not null and se.created_at<=d.revoked_at)
 ) end
$$;

-- Definer required for the private device/session tables. All membership, session,
-- binding, freshness and revocation checks are server-side; no caller user_id.
create or replace function public.choose_app_device(p_store_id uuid,p_device_id uuid,p_personal boolean)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
 choice text:=case when p_personal then 'PERSONAL' else 'SHARED' end;
 existing private.app_device_sessions; policy jsonb;
begin
 if auth.uid() is null or sid is null or p_device_id is null or p_personal is null or private.app_role(p_store_id) is null
 then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 -- Register safely; an existing session cannot be rebound to a different device.
 perform public.register_app_device(p_store_id,p_device_id);
 select * into existing from private.app_device_sessions where session_id=sid and store_id=p_store_id for update;
 if existing.device_id<>p_device_id then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 policy:=private.app_device_policy(p_store_id,p_device_id);
 if p_personal and not (policy->>'personal_allowed')::boolean then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 -- Idempotent retries cannot refresh the inactivity clock or change the choice.
 if existing.device_choice=choice then return policy;end if;
 if existing.device_choice is not null then raise exception 'FRESH_LOGIN_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from auth.sessions where id=sid and user_id=auth.uid() and created_at>now()-interval '10 minutes')
 then raise exception 'FRESH_LOGIN_REQUIRED' using errcode='42501';end if;
 update private.app_device_sessions set device_choice=choice where session_id=sid and store_id=p_store_id;
 insert into private.app_session_access(session_id,store_id,user_id) values(sid,p_store_id,auth.uid())
 on conflict(session_id,store_id) do update set last_active_at=now();
 return private.app_device_policy(p_store_id,p_device_id);
end $$;
revoke all on function public.choose_app_device(uuid,uuid,boolean) from public,anon;
grant execute on function public.choose_app_device(uuid,uuid,boolean) to authenticated;
notify pgrst,'reload schema';

-- The two stores are configured atomically, so a denied store cannot leave a
-- half-finished personal/shared choice on the other store.
create or replace function public.choose_app_devices(p_store_ids uuid[],p_device_id uuid,p_personal boolean)
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare store_id uuid; result jsonb;
begin
 if coalesce(cardinality(p_store_ids),0) not between 1 and 50 then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 foreach store_id in array p_store_ids loop
  result:=public.choose_app_device(store_id,p_device_id,p_personal);
 end loop;
 return result;
end $$;
revoke all on function public.choose_app_devices(uuid[],uuid,boolean) from public,anon;
grant execute on function public.choose_app_devices(uuid[],uuid,boolean) to authenticated;
