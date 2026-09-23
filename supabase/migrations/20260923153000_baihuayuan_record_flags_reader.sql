
create or replace function public.get_baihuayuan_record_flags(
  p_store_id uuid,
  p_entity_type text
)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null or not private.has_active_store_role(p_store_id) then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;
  select organization_id into v_org
  from public.stores
  where id=p_store_id and is_active and name in ('BeApe','Gras');

  if v_org is null then raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501'; end if;
  if p_entity_type not in ('RECEIPT_BATCH','TRANSFER','WASTE') then
    raise exception 'INVALID_ENTITY_TYPE' using errcode='22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'entity_id',f.entity_id,
      'state',f.state,
      'reason',f.reason,
      'updated_at',f.updated_at,
      'updated_by',f.updated_by
    ) order by f.updated_at desc)
    from private.baihuayuan_record_flags f
    where f.organization_id=v_org
      and f.entity_type=p_entity_type
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_baihuayuan_record_flags(uuid,text) from public;
grant execute on function public.get_baihuayuan_record_flags(uuid,text) to authenticated;
