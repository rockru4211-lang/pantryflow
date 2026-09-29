-- Isolated rollback fixtures: never confirm or change an existing restaurant receipt.
begin;
do $test$
<<receipt_qa>>
declare actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid; store_id uuid; other_store uuid; batch_id uuid; run_id uuid; data jsonb; rows jsonb; state jsonb; old_revision text; payload jsonb; f uuid; raw_before jsonb; result jsonb; req uuid:=gen_random_uuid(); denied boolean; saves bigint; amount numeric;
begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@receipt-detail.invalid',now() from unnest(array[actor,viewer,staff])id;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','進貨隔離測試','business_type','SINGLE_RESTAURANT','store_mode','SINGLE'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code','QAREVIEW'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);
 org:=(data->>'organization_id')::uuid;store_id:=(data->>'store_id')::uuid;
 insert into public.suppliers(organization_id,name) values(org,'QA 供應商');
 insert into public.organization_members(organization_id,user_id,role,work_role) values(org,viewer,'LOGISTICS','LOGISTICS'),(org,staff,'STAFF','STAFF');
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,viewer,'唯讀者',actor),(org,staff,'員工',actor);
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,access_mode)
 values(store_id,org,viewer,'viewer','LOGISTICS','LOGISTICS',actor,'VIEW'),(store_id,org,staff,'staff','STAFF','STAFF',actor,'EDIT');
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,status)
 values(org,store_id,'BeApe',actor,current_date,'READY_FOR_REVIEW') returning id into batch_id;
 select id into run_id from public.create_receipt_ocr_run(org,batch_id,'qa','qa','qa',actor);
 insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status)
 select org,batch_id,run_id,x.row_key,x.name,x.val,x.val,.99,case when x.name='quantity' and x.row_key='line-2' then 'REVIEW' else 'TRUSTED' end from(values
 ('document','supplier_name','"QA 供應商"'::jsonb),('document','receipt_date',to_jsonb(current_date::text)),('document','document_number',to_jsonb(gen_random_uuid()::text)),('document','subtotal_ex_tax','30'::jsonb),('document','tax','0'::jsonb),('document','total_inc_tax','30'::jsonb),
 ('line-1','product','"QA糖"'::jsonb),('line-1','unit','"包"'::jsonb),('line-1','quantity','1'::jsonb),('line-1','unit_price_ex_tax','10'::jsonb),('line-1','subtotal_ex_tax','10'::jsonb),
 ('line-2','product','"QA紙"'::jsonb),('line-2','unit','"支"'::jsonb),('line-2','quantity','2'::jsonb),('line-2','unit_price_ex_tax','10'::jsonb),('line-2','subtotal_ex_tax','20'::jsonb)
 )x(row_key,name,val);
 update public.receipt_ocr_runs set status='SUCCEEDED',completed_at=now() where id=run_id;
 select jsonb_agg(jsonb_build_object('id',id,'raw',raw_value) order by id) into raw_before from public.receipt_ocr_fields where ocr_run_id=run_id;
 set local role authenticated;
 rows:=public.get_baihuayuan_receipt_detail_ledger(store_id);
 reset role;
 assert jsonb_array_length(rows)=2,'missing receipt lines';
 assert (select jsonb_array_length(a->'issues')=0 from jsonb_array_elements(rows)a where a->>'row_key'='line-1'),'normal unconfirmed row warned';
 assert (select a->'issues'?'數量需核對' from jsonb_array_elements(rows)a where a->>'row_key'='line-2'),'uncertain quantity not flagged';
 assert not exists(select 1 from jsonb_array_elements(rows)a where a->>'status'='COMPLETE'),'OCR trusted means human confirmed';
 old_revision:=rows->0->>'review_revision';
 denied:=false;begin perform public.confirm_baihuayuan_receipt_details(store_id,batch_id,run_id,old_revision);exception when others then denied:=sqlerrm='RECEIPT_REVIEW_REQUIRED';end;assert denied,'unresolved whole receipt confirmed';
 assert not exists(select 1 from public.goods_receipts where source_batch_id=batch_id),'failed confirmation published';
 -- Spreadsheet transaction: validate originals before any writes, commit all or none.
 select jsonb_build_object('rows',jsonb_agg(jsonb_build_object('batch_id',batch_id,'run_id',run_id,'row_key',k,'review_revision',old_revision,'annotation_revision',0,'category','食材','note','sheet test','line',jsonb_build_object('batch_id',batch_id,'run_id',run_id,'row_key',k,'mapping_mode','KEEP','previous_product_id',null,'acknowledge',false,'fields',(select jsonb_agg(jsonb_build_object('id',e.id,'old',e.value,'value',e.value)) from private.receipt_effective_fields(run_id)e where e.row_key=k))))) into payload from unnest(array['line-1','line-2'])k;
 -- Later row failure rolls back earlier annotation writes.
 data:=jsonb_set(payload,'{rows,1,line,row_key}','"wrong"');
 denied:=false;begin perform public.app_operation(store_id,'receipt.edit-sheet',data,gen_random_uuid());exception when others then denied:=true;end;assert denied,'invalid sheet row accepted';
 assert not exists(select 1 from private.receipt_ledger_annotations a where a.batch_id=receipt_qa.batch_id),'partial sheet committed';
 data:=jsonb_set(payload,'{rows,1,review_revision}','"stale"');
 denied:=false;begin perform public.app_operation(store_id,'receipt.edit-sheet',data,gen_random_uuid());exception when serialization_failure then denied:=true;end;assert denied,'stale later row accepted';
 set local role authenticated;
 req:=gen_random_uuid();result:=public.app_operation(store_id,'receipt.edit-sheet',payload,req);
 assert result=public.app_operation(store_id,'receipt.edit-sheet',payload,req),'sheet retry changed result';
 reset role;
 assert result->>'count'='2','not all sheet rows saved';
 assert (select count(*)=2 from private.receipt_ledger_annotations a where a.batch_id=receipt_qa.batch_id),'sheet rows missing';
 perform set_config('request.jwt.claim.sub',viewer::text,true);
 denied:=false;begin perform public.app_operation(store_id,'receipt.edit-sheet',payload,req);exception when insufficient_privilege then denied:=true;end;assert denied,'viewer replayed sheet';
 perform set_config('request.jwt.claim.sub',staff::text,true);
 denied:=false;begin perform public.app_operation(store_id,'receipt.edit-sheet',payload,req);exception when insufficient_privilege then denied:=true;end;assert denied,'staff replayed sheet';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 denied:=false;begin perform public.app_operation(gen_random_uuid(),'receipt.edit-sheet',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'cross-store sheet';
 req:=gen_random_uuid();
 -- Acknowledge just the selected line with the exact original CAS payload.
 select jsonb_build_object('batch_id',batch_id,'run_id',run_id,'row_key','line-2','mapping_mode','KEEP','previous_product_id',null,'acknowledge',true,'fields',jsonb_agg(jsonb_build_object('id',e.id,'old',e.value,'value',e.value))) into payload from private.receipt_effective_fields(run_id)e where e.row_key='line-2';
 result:=public.app_operation(store_id,'receipt.edit-card',payload,req);
 assert result=public.app_operation(store_id,'receipt.edit-card',payload,req),'retry not idempotent';
 assert not exists(select 1 from public.goods_receipts where source_batch_id=batch_id),'row acknowledgement published receipt';
 state:=private.baihuayuan_receipt_review_state(batch_id);
 assert jsonb_array_length(state->'issues'->'line-2')=0,'acknowledgement did not clear warning';
 denied:=false;begin perform public.confirm_baihuayuan_receipt_details(store_id,batch_id,run_id,old_revision);exception when serialization_failure then denied:=true;end;assert denied,'stale snapshot published';
 -- This is the screenshot failure path: ambiguous store_name used to abort here.
 perform public.save_pilot_receipt_review(batch_id,'line-1',run_id);
 perform public.save_pilot_receipt_review(batch_id,'line-2',run_id);
 assert not exists(select 1 from public.goods_receipts where source_batch_id=batch_id),'save published before confirmation';
 rows:=public.get_baihuayuan_receipt_detail_ledger(store_id);
 assert not exists(select 1 from jsonb_array_elements(rows)a where a->>'status'='COMPLETE'),'saved review falsely marked published';
 -- Permission and scope checks run before completion and before cached results.
 perform set_config('request.jwt.claim.sub',viewer::text,true);
 assert jsonb_array_length(public.get_baihuayuan_receipt_detail_ledger(store_id))=2,'viewer cannot read';
 denied:=false;begin perform public.confirm_baihuayuan_receipt_details(store_id,batch_id,run_id,state->>'revision');exception when insufficient_privilege then denied:=true;end;assert denied,'viewer confirmed';
 perform set_config('request.jwt.claim.sub',staff::text,true);
 denied:=false;begin perform public.get_baihuayuan_receipt_detail_ledger(store_id);exception when insufficient_privilege then denied:=true;end;assert denied,'staff price leak';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 denied:=false;begin perform public.confirm_baihuayuan_receipt_details(gen_random_uuid(),batch_id,run_id,state->>'revision');exception when insufficient_privilege then denied:=true;end;assert denied,'cross-store write';
 state:=private.baihuayuan_receipt_review_state(batch_id);
 set local role authenticated;
 result:=public.confirm_baihuayuan_receipt_details(store_id,batch_id,run_id,state->>'revision');
 reset role;
 assert (result->>'complete')::boolean,'not completed';
 perform public.confirm_baihuayuan_receipt_details(store_id,batch_id,run_id,state->>'revision');
 assert (select count(*)=1 from public.goods_receipts where source_batch_id=batch_id),'duplicate receipt';
 assert (select count(*)=2 from public.receipt_lines where receipt_id=(select id from public.goods_receipts where source_batch_id=batch_id)),'duplicated or missing lines';
 assert (select jsonb_agg(jsonb_build_object('id',id,'raw',raw_value) order by id) from public.receipt_ocr_fields where ocr_run_id=run_id)=raw_before,'OCR original overwritten';
 rows:=public.get_baihuayuan_receipt_detail_ledger(store_id);
 assert not exists(select 1 from jsonb_array_elements(rows)a where a->>'status'<>'COMPLETE' or jsonb_array_length(a->'issues')>0),'published state incorrect';
 assert not has_function_privilege('anon','public.confirm_baihuayuan_receipt_details(uuid,uuid,uuid,text)','execute'),'anonymous write';
 assert not has_function_privilege('authenticated','private.baihuayuan_receipt_review_state(uuid)','execute'),'private evidence exposed';
end $test$;
select 'PASS: warning classification, acknowledgement, immutable OCR, save/publish separation, atomic confirmation, retries, stale snapshot, role and store denial' as result;
rollback;
