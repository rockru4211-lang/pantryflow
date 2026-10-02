-- Explicit direction with the authenticated store retained as recording context.
-- No membership changes, stock posting, historical rewrites or public RPC changes.
create or replace function private.create_store_transfer(p_store uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_role text:=private.app_role(p_store);
 v_org uuid;v_mode text;v_store_name text;v_from uuid;v_to uuid;v_product uuid;
 v_name text;v_unit text;v_qty numeric;v_available numeric;
 v_move private.store_movements;v_result jsonb;
begin
 select s.organization_id,o.store_mode,s.name into v_org,v_mode,v_store_name
 from public.stores s join public.organizations o on o.id=s.organization_id
 where s.id=p_store and s.is_active;
 if v_store_name is null or v_store_name not in ('BeApe','Gras') then
  raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501';end if;
 if v_role is null or v_role not in ('STAFF','SUPERVISOR','LOGISTICS','OWNER') then
  raise exception 'FIELD_ROLE_REQUIRED' using errcode='42501';end if;
 if v_mode is distinct from 'MULTI' then
  raise exception 'MULTI_STORE_REQUIRED' using errcode='42501';end if;
 -- Only omitted source means legacy outbound; an explicitly blank source is invalid.
 v_from:=case when p_data ? 'from_store_id' then nullif(p_data->>'from_store_id','')::uuid else p_store end;
 v_to:=nullif(p_data->>'to_store_id','')::uuid;
 v_product:=nullif(p_data->>'product_id','')::uuid;
 v_qty:=nullif(p_data->>'quantity','')::numeric;
 if v_from is null or v_to is null or v_from=v_to or p_store not in (v_from,v_to)
   or not exists(
    select 1 from public.stores fs join public.stores ts on ts.id=v_to
    where fs.id=v_from and fs.organization_id=v_org and ts.organization_id=v_org
    and fs.is_active and ts.is_active and fs.name in ('BeApe','Gras')
    and ts.name in ('BeApe','Gras') and fs.name<>ts.name
   ) then raise exception 'INVALID_DESTINATION_STORE' using errcode='22023';end if;
 if v_qty is null or v_qty<=0 or v_qty>=1000000000 then
  raise exception 'INVALID_QUANTITY' using errcode='22023';end if;
 if v_product is null then
  if not coalesce((p_data->>'manual')::boolean,false) then raise exception 'INVALID_PRODUCT' using errcode='22023';end if;
  v_name:=btrim(coalesce(p_data->>'name',''));v_unit:=btrim(coalesce(p_data->>'unit',''));
  if length(v_name) not between 1 and 160 or length(v_unit) not between 1 and 30 then
   raise exception 'INVALID_PRODUCT' using errcode='22023';end if;
 else
  select p.name,coalesce(nullif(p.count_unit,''),p.base_unit) into v_name,v_unit
  from public.products p where p.id=v_product and p.organization_id=v_org and p.is_active
   and private.count_product_not_removed(v_from,p.id)
   and not exists(select 1 from private.count_field_removed fr where fr.store_id=v_from and fr.product_id=p.id)
   and exists(select 1 from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
    where z.store_id=v_from and z.is_active and zp.product_id=p.id);
  if v_name is null then raise exception 'INVALID_PRODUCT' using errcode='22023';end if;
 end if;
 select coalesce(sum(sp.quantity),0) into v_available from private.stock_positions sp
 where sp.store_id=v_from and sp.product_id=v_product and sp.unit=v_unit and sp.state='READY';
 insert into private.store_movements(
  organization_id,from_store_id,to_store_id,kind,product_id,name,quantity,unit,
  returned_quantity,expected_return_on,status,created_by,closed_at,
  supplier_id,unit_price_snapshot,amount_snapshot,note,review_status,available_snapshot,stock_warning
 ) values(v_org,v_from,v_to,'TRANSFER',v_product,v_name,v_qty,v_unit,0,null,
 'COMPLETE',auth.uid(),null,null,null,null,btrim(coalesce(p_data->>'note','')),
 'PENDING',case when v_product is null then null else v_available end,v_product is not null and v_available<v_qty
 ) returning * into v_move;
 insert into private.store_units(store_id,unit) values(v_from,v_unit) on conflict do nothing;
 insert into private.store_units(store_id,unit) values(v_to,v_unit) on conflict do nothing;
 insert into private.store_movement_events(movement_id,store_id,action,name,quantity,unit,actor_id)
 values(v_move.id,p_store,'CREATE',v_name,v_qty,v_unit,auth.uid());
 select to_jsonb(v_move)||jsonb_build_object('from_name',fs.name,'to_name',ts.name,
 'actor_name',pr.display_name,'supplier_name',null,'reference_price',null,'transfer_amount',null)
 into v_result from public.stores fs join public.stores ts on ts.id=v_move.to_store_id
 left join public.profiles pr on pr.id=v_move.created_by where fs.id=v_move.from_store_id;
 return v_result;
end;$$;

-- Only the source product identity and unit are exposed to the receiving recorder.
create or replace function private.baihuayuan_transfer_catalogs(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text:=private.app_role(p_store);v_org uuid;v_name text;v_mode text;v_catalogs jsonb;
begin
 if v_role is null or v_role not in ('STAFF','SUPERVISOR','LOGISTICS','OWNER') then
  raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select s.organization_id,s.name,o.store_mode into v_org,v_name,v_mode
 from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store and s.is_active;
 if v_org is null or v_name not in ('BeApe','Gras') or v_mode is distinct from 'MULTI' then
  return '[]'::jsonb;end if;
 select coalesce(jsonb_agg(jsonb_build_object('store_id',s.id,'store_name',s.name,'products',
  coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,
  'unit',coalesce(nullif(p.count_unit,''),p.base_unit),'available_for_transfer',true) order by p.name,p.id)
  from public.products p where p.organization_id=v_org and p.is_active
   and private.count_product_not_removed(s.id,p.id)
   and not exists(select 1 from private.count_field_removed fr where fr.store_id=s.id and fr.product_id=p.id)
   and exists(select 1 from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
    where z.store_id=s.id and z.is_active and zp.product_id=p.id)),'[]'::jsonb)) order by s.name,s.id),'[]'::jsonb)
 into v_catalogs from public.stores s where s.organization_id=v_org and s.is_active and s.name in ('BeApe','Gras');
 return v_catalogs;
