-- Transactional regression test; every fixture and write is rolled back.
begin;
do $$
declare b uuid; org uuid; store uuid; staff uuid; reviewer uuid; r uuid; p uuid;
 result jsonb; field uuid; receipt uuid; denied boolean; saves integer;
begin
 select id,organization_id into strict store,org from public.stores where store_code='QA0908RECEIPT';
 select user_id into strict staff from public.store_memberships where store_id=store and role='STAFF';
 select user_id into strict reviewer from public.store_memberships where store_id=store and role='LOGISTICS';
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,status)
 values(org,store,'QA rollback review',staff,current_date,'READY_FOR_REVIEW') returning id into b;
 select id into r from public.create_receipt_ocr_run(org,b,'qa-fixture','qa-fixture','optional-review-test',staff);
 insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status)
 select org,b,r,x.row_key,x.name,x.v,x.v,0.99,case when x.v='null'::jsonb then 'UNREADABLE' else 'TRUSTED' end
 from (values
 ('document','supplier_name','"QA rollback supplier"'::jsonb),
 ('document','receipt_date','"2026-09-08"'::jsonb),
 ('document','document_number','null'::jsonb),
 ('document','subtotal_ex_tax','null'::jsonb),
 ('document','tax','null'::jsonb),
 ('document','total_inc_tax','null'::jsonb),
 ('line-0001','product','"QA optional review item"'::jsonb),
 ('line-0001','specification','""'::jsonb),
 ('line-0001','unit','"BT"'::jsonb),
 ('line-0001','quantity','null'::jsonb),
 ('line-0001','unit_price_ex_tax','null'::jsonb),
 ('line-0001','subtotal_ex_tax','null'::jsonb)
 )x(row_key,name,v);
 update public.receipt_ocr_runs set status='SUCCEEDED',completed_at=now() where id=r;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 denied:=false;
 begin perform public.save_pilot_receipt_review(b,'line-0001',r); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'ASSERT staff saved administrative review'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',reviewer,'role','authenticated')::text,true);
 result:=public.save_pilot_receipt_review(b,'line-0001',r);
 if not (result->>'saved')::boolean or not (result->>'complete')::boolean then raise exception 'ASSERT unmapped unreadable receipt not saved'; end if;
 if exists(select 1 from public.goods_receipts where source_batch_id=b) then raise exception 'ASSERT uncertain receipt entered statistics'; end if;
 if (public.get_pilot_receipt(b)->'review'->>'confirmed_at') is null
 or (public.get_pilot_receipt(b)->'review'->>'confirmed_by') is null then raise exception 'ASSERT confirmation attribution missing'; end if;
 if not exists(select 1 from jsonb_array_elements(public.get_pilot_receipts(store)) x where x->>'id'=b::text and (x->>'review_saved')::boolean)
 then raise exception 'ASSERT activity cannot find completed receipt'; end if;
 if exists(select 1 from private.receipt_effective_fields(r) where field_name='quantity' and (corrected or value<>'null'::jsonb or review_status<>'UNREADABLE')) then raise exception 'ASSERT unreadable auto-approved'; end if;
 select count(*) into saves from private.receipt_review_saves where ocr_run_id=r;
 perform public.save_pilot_receipt_review(b,'line-0001',r);
 if saves<>(select count(*) from private.receipt_review_saves where ocr_run_id=r) then raise exception 'ASSERT duplicate save'; end if;
 if not exists(select 1 from private.receipt_review_saves where ocr_run_id=r and saved_by=reviewer and saved_at is not null) then raise exception 'ASSERT reviewer provenance missing'; end if;
 select id into field from public.receipt_ocr_fields where ocr_run_id=r and field_name='quantity';
 perform public.correct_pilot_receipt_field(field,'2.5'::jsonb);
 if (private.receipt_review_progress(r)->>'complete')::boolean then raise exception 'ASSERT stale review after modification'; end if;
 result:=public.save_pilot_receipt_review(b,'line-0001',r);
 if result->>'publication_issue'<>'PRODUCT_MAPPING_REQUIRED' then raise exception 'ASSERT mapping requirement bypassed'; end if;
 -- A real product association can have no merchant-facing code.
 insert into public.products(organization_id,name,product_code,base_unit,count_unit,specification,category)
 values(org,'QA optional review item',null,'CAN','CAN','','其他') returning id into p;
 perform public.map_pilot_receipt_product(b,'line-0001',p,false);
 result:=public.save_pilot_receipt_review(b,'line-0001',r);
 if result->>'publication_issue'<>'UNIT_MAPPING_CONFLICT' then raise exception 'ASSERT unit mismatch bypassed'; end if;
 select id into field from public.receipt_ocr_fields where ocr_run_id=r and field_name='unit';
 perform public.correct_pilot_receipt_field(field,'"CAN"'::jsonb);
 if exists(select 1 from public.receipt_product_mappings where batch_id=b) then raise exception 'ASSERT identity correction retained stale mapping'; end if;
 perform public.map_pilot_receipt_product(b,'line-0001',p,false);
 result:=public.save_pilot_receipt_review(b,'line-0001',r);
 receipt:=(result->>'receipt_id')::uuid;
 if receipt is null then raise exception 'ASSERT reviewed mapped receipt not published: %',result; end if;
 if (select count(*) from public.receipt_lines where receipt_id=receipt)<>1 then raise exception 'ASSERT expected one persisted line'; end if;
 if not exists(select 1 from public.receipt_lines where receipt_id=receipt and quantity=2.5 and unit='CAN' and unit_price_ex_tax is null) then raise exception 'ASSERT corrected quantity/unit or null price lost'; end if;
 result:=public.save_pilot_receipt_review(b,'line-0001',r);
 if (result->>'receipt_id')::uuid<>receipt then raise exception 'ASSERT duplicate publication'; end if;
 if (select count(*) from public.inventory_lot_events where source_id in(select id from public.receipt_lines where receipt_id=receipt))<>1 then raise exception 'ASSERT duplicate inventory event'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 result:=public.get_pilot_receipt(b);
 if exists(select 1 from jsonb_array_elements(result->'fields')f where f->>'field_name' in ('unit_price_ex_tax','subtotal_ex_tax','tax','total_inc_tax')) then raise exception 'ASSERT staff price leak'; end if;
 if not exists(select 1 from jsonb_array_elements(result->'fields')f where f->>'field_name'='quantity' and f->>'value'='2.5') then raise exception 'ASSERT reopen loses saved correction'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 denied:=false;
 begin perform public.save_pilot_receipt_review(b,'line-0001',r); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'ASSERT cross-store save permitted'; end if;
 if has_function_privilege('anon','public.save_pilot_receipt_review(uuid,text,uuid)','EXECUTE')
 or has_function_privilege('authenticated','private.receipt_review_hash(uuid,text)','EXECUTE')
 or has_table_privilege('authenticated','private.receipt_review_saves','SELECT') then raise exception 'ASSERT private review bypass'; end if;
end $$;
rollback;
select 'PASS: optional code and mapping, unreadable preserved, correction provenance, idempotent save/publication, original unit validation, stale mapping invalidation, role isolation, reopen' as optional_receiving_tests;
