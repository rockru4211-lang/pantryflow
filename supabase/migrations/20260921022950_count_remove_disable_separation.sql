-- Product disablement is global and explicit. Removal concerns one store's
-- count setup; it never changes the enterprise product's enabled state.
alter table private.count_catalog_removed
  add column removed_at timestamptz not null default now(),
  add column removed_by uuid,
  add column zone_configuration jsonb not null default '[]'::jsonb;
update private.count_catalog_removed r set zone_configuration=coalesce((
  select jsonb_agg(jsonb_build_object('zone_id',zp.zone_id,'unit',zp.count_unit,'sort_order',zp.sort_order))
  from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
  where z.store_id=r.store_id and zp.product_id=r.product_id),'[]'::jsonb);

-- Backfill only a recorded source removal with no surviving store source or
-- configuration. Lack of configuration alone never means removal.
insert into private.count_catalog_removed(store_id,product_id,removed_at,removed_by)
select distinct on(f.store_id,r.product_id) f.store_id,r.product_id,f.removed_at,f.removed_by
from public.inventory_import_files f join public.inventory_import_rows r on r.import_file_id=f.id
join public.products p on p.id=r.product_id and p.organization_id=f.organization_id
where f.removed_at is not null and r.product_id is not null
  and not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=f.store_id and z.is_active and zp.product_id=r.product_id)
  and not exists(select 1 from public.inventory_import_rows live join public.inventory_import_files lf on lf.id=live.import_file_id
    where lf.store_id=f.store_id and lf.removed_at is null and live.product_id=r.product_id and live.status in ('ADDED','EXISTING','PENDING'))
order by f.store_id,r.product_id,f.removed_at desc
on conflict(store_id,product_id) do nothing;

create function private.count_setup_mutation_scope(s uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare org uuid;
begin
  if auth.uid() is null or not private.can_import_inventory(s) then
    raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('import:'||s::text,0));
  select organization_id into org from public.stores where id=s and is_active for update;
  if org is null then raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501'; end if;
  perform 1 from public.inventory_count_sessions where store_id=s and status in ('DRAFT','IN_PROGRESS') for update;
  if exists(select 1 from public.inventory_count_sessions where store_id=s
    and status in ('DRAFT','IN_PROGRESS') and private.count_has_work(id)) then
    raise exception 'COUNT_IN_PROGRESS' using errcode='22023';
  end if;
  return org;
end $$;

