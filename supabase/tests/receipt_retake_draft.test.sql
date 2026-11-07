-- Isolated rollback fixture for workbench return, draft preservation and permissions.
begin;
do $case$
declare
 actor uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid(); store uuid:=gen_random_uuid(); wrong_store uuid:=gen_random_uuid();
 hash text:=repeat('a',64); new_hash text:=repeat('b',64);
 manifest jsonb; batch uuid; doc uuid; run uuid; job uuid; request uuid; path text; original text;
 old_row jsonb; new_row jsonb; edit_snapshot jsonb; source_snapshot jsonb; payload jsonb; result jsonb;
 before_jobs int; before_batches int;
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
  select id,id||'@retake-isolated.invalid',now(),now(),now() from unnest(array[actor,staff,other]) id;
 insert into public.profiles(id,display_name) select id,'Retake SQL QA' from unnest(array[actor,staff,other]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type) values(org,'Retake SQL QA','SINGLE_RESTAURANT');
 insert into public.stores(id,organization_id,name,store_code,created_by)
 values(store,org,'BeApe','RT'||substr(store::text,1,8),actor),(wrong_store,org,'Gras','RT'||substr(wrong_store::text,1,8),actor);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
 values(org,actor,'OWNER',true,true),(org,staff,'STAFF',false,false),(org,other,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by)
 select org,id,'Retake SQL QA',actor from unnest(array[actor,staff,other]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
 values(store,org,actor,'owner','OWNER','OWNER',actor,true),(wrong_store,org,actor,'other-owner','OWNER','OWNER',actor,true),(store,org,staff,'uploader','STAFF','STAFF',actor,false),
 (wrong_store,org,other,'other','STAFF','STAFF',actor,false);

 perform set_config('request.jwt.claim.sub',staff::text,true);
 manifest:=public.begin_baihuayuan_receipt_upload(store,
  encode(extensions.digest('SAME_RECEIPT:'||hash,'sha256'),'hex'),
  jsonb_build_array(jsonb_build_object('sha256',hash,'mime_type','image/jpeg','byte_size',4,'name','original.jpeg')),'SAME_RECEIPT');
 batch:=(manifest->>'batch_id')::uuid;
 doc:=(manifest#>>'{documents,0,id}')::uuid;
 original:=manifest#>>'{documents,0,storage_path}';
 insert into storage.objects(bucket_id,name,metadata) values('receipt-documents',original,'{"size":4}');
 job:=(public.enqueue_receipt_ocr(batch)).id;
 begin
  perform public.baihuayuan_receipt_photo('request',store,jsonb_build_object('document_id',doc,'reason','INCOMPLETE','note','should be denied'));
  raise exception 'Uploader requested a retake';
 exception when insufficient_privilege then null;
 end;

 perform set_config('request.jwt.claim.sub',actor::text,true);
 run:=public.begin_baihuayuan_receipt_manual_review(store,batch);
 assert (select status='FAILED' and last_error='MANUAL_REVIEW' from public.receipt_ocr_jobs where id=job), 'manual takeover cancelled queued OCR';
 old_row:=public.get_baihuayuan_receipt_accounts(store,null,null,null,batch)->0;
 payload:=jsonb_build_object(
  'revision',old_row->'revision','source_fingerprint',old_row->>'source_fingerprint',
  'header',jsonb_build_object('supplier_name','已輸入供應商','receipt_date',current_date,'document_number','RETAKE-01'),
  'lines',jsonb_build_array(jsonb_build_object('row_key','local-test','product_name','已輸入品項','specification','已輸入規格','quantity',3,'unit','包','unit_price',10,'subtotal',30,'category','食材','note','已輸入備註')),
  'removed_row_keys','[]'::jsonb,'adjustment',0,'tax',2,'total',32,'note','先存草稿','checked',false);
 perform public.save_baihuayuan_receipt_entry(store,batch,payload,gen_random_uuid());
 old_row:=public.get_baihuayuan_receipt_accounts(store,null,null,null,batch)->0;
 select to_jsonb(e) into strict edit_snapshot from private.receipt_account_edits e where batch_id=batch;
 select to_jsonb(d) into strict source_snapshot from public.receipt_documents d where id=doc;
 select count(*) into before_jobs from public.receipt_ocr_jobs where batch_id=batch;
 select count(*) into before_batches from public.receipt_upload_batches where store_id=store;
 assert old_row->>'supplier_name'='已輸入供應商' and old_row#>>'{lines,0,product_name}'='已輸入品項', 'draft saved before return';

 begin
  perform public.baihuayuan_receipt_photo('request',store,jsonb_build_object('document_id',doc,'reason','INCOMPLETE','note',repeat('長',501)));
  raise exception 'Oversized note accepted';
 exception when sqlstate '22023' then assert sqlerrm='INVALID_PHOTO_NOTE'; end;
 result:=public.baihuayuan_receipt_photo('request',store,jsonb_build_object('document_id',doc,'reason','INCOMPLETE','note',E' \n請把右下角拍進去\t '));
 assert (result->>'requested')::boolean=true;
 assert jsonb_array_length(public.baihuayuan_receipt_photo('list',store,jsonb_build_object('batch_id',gen_random_uuid())))=0;
 result:=public.baihuayuan_receipt_photo('list',store,jsonb_build_object('batch_id',batch));
 assert jsonb_array_length(result)=1, 'one pending request';
 request:=(result#>>'{0,id}')::uuid;
 assert result#>>'{0,note}'='請把右下角拍進去' and result#>>'{0,reason}'='INCOMPLETE','reason and trimmed note present';
 begin
  perform public.retry_baihuayuan_receipt_ocr(store,batch);
  raise exception 'Pending replacement allowed a new OCR retry';
 exception when others then if sqlerrm<>'PHOTO_RETAKE_REQUIRED' then raise; end if;
 end;
 begin
  perform public.correct_receipt_store(store,batch,wrong_store,'{}',gen_random_uuid());
  raise exception 'Receipt with a pending replacement moved to another store';
 exception when others then if sqlerrm<>'PHOTO_RETAKE_REQUIRED' then raise; end if;
 end;
 payload:=jsonb_build_object(
  'revision',old_row->'revision','source_fingerprint',old_row->>'source_fingerprint',
  'header',jsonb_build_object('supplier_name','已輸入供應商','receipt_date',current_date,'document_number','RETAKE-01'),
  'lines',old_row->'lines','adjustment',0,'tax',2,'total',32,'note','先存草稿','checked',false,'entry_completed',true,'review_completed',true);
 begin
  perform public.save_baihuayuan_receipt_review(store,batch,payload,gen_random_uuid());
  raise exception 'Pending retake still allows completing draft';
 exception when others then if sqlerrm<>'PHOTO_RETAKE_REQUIRED' then raise; end if;
 end;

 perform set_config('request.jwt.claim.sub',other::text,true);
 begin
  perform public.baihuayuan_receipt_photo('prepare',wrong_store,jsonb_build_object('request_id',request,'sha256',new_hash,'mime','image/jpeg','size',8,'name','not-mine.jpeg'));
  raise exception 'Cross-store replacement allowed';
 exception when insufficient_privilege then null;
 end;

 perform set_config('request.jwt.claim.sub',staff::text,true);
 result:=public.baihuayuan_receipt_photo('list',store);
 assert result#>>'{0,note}'='請把右下角拍進去','field user receives note';
 result:=public.baihuayuan_receipt_photo('prepare',store,jsonb_build_object('request_id',request,'sha256',new_hash,'mime','image/jpeg','size',8,'name','retaken.jpeg'));
 path:=result->>'path';
 begin
  perform public.baihuayuan_receipt_photo('complete',store,jsonb_build_object('request_id',request));
  raise exception 'Missing replacement accepted';
 exception when others then if sqlerrm<>'ORIGINAL_UPLOAD_INCOMPLETE' then raise; end if;
 end;
 insert into storage.objects(bucket_id,name,metadata) values('receipt-documents',path,'{"size":8}');
 result:=public.baihuayuan_receipt_photo('complete',store,jsonb_build_object('request_id',request));
 assert (result->>'queued')::boolean=false and (result->>'preserved_draft')::boolean=true,'retake returns to saved draft without OCR';
 assert jsonb_array_length(public.baihuayuan_receipt_photo('list',store))=0,'completed task leaves queue';
 perform public.baihuayuan_receipt_photo('complete',store,jsonb_build_object('request_id',request));

 perform set_config('request.jwt.claim.sub',actor::text,true);
 new_row:=public.get_baihuayuan_receipt_accounts(store,null,null,null,batch)->0;
 assert (select status='READY_FOR_REVIEW' from public.receipt_upload_batches where id=batch), 'ready after completed replacement';
 assert (select count(*)=before_batches from public.receipt_upload_batches where store_id=store), 'no new receipt batch';
 assert (select count(*)=before_jobs from public.receipt_ocr_jobs where batch_id=batch), 'no new OCR job';
 assert (select count(*)=1 from public.receipt_ocr_runs where batch_id=batch), 'no new OCR run';
 assert (select to_jsonb(e)=edit_snapshot from private.receipt_account_edits e where batch_id=batch), 'saved draft row unchanged';
 assert (select to_jsonb(d)=source_snapshot from public.receipt_documents d where id=doc), 'original source document unchanged';
 assert (select count(*)=2 from storage.objects where bucket_id='receipt-documents' and name in(original,path)), 'both photo versions retained';
 assert new_row->>'source_fingerprint'=old_row->>'source_fingerprint' and new_row->'lines'=old_row->'lines'
  and new_row->>'supplier_name'=old_row->>'supplier_name' and (new_row->>'run_id')::uuid=run, 'same draft, header, run, and concurrency fingerprint';
 assert new_row#>>'{documents,0,path}'=path,'workbench reads replacement while preserving draft';
 assert (select count(*)=1 from public.audit_logs where action='RECEIPT_PHOTO_RETAKEN' and entity_id=batch::text), 'completion retry adds no second audit';
 assert not exists(select 1 from public.goods_receipts where source_batch_id=batch),'retake does not post stock';
 update private.receipt_account_edits set finance_sent_at=now() where batch_id=batch;
 begin
  perform public.baihuayuan_receipt_photo('request',store,jsonb_build_object('document_id',doc,'reason','BLUR'));
  raise exception 'Finance receipt accepted for retake';
 exception when others then if sqlerrm<>'PUBLISHED_RECEIPT_IMMUTABLE' then raise; end if;
 end;
end $case$;
rollback;
