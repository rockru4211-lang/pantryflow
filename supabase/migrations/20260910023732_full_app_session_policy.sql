create table private.app_session_access (
 session_id uuid not null references auth.sessions(id) on delete cascade,
 store_id uuid not null references public.stores(id), user_id uuid not null references auth.users(id),
 last_active_at timestamptz not null default now(),primary key(session_id,store_id)
);
create index app_session_access_user on private.app_session_access(user_id,store_id);
alter table private.app_session_access enable row level security;
revoke all on private.app_session_access from public,anon,authenticated;

create function private.app_session_valid(p_store uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when nullif(auth.jwt()->>'session_id','') is null then true else exists(
 select 1 from auth.sessions se left join private.app_session_access a on a.session_id=se.id and a.store_id=p_store
 left join private.app_settings st on st.store_id=p_store
 where se.id=(auth.jwt()->>'session_id')::uuid and se.user_id=auth.uid()
 and now()<coalesce(a.last_active_at,se.created_at)+make_interval(days=>greatest(coalesce((st.settings->>'reauth_days')::int,7),1))
 ) end
$$;
revoke all on function private.app_session_valid(uuid) from public,anon,authenticated;

create function public.touch_app_session(p_store_id uuid,p_active boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 if not private.app_session_valid(p_store_id) then raise exception 'AUTH_REAUTH_REQUIRED' using errcode='42501';end if;
 if private.app_role(p_store_id) is null or sid is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_active then
  insert into private.app_session_access(session_id,store_id,user_id) values(sid,p_store_id,auth.uid())
  on conflict(session_id,store_id) do update set last_active_at=now();
 end if;
 return jsonb_build_object('valid',true);
end $$;
revoke all on function public.touch_app_session(uuid,boolean) from public,anon;
grant execute on function public.touch_app_session(uuid,boolean) to authenticated;

do $migration$
declare source text;next text;
begin
 select pg_get_functiondef('private.app_role(uuid)'::regprocedure) into source;
 next:=replace(source,'and u.email_confirmed_at is not null','and private.app_session_valid(p_store) and u.email_confirmed_at is not null');
 if next=source then raise exception 'Session role source mismatch';end if;execute next;
 -- The client must show re-authentication, not treat an expired store as a new merchant.
 select pg_get_functiondef('private.app_context()'::regprocedure) into source;
 execute 'create or replace function private.app_context() returns jsonb language plpgsql stable security definer set search_path='''' as $body$ declare result jsonb;begin
 if exists(select 1 from public.store_memberships sm join public.stores s on s.id=sm.store_id where sm.user_id=auth.uid() and sm.is_active and s.is_active and not private.app_session_valid(s.id)) then raise exception ''AUTH_REAUTH_REQUIRED'' using errcode=''42501'';end if;
 '||replace(split_part(split_part(source,'AS $function$',2),'$function$',1),' select jsonb_build_object',' select jsonb_build_object')||' into result;return result;end $body$';
end $migration$;
notify pgrst,'reload schema';