end;$$;
-- These are internal helpers, not additional client RPCs.
revoke all on function private.baihuayuan_transfer_catalogs(uuid) from public,anon,authenticated;

-- Preserve the actual pre-migration workspace rather than assuming an alias exists.
-- Copying its definition retains the original OID/ACL of transfers_workspace_v2,
-- and keeps existing pricing, supplier metadata, reviews and history unchanged.
do $preserve$
declare definition text; original_header constant text:='CREATE OR REPLACE FUNCTION private.transfers_workspace_v2(';
begin
 if to_regprocedure('private.transfers_workspace_before_directions_20261002(uuid,jsonb)') is null then
  definition:=pg_get_functiondef('private.transfers_workspace_v2(uuid,jsonb)'::regprocedure);
  if position(original_header in definition)<>1 or position('baihuayuan_transfer_catalogs' in definition)>0 then
   raise exception 'UNEXPECTED_TRANSFER_WORKSPACE_BASE';
  end if;
  execute overlay(definition placing 'CREATE OR REPLACE FUNCTION private.transfers_workspace_before_directions_20261002(' from 1 for length(original_header));
 end if;
end;
$preserve$;
revoke all on function private.transfers_workspace_before_directions_20261002(uuid,jsonb) from public,anon,authenticated;

create or replace function private.transfers_workspace_v2(p_store uuid,p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
 v_result:=private.transfers_workspace_before_directions_20261002(p_store,p_filter);
 if v_result is null or jsonb_typeof(v_result)<>'object' then raise exception 'INVALID_TRANSFER_WORKSPACE';end if;
 return v_result||jsonb_build_object('transfer_catalogs',private.baihuayuan_transfer_catalogs(p_store));
end;$$;
