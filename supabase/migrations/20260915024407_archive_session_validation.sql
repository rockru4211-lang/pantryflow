-- Session validation preserves archive access while all normal operation guards remain active-only.
create or replace function public.touch_app_session(p_store_id uuid,p_active boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 if not private.app_session_valid(p_store_id) then raise exception 'AUTH_REAUTH_REQUIRED' using errcode='42501';end if;
 if (private.app_role(p_store_id) is null and not exists(select 1 from public.stores s where s.id=p_store_id and not s.is_active and (private.store_scope_role(s.id) is not null or private.can_manage_store_scope(s.id)))) or sid is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_active then
  insert into private.app_session_access(session_id,store_id,user_id) values(sid,p_store_id,auth.uid())
  on conflict(session_id,store_id) do update set last_active_at=now();
 end if;
 return jsonb_build_object('valid',true);
end $$;
