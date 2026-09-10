begin;
do $$
declare org uuid; store uuid; staff uuid; manager uuid; supplier uuid; product uuid; batch uuid; receipt uuid; line uuid; lot uuid; item uuid; waste uuid; k uuid; payload jsonb; r jsonb; d jsonb; today date:=(now() at time zone 'Asia/Taipei')::date; failed boolean;
begin
 select id,organization_id into strict store,org from public.stores where store_code='QA0907UI';
 select user_id into strict staff from public.store_memberships where store_id=store and role='STAFF';
 select user_id into strict manager from public.store_memberships where store_id=store and role='SUPERVISOR';
 insert into public.suppliers(organization_id,name) values(org,'QA expiry supplier') returning id into supplier;
 insert into public.products(organization_id,name,base_unit,count_unit,current_supplier_id) values(org,'QA dated package','瓶','瓶',supplier) returning id into product;
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,status,erp_required,work_date) values(org,store,'QA fixture',staff,'COMPLETED',false,today) returning id into batch;
 insert into public.goods_receipts(organization_id,supplier_id,receipt_date,reviewed_by,reviewed_at,source_batch_id,store_id) values(org,supplier,today,manager,now(),batch,store) returning id into receipt;
 insert into public.receipt_lines(organization_id,receipt_id,product_id,supplier_id,quantity,unit,unit_price_ex_tax,batch_or_expiry)
 values(org,receipt,product,supplier,10,'瓶',120,today::text) returning id into line;
 select id into strict lot from public.inventory_lots where source_id=line;
 select id into strict item from private.expiry_items where lot_id=lot;
 if not exists(select 1 from private.expiry_items where id=item and store_id=store and expires_on=today and zone_id is null and zone_name='未分類') then raise exception 'ASSERT receipt date/store/no guessed location';end if;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 k:=gen_random_uuid();payload:=jsonb_build_object('expiry_id',item,'quantity',2,'unit','瓶');
 r:=public.save_pilot_expiry_waste(store,k,'WASTE',payload);waste:=(r->>'id')::uuid;
 perform public.save_pilot_expiry_waste(store,k,'WASTE',payload);
 if not exists(select 1 from private.waste_records where id=waste and reference_price=120 and price_receipt_line_id=line) then raise exception 'ASSERT published matching-unit price';end if;
 if (select count(*) from public.inventory_lot_events where source_id=waste and event_type='DISCARDED' and quantity=2 and unit='瓶')<>1 then raise exception 'ASSERT one actual lot movement';end if;
 if not exists(select 1 from public.inventory_lots where id=lot and original_expiry_date=today) then raise exception 'ASSERT original lot retained';end if;
 r:=public.save_pilot_expiry_waste(store,gen_random_uuid(),'WASTE',jsonb_build_object('name','QA dated package','product_id',product,'quantity',1,'unit','公斤','reason','品質異常'));
 if exists(select 1 from private.waste_records where id=(r->>'id')::uuid and reference_price is not null) then raise exception 'ASSERT guessed conversion price';end if;
 insert into public.receipt_lines(organization_id,receipt_id,product_id,supplier_id,quantity,unit,batch_or_expiry) values(org,receipt,product,supplier,1,'瓶','2026-02-30') returning id into line;
 if not exists(select 1 from public.inventory_lots where source_id=line and original_expiry_date is null and lot_code='2026-02-30') then raise exception 'ASSERT invalid label lost or invented date';end if;
 if exists(select 1 from private.expiry_items where lot_id in(select id from public.inventory_lots where source_id=line)) then raise exception 'ASSERT invalid date reminder';end if;
 insert into public.receipt_lines(organization_id,receipt_id,product_id,supplier_id,quantity,unit,batch_or_expiry) values(org,receipt,product,supplier,1,'瓶','LOT-A') returning id into line;
 if exists(select 1 from private.expiry_items where lot_id in(select id from public.inventory_lots where source_id=line)) then raise exception 'ASSERT batch code interpreted as date';end if;
 failed:=false;begin update private.waste_records set quantity=99 where id=waste;exception when others then failed:=true;end;
 if not failed then raise exception 'ASSERT waste history mutated';end if;
end $$;
rollback;
-- Actual authenticated invoker access and district-manager denial.
begin;
select set_config('request.jwt.claim.sub','55fd006e-d2a5-4121-ac34-3b6b21071b1d',true);
set local role authenticated;
do $$ declare d jsonb; failed boolean; begin
 d:=public.get_pilot_expiry_waste('4e57f6ae-7672-41e7-9d9f-af8df9ae7a07',current_date,current_date);
 if (d->'permissions'->>'field')::boolean or (d->'permissions'->>'manage')::boolean then raise exception 'ASSERT district manager field permission';end if;
 failed:=false;begin perform public.save_pilot_expiry_waste('4e57f6ae-7672-41e7-9d9f-af8df9ae7a07',gen_random_uuid(),'REMINDER','{}');exception when others then failed:=sqlerrm like '%FIELD_ROLE_REQUIRED%';end;
 if not failed then raise exception 'ASSERT district manager created field reminder';end if;
 failed:=false;begin perform public.get_pilot_expiry_waste('c8169f2a-e9fa-41ec-a5ba-704d3f3170e9',current_date,current_date);exception when others then failed:=sqlerrm like '%STORE_ACCESS_DENIED%';end;
 if not failed then raise exception 'ASSERT unauthorized store readable';end if;
 failed:=false;begin perform 1 from private.waste_records limit 1;exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'ASSERT direct private read';end if;
end $$;
rollback;
select 'PASS: dated receipt lot/store, unknown location, safe invalid labels, immutable source, published price and unit matching, one waste movement, authenticated invoker, district manager read-only, cross-store denial' as expiry_receipt_tests;