create function private.remove_store_count_products(s uuid,ids uuid[]) returns integer
language plpgsql security invoker set search_path='' as $$
declare org uuid; previous_setting text:=current_setting('app.opening_balance_maintenance',true);
begin
  org:=private.count_setup_mutation_scope(s);
  if coalesce(cardinality(ids),0)=0 then return 0; end if;
  if exists(select 1 from unnest(ids) target(product_id) where not exists(
    select 1 from public.products p where p.id=target.product_id and p.organization_id=org)) then
    raise exception 'PRODUCT_NOT_IN_STORE' using errcode='42501';
  end if;
  insert into private.count_catalog_removed(store_id,product_id,removed_at,removed_by,zone_configuration)
  select s,p.id,now(),auth.uid(),coalesce((select jsonb_agg(jsonb_build_object(
    'zone_id',zp.zone_id,'unit',zp.count_unit,'sort_order',zp.sort_order))
    from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
    where z.store_id=s and z.is_active and zp.product_id=p.id),'[]'::jsonb)
  from public.products p where p.id=any(ids)
  on conflict(store_id,product_id) do update set removed_at=excluded.removed_at,removed_by=excluded.removed_by,
    zone_configuration=case when excluded.zone_configuration<>'[]'::jsonb then excluded.zone_configuration else count_catalog_removed.zone_configuration end;

  insert into private.import_removal_receipts(import_file_id,product_id,removed_at,reactivate_product,opening_retained,source_ids)
  select r.import_file_id,r.product_id,now(),false,
    exists(select 1 from public.store_product_opening_balances b where b.store_id=s and b.product_id=r.product_id and b.source<>'FILE_IMPORT'),
    array_agg(r.source_id order by r.source_id)
  from public.inventory_import_rows r join public.inventory_import_files f on f.id=r.import_file_id
  where f.store_id=s and f.removed_at is null and r.product_id=any(ids) and r.status in ('ADDED','EXISTING','PENDING')
  group by r.import_file_id,r.product_id
  on conflict(import_file_id,product_id) do update set removed_at=excluded.removed_at,
    reactivate_product=false,opening_retained=excluded.opening_retained,source_ids=excluded.source_ids;
  -- All earlier retained source contributions disappear when their last store
  -- setup is removed. Re-import must then apply those contributions once.
  update private.import_removal_receipts rr set opening_retained=false
  from public.inventory_import_files f where rr.import_file_id=f.id and f.store_id=s and rr.product_id=any(ids)
    and not exists(select 1 from public.store_product_opening_balances b where b.store_id=s and b.product_id=rr.product_id and b.source<>'FILE_IMPORT');
  update public.inventory_import_rows r set status='SKIPPED',reason='品項已從本門市移除',updated_at=now()
  from public.inventory_import_files f where f.id=r.import_file_id and f.store_id=s
    and f.removed_at is null and r.product_id=any(ids) and r.status in ('ADDED','EXISTING','PENDING');
  delete from public.zone_products zp using public.count_zones z
    where z.id=zp.zone_id and z.store_id=s and zp.product_id=any(ids);
  perform set_config('app.opening_balance_maintenance','on',true);
  delete from public.store_product_opening_balances where store_id=s and product_id=any(ids) and source='FILE_IMPORT';
  perform set_config('app.opening_balance_maintenance',coalesce(previous_setting,''),true);
  delete from private.count_catalog_prices where store_id=s and product_id=any(ids) and source='IMPORT';
  delete from private.count_next_exclusions where store_id=s and product_id=any(ids);
  perform private.refresh_unstarted_count(s);
  return cardinality(ids);
end $$;

