-- Atomic multi-item field transfers; retain existing RPC, ACLs and admin review.
-- No table/member/PIN changes or stock posting. Single-item clients remain supported.
create or replace function private.create_store_transfer(p_store uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_role text:=private.app_role(p_store);
 v_org uuid;v_mode text;v_store_name text;v_from uuid;v_to uuid;v_product uuid;
 v_name text;v_unit text;v_qty numeric;v_available numeric;
 v_move private.store_movements;v_result jsonb;
 v_batch jsonb:='[]'::jsonb;v_item jsonb;v_seen text[]:=array[]::text[];v_key text;v_index integer:=0;
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
 -- The existing outer app_operation owns one transaction and one durable retry key.
 -- A rejected row rolls back every movement, event and unit written by this batch.
 if p_data ? 'items' then
  if jsonb_typeof(p_data->'items') is distinct from 'array' then
   raise exception 'INVALID_TRANSFER_ITEMS' using errcode='22023';end if;
  if jsonb_array_length(p_data->'items') not between 1 and 50 then
   raise exception 'INVALID_TRANSFER_ITEM_COUNT' using errcode='22023';end if;
  for v_item in select value from jsonb_array_elements(p_data->'items') loop
   v_index:=v_index+1;
   begin
    if jsonb_typeof(v_item) is distinct from 'object' or v_item ?| array['items','from_store_id','to_store_id','note'] then
     raise exception 'INVALID_TRANSFER_ITEM' using errcode='22023';end if;
    v_key:=case when nullif(v_item->>'product_id','') is not null
      then 'product:'||lower((v_item->>'product_id')::uuid::text)
      else 'manual:'||lower(btrim(coalesce(v_item->>'name','')))||':'||btrim(coalesce(v_item->>'unit','')) end;
    if v_key=any(v_seen) then raise exception 'INVALID_DUPLICATE_TRANSFER_ITEM' using errcode='22023';end if;
    v_seen:=array_append(v_seen,v_key);
    v_result:=private.create_store_transfer(p_store,v_item||jsonb_build_object(
      'from_store_id',v_from,'to_store_id',v_to,'note',coalesce(p_data->>'note','')));
    v_batch:=v_batch||jsonb_build_array(v_result);
   exception when others then
    raise exception 'TRANSFER_ITEM_%: %',v_index,sqlerrm using errcode=sqlstate;
   end;
  end loop;
  return jsonb_build_object('id',v_batch->0->>'id','items',v_batch,'count',jsonb_array_length(v_batch));
 end if;
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
 -- Record quantities in the chosen unit, without guessing package conversions.
 -- Missing unit preserves old single-item clients' canonical unit behavior.
 if p_data ? 'unit' then
  v_unit:=btrim(coalesce(p_data->>'unit',''));
  if length(v_unit) not between 1 and 30 then raise exception 'INVALID_UNIT' using errcode='22023';end if;
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

create or replace function private.transfers_workspace_v2(p_store uuid,p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_role text:=private.app_role(p_store);v_org uuid;v_mode text;v_erp boolean;v_store_name text;
 v_start timestamptz:=coalesce(nullif(p_filter->>'from','')::timestamptz,date_trunc('month',now()));
 v_end timestamptz:=coalesce(nullif(p_filter->>'to','')::timestamptz,now()+interval '1 day');v_records jsonb;
begin
 if v_role is null or v_role not in ('STAFF','SUPERVISOR','LOGISTICS','OWNER') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select s.organization_id,o.store_mode,o.has_erp,s.name into v_org,v_mode,v_erp,v_store_name
 from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store and s.is_active;
 if v_store_name is null or v_store_name not in ('BeApe','Gras') then raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501';end if;
 if v_mode is distinct from 'MULTI' then raise exception 'MULTI_STORE_REQUIRED' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object(
  'from_name',fs.name,'to_name',ts.name,
  'actor_name',coalesce(nullif(m.original_actor_name,''),creator.display_name),
  'reviewer_name',reviewer.display_name,
  'supplier_name',case when m.review_status='CONFIRMED' then coalesce(sp.name,legacy.supplier_name) else null end,
  'reference_price',case when m.review_status='CONFIRMED' then m.unit_price_snapshot else legacy.unit_price end,
  'transfer_amount',case when m.review_status='CONFIRMED' then m.amount_snapshot else null end,
  'events',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',ep.display_name) order by e.created_at),'[]'::jsonb)
   from private.store_movement_events e left join public.profiles ep on ep.id=e.actor_id where e.movement_id=m.id)
 ) order by coalesce(m.occurred_at,m.created_at) desc),'[]'::jsonb) into v_records
 from private.store_movements m join public.stores fs on fs.id=m.from_store_id join public.stores ts on ts.id=m.to_store_id
 left join public.profiles creator on creator.id=m.created_by left join public.profiles reviewer on reviewer.id=m.reviewed_by
 left join public.suppliers sp on sp.id=m.supplier_id
 left join lateral (
  select s.name supplier_name,rl.unit_price_ex_tax unit_price from public.receipt_lines rl
  join public.goods_receipts g on g.id=rl.receipt_id join public.receipt_upload_batches b on b.id=g.source_batch_id
  left join public.suppliers s on s.id=g.supplier_id
  where g.store_id=m.from_store_id and b.status::text='COMPLETED' and rl.product_id=m.product_id and rl.unit=m.unit
  order by g.receipt_date desc nulls last,g.reviewed_at desc nulls last,rl.created_at desc limit 1
 ) legacy on true
 where m.organization_id=v_org and fs.name in ('BeApe','Gras') and ts.name in ('BeApe','Gras')
 and (m.from_store_id=p_store or m.to_store_id=p_store)
 and (m.review_status='PENDING' or m.status='OPEN' or (coalesce(m.occurred_at,m.created_at)>=v_start and coalesce(m.occurred_at,m.created_at)<v_end));
 return jsonb_build_object(
  'records',v_records,'role',v_role,'has_erp',v_erp,
  'stores',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name),'[]'::jsonb)
    from public.stores s where s.organization_id=v_org and s.is_active and s.id<>p_store and s.name in ('BeApe','Gras')),
  'transfer_batch_version',1,
  'transfer_catalogs',(
   select coalesce(jsonb_agg(jsonb_build_object('store_id',s.id,'store_name',s.name,'products',(
    select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,
     'unit',coalesce(nullif(p.count_unit,''),p.base_unit),'available_for_transfer',true) order by p.name,p.id),'[]'::jsonb)
    from public.products p where p.organization_id=v_org and p.is_active
    and private.count_product_not_removed(s.id,p.id)
    and not exists(select 1 from private.count_field_removed fr where fr.store_id=s.id and fr.product_id=p.id)
    and exists(select 1 from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
     where z.store_id=s.id and z.is_active and zp.product_id=p.id)
   )) order by s.name,s.id),'[]'::jsonb)
   from public.stores s where s.organization_id=v_org and s.is_active and s.name in ('BeApe','Gras')
  ),
  'units',(select coalesce(jsonb_agg(unit order by unit),'[]') from private.store_units where store_id=p_store),
  'products',(
   select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.name,'available_for_transfer',private.count_product_not_removed(p_store,p.id) and not exists(select 1 from private.count_field_removed fr where fr.store_id=p_store and fr.product_id=p.id),
    'unit',coalesce(nullif(p.count_unit,''),p.base_unit),'current_supplier_id',p.current_supplier_id,'current_supplier_name',cs.name,
    'suppliers',(
     select coalesce(jsonb_agg(jsonb_build_object('id',q.supplier_id,'name',q.supplier_name,'unit_price',q.unit_price,'receipt_date',q.receipt_date) order by q.receipt_date desc nulls last),'[]'::jsonb)
     from (select distinct on(g.supplier_id) g.supplier_id,s2.name supplier_name,rl.unit_price_ex_tax unit_price,g.receipt_date
      from public.receipt_lines rl join public.goods_receipts g on g.id=rl.receipt_id join public.receipt_upload_batches b on b.id=g.source_batch_id
      left join public.suppliers s2 on s2.id=g.supplier_id
      where g.store_id=p_store and b.status::text='COMPLETED' and rl.product_id=p.id
      and rl.unit=coalesce(nullif(p.count_unit,''),p.base_unit) and g.supplier_id is not null
      order by g.supplier_id,g.receipt_date desc nulls last,g.reviewed_at desc nulls last,rl.created_at desc
     ) q
    )
   ) order by p.name),'[]'::jsonb)
   from public.products p left join public.suppliers cs on cs.id=p.current_supplier_id
   where p.organization_id=v_org and p.is_active and exists(select 1 from public.count_zones z
    join public.zone_products zp on zp.zone_id=z.id where z.store_id=p_store and z.is_active and zp.product_id=p.id)
  )
 );
end;$$;
