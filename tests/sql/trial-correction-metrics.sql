begin;
do $$
declare store uuid; batch uuid; f public.receipt_ocr_fields; baseline int; changed int; report jsonb;
begin
 select id into store from public.stores where store_code='QAFULLINDEP';
 select b.id into batch from public.receipt_upload_batches b join public.goods_receipts g on g.source_batch_id=b.id where b.store_id=store limit 1;
 assert batch is not null,'Existing isolated receipt fixture required';
 insert into private.trial_stores(store_id,cohort,activated_at,enrollment_reason) values(store,'QA',date_trunc('day',now(),'Asia/Taipei'),'rollback metric check') on conflict(store_id)do update set activated_at=date_trunc('day',now(),'Asia/Taipei');
 select * into f from public.receipt_ocr_fields where batch_id=batch and row_key<>'document' and field_name='quantity' order by created_at desc limit 1;
 assert f.id is not null,'Three-line OCR fixture missing';
 insert into public.receipt_review_corrections(organization_id,batch_id,ocr_field_id,old_value,new_value,modified_by) values(f.organization_id,batch,f.id,f.normalized_value,f.normalized_value,(select owner_user_id from public.organizations where id=f.organization_id));
 report:=private.trial_daily_report(store);baseline:=(report->'days'->0->'review'->>'finally_changed_fields')::int;
 insert into public.receipt_review_corrections(organization_id,batch_id,ocr_field_id,old_value,new_value,modified_by,modified_at) values(f.organization_id,batch,f.id,f.normalized_value,'77'::jsonb,(select owner_user_id from public.organizations where id=f.organization_id),clock_timestamp()+interval '1 second');
 report:=private.trial_daily_report(store);changed:=(report->'days'->0->'review'->>'finally_changed_fields')::int;
 assert changed=baseline+1,'A changed field was missed';
 insert into public.receipt_review_corrections(organization_id,batch_id,ocr_field_id,old_value,new_value,modified_by,modified_at) values(f.organization_id,batch,f.id,'77'::jsonb,f.normalized_value,(select owner_user_id from public.organizations where id=f.organization_id),clock_timestamp()+interval '2 seconds');
 report:=private.trial_daily_report(store);
 assert (report->'days'->0->'review'->>'finally_changed_fields')::int=baseline,'Reverted edits counted as final OCR errors';
 assert (report->'days'->0->'review'->>'reverted_fields')::int>=1,'Reverted edit history not traceable';
 assert (report->'days'->0->'review'->>'reviewed_fields')::int>3,'Full confirmed field denominator missing';
end $$;
rollback;