create or replace function public.undo_inventory_import_batch(p_store_id uuid,p_file_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; f public.inventory_import_files; ids uuid[]; shared_ids uuid[]; removed_ids uuid[];
begin
  org:=private.count_setup_mutation_scope(p_store_id);
  select * into f from public.inventory_import_files where store_id=p_store_id and file_sha256=p_file_sha256 for update;
  if f.id is null then raise exception 'IMPORT_NOT_FOUND' using errcode='22023'; end if;
  if f.removed_at is not null then return jsonb_build_object('removed',0,'shared',0,'hidden',true); end if;
  select coalesce(array_agg(distinct product_id),'{}'::uuid[]) into ids from public.inventory_import_rows where import_file_id=f.id and product_id is not null;
  select coalesce(array_agg(target.product_id),'{}'::uuid[]) into shared_ids from unnest(ids) target(product_id) where exists(
    select 1 from public.inventory_import_rows r join public.inventory_import_files other on other.id=r.import_file_id
    where r.product_id=target.product_id and other.store_id=p_store_id and other.id<>f.id and other.removed_at is null and r.status in ('ADDED','EXISTING','PENDING'));
  select coalesce(array_agg(target.product_id),'{}'::uuid[]) into removed_ids from unnest(ids) target(product_id) where not(target.product_id=any(shared_ids));
  -- Shared items retain their current setup and aggregate opening. Their source
  -- contribution must not be applied twice if this file is re-imported.
  insert into private.import_removal_receipts(import_file_id,product_id,removed_at,reactivate_product,opening_retained,source_ids)
  select f.id,r.product_id,now(),false,true,array_agg(r.source_id order by r.source_id)
  from public.inventory_import_rows r where r.import_file_id=f.id and r.product_id=any(shared_ids)
    and r.status in ('ADDED','EXISTING','PENDING') group by r.product_id
  on conflict(import_file_id,product_id) do update set removed_at=excluded.removed_at,
    reactivate_product=false,opening_retained=true,source_ids=excluded.source_ids;
  perform private.remove_store_count_products(p_store_id,removed_ids);
  update public.inventory_import_rows r set status='SKIPPED',reason=case when product_id=any(shared_ids)
    then '本次匯入已移除；同品項仍由其他匯入資料使用' else '本次匯入已移除' end,updated_at=now()
    where r.import_file_id=f.id and r.product_id is not null;
  update public.inventory_import_files set removed_at=now(),removed_by=auth.uid() where id=f.id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(org,'store',p_store_id,'INVENTORY_IMPORT_REMOVED',jsonb_build_object('import_file_id',f.id,'removed',cardinality(removed_ids),'shared',cardinality(shared_ids)),auth.uid());
  return jsonb_build_object('removed',cardinality(removed_ids),'shared',cardinality(shared_ids),'hidden',true);
end $$;

create or replace function public.remove_single_imported_product_safely(p_store_id uuid,p_product_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
  org:=private.count_setup_mutation_scope(p_store_id);
  if not exists(select 1 from public.inventory_import_rows where store_id=p_store_id and product_id=p_product_id) then
    raise exception 'IMPORTED_PRODUCT_ONLY' using errcode='22023'; end if;
  perform private.remove_store_count_products(p_store_id,array[p_product_id]);
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(org,'store',p_store_id,'COUNT_PRODUCT_REMOVED',jsonb_build_object('product_id',p_product_id),auth.uid());
  return jsonb_build_object('removed',true,'product_id',p_product_id);
end $$;

create or replace function private.count_catalog_operation(s uuid,a text,d jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare ids uuid[]; pid uuid; amount numeric; result jsonb; config jsonb; v_restore_zone uuid; mode text:=d->>'mode';
begin
  if not private.can_import_inventory(s) then raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501'; end if;
  if a='count.prepare' then return jsonb_build_object('session_id',private.refresh_unstarted_count(s)); end if;
  if a='count.catalog-edit' then
    result:=private.edit_count_product(s,d);
    if d ? 'unit_price' then
      amount:=nullif(d->>'unit_price','')::numeric;
      if amount<0 or amount::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_PRICE' using errcode='22023'; end if;
      insert into private.count_catalog_prices(store_id,product_id,unit,unit_price,source)
      values(s,(d->>'id')::uuid,btrim(d->>'unit'),amount,'MANUAL')
      on conflict(store_id,product_id,unit) do update set unit_price=excluded.unit_price,source='MANUAL',updated_at=now();
    end if;
    perform private.refresh_unstarted_count(s);
    return result||jsonb_build_object('unit_price',private.count_price(s,(d->>'id')::uuid,btrim(d->>'unit')));
  end if;
  if a<>'count.catalog-lifecycle' or coalesce(mode,'') not in ('REMOVE','DISABLE','RESTORE') or jsonb_typeof(d->'ids') is distinct from 'array' then
    raise exception 'INVALID_APP_INPUT' using errcode='22023'; end if;
  perform private.count_setup_mutation_scope(s);
  select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(d->'ids');
  if coalesce(cardinality(ids),0) not between 1 and 5000 then raise exception 'INVALID_APP_INPUT' using errcode='22023'; end if;
  if exists(select 1 from unnest(ids) desired(id) where not exists(select 1 from public.products p join public.stores st on st.organization_id=p.organization_id where st.id=s and p.id=desired.id)
    or not(exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=s and zp.product_id=desired.id)
      or exists(select 1 from private.count_catalog_removed where store_id=s and product_id=desired.id)
      or exists(select 1 from public.inventory_import_rows where store_id=s and product_id=desired.id))) then
    raise exception 'PRODUCT_NOT_IN_STORE' using errcode='42501'; end if;
  if mode in ('REMOVE','DISABLE') then
    perform private.remove_store_count_products(s,ids);
  else
    foreach pid in array ids loop
      select zone_configuration into config from private.count_catalog_removed where store_id=s and product_id=pid;
      insert into public.zone_products(zone_id,product_id,count_unit,sort_order)
      select z.id,pid,item->>'unit',coalesce((item->>'sort_order')::int,0)
      from jsonb_array_elements(coalesce(config,'[]'::jsonb)) item join public.count_zones z on z.id=(item->>'zone_id')::uuid
      where z.store_id=s and z.is_active on conflict(zone_id,product_id) do nothing;
      if not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=s and z.is_active and zp.product_id=pid) then
        v_restore_zone:=public.create_pilot_zone(s,'未分類');
        insert into public.zone_products(zone_id,product_id,count_unit,sort_order)
        select v_restore_zone,p.id,coalesce(nullif(p.count_unit,''),p.base_unit),coalesce((select max(sort_order)+1 from public.zone_products where zone_products.zone_id=v_restore_zone),0)
        from public.products p where p.id=pid on conflict(zone_id,product_id) do nothing;
      end if;
      delete from private.count_catalog_removed where store_id=s and product_id=pid;
      delete from private.count_next_exclusions where store_id=s and product_id=pid;
    end loop;
    perform private.refresh_unstarted_count(s);
  end if;
  return jsonb_build_object('changed',cardinality(ids),'action',case when mode='DISABLE' then 'REMOVE' else mode end);
end $$;

create or replace function public.reset_pilot_count_setup(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; source_file record; ids uuid[]; sessions integer; zones integer;
  previous_setting text:=current_setting('app.opening_balance_maintenance',true);
begin
  org:=private.count_setup_mutation_scope(p_store_id);
  select coalesce(array_agg(distinct product_id),'{}'::uuid[]) into ids from (
    select zp.product_id from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=p_store_id and z.is_active
    union select r.product_id from public.inventory_import_rows r join public.inventory_import_files f on f.id=r.import_file_id where f.store_id=p_store_id and f.removed_at is null and r.product_id is not null
  ) candidates;
  for source_file in select file_sha256 from public.inventory_import_files where store_id=p_store_id and removed_at is null loop
    perform public.undo_inventory_import_batch(p_store_id,source_file.file_sha256);
  end loop;
  perform private.remove_store_count_products(p_store_id,ids);
  select count(*) into sessions from public.inventory_count_sessions where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS');
  delete from public.count_drafts d using public.inventory_count_sessions s where d.session_id=s.id and s.store_id=p_store_id and s.status in ('DRAFT','IN_PROGRESS');
  delete from public.count_zone_progress d using public.inventory_count_sessions s where d.session_id=s.id and s.store_id=p_store_id and s.status in ('DRAFT','IN_PROGRESS');
  delete from private.count_opening_snapshots d using public.inventory_count_sessions s where d.session_id=s.id and s.store_id=p_store_id and s.status in ('DRAFT','IN_PROGRESS');
  delete from public.inventory_count_sessions where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS');
  perform set_config('app.opening_balance_maintenance','on',true);
  delete from public.store_product_opening_balances where store_id=p_store_id;
  perform set_config('app.opening_balance_maintenance',coalesce(previous_setting,''),true);
  -- The full setup was cleared, including any formerly retained manual opening.
  update private.import_removal_receipts rr set opening_retained=false from public.inventory_import_files f where rr.import_file_id=f.id and f.store_id=p_store_id;
  delete from private.count_next_exclusions where store_id=p_store_id;
  delete from private.count_catalog_prices where store_id=p_store_id and source='IMPORT';
  select count(*) into zones from public.count_zones where store_id=p_store_id and is_active;
  update public.count_zones set is_active=false,name=name||' · 重建-'||substr(id::text,1,8) where store_id=p_store_id and is_active;
  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
  values(org,p_store_id,'store',p_store_id,'COUNT_SETUP_RESET',jsonb_build_object('products_unlinked',cardinality(ids),'zones_archived',zones,'active_counts_removed',sessions),auth.uid());
  return jsonb_build_object('products_unlinked',cardinality(ids),'zones_archived',zones,'active_counts_removed',sessions);
end $$;

create or replace function private.restore_removed_import_product(p_store_id uuid,p_file_id uuid,p_product_id uuid,p_reset_opening boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare restored boolean:=false;
begin
  if auth.uid() is null or not private.can_import_inventory(p_store_id) then raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from public.inventory_import_files f join public.products p on p.organization_id=f.organization_id
    where f.id=p_file_id and f.store_id=p_store_id and f.removed_at is null and p.id=p_product_id) then return false; end if;
  -- Compatibility with proven removals from before this separation. A mere old
  -- removed file is insufficient; an exact receipt and untouched state are required.
  update public.products p set is_active=true,updated_at=now()
  where p.id=p_product_id and not p.is_active and exists(
    select 1 from private.import_removal_receipts rr join public.inventory_import_files f on f.id=rr.import_file_id
    where rr.product_id=p.id and f.store_id=p_store_id and rr.reactivate_product
      and p.updated_at=rr.removed_at and (f.id=p_file_id or f.removed_at is not null))
    and not exists(select 1 from public.inventory_import_rows r join public.inventory_import_files f on f.id=r.import_file_id where r.product_id=p.id and f.id<>p_file_id and f.removed_at is null and r.status in ('ADDED','EXISTING','PENDING'))
    and not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where zp.product_id=p.id and z.store_id<>p_store_id);
  restored:=found;
  if restored and p_reset_opening then
    delete from public.store_product_opening_balances where store_id=p_store_id and product_id=p_product_id and source='FILE_IMPORT';
  end if;
  delete from private.count_catalog_removed where store_id=p_store_id and product_id=p_product_id;
  delete from private.count_next_exclusions where store_id=p_store_id and product_id=p_product_id;
  return restored;
end $$;

create or replace function public.get_pilot_inventory_catalog(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.can_read_count_management(p_store_id) then raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501'; end if;
  with candidates as (
    select zp.product_id from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=p_store_id and z.is_active
    union select product_id from private.count_catalog_removed where store_id=p_store_id
    union select product_id from public.inventory_import_rows where store_id=p_store_id and product_id is not null
  ), items as (
    select p.*,z.zone_id,z.zone_name,z.unit,z.sort_order,z.zone_order,
      (z.zone_id is not null) configured,
      exists(select 1 from private.count_catalog_removed cr where cr.store_id=p_store_id and cr.product_id=p.id) removed
    from candidates c join public.products p on p.id=c.product_id
    join public.stores st on st.id=p_store_id and st.organization_id=p.organization_id
    left join lateral(select cz.id zone_id,cz.name zone_name,zp.count_unit unit,zp.sort_order,cz.sort_order zone_order
      from public.zone_products zp join public.count_zones cz on cz.id=zp.zone_id where cz.store_id=p_store_id and cz.is_active and zp.product_id=p.id) z on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',p.id,'name',p.name,'unit',coalesce(p.unit,p.count_unit,p.base_unit),'zone',coalesce(p.zone_name,'未配置'),'quantity',b.quantity,
    'imported_at',r.created_at,'supplier',r.normalized_values->>'supplier','sheet',r.sheet_name,'source_row',r.source_row,
    'specification',p.specification,'updated_at',p.updated_at,'unit_price',private.count_price(p_store_id,p.id,coalesce(p.unit,p.count_unit,p.base_unit)),
    'is_active',p.is_active and not p.removed and p.configured,'product_is_active',p.is_active,'is_removed',p.removed,'is_configured',p.configured,
    'catalog_state',case when p.removed then 'REMOVED' when not p.is_active then 'DISABLED' else 'ACTIVE' end
  ) order by p.removed,p.is_active desc,p.zone_order,p.sort_order,p.id),'[]'::jsonb) into result
  from items p left join public.store_product_opening_balances b on b.store_id=p_store_id and b.product_id=p.id
  left join lateral(select ir.* from public.inventory_import_rows ir join public.inventory_import_files f on f.id=ir.import_file_id
    where ir.store_id=p_store_id and ir.product_id=p.id order by (f.removed_at is null and ir.status in ('ADDED','EXISTING','PENDING')) desc,ir.created_at,ir.id limit 1) r on true;
  return result;
