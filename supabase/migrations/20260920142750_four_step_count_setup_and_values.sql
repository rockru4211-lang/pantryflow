-- Keep catalogue preparation separate from quantity entry. Prices stay manager-only.
create table private.count_catalog_prices(
 store_id uuid references public.stores(id) on delete cascade, product_id uuid references public.products(id) on delete cascade,
 unit text not null, unit_price numeric check(unit_price>=0 and unit_price::text not in ('NaN','Infinity','-Infinity')),
 source text not null, updated_at timestamptz not null default now(), primary key(store_id,product_id,unit)
);
create table private.count_catalog_removed(
 store_id uuid references public.stores(id) on delete cascade, product_id uuid references public.products(id) on delete cascade,
 primary key(store_id,product_id)
);
create table private.count_price_snapshots(
 session_id uuid references public.inventory_count_sessions(id) on delete cascade,
 product_id uuid references public.products(id), unit text not null, unit_price numeric,
 primary key(session_id,product_id,unit)
);
alter table private.count_catalog_prices enable row level security;
alter table private.count_catalog_removed enable row level security;
alter table private.count_price_snapshots enable row level security;
revoke all on private.count_catalog_prices,private.count_catalog_removed,private.count_price_snapshots from public,anon,authenticated;

create function private.count_has_work(s uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.count_drafts where session_id=s and quantity is not null)
 or exists(select 1 from public.count_entries where session_id=s)
 or exists(select 1 from public.count_zone_progress where session_id=s and status='COMPLETED')
$$;
create function private.count_price(s uuid,p uuid,u text) returns numeric language sql stable set search_path='' as $$
 select coalesce((select unit_price from private.count_catalog_prices where store_id=s and product_id=p and unit=u),private.stock_cost_quote(s,p,u))
$$;
create function private.capture_count_prices(s uuid) returns void language sql set search_path='' as $$
 insert into private.count_price_snapshots(session_id,product_id,unit,unit_price)
 select distinct c.id,(i->>'product_id')::uuid,i->>'unit',private.count_price(c.store_id,(i->>'product_id')::uuid,i->>'unit')
 from public.inventory_count_sessions c cross join lateral jsonb_array_elements(c.snapshot->'zones') i where c.id=s
 on conflict do nothing
$$;

create function private.refresh_unstarted_count(p_store_id uuid) returns uuid language plpgsql set search_path='' as $$
declare v_old public.inventory_count_sessions; v_org uuid; v_type text; v_snapshot jsonb; p_selection jsonb:=null;
begin
 perform 1 from public.stores where id=p_store_id for update;
 select * into v_old from public.inventory_count_sessions where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS') order by started_at desc limit 1 for update;
 if v_old.id is null or private.count_has_work(v_old.id) then return v_old.id; end if;
 -- Explicitly selected scopes stay selected. An untouched full count follows catalogue changes.
 p_selection:=nullif(v_old.snapshot->'selection','null'::jsonb);
 v_org:=v_old.organization_id;
 select business_type into v_type from public.organizations where id=v_org;
 select jsonb_build_object('created_at',now(),'opening_captured',true,'business_type',v_type,'zones',coalesce(jsonb_agg(jsonb_build_object(
 'zone_id',z.id,'zone_name',z.name,'product_id',p.id,'product_code',p.product_code,'product_name',p.name,'unit',zp.count_unit,
 'supplier',sp.name,'specification',p.specification,'file_name',src.original_filename,'sheet_name',src.sheet_name,'source_row',src.source_row,'file_order',src.created_at,'sheet_order',src.sheet_order
 ) order by z.sort_order,z.id,zp.sort_order,zp.product_id),'[]'::jsonb)) into v_snapshot
 from public.count_zones z join public.zone_products zp on zp.zone_id=z.id join public.products p on p.id=zp.product_id and p.is_active
 left join public.suppliers sp on sp.id=p.current_supplier_id
 left join lateral(select f.original_filename,r.sheet_name,r.source_row,f.created_at,
 (select ordinality from jsonb_array_elements_text(f.sheet_names) with ordinality a(name,ordinality) where a.name=r.sheet_name limit 1) sheet_order
 from public.inventory_import_rows r join public.inventory_import_files f on f.id=r.import_file_id where r.store_id=p_store_id and r.product_id=p.id and f.removed_at is null and r.status in ('ADDED','EXISTING','PENDING') order by f.created_at,r.created_at,r.id limit 1) src on true
 where z.store_id=p_store_id and z.is_active and not exists(select 1 from private.count_catalog_removed cr where cr.store_id=p_store_id and cr.product_id=p.id)
   and not exists(select 1 from private.count_next_exclusions x where x.store_id=p_store_id and x.product_id=p.id)
   and (p_selection is null or exists(select 1 from jsonb_array_elements(p_selection) item where item->>'zone_id'=z.id::text and item->>'product_id'=p.id::text));

 v_snapshot:=v_snapshot||jsonb_build_object('selection',p_selection);
 update public.inventory_count_sessions set snapshot=v_snapshot where id=v_old.id;
 delete from public.count_drafts where session_id=v_old.id;
 delete from public.count_zone_progress where session_id=v_old.id;
 insert into public.count_zone_progress(organization_id,session_id,zone_id,status)
 select distinct v_org,v_old.id,(i->>'zone_id')::uuid,'NOT_STARTED' from jsonb_array_elements(v_snapshot->'zones') i;
 delete from private.count_opening_snapshots where session_id=v_old.id;
 insert into private.count_opening_snapshots(session_id,product_id,quantity,confirmed_at)
 select distinct v_old.id,(i->>'product_id')::uuid,b.quantity,b.created_at from jsonb_array_elements(v_snapshot->'zones') i
 left join public.store_product_opening_balances b on b.store_id=p_store_id and b.product_id=(i->>'product_id')::uuid;
 delete from private.count_price_snapshots where session_id=v_old.id;
 perform private.capture_count_prices(v_old.id);
 return v_old.id;
end $$;

