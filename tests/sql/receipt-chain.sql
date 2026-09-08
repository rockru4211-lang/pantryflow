-- Transient chain fixtures. No merchant data or existing memberships are changed.
begin;
do $$
declare org uuid; store uuid; staff uuid; manager uuid; area uuid; batch uuid; product uuid; job uuid; lease uuid:=gen_random_uuid(); run uuid; fields jsonb; erp jsonb; denied boolean;
begin
 select user_id into strict staff from public.store_memberships m join public.stores s on s.id=m.store_id where s.store_code='QA0908RECEIPT' and m.role='STAFF';
 select user_id into strict manager from public.store_memberships m join public.stores s on s.id=m.store_id where s.store_code='QA0908RECEIPT' and m.role='LOGISTICS';
 select user_id into strict area from public.store_memberships m join public.stores s on s.id=m.store_id where s.store_code='QA0908RECEIPT' and m.role='ADMIN';
 -- The QA organization mode changes only inside this rolled-back transaction.
 select organization_id into org from public.stores where store_code='QA0908RECEIPT';
 update public.organizations set business_type='CHAIN_RESTAURANT',store_mode='MULTI',has_erp=true where id=org;
 insert into public.stores(organization_id,name,store_code,created_by) values(org,'QA temporary chain',upper(left(gen_random_uuid()::text,8)),area) returning id into store;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,assigned_by) values(store,org,staff,'staff','STAFF',area),(store,org,manager,'manager','SUPERVISOR',area),(store,org,area,'area','LOGISTICS',area);
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,erp_required,work_date) values(org,store,'QA temporary chain',staff,true,current_date) returning id into batch;
 insert into public.products(organization_id,name,product_code,specification,base_unit,count_unit) values(org,'QA chain item','QA-CHAIN-1','','BT','BT') returning id into product;
 insert into public.receipt_ocr_jobs(organization_id,batch_id,requested_by,status,attempt_count,locked_at,lease_token) values(org,batch,staff,'RUNNING',1,now(),lease) returning id into job;
 select id into run from public.create_receipt_ocr_run(org,batch,'qa-fixture','qa-fixture','receipt-test',staff);
 select jsonb_agg(jsonb_build_object('row_key',x.r,'field_name',x.f,'raw_value',x.v,'normalized_value',x.v,'confidence',0.99,'review_status','TRUSTED','source_region',null,'validation_notes','[]'::jsonb)) into fields
 from(values('document','supplier_name','"QA chain supplier"'::jsonb),('document','document_number','"QA-CHAIN-ROLLBACK"'::jsonb),('document','receipt_date','"2026-09-08"'::jsonb),('document','subtotal_ex_tax','null'::jsonb),('document','tax','null'::jsonb),('document','total_inc_tax','null'::jsonb),('line-0001','product','"QA chain item"'::jsonb),('line-0001','specification','""'::jsonb),('line-0001','unit','"BT"'::jsonb),('line-0001','quantity','2'::jsonb),('line-0001','unit_price_ex_tax','null'::jsonb),('line-0001','subtotal_ex_tax','null'::jsonb))x(r,f,v);
 perform public.commit_pilot_receipt_ocr(job,lease,run,fields,'{"fixture":true}'::jsonb,null);
 if not exists(select 1 from public.goods_receipts where source_batch_id=batch and reviewed_at is null and reviewed_by is null) then raise exception 'ASSERT trusted mapped chain receipt not auto-published';end if;
 if (select count(*) from public.receipt_lines where receipt_id in(select id from public.goods_receipts where source_batch_id=batch))<>1 then raise exception 'ASSERT auto-publish line count';end if;
 if exists(select 1 from public.receipt_upload_batches where id=batch and erp_completed_at is not null) then raise exception 'ASSERT OCR falsely completed ERP';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',area,'role','authenticated')::text,true);
 if (public.get_pilot_receipt(batch)->>'review_allowed')::boolean then raise exception 'ASSERT chain area supervisor can modify receipt';end if;
 denied:=false;begin perform public.complete_pilot_receipt_erp(batch);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'ASSERT area supervisor completed ERP';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 erp:=public.complete_pilot_receipt_erp(batch);
 if erp<>public.complete_pilot_receipt_erp(batch) then raise exception 'ASSERT duplicate ERP completion changes actor/time';end if;
 if (select count(*) from public.audit_logs where entity_id=batch::text and action='RECEIPT_ERP_REPORTED')<>1 then raise exception 'ASSERT duplicate ERP audit';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'role','authenticated')::text,true);
 if public.get_pilot_receipt(batch)->'batch'->>'erp_completed_by'<>staff::text then raise exception 'ASSERT manager cannot see ERP actor';end if;
end $$;
rollback;
select 'PASS: trusted company mapping, automatic receipt/stock event, independent ERP status, area read-only, one ERP actor/time and manager visibility' as receipt_chain_tests;
