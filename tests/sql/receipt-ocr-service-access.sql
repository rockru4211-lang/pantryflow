-- Isolated fixtures; exercise the actual database roles, not just JWT claims.
begin;
do $test$
declare actor uuid:=gen_random_uuid(); org uuid; store uuid; batch uuid; document uuid;
 data jsonb; actual jsonb; original jsonb; denied boolean;
begin
 assert has_schema_privilege('service_role','private','USAGE'),'worker cannot resolve private implementation';
 assert not has_schema_privilege('service_role','private','CREATE'),'worker received schema creation rights';
 assert not has_schema_privilege('anon','private','USAGE'),'anonymous schema access expanded';
 assert not (select prosecdef from pg_proc where oid='public.get_receipt_ocr_sources(uuid)'::regprocedure),'source wrapper bypasses invoker security';
 assert not has_function_privilege('anon','public.get_receipt_ocr_sources(uuid)','EXECUTE'),'anonymous worker access';
 assert not has_function_privilege('authenticated','public.get_receipt_ocr_sources(uuid)','EXECUTE'),'client worker access';
 insert into auth.users(id,email,email_confirmed_at) values(actor,actor||'@ocr-access-qa.invalid',now());
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','OCR access QA','business_type','SINGLE_RESTAURANT','store_mode','MULTI'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','Gras','store_code','OCR'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);
 org:=(data->>'organization_id')::uuid;store:=(data->>'store_id')::uuid;
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date)
 values(org,store,'Gras',actor,current_date) returning id into batch;
 insert into public.receipt_documents(organization_id,batch_id,storage_path,original_filename,page_order,mime_type,uploaded_by,content_sha256,byte_size)
 values(org,batch,org||'/'||batch||'/original','original.jpg',1,'image/jpeg',actor,repeat('a',64),4) returning id into document;
 select to_jsonb(d) into original from public.receipt_documents d where id=document;
 set local role service_role;
 actual:=public.get_receipt_ocr_sources(batch);
 reset role;
 assert jsonb_array_length(actual)=1 and actual->0->>'storage_path'=original->>'storage_path','worker cannot read original source';
 insert into private.receipt_photo_requests(batch_id,document_id,reason,requested_by,replacement_path,replacement_hash,replacement_name,replacement_mime,replacement_size,prepared_by,completed_at)
 values(batch,document,'BLUR',actor,org||'/'||batch||'/replacement',repeat('b',64),'replacement.jpg','image/jpeg',8,actor,now());
 set local role service_role;
 actual:=public.get_receipt_ocr_sources(batch);
 assert actual=public.get_receipt_ocr_sources(batch),'repeated source read changed result';
 assert public.get_receipt_ocr_sources(gen_random_uuid())='[]'::jsonb,'missing batch returned source';
 reset role;
 assert actual->0->>'original_filename'='replacement.jpg' and actual->0->>'content_sha256'=repeat('b',64),'worker missed completed retake';
 assert (select to_jsonb(d)=original from public.receipt_documents d where id=document),'original source mutated';
 set local role authenticated;
 denied:=false;
 begin perform public.get_receipt_ocr_sources(batch);exception when insufficient_privilege then denied:=true;end;
 reset role;
 assert denied,'authenticated user read worker sources';
 set local role anon;
 denied:=false;
 begin perform public.get_receipt_ocr_sources(batch);exception when insufficient_privilege then denied:=true;end;
 reset role;
 assert denied,'anonymous user read worker sources';
end $test$;
-- Applying the additive permission twice remains safe.
grant usage on schema private to service_role;
grant usage on schema private to service_role;
rollback;
select 'PASS: real worker source/retake access, client denial, immutable originals, idempotency' as result;