CREATE OR REPLACE FUNCTION public.start_pilot_count(p_store_id uuid, p_selection jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_org uuid; v_type text; v_actor uuid:=(select auth.uid()); v_snapshot jsonb; v_old public.inventory_count_sessions%rowtype;
begin
 select s.organization_id,o.business_type into v_org,v_type from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store_id and s.is_active for update of s;
 if v_org is null or not private.has_active_store_role(p_store_id,null) then raise exception using errcode='42501',message='STORE_MEMBERSHIP_REQUIRED'; end if;
 select * into v_old from public.inventory_count_sessions where store_id=p_store_id order by started_at desc limit 1;
 if v_old.status in ('DRAFT','IN_PROGRESS') then if private.can_import_inventory(p_store_id) then perform private.refresh_unstarted_count(p_store_id); end if; return v_old.id; end if;
 -- REVIEWING and unresolved discrepancies are historical follow-up work. They never block the next count.
 if v_type='CHAIN_RESTAURANT' and v_old.status='CLOSED' and (v_old.started_at at time zone 'Asia/Taipei')::date=(now() at time zone 'Asia/Taipei')::date then return v_old.id; end if;
 if not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) and not(v_type='CHAIN_RESTAURANT' and private.has_active_store_role(p_store_id,array['STAFF']::public.app_role[]) and p_selection is null) then raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED'; end if;
 if p_selection is not null and (jsonb_typeof(p_selection)<>'array' or jsonb_array_length(p_selection)=0) then raise exception 'COUNT_SCOPE_REQUIRED'; end if;
 if p_selection is not null and exists(select 1 from jsonb_array_elements(p_selection) item where not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id and z.store_id=p_store_id and z.is_active where zp.zone_id::text=item->>'zone_id' and zp.product_id::text=item->>'product_id')) then raise exception using errcode='42501',message='PRODUCT_NOT_IN_STORE'; end if;
 select jsonb_build_object('created_at',now(),'opening_captured',true,'business_type',v_type,'zones',coalesce(jsonb_agg(jsonb_build_object(
 'zone_id',z.id,'zone_name',z.name,'product_id',p.id,'product_code',p.product_code,'product_name',p.name,'unit',zp.count_unit,
 'supplier',sp.name,'specification',p.specification,'file_name',src.original_filename,'sheet_name',src.sheet_name,'source_row',src.source_row,'file_order',src.created_at,'sheet_order',src.sheet_order
 ) order by z.sort_order,z.id,zp.sort_order,zp.product_id),'[]'::jsonb)) into v_snapshot
 from public.count_zones z join public.zone_products zp on zp.zone_id=z.id join public.products p on p.id=zp.product_id and p.is_active
 left join public.suppliers sp on sp.id=p.current_supplier_id
 left join lateral(select f.original_filename,r.sheet_name,r.source_row,f.created_at,
 (select ordinality from jsonb_array_elements_text(f.sheet_names) with ordinality a(name,ordinality) where a.name=r.sheet_name limit 1) sheet_order
 from public.inventory_import_rows r join public.inventory_import_files f on f.id=r.import_file_id where r.store_id=p_store_id and r.product_id=p.id and f.removed_at is null and r.status in ('ADDED','EXISTING','PENDING') order by f.created_at,r.created_at,r.id limit 1) src on true
 where z.store_id=p_store_id and z.is_active and not exists(select 1 from private.count_catalog_removed cr where cr.store_id=p_store_id and cr.product_id=p.id)
   and not exists(select 1 from private.count_next_exclusions x where x.store_id=p_store_id and x.product_id=p.id)
   and (p_selection is null or exists(select 1 from jsonb_array_elements(p_selection) item where item->>'zone_id'=z.id::text and item->>'product_id'=p.id::text));
 if jsonb_array_length(v_snapshot->'zones')=0 then raise exception 'ZONE_PRODUCTS_REQUIRED'; end if;
 v_snapshot:=v_snapshot||jsonb_build_object('selection',p_selection);
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot,paper_required)
 values(v_org,p_store_id,v_actor,'IN_PROGRESS',v_snapshot,v_type='CHAIN_RESTAURANT') returning id into v_id;
 insert into private.count_opening_snapshots(session_id,product_id,quantity,confirmed_at)
 select v_id,(item->>'product_id')::uuid,b.quantity,b.created_at from jsonb_array_elements(v_snapshot->'zones') item
 left join public.store_product_opening_balances b on b.store_id=p_store_id and b.product_id=(item->>'product_id')::uuid
 group by item->>'product_id',b.quantity,b.created_at;
 insert into public.count_zone_progress(organization_id,session_id,zone_id,status)
 select distinct v_org,v_id,(item->>'zone_id')::uuid,'NOT_STARTED' from jsonb_array_elements(v_snapshot->'zones') item;
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
 values(v_org,'inventory_count_session',v_id,'COUNT_SESSION_CREATED',jsonb_build_object('store_id',p_store_id,'business_type',v_type,'scope_count',jsonb_array_length(v_snapshot->'zones')),v_actor);
 perform private.capture_count_prices(v_id);
 return v_id;
end $function$;


