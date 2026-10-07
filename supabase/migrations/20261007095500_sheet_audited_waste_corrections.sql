-- Keep history append-only except the scoped, audited correction RPC.
create or replace function private.prevent_pilot_history_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_schema='public' and tg_table_name='store_product_opening_balances'
 and current_setting('app.opening_balance_maintenance',true)='on'
 and auth.uid() is not null and private.can_import_inventory(coalesce(old.store_id,new.store_id)) then
  if tg_op='DELETE' then return old;end if;return new;
 end if;
 if tg_table_schema='private' and tg_table_name='waste_records' and tg_op='UPDATE' then
  if current_setting('app.sheet_waste_correction',true)=old.id::text
   and auth.uid() is not null and private.baihuayuan_can_confirm_backoffice(old.store_id)
   and (to_jsonb(old)-array['name','quantity','reference_price','reason','note','actor_name','occurred_at','work_date'])
    =(to_jsonb(new)-array['name','quantity','reference_price','reason','note','actor_name','occurred_at','work_date']) then
   return new;
  end if;
 end if;
 raise exception 'PILOT_HISTORY_IS_APPEND_ONLY';
end $$;
create or replace function public.save_baihuayuan_sheet_row(p_store_id uuid,p_kind text,p_id uuid,p_value jsonb,p_expected jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; saved private.operations_sheet_requests; result jsonb; payload jsonb;
 m private.store_movements; w private.waste_records; wr private.waste_reviews; old_value jsonb;
 product uuid; product_count int; qty numeric; price numeric; source_store uuid; target_store uuid; zone uuid; prior_qty numeric;
 occurred timestamptz; unit_name text; v_actor_name text;
begin
 perform private.assert_store_editable(p_store_id);
 if auth.uid() is null or not private.baihuayuan_can_confirm_backoffice(p_store_id) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into org from public.stores where id=p_store_id and is_active and name in ('BeApe','Gras');
 if org is null or p_request_id is null or p_kind not in ('receipt','transfer','waste') then raise exception 'INVALID_SHEET_REQUEST';end if;
 payload:=jsonb_build_object('kind',p_kind,'id',p_id,'value',p_value,'expected',p_expected);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_store_id::text||p_request_id::text,0));
 select * into saved from private.operations_sheet_requests where actor=auth.uid() and store_id=p_store_id and request_id=p_request_id;
 if found then if saved.payload<>payload then raise exception 'REQUEST_PAYLOAD_CHANGED' using errcode='40001';end if;return saved.result;end if;
 qty:=nullif(p_value->>'quantity','')::numeric;price:=nullif(p_value->>'price','')::numeric;unit_name:=btrim(p_value->>'unit');
 if qty is null or qty<=0 or qty>=1e9 or qty::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_QUANTITY';end if;
 if price is not null and (price<0 or price>=1e9 or price::text in ('NaN','Infinity','-Infinity')) then raise exception 'INVALID_PRICE';end if;
 if coalesce(length(btrim(p_value->>'name')),0) not between 1 and 160 or coalesce(length(unit_name),0) not between 1 and 30 then raise exception 'INVALID_SHEET_FIELDS';end if;
 occurred:=((p_value->>'date')::date::text||' 12:00:00+08')::timestamptz;
 if (p_value->>'date')::date>(now() at time zone 'Asia/Taipei')::date then raise exception 'INVALID_OCCURRED_AT';end if;
 if occurred>now() then occurred:=now();end if;
 v_actor_name:=nullif(btrim(p_value->>'actor'),'');
 if p_kind='receipt' then
  if p_id is not null then raise exception 'USE_RECEIPT_REVIEW';end if;
  result:=public.create_baihuayuan_direct_receipt(p_store_id,p_value->>'supplier',(p_value->>'date')::date,coalesce(p_value->>'number',''),jsonb_build_array(jsonb_build_object('product_name',p_value->>'name','specification',coalesce(p_value->>'specification',''),'unit',unit_name,'quantity',qty,'unit_price',price,'note',coalesce(p_value->>'note',''))));
 elsif p_id is null then
  select count(*),(array_agg(p.id))[1] into product_count,product from public.products p
   where p.organization_id=org and p.is_active and p.name=btrim(p_value->>'name') and (p.base_unit=unit_name or p.count_unit=unit_name)
   and not exists(select 1 from private.count_catalog_removed cr where cr.store_id=p_store_id and cr.product_id=p.id);
  if product_count<>1 then raise exception 'PRODUCT_MATCH_REQUIRED';end if;
  if p_kind='transfer' then
   select id into source_store from public.stores where organization_id=org and name=p_value->>'from' and name in ('BeApe','Gras') and is_active;
   select id into target_store from public.stores where organization_id=org and name=p_value->>'to' and name in ('BeApe','Gras') and is_active;
   if p_store_id not in (source_store,target_store) or source_store is null or target_store is null then raise exception 'INVALID_TRANSFER_DIRECTION';end if;
   -- Missing prices are explicitly pending, never converted to zero.
   if price is null then raise exception 'TRANSFER_PRICE_REQUIRED';end if;
   result:=public.create_baihuayuan_transfer_backfill(p_store_id,source_store,target_store,product,qty,unit_name,price,occurred,v_actor_name,'行政表格新增',p_value->>'note');
  else
   result:=public.create_baihuayuan_waste_backfill(p_store_id,product,qty,unit_name,p_value->>'reason',price,occurred,v_actor_name,'行政表格新增',p_value->>'note');
  end if;
 elsif p_kind='transfer' then
  select * into m from private.store_movements where id=p_id and organization_id=org and kind='TRANSFER' and p_store_id in (from_store_id,to_store_id) for update;
  if not found then raise exception 'RECORD_NOT_FOUND' using errcode='42501';end if;
  if m.revision is distinct from (p_expected->>'revision')::int then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  if exists(select 1 from private.baihuayuan_record_flags where entity_type='TRANSFER' and entity_id=m.id and state='REMOVED') then raise exception 'RECORD_REMOVED';end if;
  if (select name from public.stores where id=m.from_store_id) is distinct from p_value->>'from' or (select name from public.stores where id=m.to_store_id) is distinct from p_value->>'to' then raise exception 'TRANSFER_DIRECTION_LOCKED';end if;
  old_value:=to_jsonb(m);
  if m.review_status<>'CONFIRMED' then
   perform private.confirm_store_transfer(p_store_id,jsonb_build_object('id',m.id,'revision',m.revision,'quantity',qty,'unit',unit_name,'unit_price',price));
  elsif qty<>m.quantity or unit_name<>m.unit then
   raise exception 'CONFIRMED_TRANSFER_QUANTITY_LOCKED';
  end if;
  update private.store_movements set name=btrim(p_value->>'name'),unit=unit_name,unit_price_snapshot=price,amount_snapshot=price*quantity,note=coalesce(p_value->>'note',''),original_actor_name=v_actor_name,occurred_at=occurred,revision=revision+1 where id=m.id returning to_jsonb(store_movements) into result;
 else
  select * into w from private.waste_records where id=p_id and store_id=p_store_id and organization_id=org for update;
  if not found then raise exception 'RECORD_NOT_FOUND' using errcode='42501';end if;
  select * into wr from private.waste_reviews where waste_id=w.id for update;
  if jsonb_build_object('name',w.name,'quantity',w.quantity,'unit',w.unit,'price',coalesce(wr.unit_price,w.reference_price),'note',coalesce(w.note,''),'reason',w.reason,'actor',w.actor_name,'date',w.work_date) is distinct from p_expected then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  if exists(select 1 from private.baihuayuan_record_flags where entity_type='WASTE' and entity_id=w.id and state='REMOVED') then raise exception 'RECORD_REMOVED';end if;
  if unit_name<>w.unit then raise exception 'WASTE_UNIT_LOCKED';end if;
  if p_value->>'reason' not in ('效期到期','品質異常','製作或操作損耗','保存或設備異常','供應商問題','其他') then raise exception 'WASTE_FIELDS_REQUIRED';end if;
  old_value:=jsonb_build_object('record',to_jsonb(w),'review',to_jsonb(wr));
  prior_qty:=coalesce(wr.confirmed_quantity,w.quantity);
  if qty<>prior_qty and (w.lot_id is not null or w.expiry_id is not null) then raise exception 'EXPIRY_WASTE_QUANTITY_LOCKED';end if;
  if wr.waste_id is not null or not w.requires_review then
   if w.product_id is not null and qty<>prior_qty then
    select id into zone from public.count_zones where store_id=p_store_id and name=w.zone_name order by id limit 1;
    perform private.stock_adjust_zone(p_store_id,w.product_id,w.unit,zone,prior_qty-qty);
   end if;
  end if;
  perform set_config('app.sheet_waste_correction',w.id::text,true);
  update private.waste_records set name=btrim(p_value->>'name'),quantity=qty,reference_price=price,reason=p_value->>'reason',note=nullif(p_value->>'note',''),actor_name=coalesce(v_actor_name,w.actor_name),occurred_at=occurred,work_date=(occurred at time zone 'Asia/Taipei')::date where id=w.id;
  perform set_config('app.sheet_waste_correction','',true);
  if wr.waste_id is not null then update private.waste_reviews set confirmed_quantity=qty,unit_price=price,amount=price*qty where waste_id=w.id;
  elsif w.requires_review then perform public.confirm_baihuayuan_waste(p_store_id,w.id,qty,price);end if;
  result:=jsonb_build_object('id',w.id,'saved',true);
 end if;
 if old_value is not null then
  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
  values(org,p_store_id,p_kind,p_id::text,'ADMIN_SHEET_CORRECTION',old_value,p_value,auth.uid());
 end if;
 insert into private.operations_sheet_requests(actor,store_id,request_id,payload,result) values(auth.uid(),p_store_id,p_request_id,payload,result);
 return result;
end $$;
revoke all on function public.save_baihuayuan_sheet_row(uuid,text,uuid,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.save_baihuayuan_sheet_row(uuid,text,uuid,jsonb,jsonb,uuid) to authenticated;
