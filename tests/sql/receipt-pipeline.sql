-- Run against Beta with its existing QA0908RECEIPT store. All fixture writes roll back.
begin;
do $$
declare b uuid; store uuid; org uuid; staff uuid; reviewer uuid; old_batches integer; old_docs integer; manifest jsonb; again jsonb; job public.receipt_ocr_jobs; claimed public.receipt_ocr_jobs; run uuid; product uuid; saved uuid; fields jsonb; info jsonb; did_deny boolean;
begin
 select id,organization_id into strict store,org from public.stores where store_code='QA0908RECEIPT';
 select user_id into strict staff from public.store_memberships where store_id=store and role='STAFF';
 select user_id into strict reviewer from public.store_memberships where store_id=store and role='LOGISTICS';
 select id into strict b from public.receipt_upload_batches where store_id=store order by uploaded_at limit 1;
 select count(*) into old_batches from public.receipt_upload_batches;select count(*) into old_docs from public.receipt_documents;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 select public.begin_pilot_receipt_upload(store,x.upload_fingerprint,(select jsonb_agg(jsonb_build_object('sha256',content_sha256,'mime_type',mime_type,'byte_size',byte_size,'name',original_filename) order by page_order) from public.receipt_documents where batch_id=b),x.group_mode) into manifest from public.receipt_upload_batches x where x.id=b;
 if (manifest->>'batch_id')::uuid<>b or not (manifest->>'existing')::boolean then raise exception 'ASSERT duplicate upload did not reuse batch'; end if;
 if (select count(*) from public.receipt_upload_batches)<>old_batches or (select count(*) from public.receipt_documents)<>old_docs then raise exception 'ASSERT duplicate upload created documents'; end if;
 job:=public.enqueue_receipt_ocr(b);claimed:=public.enqueue_receipt_ocr(b);
 if job.id<>claimed.id then raise exception 'ASSERT duplicate queue job'; end if;
 did_deny:=false;begin perform public.publish_pilot_receipt(b);exception when insufficient_privilege then did_deny:=true;end;
 if not did_deny then raise exception 'ASSERT staff publication permitted'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 did_deny:=false;begin perform public.get_pilot_receipt(b);exception when insufficient_privilege then did_deny:=true;end;
 if not did_deny then raise exception 'ASSERT cross-store read permitted';end if;
 -- Commit a deterministic extraction to exercise atomic persistence, independent
 -- review, mapping and publication. This is explicitly a fixture, not a Gemini run.
 select * into strict claimed from public.claim_receipt_ocr_jobs(2) where id=job.id;
 select id into run from public.create_receipt_ocr_run(org,b,'qa-fixture','qa-fixture','receipt-test',staff);
 select jsonb_agg(jsonb_build_object('row_key',x.r,'field_name',x.f,'raw_value',x.v,'normalized_value',x.v,'confidence',0.99,'review_status','TRUSTED','source_region',null,'validation_notes','[]'::jsonb)) into fields
 from(values('document','supplier_name','"QA supplier"'::jsonb),('document','document_number','"QA-ROLLBACK"'::jsonb),('document','receipt_date','"2026-09-08"'::jsonb),('document','subtotal_ex_tax','null'::jsonb),('document','tax','null'::jsonb),('document','total_inc_tax','null'::jsonb),('line-0001','product','"QA receipt item"'::jsonb),('line-0001','specification','""'::jsonb),('line-0001','unit','"BT"'::jsonb),('line-0001','quantity','1.25'::jsonb),('line-0001','unit_price_ex_tax','null'::jsonb),('line-0001','subtotal_ex_tax','null'::jsonb))x(r,f,v);
 did_deny:=false;begin perform public.commit_pilot_receipt_ocr(job.id,gen_random_uuid(),run,fields,'{}'::jsonb,null);exception when others then if sqlerrm='OCR_JOB_LEASE_LOST' then did_deny:=true;else raise;end if;end;
 if not did_deny or exists(select 1 from public.receipt_ocr_fields where ocr_run_id=run) then raise exception 'ASSERT stale worker wrote OCR fields';end if;
 perform public.commit_pilot_receipt_ocr(job.id,claimed.lease_token,run,fields,'{"fixture":true}'::jsonb,null);
 if exists(select 1 from public.goods_receipts where source_batch_id=b) then raise exception 'ASSERT independent receipt auto-published';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',reviewer,'role','authenticated')::text,true);
 product:=public.map_pilot_receipt_product(b,'line-0001',null,true);
 perform public.correct_pilot_receipt_field((select id from public.receipt_ocr_fields where ocr_run_id=run and field_name='quantity'),'2.5'::jsonb);
 saved:=public.publish_pilot_receipt(b);
 if saved<>public.publish_pilot_receipt(b) then raise exception 'ASSERT duplicate publication';end if;
 if (select count(*) from public.receipt_lines where receipt_id=saved)<>1 then raise exception 'ASSERT receipt line count';end if;
 if not exists(select 1 from public.receipt_lines where receipt_id=saved and quantity=2.5 and unit='BT' and unit_price_ex_tax is null and line_subtotal_ex_tax is null and human_correction->>'quantity'='2.5') then raise exception 'ASSERT quantities, units, null prices or correction lost';end if;
 if (select count(*) from public.inventory_lot_events where source_id in(select id from public.receipt_lines where receipt_id=saved))<>1 then raise exception 'ASSERT duplicate stock event';end if;
 did_deny:=false;begin perform public.correct_pilot_receipt_field((select id from public.receipt_ocr_fields where ocr_run_id=run and field_name='quantity'),'3'::jsonb);exception when others then if sqlerrm='PUBLISHED_RECEIPT_IMMUTABLE' then did_deny:=true;else raise;end if;end;
 if not did_deny then raise exception 'ASSERT published receipt mutable';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 info:=public.get_pilot_receipt(b);
 if exists(select 1 from jsonb_array_elements(info->'fields')f where f->>'field_name' in ('unit_price_ex_tax','subtotal_ex_tax','tax','total_inc_tax')) or (info->'receipt')?'total_inc_tax' then raise exception 'ASSERT staff price disclosure';end if;
 if not exists(select 1 from jsonb_array_elements(info->'fields')f where f->>'field_name'='quantity' and f->>'value'='2.5') then raise exception 'ASSERT reopen loses corrected quantity';end if;
execute 'set local role authenticated';
 if exists(select 1 from public.goods_receipts where id=saved) or exists(select 1 from public.receipt_lines where receipt_id=saved) then raise exception 'ASSERT raw prices exposed through tables';end if;
 if has_function_privilege('authenticated','public.claim_receipt_ocr_jobs(integer)','EXECUTE') or has_function_privilege('anon','public.begin_pilot_receipt_upload(uuid,text,jsonb,text)','EXECUTE') then raise exception 'ASSERT worker or upload publicly callable';end if;
end $$;
rollback;
select 'PASS: duplicate upload/queue/publication, lease rejection, role isolation, atomic review, null prices, original units, immutable publication, reopen' as receipt_pipeline_tests;