-- A single store-scoped transaction saves names, assignments and item order.
-- Completed count entries and their original snapshots are never rewritten.
create or replace function public.save_pilot_zone_configuration_v2(
  p_zone_id uuid, p_name text, p_product_ids uuid[], p_expected_config jsonb, p_keep_existing boolean default false
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_store uuid; v_org uuid; v_current jsonb; v_removed uuid[];
  v_fallback uuid; v_old_name text; v_old_ids uuid[];
begin
  select store_id,organization_id,name into v_store,v_org,v_old_name
    from public.count_zones where id=p_zone_id and is_active;
  if v_store is null or not private.has_active_store_role(v_store,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  -- Matches the store lock used when starting a count.
  perform 1 from public.stores where id=v_store and is_active for update;
  if not found then raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED'; end if;
  perform 1 from public.inventory_count_sessions where store_id=v_store and status in ('DRAFT','IN_PROGRESS') for update;
  if exists(select 1 from public.inventory_count_sessions where store_id=v_store and status in ('DRAFT','IN_PROGRESS') and private.count_has_work(id)) then
    raise exception using errcode='22023',message='COUNT_IN_PROGRESS';
  end if;
  if btrim(coalesce(p_name,''))='' or length(btrim(p_name))>80 then
    raise exception using errcode='22023',message='ZONE_NAME_REQUIRED';
  end if;
  if exists(select 1 from public.count_zones where store_id=v_store and id<>p_zone_id
    and regexp_replace(lower(name),'[[:space:]]+','','g')=regexp_replace(lower(p_name),'[[:space:]]+','','g')) then
    raise exception using errcode='23505',message='ZONE_NAME_EXISTS';
  end if;
  if p_product_ids is null or cardinality(p_product_ids)>5000
    or cardinality(p_product_ids)<>(select count(distinct id) from unnest(p_product_ids) t(id)) then
    raise exception using errcode='22023',message='INVALID_ZONE_PRODUCTS';
  end if;
  select coalesce(jsonb_object_agg(z.id::text,jsonb_build_object('name',z.name,'product_ids',
    coalesce((select jsonb_agg(zp.product_id order by zp.sort_order,zp.product_id) from public.zone_products zp join public.products pr on pr.id=zp.product_id and pr.is_active where zp.zone_id=z.id and not exists(select 1 from private.count_catalog_removed cr where cr.store_id=v_store and cr.product_id=zp.product_id)),'[]'::jsonb))),'{}'::jsonb)
    into v_current from public.count_zones z where z.store_id=v_store and z.is_active;
  if p_expected_config is distinct from v_current then
    raise exception using errcode='40001',message='ZONE_CONFIGURATION_CHANGED';
  end if;
  if exists(select 1 from unnest(p_product_ids) desired(id) where not exists(
    select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
    join public.products p on p.id=zp.product_id and p.is_active
    where z.store_id=v_store and z.is_active and zp.product_id=desired.id and not exists(select 1 from private.count_catalog_removed cr where cr.store_id=v_store and cr.product_id=desired.id)
  )) then raise exception using errcode='42501',message='PRODUCT_NOT_IN_STORE'; end if;

  select coalesce(array_agg(product_id order by sort_order,product_id),'{}'::uuid[]) into v_old_ids
    from public.zone_products where zone_id=p_zone_id and exists(select 1 from public.products pr where pr.id=product_id and pr.is_active) and not exists(select 1 from private.count_catalog_removed cr where cr.store_id=v_store and cr.product_id=zone_products.product_id);
  select coalesce(array_agg(id order by pos),'{}'::uuid[]) into v_removed from unnest(v_old_ids) with ordinality t(id,pos) where not(id=any(p_product_ids));
  if cardinality(v_removed)>0 and regexp_replace(p_name,'[[:space:]]+','','g')='未分類' then
    raise exception using errcode='22023',message='CHOOSE_DESTINATION_ZONE';
  end if;
  update public.count_zones set name=btrim(p_name),updated_at=now() where id=p_zone_id;

  -- Existing assignments survive reorder. Newly added products can move or stay in both zones.
  delete from public.zone_products zp using public.count_zones z
    where z.id=zp.zone_id and z.store_id=v_store and z.is_active
      and ((zp.zone_id=p_zone_id and (zp.product_id=any(v_old_ids) or zp.product_id=any(p_product_ids))) or (not p_keep_existing and zp.product_id=any(p_product_ids) and not(zp.product_id=any(v_old_ids))));
  insert into public.zone_products(zone_id,product_id,sort_order,count_unit)
    select p_zone_id,d.id,(d.pos-1)::integer,p.count_unit
    from unnest(p_product_ids) with ordinality d(id,pos) join public.products p on p.id=d.id;

  if cardinality(v_removed)>0 then
    v_fallback:=public.create_pilot_zone(v_store,'未分類');
    insert into public.zone_products(zone_id,product_id,sort_order,count_unit)
      select v_fallback,p.id,
        (select coalesce(max(sort_order),-1) from public.zone_products where zone_id=v_fallback)+row_number() over(order by r.pos)::integer,p.count_unit
      from unnest(v_removed) with ordinality r(id,pos) join public.products p on p.id=r.id
      where not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=v_store and z.is_active and zp.product_id=p.id)
      on conflict(zone_id,product_id) do nothing;
  end if;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
    values(v_org,'count_zone',p_zone_id,'ZONE_CONFIGURATION_SAVED',
      jsonb_build_object('name',v_old_name,'product_ids',v_old_ids),
      jsonb_build_object('store_id',v_store,'name',btrim(p_name),'product_ids',p_product_ids,'returned_to_unclassified',v_removed,'keep_existing',p_keep_existing),(select auth.uid()));
  perform private.refresh_unstarted_count(v_store);
end;
$$;
revoke all on function public.save_pilot_zone_configuration_v2(uuid,text,uuid[],jsonb,boolean) from public,anon;
grant execute on function public.save_pilot_zone_configuration_v2(uuid,text,uuid[],jsonb,boolean) to authenticated;

notify pgrst, 'reload schema';

create function private.count_catalog_operation(s uuid,a text,d jsonb) returns jsonb language plpgsql set search_path='' as $$
declare ids uuid[]; current_id uuid; pid uuid; amount numeric; result jsonb;
begin
 if not private.can_import_inventory(s) then raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501'; end if;
 perform 1 from public.stores where id=s and is_active for update;
 select id into current_id from public.inventory_count_sessions where store_id=s and status in ('DRAFT','IN_PROGRESS') order by started_at desc limit 1 for update;
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
 if a<>'count.catalog-lifecycle' or coalesce(d->>'mode','') not in ('DISABLE','RESTORE') or jsonb_typeof(d->'ids') is distinct from 'array' then raise exception 'INVALID_APP_INPUT' using errcode='22023'; end if;
 select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(d->'ids');
 if coalesce(cardinality(ids),0) not between 1 and 5000 then raise exception 'INVALID_APP_INPUT' using errcode='22023'; end if;
 if exists(select 1 from unnest(ids) desired(product_id) where not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=s and z.is_active and zp.product_id=desired.product_id)) then raise exception 'PRODUCT_NOT_IN_STORE' using errcode='42501'; end if;
 -- An active count with any work keeps its full item/zone snapshot unchanged.
 if current_id is not null and private.count_has_work(current_id) then raise exception 'COUNT_IN_PROGRESS' using errcode='22023'; end if;
 if d->>'mode'='DISABLE' then
   insert into private.count_catalog_removed select s,id from unnest(ids) id on conflict do nothing;
 else
   if exists(select 1 from public.products p where p.id=any(ids) and not p.is_active and exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where zp.product_id=p.id and z.store_id<>s and z.is_active)) then raise exception 'SHARED_INACTIVE_PRODUCT' using errcode='22023'; end if;
   update public.products set is_active=true,updated_at=now() where id=any(ids) and not is_active;
   delete from private.count_catalog_removed where store_id=s and product_id=any(ids);
 end if;
 perform private.refresh_unstarted_count(s);
 return jsonb_build_object('changed',cardinality(ids));
end $$;

