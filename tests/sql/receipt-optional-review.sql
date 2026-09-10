-- Transactional regression test; every fixture and write is rolled back.
begin;
do $$
declare b uuid; org uuid; store uuid; staff uuid; reviewer uuid; r uuid; p uuid;
 result jsonb; field uuid; receipt uuid; denied boolean; saves integer; line public.receipt_lines; payload jsonb; req uuid; first_result jsonb;
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
 select id into strict receipt from public.goods_receipts where source_batch_id=b;
 select * into strict line from public.receipt_lines where receipt_id=receipt;
 assert line.quantity is null and line.inventory_status='REVIEW_PENDING' and line.inventory_quantity is null,'unreadable quantity was invented';
 assert not exists(select 1 from public.inventory_lots where source_id=line.id),'uncertain receipt entered inventory';
 if (public.get_pilot_receipt(b)->'review'->>'confirmed_at') is null
 or (public.get_pilot_receipt(b)->'review'->>'confirmed_by') is null then raise exception 'ASSERT confirmation attribution missing'; end if;
 if not exists(select 1 from jsonb_array_elements(public.get_pilot_receipts(store)) x where x->>'id'=b::text and (x->>'review_saved')::boolean)
 then raise exception 'ASSERT activity cannot find completed receipt'; end if;
 if exists(select 1 from private.receipt_effective_fields(r) where field_name='quantity' and (corrected or value<>'null'::jsonb or review_status<>'UNREADABLE')) then raise exception 'ASSERT unreadable auto-approved'; end if;
 select count(*) into saves from private.receipt_review_saves where ocr_run_id=r;
 perform public.save_pilot_receipt_review(b,'line-0001',r);
 if saves<>(select count(*) from private.receipt_review_saves where ocr_run_id=r) then raise exception 'ASSERT duplicate save'; end if;
 if not exists(select 1 from private.receipt_review_saves where ocr_run_id=r and saved_by=reviewer and saved_at is not null) then raise exception 'ASSERT reviewer provenance missing'; end if;
 -- Confirmed originals are immutable. Mapping is optional and separately audited.
 denied:=false;
 begin perform public.correct_pilot_receipt_field((select id from public.receipt_ocr_fields where ocr_run_id=r and field_name='quantity'),'2.5'::jsonb);exception when others then denied:=sqlerrm='PUBLISHED_RECEIPT_IMMUTABLE';end;
 assert denied,'confirmed evidence can be overwritten';
 -- A second fixture tests explicit unit conversion without changing the source.
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,status)
 values(org,store,'QA rollback mapping',staff,current_date,'READY_FOR_REVIEW') returning id into b;
 select id into r from public.create_receipt_ocr_run(org,b,'qa-fixture','qa-fixture','mapping-test',staff);
 insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status)
 select org,b,r,x.row_key,x.f,x.v,x.v,0.99,'TRUSTED' from(values
 ('document','supplier_name','"QA mapping supplier"'::jsonb),('document','receipt_date','"2026-09-10"'::jsonb),('document','document_number','null'::jsonb),
 ('document','subtotal_ex_tax','null'::jsonb),('document','tax','null'::jsonb),('document','total_inc_tax','null'::jsonb),
 ('line-0001','product','"QA bottle"'::jsonb),('line-0001','specification','""'::jsonb),('line-0001','unit','"箱"'::jsonb),('line-0001','quantity','2.5'::jsonb),('line-0001','unit_price_ex_tax','null'::jsonb),('line-0001','subtotal_ex_tax','null'::jsonb)
 )x(row_key,f,v);
 update public.receipt_ocr_runs set status='SUCCEEDED',completed_at=now() where id=r;
 result:=public.save_pilot_receipt_review(b,'line-0001',r);receipt:=(result->>'receipt_id')::uuid;
 select * into strict line from public.receipt_lines where receipt_id=receipt;
 assert line.inventory_status='MAPPING_PENDING','unmapped row was lost or posted';
 insert into public.products(organization_id,name,base_unit,count_unit,specification,category) values(org,'QA bottle','瓶','瓶','','其他') returning id into p;
 payload:=jsonb_build_object('id',line.id,'modified_at',line.modified_at,'product_id',p,'factor',12);req:=gen_random_uuid();
 first_result:=public.app_operation(store,'mapping.resolve',payload,req);
 assert public.app_operation(store,'mapping.resolve',payload,req)=first_result,'mapping retry duplicated';
 select * into strict line from public.receipt_lines rl where rl.id=line.id;
 assert line.quantity=2.5 and line.unit='箱' and line.inventory_status='MAPPING_PENDING','confirmed original was overwritten';
 assert first_result->'value'->>'inventory_status'='POSTED' and (first_result->'value'->>'inventory_quantity')::numeric=30 and first_result->'value'->>'inventory_unit'='瓶','explicit conversion lost';
 assert (select count(*) from public.inventory_lot_events where source_id=line.id)=1,'mapping duplicate inventory event';
 assert exists(select 1 from jsonb_array_elements(public.app_workspace(store,'reports')->'lines') x where x->>'id'=line.id::text),'reports cannot read confirmed line';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 result:=public.get_pilot_receipt(b);
 assert not exists(select 1 from jsonb_array_elements(result->'fields')f where f->>'field_name' in ('unit_price_ex_tax','subtotal_ex_tax','tax','total_inc_tax')),'staff price leak';
 assert exists(select 1 from jsonb_array_elements(result->'fields')f where f->>'field_name'='quantity' and f->>'value'='2.5'),'reopen loses source quantity';
 denied:=false;begin perform public.app_workspace(store,'mappings');exception when insufficient_privilege then denied:=true;end;assert denied,'staff mapping management exposed';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 denied:=false;
 begin perform public.save_pilot_receipt_review(b,'line-0001',r); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'ASSERT cross-store save permitted'; end if;
 if has_function_privilege('anon','public.save_pilot_receipt_review(uuid,text,uuid)','EXECUTE')
 or has_function_privilege('authenticated','private.receipt_review_hash(uuid,text)','EXECUTE')
 or has_table_privilege('authenticated','private.receipt_review_saves','SELECT') then raise exception 'ASSERT private review bypass'; end if;
end $$;
rollback;
select 'PASS: complete confirmation, unknown values preserved, immutable source, optional mapping and conversion, idempotent inventory resolution, role isolation, reopen' as optional_receiving_tests;
