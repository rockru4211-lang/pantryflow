-- Count V2.1: interrupt/resume, add items during a count, keep discrepancies asynchronous,
-- and let zero-stock items be excluded from the next count without deleting history.
begin;

create table private.count_next_exclusions (
  store_id uuid not null references public.stores(id),
  product_id uuid not null references public.products(id),
  excluded_by uuid not null references public.profiles(id),
  excluded_at timestamptz not null default now(),
  primary key (store_id, product_id)
);
revoke all on private.count_next_exclusions from public, anon, authenticated;

create or replace function public.set_pilot_count_next_period(
  p_store_id uuid, p_product_id uuid, p_action text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_actor uuid := (select auth.uid()); v_name text; v_active boolean;
begin
  select s.organization_id,p.name,p.is_active into v_org,v_name,v_active
  from public.stores s join public.products p on p.organization_id=s.organization_id
  where s.id=p_store_id and s.is_active and p.id=p_product_id;
  if v_org is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if p_action not in ('KEEP','EXCLUDE','DISABLE') then raise exception 'INVALID_NEXT_COUNT_ACTION' using errcode='22023'; end if;
  if p_action='KEEP' then
    delete from private.count_next_exclusions where store_id=p_store_id and product_id=p_product_id;
  elsif p_action='EXCLUDE' then
    insert into private.count_next_exclusions(store_id,product_id,excluded_by)
    values(p_store_id,p_product_id,v_actor)
    on conflict(store_id,product_id) do update set excluded_by=excluded.excluded_by,excluded_at=now();
  else
    delete from private.count_next_exclusions where store_id=p_store_id and product_id=p_product_id;
    update public.products set is_active=false,updated_at=now() where id=p_product_id and organization_id=v_org;
  end if;
  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,p_store_id,'product',p_product_id,'COUNT_NEXT_PERIOD_SETTING',jsonb_build_object('action',p_action,'name',v_name),v_actor);
  return jsonb_build_object('product_id',p_product_id,'action',p_action,'active',case when p_action='DISABLE' then false else v_active end);
end $$;
revoke all on function public.set_pilot_count_next_period(uuid,uuid,text) from public,anon;
grant execute on function public.set_pilot_count_next_period(uuid,uuid,text) to authenticated;

create or replace function public.add_pilot_count_item(
  p_session_id uuid, p_zone_id uuid, p_name text, p_unit text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.inventory_count_sessions%rowtype; z public.count_zones%rowtype; v_actor uuid:=(select auth.uid()); v_product uuid; v_sort integer; v_item jsonb;
begin
  select * into s from public.inventory_count_sessions where id=p_session_id and status='IN_PROGRESS' for update;
  if not found or not private.has_active_store_role(s.store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_COUNTER_REQUIRED';
  end if;
  select * into z from public.count_zones where id=p_zone_id and store_id=s.store_id and is_active;
  if not found or exists(select 1 from public.count_zone_progress where session_id=s.id and zone_id=z.id and status='COMPLETED') then
    raise exception 'COUNT_ZONE_NOT_AVAILABLE' using errcode='22023';
  end if;
  if btrim(coalesce(p_name,''))='' or length(btrim(p_name))>160 or btrim(coalesce(p_unit,''))='' or length(btrim(p_unit))>30 then
    raise exception 'INVALID_COUNT_ITEM' using errcode='22023';
  end if;
  insert into public.products(organization_id,product_code,name,category,base_unit,count_unit,is_active)
  values(s.organization_id,'CNT-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),btrim(p_name),'其他',btrim(p_unit),btrim(p_unit),true)
  returning id into v_product;
  select coalesce(max(sort_order),-1)+1 into v_sort from public.zone_products where zone_id=z.id;
  insert into public.zone_products(zone_id,product_id,sort_order,count_unit) values(z.id,v_product,v_sort,btrim(p_unit));
  v_item:=jsonb_build_object('zone_id',z.id,'zone_name',z.name,'product_id',v_product,'product_code',(select product_code from public.products where id=v_product),
    'product_name',btrim(p_name),'unit',btrim(p_unit),'supplier',null,'specification',null,'file_name',null,'sheet_name',null,'source_row',null,'file_order',null,'sheet_order',null,'added_during_count',true);
  update public.inventory_count_sessions set snapshot=jsonb_set(snapshot,'{zones}',coalesce(snapshot->'zones','[]'::jsonb)||jsonb_build_array(v_item),false) where id=s.id;
  insert into private.count_opening_snapshots(session_id,product_id,quantity,confirmed_at) values(s.id,v_product,null,now()) on conflict do nothing;
  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
  values(s.organization_id,s.store_id,'inventory_count_session',s.id,'COUNT_ITEM_ADDED_DURING_COUNT',jsonb_build_object('zone_id',z.id,'product_id',v_product,'name',btrim(p_name),'unit',btrim(p_unit)),v_actor);
  return v_product;
end $$;
revoke all on function public.add_pilot_count_item(uuid,uuid,text,text) from public,anon;
grant execute on function public.add_pilot_count_item(uuid,uuid,text,text) to authenticated;

create or replace function public.start_pilot_count(p_store_id uuid,p_selection jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_org uuid; v_type text; v_actor uuid:=(select auth.uid()); v_snapshot jsonb; v_old public.inventory_count_sessions%rowtype;
begin
 select s.organization_id,o.business_type into v_org,v_type from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store_id and s.is_active for update of s;
 if v_org is null or not private.has_active_store_role(p_store_id,null) then raise exception using errcode='42501',message='STORE_MEMBERSHIP_REQUIRED'; end if;
 select * into v_old from public.inventory_count_sessions where store_id=p_store_id order by started_at desc limit 1;
 if v_old.status in ('DRAFT','IN_PROGRESS') then return v_old.id; end if;
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
 from public.inventory_import_rows r join public.inventory_import_files f on f.id=r.import_file_id where r.store_id=p_store_id and r.product_id=p.id order by f.created_at,r.created_at,r.id limit 1) src on true
 where z.store_id=p_store_id and z.is_active
   and not exists(select 1 from private.count_next_exclusions x where x.store_id=p_store_id and x.product_id=p.id)
   and (p_selection is null or exists(select 1 from jsonb_array_elements(p_selection) item where item->>'zone_id'=z.id::text and item->>'product_id'=p.id::text));
 if jsonb_array_length(v_snapshot->'zones')=0 then raise exception 'ZONE_PRODUCTS_REQUIRED'; end if;
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
 return v_id;
end $$;
revoke all on function public.start_pilot_count(uuid,jsonb) from public,anon;
grant execute on function public.start_pilot_count(uuid,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