end $$;

revoke all on function private.count_setup_mutation_scope(uuid),private.remove_store_count_products(uuid,uuid[]),private.restore_removed_import_product(uuid,uuid,uuid,boolean),private.count_catalog_operation(uuid,text,jsonb) from public,anon,authenticated;

create or replace function private.product_lifecycle(s uuid,d jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare org uuid; pid uuid; mode text:=d->>'mode'; results jsonb:='[]';
begin
  if not private.can_import_inventory(s) then raise exception 'CATALOG_ROLE_REQUIRED' using errcode='42501'; end if;
  select organization_id into org from public.stores where id=s;
  if mode not in ('DISABLE','RESTORE','DELETE') or jsonb_typeof(d->'ids') is distinct from 'array' or jsonb_array_length(d->'ids') not between 1 and 200 then
    raise exception 'INVALID_APP_INPUT'; end if;
  if mode='DELETE' then
    -- Legacy clients requesting deletion get a store removal, never an implicit
    -- enterprise disable and never destruction of historical product identity.
    perform private.remove_store_count_products(s,array(select distinct value::uuid from jsonb_array_elements_text(d->'ids')));
    select coalesce(jsonb_agg(jsonb_build_object('id',value,'status','REMOVED','reason','已從本門市移除，歷史紀錄保留')),'[]'::jsonb)
      into results from jsonb_array_elements_text(d->'ids');
    return jsonb_build_object('results',results);
  end if;
  for pid in select distinct value::uuid from jsonb_array_elements_text(d->'ids') order by 1 loop
    perform 1 from public.products where id=pid and organization_id=org for update;
    if not found then raise exception 'INVALID_PRODUCT'; end if;
    update public.products set is_active=(mode='RESTORE'),updated_at=now() where id=pid;
    -- Explicit human lifecycle choices supersede any older automatic repair proof.
    update private.import_removal_receipts set reactivate_product=false where product_id=pid;
    results:=results||jsonb_build_array(jsonb_build_object('id',pid,'status',case when mode='RESTORE' then 'RESTORED' else 'DISABLED' end,'reason',''));
  end loop;
  return jsonb_build_object('results',results);
end $$;

do $migration$
declare src text; needle text;
begin
  select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into src;
  needle:='current_supplier_id=v_target,is_active=coalesce((p_data->>''is_active'')::boolean,true),updated_at=now()';
  if strpos(src,needle)=0 then raise exception 'Missing product.save lifecycle anchor'; end if;
  src:=replace(src,needle,'current_supplier_id=v_target,updated_at=now()');
  execute src;
  select pg_get_functiondef('public.set_pilot_count_next_period(uuid,uuid,text)'::regprocedure) into src;
  needle:='update public.products set is_active=false,updated_at=now() where id=p_product_id and organization_id=v_org;';
  if strpos(src,needle)=0 then raise exception 'Missing explicit next-count disable anchor'; end if;
  src:=replace(src,needle,needle||chr(10)||'    update private.import_removal_receipts set reactivate_product=false where product_id=p_product_id;');
  execute src;
end $migration$;

create function private.count_product_not_removed(s uuid,p uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select not exists(select 1 from private.count_catalog_removed where store_id=s and product_id=p)
$$;
revoke all on function private.count_product_not_removed(uuid,uuid) from public,anon,authenticated;

-- Scope only new selections to the current store. Historical rows and settlement
-- of an existing movement/expiry record keep their original product identities.
do $migration$
declare src text; change record;
begin
  for change in select * from (values
    ('private.app_workspace(uuid,text,jsonb)',
      'where p.organization_id=v_org and p.is_active',
      'where p.organization_id=v_org and p.is_active and private.count_product_not_removed(p_store,p.id)'),
    ('private.app_workspace(uuid,text,jsonb)',
      'pr.organization_id=v_org and pr.is_active and pr.name ilike',
      'pr.organization_id=v_org and pr.is_active and private.count_product_not_removed(s.id,pr.id) and pr.name ilike'),
    ('private.app_workspace(uuid,text,jsonb)',
      'join public.products p on p.id=zp.product_id and p.is_active',
      'join public.products p on p.id=zp.product_id and p.is_active and private.count_product_not_removed(s.id,p.id)'),
    ('private.app_mapping_workspace(uuid)',
      'where p.organization_id=org and p.is_active',
      'where p.organization_id=org and p.is_active and private.count_product_not_removed(p_store,p.id)'),
    ('private.transfers_workspace_v2(uuid,jsonb)',
      'where p.organization_id=v_org and p.is_active',
      'where p.organization_id=v_org and p.is_active and private.count_product_not_removed(p_store,p.id)'),
    ('private.expiry_waste_workspace(uuid,date,date)',
      'where z.store_id=p_store_id and z.is_active and p.is_active',
      'where z.store_id=p_store_id and z.is_active and p.is_active and private.count_product_not_removed(p_store_id,p.id)'),
    ('private.app_dashboard(uuid)',
      'where p.organization_id=s.organization_id and p.is_active and d.safety_quantity',
      'where p.organization_id=s.organization_id and p.is_active and private.count_product_not_removed(p_store,p.id) and d.safety_quantity'),
    ('private.stock_operation(uuid,text,jsonb)',
      'where id=p and organization_id=org and is_active)',
      'where id=p and organization_id=org and is_active and (action=''stock.move'' or private.count_product_not_removed(s,p)))'),
    ('private.create_store_transfer(uuid,jsonb)',
      'where p.id=v_product and p.organization_id=v_org and p.is_active',
      'where p.id=v_product and p.organization_id=v_org and p.is_active and private.count_product_not_removed(p_store,p.id)'),
    ('private.app_operation(uuid,text,jsonb,uuid)',
      'where id=v_target and organization_id=v_org and is_active)',
      'where id=v_target and organization_id=v_org and is_active and private.count_product_not_removed(case when v_kind=''loan'' then v_other else p_store end,v_target))'),
    ('private.app_resolve_receipt_mapping(uuid,jsonb)',
      'where id=(p_data->>''product_id'')::uuid and organization_id=org and is_active;',
      'where id=(p_data->>''product_id'')::uuid and organization_id=org and is_active and private.count_product_not_removed(p_store,id);'),
    ('private.expiry_waste_command(uuid,uuid,text,jsonb)',
      'where id=(p_data->>''product_id'')::uuid and organization_id=org and is_active and name=item_name;',
      'where id=(p_data->>''product_id'')::uuid and organization_id=org and is_active and name=item_name and private.count_product_not_removed(p_store_id,id);'),
    ('public.map_pilot_receipt_product(uuid,text,uuid,boolean)',
      ' select product_id into old_id from public.receipt_product_mappings',
      E' if not private.count_product_not_removed(b.store_id,product.id) then raise exception ''PRODUCT_REMOVED_FROM_STORE'' using errcode=''22023''; end if;\n select product_id into old_id from public.receipt_product_mappings'),
    ('public.commit_pilot_receipt_ocr(uuid,uuid,uuid,jsonb,jsonb,text)',
      'from public.products where organization_id=b.organization_id and is_active and lower(btrim(name))',
      'from public.products where organization_id=b.organization_id and is_active and private.count_product_not_removed(b.store_id,id) and lower(btrim(name))')
  ) changes(signature,needle,replacement) loop
    select pg_get_functiondef(change.signature::regprocedure) into src;
    if strpos(src,change.needle)=0 then raise exception 'Missing store product selection anchor in %',change.signature; end if;
    execute replace(src,change.needle,change.replacement);
  end loop;

  select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into src;
  if strpos(src,' if p_section=''mappings'' then')=0 then raise exception 'Missing basic product options anchor'; end if;
  src:=replace(src,' if p_section=''mappings'' then',$patch$
 if p_section='product-options' then
   return jsonb_build_object('products',(select coalesce(jsonb_agg(jsonb_build_object(
     'id',p.id,'name',p.name,'base_unit',p.base_unit,'specification',p.specification) order by p.name),'[]'::jsonb)
     from public.products p where p.organization_id=v_org and p.is_active and private.count_product_not_removed(p_store,p.id)));
 end if;
 if p_section='mappings' then$patch$);
  -- The enterprise management list keeps the product; its store removal is a
  -- separate field, not a fabricated global disablement.
  if strpos(src,'''supplier_name'',s.name) order by p.name)')=0 then raise exception 'Missing management catalogue state anchor'; end if;
  src:=replace(src,'''supplier_name'',s.name) order by p.name)',
    '''supplier_name'',s.name,''product_is_active'',p.is_active,''is_removed'',not private.count_product_not_removed(p_store,p.id)) order by p.name)');
  execute src;
end $migration$;