CREATE OR REPLACE FUNCTION private.app_operation(p_store uuid, p_action text, p_data jsonb, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text:=private.app_role(p_store); v_org uuid; v_type text; v_mode text; v_old jsonb; v_result jsonb;
 v_cached private.app_requests; v_record private.app_records; v_move private.store_movements;
 v_id uuid; v_other uuid; v_target uuid; v_qty numeric; v_name text; v_unit text; v_kind text;
begin
 if p_action in ('store.delete','store.deactivate','store.restore') then return private.store_lifecycle(p_store,p_action,p_data,p_request);end if;
 if v_role is null and p_action in ('movement.return','movement.exchange') then v_role:=private.store_scope_role(p_store);end if;
 if p_action in ('receipt.delivery','receipt.erp-bulk') and (auth.uid() is null or coalesce(private.app_role(p_store),'') not in ('STAFF','SUPERVISOR')) then raise exception 'FIELD_ROLE_REQUIRED' using errcode='42501';end if;
 if p_action='receipt.edit-card' and (not exists(select 1 from public.receipt_upload_batches b where b.id=(p_data->>'batch_id')::uuid and b.store_id=p_store) or not private.can_review_receipt((p_data->>'batch_id')::uuid)) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 if p_action='product.edit-basic' and not private.can_import_inventory(p_store) then raise exception 'PRODUCT_EDIT_REQUIRED' using errcode='42501';end if;
 if p_action in ('count.prepare','count.catalog-edit','count.catalog-lifecycle') and not private.can_import_inventory(p_store) then raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501';end if;
 if v_role is null or p_request is null then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>64000 then raise exception 'INVALID_APP_INPUT' using errcode='22023'; end if;
 if p_action in ('store.create','store.save','settings.save','business.save','business.transfer','delegation.create','delegation.revoke','invite.cancel') and not private.can_manage_business(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_action in ('member.save','member.assign','member.offboard') and not private.can_manage_members(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_request::text,0));
 select * into v_cached from private.app_requests where store_id=p_store and request_id=p_request;
 if found then
  if v_cached.actor_id<>auth.uid() or v_cached.action<>p_action or v_cached.payload<>p_data then raise exception 'REQUEST_CONFLICT' using errcode='23505'; end if;
  return v_cached.result;
 end if;
 select s.organization_id,o.business_type::text,o.store_mode into v_org,v_type,v_mode from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store;
 if p_action in ('count.prepare','count.catalog-edit','count.catalog-lifecycle') then v_result:=private.count_catalog_operation(p_store,p_action,p_data);
 elsif p_action like 'stock.%' then v_result:=private.stock_operation(p_store,p_action,p_data);
 elsif p_action in ('receipt.delivery','receipt.erp-bulk') then v_result:=private.receipt_delivery_operation(p_store,p_action,p_data);
 elsif p_action='receipt.edit-card' then v_result:=private.receipt_edit_card(p_store,p_data);
 elsif p_action='product.edit-basic' then v_result:=private.edit_count_product(p_store,p_data);
 elsif p_action='product.lifecycle' then v_result:=private.product_lifecycle(p_store,p_data);
 elsif p_action='record.create' then
  v_kind:=p_data->>'kind'; if v_kind='bulletin' and p_data ? 'audience' and (jsonb_typeof(p_data->'audience')<>'array' or jsonb_array_length(p_data->'audience')=0 or exists(select 1 from jsonb_array_elements_text(p_data->'audience') a where a not in ('STAFF','SUPERVISOR','LOGISTICS','OWNER'))) then raise exception 'INVALID_AUDIENCE' using errcode='22023';end if;
  if v_kind not in ('incident','handover','bulletin','company_task') or (v_kind in ('bulletin','company_task') and v_role='STAFF') then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  v_target:=nullif(p_data->>'responsible_id','')::uuid;
  if v_target is not null and not exists(select 1 from public.store_memberships sm join public.organization_members om on om.organization_id=sm.organization_id and om.user_id=sm.user_id where sm.store_id=p_store and sm.user_id=v_target and sm.is_active and om.is_active) then raise exception 'INVALID_RESPONSIBLE' using errcode='22023'; end if;
  if v_kind='company_task' and not exists(select 1 from public.organizations where id=v_org and has_erp) then raise exception 'ERP_NOT_ENABLED' using errcode='22023'; end if;
  insert into private.app_records(store_id,kind,title,body,category,responsible_id,due_at,expires_at,audience,created_by)
  values(p_store,v_kind,btrim(p_data->>'title'),coalesce(p_data->>'body',''),nullif(p_data->>'category',''),v_target,nullif(p_data->>'due_at','')::timestamptz,nullif(p_data->>'expires_at','')::timestamptz,
   coalesce((select array_agg(value) from jsonb_array_elements_text(p_data->'audience') where value in ('STAFF','SUPERVISOR','LOGISTICS','OWNER')),array['STAFF','SUPERVISOR','LOGISTICS','OWNER']),auth.uid()) returning * into v_record;
  v_id:=v_record.id; v_result:=to_jsonb(v_record);
  insert into private.app_record_events(record_id,action,snapshot,actor_id) values(v_id,'CREATE',v_result,auth.uid());
 elsif p_action in ('record.take','record.complete','record.read','record.update') then
  select * into v_record from private.app_records where id=(p_data->>'id')::uuid and store_id=p_store for update;
  if not found then raise exception 'RECORD_NOT_FOUND' using errcode='P0002'; end if;
  if v_record.kind='bulletin' and not (v_role=any(v_record.audience) or v_role in ('SUPERVISOR','OWNER')) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  v_id:=v_record.id; v_old:=to_jsonb(v_record);
  if p_action='record.read' then
   insert into private.app_record_reads(record_id,user_id) values(v_id,auth.uid()) on conflict do nothing;
   v_result:=jsonb_build_object('id',v_id,'read_at',(select read_at from private.app_record_reads where record_id=v_id and user_id=auth.uid()));
  else
   if v_record.kind='bulletin' and v_role='STAFF' then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   if p_action='record.update' and v_role='STAFF' and v_record.created_by<>auth.uid() then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   if p_action='record.complete' and v_record.kind='incident' and v_role='STAFF' and coalesce(v_record.responsible_id,v_record.created_by)<>auth.uid() then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   if v_record.status='COMPLETE' then v_result:=v_old;
   else
    if (p_data->>'revision')::int is distinct from v_record.revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
    if p_action='record.take' then
     update private.app_records set responsible_id=auth.uid(),status='IN_PROGRESS',revision=revision+1,updated_at=now() where id=v_id returning * into v_record;
    elsif p_action='record.complete' then
     update private.app_records set status='COMPLETE',completed_by=auth.uid(),completed_at=now(),revision=revision+1,updated_at=now() where id=v_id returning * into v_record;
    else
     update private.app_records set title=btrim(p_data->>'title'),body=coalesce(p_data->>'body',''),revision=revision+1,updated_at=now() where id=v_id returning * into v_record;
    end if;
    v_result:=to_jsonb(v_record);
    insert into private.app_record_events(record_id,action,note,snapshot,actor_id) values(v_id,p_action,coalesce(p_data->>'note',''),v_result,auth.uid());
   end if;
  end if;
 elsif p_action='movement.transfer-create' then v_result:=private.create_store_transfer(p_store,p_data);v_id:=nullif(v_result->>'id','')::uuid;
 elsif p_action in ('movement.create','movement.return','movement.exchange') then
  if v_role not in ('STAFF','SUPERVISOR') then raise exception 'FIELD_ROLE_REQUIRED' using errcode='42501'; end if;
  if v_mode<>'MULTI' then raise exception 'MULTI_STORE_REQUIRED' using errcode='42501'; end if;
  v_qty:=(p_data->>'quantity')::numeric;
  if v_qty is null or v_qty<=0 or v_qty>=1000000000 then raise exception 'INVALID_QUANTITY' using errcode='22023'; end if;
  if p_action='movement.create' then
   v_kind:=p_data->>'mode'; v_other:=(p_data->>'other_store_id')::uuid;
   if v_kind not in ('loan','loan_out','move') or v_other=p_store or not exists(select 1 from public.stores where id=v_other and organization_id=v_org and is_active) then raise exception 'INVALID_MOVEMENT' using errcode='22023'; end if;
   v_target:=nullif(p_data->>'product_id','')::uuid;
   if v_target is not null and not exists(select 1 from public.products where id=v_target and organization_id=v_org and is_active) then raise exception 'INVALID_PRODUCT' using errcode='22023'; end if;
   v_name:=btrim(p_data->>'name'); v_unit:=btrim(p_data->>'unit');
   insert into private.store_movements(organization_id,from_store_id,to_store_id,kind,product_id,name,quantity,unit,expected_return_on,status,created_by,closed_at)
   values(v_org,case when v_kind='loan' then v_other else p_store end,case when v_kind='loan' then p_store else v_other end,case when v_kind='move' then 'TRANSFER' else 'LOAN' end,v_target,v_name,v_qty,v_unit,case when v_kind<>'move' then nullif(p_data->>'expected_return_on','')::date end,case when v_kind='move' then 'COMPLETE' else 'OPEN' end,auth.uid(),case when v_kind='move' then now() end) returning * into v_move;
  else
   select * into v_move from private.store_movements where id=(p_data->>'id')::uuid and organization_id=v_org and p_store in (from_store_id,to_store_id) for update;
   if not found then raise exception 'MOVEMENT_NOT_FOUND' using errcode='P0002'; end if;
   if v_move.status<>'OPEN' then raise exception 'MOVEMENT_ALREADY_CLOSED' using errcode='22023'; end if;
   if (p_data->>'revision')::int is distinct from v_move.revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
   v_old:=to_jsonb(v_move);
   if p_action='movement.return' then
    if v_qty>v_move.quantity-v_move.returned_quantity then raise exception 'RETURN_EXCEEDS_REMAINING' using errcode='22023'; end if;
    v_name:=v_move.name; v_unit:=v_move.unit;
    update private.store_movements set returned_quantity=returned_quantity+v_qty,status=case when returned_quantity+v_qty=quantity then 'RETURNED' else 'OPEN' end,closed_at=case when returned_quantity+v_qty=quantity then now() end,revision=revision+1 where id=v_move.id returning * into v_move;
   else
    v_name:=btrim(p_data->>'name'); v_unit:=btrim(p_data->>'unit');
    if length(coalesce(v_name,'')) not between 1 and 160 or length(coalesce(v_unit,'')) not between 1 and 30 then raise exception 'INVALID_EXCHANGE' using errcode='22023'; end if;
    update private.store_movements set status='EXCHANGED',closed_at=now(),revision=revision+1 where id=v_move.id returning * into v_move;
   end if;
  end if;
  v_id:=v_move.id; v_result:=to_jsonb(v_move);
  insert into private.store_units(store_id,unit) values(p_store,v_unit) on conflict do nothing;
  if p_action='movement.create' and v_target is not null then
   if v_kind='loan' then perform private.stock_post(p_store,v_target,v_unit,v_qty,'MOVEMENT',v_id);
   else perform private.stock_post(p_store,v_target,v_unit,-v_qty,'MOVEMENT',v_id);end if;
  elsif p_action='movement.return' and v_move.product_id is not null then
   perform private.stock_post(p_store,v_move.product_id,v_unit,case when p_store=v_move.to_store_id then -v_qty else v_qty end,'RETURN',p_request);
  end if;
  insert into private.store_movement_events(movement_id,store_id,action,name,quantity,unit,actor_id) values(v_id,p_store,case p_action when 'movement.create' then 'CREATE' when 'movement.return' then 'RETURN' else 'EXCHANGE' end,v_name,v_qty,v_unit,auth.uid());
 else
  -- Management operations continue below; the dispatcher does not accept arbitrary table names.
  v_result:=private.app_management(p_store,p_action,p_data);
  v_id:=nullif(v_result->>'id','')::uuid;
 end if;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store,p_request,auth.uid(),p_action,p_data,v_result);
 if p_action<>'record.read' then
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
  values(v_org,'app_operation',coalesce(v_id,p_store)::text,p_action,v_old,v_result||jsonb_build_object('store_id',p_store),auth.uid());
 end if;
 return v_result;
