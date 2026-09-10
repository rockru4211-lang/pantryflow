-- Public login context exposes only the exact identity entered by the employee.
-- Credentials, identifiers for other staff, and membership IDs remain private.
create or replace function public.get_pilot_staff_login_context(p_store_code text,p_identifier text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_store public.stores%rowtype; v_matches jsonb; v_count integer;
begin
 if p_store_code is null or p_store_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$'
    or length(coalesce(p_identifier,''))>64 then raise exception 'INVALID_LOGIN_INPUT'; end if;
 select * into v_store from public.stores where upper(store_code)=upper(trim(p_store_code)) and is_active;
 if not found then raise exception 'LOGIN_CONTEXT_NOT_FOUND'; end if;
 if nullif(trim(p_identifier),'') is null then
   return jsonb_build_object('storeName',v_store.name,'storeCode',v_store.store_code,'loginMode',v_store.staff_login_mode);
 end if;
 select count(*),jsonb_agg(jsonb_build_object('displayName',i.display_name,'loginIdentifier',m.login_identifier,'role',m.role))
 into v_count,v_matches from public.store_memberships m join public.staff_identities i on i.user_id=m.user_id
 where m.store_id=v_store.id and m.is_active and i.is_active and
 (lower(m.login_identifier)=lower(trim(p_identifier)) or
  (v_store.staff_login_mode='NAME_OR_NICKNAME' and
    (lower(i.display_name)=lower(trim(p_identifier)) or lower(i.nickname)=lower(trim(p_identifier)))) or
  (v_store.staff_login_mode='EMPLOYEE_NUMBER' and lower(i.employee_number)=lower(trim(p_identifier))));
 if v_count<>1 then raise exception 'LOGIN_CONTEXT_NOT_FOUND'; end if;
 return jsonb_build_object('storeName',v_store.name,'storeCode',v_store.store_code,'loginMode',v_store.staff_login_mode)
   || (v_matches->0);
end $$;
revoke all on function public.get_pilot_staff_login_context(text,text) from public;
grant execute on function public.get_pilot_staff_login_context(text,text) to anon,authenticated;
