-- Device authorization stays in the existing management settings. A new device
-- can work after login but cannot remember an identity until a manager approves.
create table private.app_devices (
 id uuid not null, store_id uuid not null references public.stores(id),
 label text not null, device_type text not null default 'SHARED' check(device_type in ('PERSONAL','SHARED')),
 authorized_by uuid references auth.users(id), authorized_at timestamptz,
 revoked_at timestamptz, first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),primary key(id,store_id)
);
create table private.app_device_sessions (
 session_id uuid not null references auth.sessions(id) on delete cascade,
 store_id uuid not null, device_id uuid not null, created_at timestamptz not null default now(),
 primary key(session_id,store_id), foreign key(device_id,store_id) references private.app_devices(id,store_id)
);
alter table private.app_devices enable row level security;
alter table private.app_device_sessions enable row level security;
revoke all on private.app_devices,private.app_device_sessions from public,anon,authenticated;

create function private.app_device_policy(p_store uuid,p_device uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('authorized',coalesce(d.authorized_at is not null and d.revoked_at is null,false),
 'device_type',coalesce(d.device_type,'SHARED'),'remember_device',coalesce((s.settings->>'remember_device')::boolean,true),
 'reauth_days',coalesce((s.settings->>'reauth_days')::int,7))
 from (select p_store store_id) x left join private.app_settings s on s.store_id=x.store_id
 left join private.app_devices d on d.store_id=x.store_id and d.id=p_device
$$;
revoke all on function private.app_device_policy(uuid,uuid) from public,anon,authenticated;

create function public.register_app_device(p_store_id uuid,p_device_id uuid,p_label text default '瀏覽器') returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 if private.app_role(p_store_id) is null or sid is null or p_device_id is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 insert into private.app_devices(id,store_id,label) values(p_device_id,p_store_id,left(coalesce(nullif(btrim(p_label),''),'瀏覽器'),80))
 on conflict(id,store_id) do update set last_seen_at=now();
 -- A fresh password/PIN login after revocation may work, but cannot restore authorization.
 insert into private.app_device_sessions(session_id,store_id,device_id) values(sid,p_store_id,p_device_id)
 on conflict(session_id,store_id) do nothing;
 return private.app_device_policy(p_store_id,p_device_id);
end $$;
revoke all on function public.register_app_device(uuid,uuid,text) from public,anon;
grant execute on function public.register_app_device(uuid,uuid,text) to authenticated;

create function private.app_device_management(p_store uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result private.app_devices;
begin
 if coalesce(private.app_role(p_store),'') not in ('OWNER','SUPERVISOR') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_action='device.authorize' then
  if p_data->>'device_type' not in ('PERSONAL','SHARED') then raise exception 'INVALID_DEVICE_TYPE' using errcode='22023';end if;
  update private.app_devices set device_type=p_data->>'device_type',authorized_by=auth.uid(),authorized_at=now(),revoked_at=null
  where id=(p_data->>'id')::uuid and store_id=p_store returning * into result;
 elsif p_action='device.revoke' then
  update private.app_devices set revoked_at=coalesce(revoked_at,now()),authorized_at=null,authorized_by=null
  where id=(p_data->>'id')::uuid and store_id=p_store returning * into result;
 end if;
 if result.id is null then raise exception 'DEVICE_NOT_FOUND' using errcode='P0002';end if;
 return to_jsonb(result);
end $$;
revoke all on function private.app_device_management(uuid,text,jsonb) from public,anon,authenticated;

create or replace function private.app_session_valid(p_store uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when nullif(auth.jwt()->>'session_id','') is null then true else exists(
 select 1 from auth.sessions se left join private.app_session_access a on a.session_id=se.id and a.store_id=p_store
 left join private.app_settings st on st.store_id=p_store
 where se.id=(auth.jwt()->>'session_id')::uuid and se.user_id=auth.uid()
 and now()<coalesce(a.last_active_at,se.created_at)+make_interval(days=>greatest(coalesce((st.settings->>'reauth_days')::int,7),1))
 and not exists(select 1 from private.app_device_sessions ds join private.app_devices d on d.id=ds.device_id and d.store_id=ds.store_id
 where ds.session_id=se.id and ds.store_id=p_store and d.revoked_at is not null and se.created_at<=d.revoked_at)
 ) end
$$;

do $migration$
declare source text;next text;
begin
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 next:=replace(source,'begin',E'begin\n if p_action in (''device.authorize'',''device.revoke'') then return private.app_device_management(p_store,p_action,p_data);end if;');
 if next=source then raise exception 'Management entry not found';end if;execute next;
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into source;
 next:=replace(source,'''editable'',v_role in (''OWNER'',''SUPERVISOR''),''revision''','''devices'',case when v_role in (''OWNER'',''SUPERVISOR'') then (select coalesce(jsonb_agg(to_jsonb(d) order by d.last_seen_at desc),''[]''::jsonb) from private.app_devices d where d.store_id=p_store) else ''[]''::jsonb end,''editable'',v_role in (''OWNER'',''SUPERVISOR''),''revision''');
 if next=source then raise exception 'Settings entry not found';end if;
 -- The report uses the reviewed field first while retaining raw OCR in its source.
 next:=replace(next,'coalesce(p.name,l.ai_original->>''raw_product_name'',''未對應'')','coalesce(p.name,l.human_correction#>>''{effective_fields,product}'',l.ai_original->>''raw_product_name'',''未對應'')');
 next:=replace(next,'a.created_at<v_end limit 500','a.created_at<v_end order by a.created_at desc limit 500');
 execute next;
end $migration$;

-- Return only the non-sensitive policy on the existing PIN context endpoint.
do $migration$
declare source text;next text;
begin
 select pg_get_functiondef('public.get_pilot_staff_login_context(text,text)'::regprocedure) into source;
 next:=replace(source,'''loginMode'',v_store.staff_login_mode)','''loginMode'',v_store.staff_login_mode,''policy'',private.app_device_policy(v_store.id,null))');
 if next=source then raise exception 'PIN context entry not found';end if;execute next;
end $migration$;
notify pgrst,'reload schema';
create function public.get_app_reauth_reason() returns text language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from private.app_device_sessions ds join private.app_devices d on d.id=ds.device_id and d.store_id=ds.store_id
 join auth.sessions se on se.id=ds.session_id where se.user_id=auth.uid() and se.id=nullif(auth.jwt()->>'session_id','')::uuid
 and d.revoked_at is not null and se.created_at<=d.revoked_at) then 'revoked' else 'expired' end
$$;
revoke all on function public.get_app_reauth_reason() from public,anon;
grant execute on function public.get_app_reauth_reason() to authenticated;