end $function$;


CREATE OR REPLACE FUNCTION public.get_pilot_inventory_catalog(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
  if not private.can_read_count_management(p_store_id) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',p.id,'name',p.name,'unit',zp.count_unit,'zone',z.name,'quantity',b.quantity,
    'imported_at',r.created_at,'supplier',r.normalized_values->>'supplier','sheet',r.sheet_name,'source_row',r.source_row,
    'specification',p.specification,'updated_at',p.updated_at,'unit_price',private.count_price(p_store_id,p.id,zp.count_unit),
    'is_active',p.is_active and not exists(select 1 from private.count_catalog_removed cr where cr.store_id=p_store_id and cr.product_id=p.id)
  ) order by p.is_active desc,z.sort_order,zp.sort_order,p.id),'[]'::jsonb) into v_result
  from public.count_zones z
  join public.zone_products zp on zp.zone_id=z.id
  join public.products p on p.id=zp.product_id
  left join public.store_product_opening_balances b on b.store_id=p_store_id and b.product_id=p.id
  left join lateral(
    select ir.* from public.inventory_import_rows ir
    where ir.store_id=p_store_id and ir.product_id=p.id and ir.status <> 'FAILED'
    order by ir.created_at,ir.id limit 1
  ) r on true
  where z.store_id=p_store_id and z.is_active;
  return v_result;
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_pilot_count_details(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_session public.inventory_count_sessions%rowtype; v_result jsonb;
begin
  select * into v_session from public.inventory_count_sessions where id=p_session_id;
  if not found or not private.can_read_count_management(v_session.store_id) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if v_session.status not in ('REVIEWING','CLOSED') then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'name',coalesce(s.item->>'product_name',p.name),'unit',e.unit,'zone',coalesce(s.item->>'zone_name',z.name),
    'quantity',e.quantity,'opening_quantity',b.quantity,'entered_at',e.entered_at,'entered_by',coalesce(si.display_name,pr.display_name),
    'unit_price',price.unit_price,'amount',round(coalesce(final.quantity,e.quantity)*price.unit_price,2),
    'product_id',e.product_id,'difference',d.difference,'confirmed_quantity',coalesce(final.quantity,e.quantity),'correction_reason',d.reason,'confirmed_at',d.answered_at,'confirmed_by',confirmer.display_name
  ) order by s.ordinality,e.entered_at),'[]'::jsonb) into v_result
  from public.count_entries e
  join public.products p on p.id=e.product_id
  left join public.inventory_count_discrepancies d on d.initial_entry_id=e.id
  left join public.count_entries final on final.id=d.final_entry_id
  left join public.profiles confirmer on confirmer.id=d.answered_by
  join public.count_zones z on z.id=e.zone_id
  left join lateral(select item,ordinality from jsonb_array_elements(v_session.snapshot->'zones') with ordinality a(item,ordinality)
    where item->>'zone_id'=e.zone_id::text and item->>'product_id'=e.product_id::text limit 1) s on true
  left join private.count_opening_snapshots b on b.session_id=e.session_id and b.product_id=e.product_id
  left join private.count_price_snapshots price on price.session_id=e.session_id and price.product_id=e.product_id and price.unit=e.unit
  left join public.staff_identities si on si.user_id=e.entered_by and si.organization_id=v_session.organization_id
  left join public.profiles pr on pr.id=e.entered_by
  where e.session_id=p_session_id and e.entry_type='INITIAL_COUNT';
  return v_result;
