-- Re-importing a removed source must restore its otherwise-unused products, not
-- inherit stale FILE_IMPORT openings left behind by an older removal implementation.
-- Explicitly disabled products without a removed source remain disabled.
create or replace function private.restore_removed_import_product(
  p_store_id uuid, p_file_id uuid, p_product_id uuid, p_reset_opening boolean
) returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or not private.can_import_inventory(p_store_id) then
    raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501';
  end if;
  update public.products p set is_active=true,updated_at=now()
  where p.id=p_product_id and not p.is_active
    and exists(select 1 from public.inventory_import_files f where f.id=p_file_id and f.store_id=p_store_id and f.organization_id=p.organization_id and f.removed_at is null)
    and exists(select 1 from public.inventory_import_rows r join public.inventory_import_files f on f.id=r.import_file_id where r.product_id=p.id and f.store_id=p_store_id and f.removed_at is not null)
    and not exists(select 1 from public.inventory_import_rows r join public.inventory_import_files f on f.id=r.import_file_id where r.product_id=p.id and f.removed_at is null and f.id<>p_file_id and r.status in ('ADDED','EXISTING','PENDING'))
    and not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where zp.product_id=p.id and z.store_id<>p_store_id);
  if not found then return false; end if;
  if p_reset_opening then
    delete from public.store_product_opening_balances
    where store_id=p_store_id and product_id=p_product_id and source='FILE_IMPORT';
  end if;
  return true;
end $$;
revoke all on function private.restore_removed_import_product(uuid,uuid,uuid,boolean) from public,anon,authenticated;

-- Retain the complete importer, validation, per-source idempotency, and audit logic.
do $migration$
declare src text;
begin
  select pg_get_functiondef('public.import_pilot_inventory(uuid,jsonb)'::regprocedure) into src;
  if src like '%private.restore_removed_import_product%' then return; end if;
  if src not like '%v_existing_count:=v_existing_count+1;continue;%'
     or src not like '%      if v_opening_quantity is not null then%' then
    raise exception 'Expected inventory import restoration anchors not found';
  end if;
  src:=replace(src,'v_existing_count:=v_existing_count+1;continue;',
    'perform private.restore_removed_import_product(p_store_id,v_import_file_id,v_product_id,false); v_existing_count:=v_existing_count+1;continue;');
  src:=replace(src,'      if v_opening_quantity is not null then',$patch$
      -- The existing per-row exception block rolls back this local flag on failure.
      -- Restore it explicitly on success so it never enables unrelated mutations.
      declare v_previous_maintenance text:=current_setting('app.opening_balance_maintenance',true);
      begin
      perform set_config('app.opening_balance_maintenance','on',true);
      perform private.restore_removed_import_product(p_store_id,v_import_file_id,v_product_id,true);
      if v_opening_quantity is not null then$patch$);
  if src not like '%      select coalesce(max(sort_order), -1) + 1 into v_sort from public.zone_products%' then
    raise exception 'Expected end of opening balance import block not found';
  end if;
  src:=replace(src,'      select coalesce(max(sort_order), -1) + 1 into v_sort from public.zone_products',$patch$
      perform set_config('app.opening_balance_maintenance',coalesce(v_previous_maintenance,''),true);
      end;
      select coalesce(max(sort_order), -1) + 1 into v_sort from public.zone_products$patch$);
  execute src;
end $migration$;
