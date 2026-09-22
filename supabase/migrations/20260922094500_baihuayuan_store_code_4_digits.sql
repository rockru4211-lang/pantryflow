create or replace function public.update_store_login_code(
  p_store_id uuid,
  p_store_code text,
  p_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
  v_code text := btrim(coalesce(p_store_code,''));
begin
  if auth.uid() is null or not private.can_manage_business(p_store_id) then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;
  if v_code !~ '^[0-9]{4}$' then
    raise exception 'STORE_CODE_4_DIGITS_REQUIRED' using errcode='22023';
  end if;

  select * into v_store from public.stores where id=p_store_id for update;
  if not found then raise exception 'STORE_NOT_FOUND' using errcode='P0002'; end if;
  if p_updated_at is distinct from v_store.updated_at then
    raise exception 'REVISION_CONFLICT' using errcode='40001';
  end if;
  if exists(
    select 1 from public.stores s
    where lower(s.store_code)=lower(v_code) and s.id<>p_store_id
  ) then
    raise exception 'STORE_CODE_ALREADY_EXISTS' using errcode='23505';
  end if;

  update public.stores
  set store_code=v_code, updated_at=now()
  where id=p_store_id
  returning * into v_store;

  insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
  values(v_store.organization_id,'store',v_store.id::text,'store.code-save',
    null,
    jsonb_build_object('store_code',v_store.store_code),
    auth.uid());

  return to_jsonb(v_store);
end;
$$;

revoke all on function public.update_store_login_code(uuid,text,timestamptz) from public;
grant execute on function public.update_store_login_code(uuid,text,timestamptz) to authenticated;