end;
$function$;


CREATE OR REPLACE FUNCTION public.sync_active_count_after_import(p_store_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_session public.inventory_count_sessions%rowtype;
  v_append jsonb;
begin
  if v_user is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_org is null or not private.can_import_inventory(p_store_id) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;

  perform 1 from public.stores where id=p_store_id for update;
  select * into v_session
  from public.inventory_count_sessions
  where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS')
  order by started_at desc
  limit 1
  for update;

  if v_session.id is null then return null; end if;
  if not private.count_has_work(v_session.id) then return private.refresh_unstarted_count(p_store_id); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'zone_id',z.id,'zone_name',z.name,'product_id',p.id,'product_code',p.product_code,
    'product_name',p.name,'unit',zp.count_unit,'supplier',sp.name,'specification',p.specification,
    'file_name',src.original_filename,'sheet_name',src.sheet_name,'source_row',src.source_row,
    'file_order',src.created_at,'sheet_order',src.sheet_order
  ) order by z.sort_order,z.id,zp.sort_order,zp.product_id),'[]'::jsonb)
  into v_append
  from public.count_zones z
  join public.zone_products zp on zp.zone_id=z.id
  join public.products p on p.id=zp.product_id and p.is_active
  left join public.suppliers sp on sp.id=p.current_supplier_id
  left join lateral(
    select f.original_filename,r.sheet_name,r.source_row,f.created_at,
      (select ordinality from jsonb_array_elements_text(f.sheet_names) with ordinality a(name,ordinality)
       where a.name=r.sheet_name limit 1) sheet_order
    from public.inventory_import_rows r
    join public.inventory_import_files f on f.id=r.import_file_id
    where r.store_id=p_store_id and r.product_id=p.id
    order by f.created_at desc,r.created_at desc,r.id desc limit 1
  ) src on true
  where z.store_id=p_store_id and z.is_active and not exists(select 1 from private.count_catalog_removed cr where cr.store_id=p_store_id and cr.product_id=p.id)
    and not exists(
      select 1 from jsonb_array_elements(coalesce(v_session.snapshot->'zones','[]'::jsonb)) item
      where item->>'zone_id'=z.id::text and item->>'product_id'=p.id::text
    );

  if jsonb_array_length(v_append)=0 then return v_session.id; end if;

  update public.inventory_count_sessions
  set snapshot=jsonb_set(v_session.snapshot,'{zones}',coalesce(v_session.snapshot->'zones','[]'::jsonb)||v_append,true)
  where id=v_session.id;

  insert into public.count_zone_progress(organization_id,session_id,zone_id,status)
  select distinct v_org,v_session.id,(item->>'zone_id')::uuid,'NOT_STARTED'
  from jsonb_array_elements(v_append) item
  where not exists(
    select 1 from public.count_zone_progress p
    where p.session_id=v_session.id and p.zone_id=(item->>'zone_id')::uuid
  );

  insert into private.count_opening_snapshots(session_id,product_id,quantity,confirmed_at)
  select distinct v_session.id,(item->>'product_id')::uuid,b.quantity,b.created_at
  from jsonb_array_elements(v_append) item
  left join public.store_product_opening_balances b
    on b.store_id=p_store_id and b.product_id=(item->>'product_id')::uuid
  where not exists(
    select 1 from private.count_opening_snapshots s
    where s.session_id=v_session.id and s.product_id=(item->>'product_id')::uuid
  );

  perform private.capture_count_prices(v_session.id);
  return v_session.id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.import_pilot_inventory(p_store_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_rows jsonb;
  v_file jsonb;
  v_import_file_id uuid;
  v_row jsonb;
  v_ordinal bigint;
  v_results jsonb := '[]'::jsonb;
  v_source_id text;
  v_sheet_name text;
  v_source_row integer;
  v_product_code text;
  v_generated_code boolean;
  v_name text;
  v_specification text;
  v_count_unit text;
  v_supplier_name text;
  v_zone_name text;
  v_opening_quantity numeric;
  v_missing_fields jsonb;
  v_raw_values jsonb;
  v_merged_ranges jsonb;
  v_product_id uuid;
  v_zone_id uuid;
  v_supplier_id uuid;
  v_existing_supplier_id uuid;
  v_supplier_matches integer;
  v_existing_name text;
  v_matched_by text;
  v_status text;
  v_reason text;
  v_warning text;
  v_sort integer;
  v_added_count integer := 0;
  v_existing_count integer := 0;
  v_failed_count integer := 0;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select organization_id into v_org
  from public.stores
  where id = p_store_id and is_active;

  if v_org is null
    or not private.can_import_inventory(p_store_id)
  then
    raise exception using errcode = '42501', message = 'STORE_MANAGER_REQUIRED';
  end if;

  if jsonb_typeof(p_rows) = 'array' then
    v_rows := p_rows;
    v_file := null;
  elsif jsonb_typeof(p_rows) = 'object' then
    v_rows := p_rows->'rows';
    v_file := p_rows->'file';
  else
    raise exception using errcode = '22023', message = 'IMPORT_PAYLOAD_INVALID';
  end if;

  if jsonb_typeof(v_rows) <> 'array'
    or jsonb_array_length(v_rows) = 0
    or jsonb_array_length(v_rows) > 500
  then
    raise exception using errcode = '22023', message = 'IMPORT_REQUIRES_1_TO_500_ROWS';
  end if;

  if v_file is not null then
    if coalesce(v_file->>'original_filename', '') = ''
      or coalesce(v_file->>'file_sha256', '') !~ '^[0-9a-f]{64}$'
      or coalesce(v_file->>'storage_path', '') = ''
    then
      raise exception using errcode = '22023', message = 'IMPORT_FILE_METADATA_INVALID';
    end if;

    insert into public.inventory_import_files(
      organization_id, store_id, original_filename, file_sha256, storage_path,
      sheet_names, row_count, imported_by
    ) values (
      v_org, p_store_id, v_file->>'original_filename', v_file->>'file_sha256',
      v_file->>'storage_path', coalesce(v_file->'sheet_names', '[]'::jsonb),
      jsonb_array_length(v_rows), v_user
    )
    on conflict (store_id, file_sha256) do update set
      last_imported_at = now(),
      row_count = excluded.row_count
    returning id into v_import_file_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('import:'||p_store_id::text,0));
  for v_row, v_ordinal in
    select value, ordinality from jsonb_array_elements(v_rows) with ordinality
  loop
    begin
      v_source_id := coalesce(nullif(btrim(v_row->>'source_id'), ''), v_ordinal::text);
      v_sheet_name := coalesce(nullif(btrim(v_row->>'sheet_name'), ''), 'Sheet');
      v_source_row := coalesce(nullif(v_row->>'source_row', '')::integer, v_ordinal::integer);
      v_product_code := upper(nullif(btrim(v_row->>'product_code'), ''));
      v_generated_code := coalesce((v_row->>'generated_code')::boolean, false);
      v_name := nullif(btrim(v_row->>'name'), '');
      v_specification := coalesce(btrim(v_row->>'specification'), '');
      v_count_unit := coalesce(nullif(btrim(v_row->>'count_unit'), ''), '待補單位');
      v_supplier_name := nullif(btrim(v_row->>'supplier_name'), '');
      v_zone_name := coalesce(nullif(btrim(v_row->>'zone_name'), ''), '未分類');
      v_opening_quantity := nullif(v_row->>'opening_quantity', '')::numeric;
      v_missing_fields := case when jsonb_typeof(v_row->'missing_fields') = 'array' then v_row->'missing_fields' else '[]'::jsonb end;
      v_raw_values := case when jsonb_typeof(v_row->'raw_values') = 'object' then v_row->'raw_values' else '{}'::jsonb end;
      v_merged_ranges := case when jsonb_typeof(v_row->'merged_ranges') = 'array' then v_row->'merged_ranges' else '[]'::jsonb end;
      v_product_id := null;
      v_supplier_id := null;
      v_existing_supplier_id := null;
      v_warning := null;
      v_status := 'ADDED';


      if v_import_file_id is not null then
        select product_id into v_product_id from public.inventory_import_rows where import_file_id=v_import_file_id and source_id=v_source_id and product_id is not null;
        if v_product_id is not null then
          v_results:=v_results||jsonb_build_array(jsonb_build_object('source_id',v_source_id,'sheet_name',v_sheet_name,'source_row',v_source_row,'name',v_name,'product_id',v_product_id,'status','EXISTING','reason','此來源列已建檔，保留既有品項與歷史'));
          perform private.restore_removed_import_product(p_store_id,v_import_file_id,v_product_id,false); v_existing_count:=v_existing_count+1;continue;
        end if;
      end if;
      if v_name is null then
        raise exception using errcode = '22023', message = 'PRODUCT_NAME_REQUIRED';
      end if;

      if v_count_unit in ('','待補單位') or v_count_unit is null then raise exception using errcode='22023',message='UNIT_CONFIRMATION_REQUIRED';end if;
      if v_opening_quantity is not null and v_opening_quantity < 0 then
        raise exception using errcode = '22023', message = 'OPENING_QUANTITY_MUST_BE_NON_NEGATIVE';
      end if;
      if v_product_code is null then
        v_product_code := 'SEQ-' || upper(substr(md5(lower(v_name || '|' || v_specification || '|' || v_count_unit)), 1, 16));
        v_generated_code := true;
      end if;

      if v_supplier_name is not null then
        select (array_agg(id order by created_at, id))[1], count(*)::integer
        into v_supplier_id, v_supplier_matches
        from public.suppliers
        where organization_id = v_org and is_active
          and regexp_replace(lower(name), '\s+', '', 'g') = regexp_replace(lower(v_supplier_name), '\s+', '', 'g');

        if v_supplier_matches = 0 then
          insert into public.suppliers(organization_id, supplier_code, name)
          values (v_org, 'IMP-' || upper(substr(md5(v_org::text || lower(v_supplier_name)), 1, 12)), v_supplier_name)
          on conflict (organization_id, supplier_code) do nothing
          returning id into v_supplier_id;
          if v_supplier_id is null then
            select id into v_supplier_id from public.suppliers
            where organization_id = v_org
              and supplier_code = 'IMP-' || upper(substr(md5(v_org::text || lower(v_supplier_name)), 1, 12));
          end if;
        elsif v_supplier_matches > 1 then
          v_supplier_id := null;
          v_warning := '供應商名稱有多筆相符，保留來源並待主管確認';
        end if;
      end if;

      select id, name, current_supplier_id
      into v_product_id, v_existing_name, v_existing_supplier_id
      from public.products
      where organization_id = v_org and upper(product_code) = v_product_code
      limit 1;

      if v_product_id is not null then
        if regexp_replace(lower(normalize(v_existing_name,NFKC)), '\s+', '', 'g') <> regexp_replace(lower(normalize(v_name,NFKC)), '\s+', '', 'g') then
          raise exception using errcode = '23505', message = 'PRODUCT_CODE_ALREADY_USED_BY_ANOTHER_ITEM';
        end if;
        v_status := 'EXISTING';
        v_matched_by := 'product_code';
      else
        select id, name, current_supplier_id
        into v_product_id, v_existing_name, v_existing_supplier_id
        from public.products
        where organization_id = v_org
          and regexp_replace(lower(name), '\s+', '', 'g') = regexp_replace(lower(normalize(v_name,NFKC)), '\s+', '', 'g')
          and regexp_replace(lower(coalesce(specification, '')), '\s+', '', 'g') = regexp_replace(lower(v_specification), '\s+', '', 'g')
          and regexp_replace(lower(coalesce(count_unit, '')), '\s+', '', 'g') = regexp_replace(lower(v_count_unit), '\s+', '', 'g')
        order by created_at limit 1;

        if v_product_id is not null then
          v_status := 'EXISTING';
          v_matched_by := 'name_specification_unit';
        else
          insert into public.products(
            organization_id, product_code, name, specification, category, base_unit, count_unit, current_supplier_id
          ) values (
            v_org, v_product_code, v_name, v_specification, '其他', v_count_unit, v_count_unit, v_supplier_id
          ) returning id, current_supplier_id into v_product_id, v_existing_supplier_id;
        end if;
      end if;

      if v_supplier_id is not null then
        if v_existing_supplier_id is not null and v_existing_supplier_id <> v_supplier_id then
          v_warning := concat_ws('；', v_warning, '既有品項已連結其他供應商，未覆寫並待主管確認');
          v_supplier_id := v_existing_supplier_id;
        elsif v_existing_supplier_id is null then
          update public.products set current_supplier_id = v_supplier_id, updated_at = now()
          where id = v_product_id and organization_id = v_org;
        end if;
        insert into public.product_supplier_history(organization_id, product_id, supplier_id, effective_from, is_current)
        select v_org, v_product_id, v_supplier_id, current_date, true
        where not exists (
          select 1 from public.product_supplier_history
          where organization_id = v_org and product_id = v_product_id and supplier_id = v_supplier_id and is_current
        );
      end if;

      select id into v_zone_id from public.count_zones
      where organization_id = v_org and store_id = p_store_id and is_active
        and regexp_replace(lower(name), '\s+', '', 'g') = regexp_replace(lower(v_zone_name), '\s+', '', 'g')
      order by created_at limit 1;
      if v_zone_id is null then
        select coalesce(max(sort_order), -1) + 1 into v_sort from public.count_zones where store_id = p_store_id;
        insert into public.count_zones(organization_id, store_id, name, sort_order)
        values (v_org, p_store_id, v_zone_name, v_sort) returning id into v_zone_id;
      end if;


      -- The existing per-row exception block rolls back this local flag on failure.
      -- Restore it explicitly on success so it never enables unrelated mutations.
      declare v_previous_maintenance text:=current_setting('app.opening_balance_maintenance',true);
      begin
      perform set_config('app.opening_balance_maintenance','on',true);
      perform private.restore_removed_import_product(p_store_id,v_import_file_id,v_product_id,true);
      if v_opening_quantity is not null then
        insert into public.store_product_opening_balances(
          organization_id, store_id, product_id, quantity, unit, source, created_by
        ) values (v_org, p_store_id, v_product_id, v_opening_quantity, v_count_unit, 'FILE_IMPORT', v_user)
        on conflict (store_id, product_id) do update set quantity = public.store_product_opening_balances.quantity + excluded.quantity;
      end if;


      perform set_config('app.opening_balance_maintenance',coalesce(v_previous_maintenance,''),true);
      end;
      select coalesce(max(sort_order), -1) + 1 into v_sort from public.zone_products where zone_id = v_zone_id;
      insert into public.zone_products(zone_id, product_id, sort_order, count_unit)
      values (v_zone_id, v_product_id, v_sort, v_count_unit)
      on conflict (zone_id, product_id) do nothing;

      v_reason := case
        when v_status = 'ADDED' then '品項與盤點區域已建立'
        when v_matched_by = 'product_code' then '既有品項：品項代碼相同'
        else '既有品項：品名、規格與單位相同'
      end;
      if v_opening_quantity is null then v_reason:=v_reason||'；期初未提供';end if;
      if not (select is_active from public.products where id=v_product_id) then v_reason:=v_reason||'；既有停用品項，維持停用';end if;
      if v_warning is not null then v_reason := v_reason || '；' || v_warning; end if;

      if v_import_file_id is not null then
        insert into public.inventory_import_rows(
          import_file_id, organization_id, store_id, source_id, sheet_name, source_row,
          raw_values, merged_ranges, normalized_values, status, reason, product_id, supplier_id
        ) values (
          v_import_file_id, v_org, p_store_id, v_source_id, v_sheet_name, v_source_row,
          v_raw_values, v_merged_ranges,
          jsonb_build_object('name',v_name,'specification',v_specification,'unit',v_count_unit,'supplier',v_supplier_name,'zone',v_zone_name,'product_code',v_product_code,'opening_quantity',v_opening_quantity,'unit_price',nullif(v_row->>'unit_price','')::numeric),
          case when v_warning is null then v_status else 'PENDING' end, v_reason, v_product_id, v_supplier_id
        ) on conflict (import_file_id, source_id) do update set
          raw_values = inventory_import_rows.raw_values, merged_ranges = inventory_import_rows.merged_ranges,
          normalized_values = excluded.normalized_values, status = excluded.status,
          reason = excluded.reason, product_id = excluded.product_id, supplier_id = excluded.supplier_id,
          updated_at = now();
      end if;

      if nullif(v_row->>'unit_price','') is not null then
        insert into private.count_catalog_prices(store_id,product_id,unit,unit_price,source)
        values(p_store_id,v_product_id,v_count_unit,(v_row->>'unit_price')::numeric,'IMPORT')
        on conflict(store_id,product_id,unit) do nothing;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_id',v_source_id,'sheet_name',v_sheet_name,'source_row',v_source_row,
        'name',v_name,'product_code',v_product_code,'product_id',v_product_id,
        'supplier_name',v_supplier_name,'supplier_id',v_supplier_id,'status',v_status,
        'matched_by',v_matched_by,'missing_fields',v_missing_fields,'reason',v_reason
      ));
      if v_status = 'ADDED' then v_added_count := v_added_count + 1;
      else v_existing_count := v_existing_count + 1; end if;
    exception when others then
      v_failed_count := v_failed_count + 1;
      v_reason := sqlerrm;
      if v_import_file_id is not null then
        insert into public.inventory_import_rows(
          import_file_id, organization_id, store_id, source_id, sheet_name, source_row,
          raw_values, merged_ranges, normalized_values, status, reason
        ) values (
          v_import_file_id, v_org, p_store_id, coalesce(v_source_id,v_ordinal::text),
          coalesce(v_sheet_name,'Sheet'), coalesce(v_source_row,v_ordinal::integer),
          coalesce(v_raw_values,'{}'::jsonb), coalesce(v_merged_ranges,'[]'::jsonb),
          coalesce(v_row,'{}'::jsonb), 'FAILED', v_reason
        ) on conflict (import_file_id, source_id) do update set
          raw_values = inventory_import_rows.raw_values, merged_ranges = inventory_import_rows.merged_ranges,
          normalized_values = excluded.normalized_values, status = 'FAILED',
          reason = excluded.reason, updated_at = now();
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_id',coalesce(v_source_id,v_ordinal::text),'sheet_name',coalesce(v_sheet_name,'Sheet'),
        'source_row',coalesce(v_source_row,v_ordinal::integer),'name',v_name,
        'supplier_name',v_supplier_name,'status','FAILED','sqlstate',sqlstate,'reason',v_reason
      ));
    end;
  end loop;

  if v_import_file_id is not null then
    update public.inventory_import_files set
      added_count = v_added_count, existing_count = v_existing_count,
      failed_count = v_failed_count, last_imported_at = now()
    where id = v_import_file_id;
  end if;

  insert into public.audit_logs(organization_id, entity_type, entity_id, action, new_value, user_id)
  values (v_org, 'store', p_store_id, 'PILOT_INVENTORY_IMPORT_COMPLETED',
    jsonb_build_object('import_file_id',v_import_file_id,'submitted_rows',jsonb_array_length(v_rows),
      'added',v_added_count,'existing',v_existing_count,'failed',v_failed_count), v_user);
  return v_results;
end;
$function$;


revoke all on function private.count_has_work(uuid),private.count_price(uuid,uuid,text),private.capture_count_prices(uuid),private.refresh_unstarted_count(uuid),private.count_catalog_operation(uuid,text,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
