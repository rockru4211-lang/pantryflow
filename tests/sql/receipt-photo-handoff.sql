-- Run with migration applied. Every fixture is isolated and rolled back.
begin;
do $$
declare org uuid; staff uuid; staff2 uuid; reviewer uuid; supervisor uuid; store uuid; foreign_store uuid;
 manifest jsonb; docs jsonb; result jsonb; batch uuid; document uuid; request uuid; job uuid; run uuid; lease uuid:=gen_random_uuid();
 original text; replacement text; hash1 text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
 hash2 text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');fingerprint text; denied boolean; fields jsonb;
 second_batch uuid; second_run uuid; second_job uuid; second_lease uuid:=gen_random_uuid();
begin
 select s.organization_id,m.user_id into strict org,staff from public.stores s join public.store_memberships m on m.store_id=s.id where s.store_code='QA0908RECEIPT' and m.role='STAFF';
 select m.user_id into strict reviewer from public.stores s join public.store_memberships m on m.store_id=s.id where s.store_code='QA0908RECEIPT' and m.role='LOGISTICS';
 select m.user_id into strict staff2 from public.stores s join public.store_memberships m on m.store_id=s.id where s.store_code='QAFULLCHAIN' and m.role='STAFF';
 select m.user_id into strict supervisor from public.stores s join public.store_memberships m on m.store_id=s.id where s.store_code='QAFULLCHAIN' and m.role='SUPERVISOR';
 insert into public.stores(organization_id,name,store_code,created_by) values(org,'BeApe','QA-PHOTO-'||left(gen_random_uuid()::text,8),reviewer) returning id into store;
 insert into public.stores(organization_id,name,store_code,created_by) values(org,'Gras','QA-PHOTO-'||left(gen_random_uuid()::text,8),reviewer) returning id into foreign_store;
 insert into public.organization_members(organization_id,user_id,role) values(org,staff2,'STAFF'),(org,supervisor,'SUPERVISOR') on conflict do nothing;
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,staff2,'QA photo second',reviewer),(org,supervisor,'QA photo supervisor',reviewer) on conflict do nothing;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,assigned_by)
 values(store,org,staff,'photo-staff','STAFF',reviewer),(store,org,staff2,'photo-staff2','STAFF',reviewer),
 (store,org,reviewer,'photo-reviewer','LOGISTICS',reviewer),(store,org,supervisor,'photo-supervisor','SUPERVISOR',reviewer);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 docs:=jsonb_build_array(jsonb_build_object('sha256',hash1,'mime_type','image/jpeg','byte_size',4,'name','fixture.jpg'));
 fingerprint:=encode(extensions.digest('SAME_RECEIPT:'||hash1,'sha256'),'hex');
 manifest:=public.begin_baihuayuan_receipt_upload(store,fingerprint,docs,'SAME_RECEIPT');batch:=(manifest->>'batch_id')::uuid;
 document:=(manifest#>>'{documents,0,id}')::uuid;original:=manifest#>>'{documents,0,storage_path}';
 insert into storage.objects(bucket_id,name,metadata) values('receipt-documents',original,'{"size":4}');
 select (public.enqueue_receipt_ocr(batch)).id into job;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff2,'role','authenticated')::text,true);
 result:=public.begin_baihuayuan_receipt_upload(store,encode(extensions.digest('SEPARATE_RECEIPTS:'||hash1,'sha256'),'hex'),docs,'SEPARATE_RECEIPTS');
 if result<>'{"duplicate":true}'::jsonb then raise exception 'ASSERT cross-user/mode duplicate not skipped';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisor,'role','authenticated')::text,true);
 denied:=false;begin perform public.baihuayuan_receipt_photo('request',store,jsonb_build_object('document_id',document,'reason','BLUR'));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'ASSERT supervisor can review';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',reviewer,'role','authenticated')::text,true);
 perform public.baihuayuan_receipt_photo('request',store,jsonb_build_object('document_id',document,'reason','BLUR'));
 perform public.baihuayuan_receipt_photo('request',store,jsonb_build_object('document_id',document,'reason','BLUR'));
 result:=public.baihuayuan_receipt_photo('list',store);
 if jsonb_array_length(result)<>1 then raise exception 'ASSERT duplicate retake request';end if;request:=(result->0->>'id')::uuid;
 denied:=false;begin perform private.publish_receipt(batch,reviewer,false);exception when others then if sqlerrm='PHOTO_RETAKE_REQUIRED' then denied:=true;else raise;end if;end;
 if not denied then raise exception 'ASSERT requested photo can publish';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 denied:=false;begin perform public.baihuayuan_receipt_photo('list',foreign_store);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'ASSERT cross-store access';end if;
 denied:=false;begin perform public.baihuayuan_receipt_photo('prepare',store,jsonb_build_object('request_id',request,'sha256',hash1,'name','same.jpg','mime','image/jpeg','size',4));exception when others then if sqlerrm='RETAKE_SAME_PHOTO' then denied:=true;else raise;end if;end;
 if not denied then raise exception 'ASSERT original photo accepted as retake';end if;
 result:=public.baihuayuan_receipt_photo('prepare',store,jsonb_build_object('request_id',request,'sha256',hash2,'name','clear.jpg','mime','image/jpeg','size',4));replacement:=result->>'path';
 denied:=false;begin perform public.baihuayuan_receipt_photo('complete',store,jsonb_build_object('request_id',request));exception when others then if sqlerrm='ORIGINAL_UPLOAD_INCOMPLETE' then denied:=true;else raise;end if;end;
 if not denied then raise exception 'ASSERT missing upload resolved retake';end if;
 insert into storage.objects(bucket_id,name,metadata) values('receipt-documents',replacement,'{"size":4}');
 update public.receipt_ocr_jobs set status='FAILED' where id=job;
 result:=public.baihuayuan_receipt_photo('complete',store,jsonb_build_object('request_id',request));
 if result->>'queued'<>'true' or jsonb_array_length(public.baihuayuan_receipt_photo('list',store))<>0 then raise exception 'ASSERT retake not queued';end if;
 perform public.baihuayuan_receipt_photo('complete',store,jsonb_build_object('request_id',request));
 if (select count(*) from public.receipt_ocr_jobs where batch_id=batch and status='QUEUED')<>1 then raise exception 'ASSERT retry creates duplicate job';end if;
 if (select storage_path from public.receipt_documents where id=document)<>original then raise exception 'ASSERT original overwritten';end if;
 if private.receipt_ocr_sources(batch)->0->>'storage_path'<>replacement then raise exception 'ASSERT worker reads old photo';end if;
 if public.get_pilot_receipt(batch)->'documents'->0->>'path'<>replacement then raise exception 'ASSERT reviewer reads old photo';end if;
 denied:=false;begin perform private.publish_receipt(batch,reviewer,false);exception when others then if sqlerrm='OCR_NOT_READY' then denied:=true;else raise;end if;end;
 if not denied then raise exception 'ASSERT stale pre-retake OCR can publish';end if;
 -- Physical defect reports require the active job lease; no-lines is not inferred.
 select id into job from public.receipt_ocr_jobs where batch_id=batch and status='QUEUED';
 update public.receipt_ocr_jobs set status='RUNNING',lease_token=lease where id=job;
 select id into run from public.create_receipt_ocr_run(org,batch,'qa-fixture','qa-fixture','photo-test',staff);
 denied:=false;begin perform public.report_receipt_photo_issues(job,gen_random_uuid(),run,'[{"page":1,"reason":"GLARE"}]','{}');exception when others then if sqlerrm='OCR_JOB_LEASE_LOST' then denied:=true;else raise;end if;end;
 if not denied then raise exception 'ASSERT stale photo worker';end if;
 if public.report_receipt_photo_issues(job,lease,run,'[]','{}') then raise exception 'ASSERT empty quality report demands retake';end if;
 if not public.report_receipt_photo_issues(job,lease,run,'[{"page":1,"reason":"GLARE"}]','{}') then raise exception 'ASSERT defect not requested';end if;
 if (select status from public.receipt_ocr_jobs where id=job)<>'FAILED' then raise exception 'ASSERT photo defect retries provider';end if;
 -- A separate extraction pair exercises exact semantic deduplication.
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date) values(org,store,'BeApe',staff,current_date) returning id into batch;
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date) values(org,store,'BeApe',staff2,current_date) returning id into second_batch;
 insert into public.receipt_ocr_jobs(organization_id,batch_id,requested_by,status,lease_token) values(org,batch,staff,'RUNNING',lease) returning id into job;
 insert into public.receipt_ocr_jobs(organization_id,batch_id,requested_by,status,lease_token) values(org,second_batch,staff2,'RUNNING',second_lease) returning id into second_job;
 select id into run from public.create_receipt_ocr_run(org,batch,'qa-fixture','qa-fixture','photo-test',staff);
 select id into second_run from public.create_receipt_ocr_run(org,second_batch,'qa-fixture','qa-fixture','photo-test',staff2);
 select jsonb_agg(jsonb_build_object('row_key',x.r,'field_name',x.f,'raw_value',x.v,'normalized_value',x.v,'confidence',0.99,'review_status','TRUSTED','source_region',null,'validation_notes','[]'::jsonb)) into fields
 from(values('document','supplier_name','"QA photo supplier"'::jsonb),('document','document_number',to_jsonb(gen_random_uuid()::text)),('document','receipt_date','"2026-09-24"'::jsonb),('document','subtotal_ex_tax','null'::jsonb),('document','tax','null'::jsonb),('document','total_inc_tax','null'::jsonb),('line-0001','product','"QA photo item"'::jsonb),('line-0001','specification','""'::jsonb),('line-0001','unit','"BT"'::jsonb),('line-0001','quantity','1.25'::jsonb),('line-0001','unit_price_ex_tax','null'::jsonb),('line-0001','subtotal_ex_tax','null'::jsonb))x(r,f,v);
 perform public.commit_pilot_receipt_ocr(job,lease,run,fields,'{}',null);
 perform public.commit_pilot_receipt_ocr(second_job,second_lease,second_run,fields,'{}',null);
 if not exists(select 1 from private.receipt_duplicate_links where batch_id=second_batch and original_batch_id=batch) then raise exception 'ASSERT exact rephoto duplicate not linked';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',reviewer,'role','authenticated')::text,true);
 if exists(select 1 from jsonb_array_elements(public.get_baihuayuan_receipt_inbox(store)) x where x->>'batch_id'=second_batch::text) then raise exception 'ASSERT duplicate in review inbox';end if;
 denied:=false;begin perform private.publish_receipt(second_batch,reviewer,false);exception when others then if sqlerrm='DUPLICATE_RECEIPT_NUMBER' then denied:=true;else raise;end if;end;
 if not denied then raise exception 'ASSERT duplicate publication';end if;
 if exists(select 1 from public.goods_receipts where source_batch_id in (batch,second_batch)) then raise exception 'ASSERT draft posted stock';end if;
 if has_function_privilege('anon','public.baihuayuan_receipt_photo(text,uuid,jsonb)','execute') or has_function_privilege('authenticated','public.report_receipt_photo_issues(uuid,uuid,uuid,jsonb,jsonb)','execute') then raise exception 'ASSERT public worker access';end if;
end $$;
rollback;
select 'PASS: field/admin separation, store isolation, photo retry, immutable sources, leased quality check, file and semantic deduplication, no stock posting' as result;
