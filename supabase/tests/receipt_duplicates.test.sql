-- Exercise duplicate decisions with isolated stores, actors and evidence.
begin;
do $test$
declare
  owner_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid();
  org_id uuid:=gen_random_uuid(); store_a uuid:=gen_random_uuid(); store_b uuid:=gen_random_uuid();
  original uuid; copied uuid:=gen_random_uuid(); numbered uuid:=gen_random_uuid();
  intentional uuid:=gen_random_uuid(); posted_a uuid:=gen_random_uuid(); posted_b uuid:=gen_random_uuid();
  hash text:=repeat('a',64); mode text:='SAME_RECEIPT'; fingerprint text; manifest jsonb;
  result jsonb; source_path text; item record; document_id uuid; run_id uuid;
begin
  insert into auth.users(id,email,email_confirmed_at)
    select id,id||'@receipt-duplicate.invalid',now() from unnest(array[owner_id,staff_id]) id;
  insert into public.profiles(id,display_name)
    select id,'重複貨單測試' from unnest(array[owner_id,staff_id]) id on conflict(id) do nothing;
  insert into public.organizations(id,name,business_type) values(org_id,'重複貨單測試','SINGLE_RESTAURANT');
  insert into public.stores(id,organization_id,name,store_code,created_by) values
    (store_a,org_id,'BeApe','DA'||left(store_a::text,8),owner_id),
    (store_b,org_id,'Gras','DB'||left(store_b::text,8),owner_id);
  insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
    values(org_id,owner_id,'OWNER',true,true),(org_id,staff_id,'STAFF',false,false);
  insert into public.staff_identities(organization_id,user_id,display_name,created_by)
    select org_id,id,'重複貨單測試',owner_id from unnest(array[owner_id,staff_id]) id;
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by)
    values(store_a,org_id,owner_id,'duplicate-owner','OWNER','OWNER',owner_id),
      (store_b,org_id,owner_id,'duplicate-owner-b','OWNER','OWNER',owner_id),
      (store_a,org_id,staff_id,'duplicate-staff','STAFF','STAFF',owner_id);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);

  fingerprint:=encode(extensions.digest(mode||':'||hash,'sha256'),'hex');
  manifest:=jsonb_build_array(jsonb_build_object('sha256',hash,'mime_type','image/jpeg','byte_size',4,'name','原單.jpg'));
  result:=public.begin_baihuayuan_receipt_upload(store_a,fingerprint,manifest,mode);
  original:=(result->>'batch_id')::uuid;
  source_path:=result#>>'{documents,0,storage_path}';
  assert public.begin_baihuayuan_receipt_upload(store_a,fingerprint,manifest,mode)->>'batch_id'=original::text,
    'same uploader can resume an incomplete manifest';
  begin
    perform public.begin_baihuayuan_receipt_upload(store_a,
      encode(extensions.digest('SEPARATE_RECEIPTS:'||hash,'sha256'),'hex'),manifest,'SEPARATE_RECEIPTS');
    raise exception 'concurrent manifest with different grouping accepted';
  exception when sqlstate 'PT409' then
    assert sqlerrm='RECEIPT_DUPLICATE_UPLOAD_PENDING';
  end;
  insert into storage.objects(bucket_id,name,metadata) values('receipt-documents',source_path,'{"size":4}');
  update public.receipt_upload_batches set upload_completed_at=now() where id=original;
  result:=public.begin_baihuayuan_receipt_upload(store_a,fingerprint,manifest,mode);
  assert result=jsonb_build_object('duplicate',true,'batch_id',original),'opens permitted original';
  assert public.begin_baihuayuan_receipt_upload(store_a,fingerprint,manifest,mode)=result,'duplicate retry idempotent';
  assert (select count(*)=1 from public.receipt_upload_batches where store_id=store_a),'duplicate attempt creates no copy';
  assert (select count(*)=1 from private.receipt_duplicate_uploads where store_id=store_a),'one retried upload audit record';
  result:=public.begin_baihuayuan_receipt_upload(store_b,fingerprint,manifest,mode);
  assert result->>'batch_id'<>original::text and result->>'duplicate' is null,'same bytes in another store are independent';

  perform set_config('request.jwt.claim.sub',staff_id::text,true);
  result:=public.begin_baihuayuan_receipt_upload(store_a,fingerprint,manifest,mode);
  assert result='{"duplicate":true,"batch_id":null}'::jsonb,'field uploader cannot open another person original';
  begin
    perform public.get_baihuayuan_receipt_duplicates(store_a);
    raise exception 'field reviewer list access accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.begin_baihuayuan_receipt_upload(store_b,fingerprint,manifest,mode);
    raise exception 'foreign-store upload accepted';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  assert not has_function_privilege('anon','public.get_baihuayuan_receipt_duplicates(uuid)','execute');
  assert not has_function_privilege('anon','public.set_baihuayuan_receipt_duplicate(uuid,uuid,uuid,text)','execute');
  assert not has_table_privilege('authenticated','private.receipt_duplicate_uploads','select');

  insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,uploaded_by,uploaded_at,status,work_date)
    select id,org_id,store_a,'BeApe',owner_id,now()+n*interval '1 minute','READY_FOR_REVIEW',current_date
    from unnest(array[copied,numbered,intentional,posted_a,posted_b]) with ordinality x(id,n);
  insert into private.receipt_same_photo_entries(batch_id,source_batch_id,created_by)
    values(intentional,original,owner_id);
  for item in
    select id, ord, case when id in (posted_a,posted_b) then 'POSTED-1' else 'RECEIPT-1' end as receipt_number
    from unnest(array[original,copied,numbered,intentional,posted_a,posted_b]) with ordinality x(id,ord)
  loop
    if item.id=original then
      select id into document_id from public.receipt_documents where batch_id=original;
    else
      insert into public.receipt_documents(
        organization_id,batch_id,storage_path,original_filename,page_order,mime_type,uploaded_by,content_sha256,byte_size
      ) values(org_id,item.id,case when item.id in (copied,intentional) then source_path else 'fixture/'||item.id end,
        '比對貨單.jpg',1,'image/jpeg',owner_id,
        case when item.id in (copied,intentional) then hash else encode(extensions.digest(item.id::text,'sha256'),'hex') end,4)
      returning id into document_id;
      if item.id not in (copied,intentional) then
        insert into storage.objects(bucket_id,name,metadata)
          values('receipt-documents','fixture/'||item.id,'{"size":4}');
      end if;
    end if;
    insert into public.receipt_ocr_runs(organization_id,batch_id,version,provider,model,prompt_version,status,started_by)
      values(org_id,item.id,1,'manual','fixture','fixture','SUCCEEDED',owner_id) returning id into run_id;
    insert into public.receipt_ocr_fields(
      organization_id,batch_id,document_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status
    ) select org_id,item.id,document_id,run_id,'document',x.field,x.val,x.val,0.99,'TRUSTED'
      from (values ('supplier_name','"日禾食材"'::jsonb),('receipt_date',to_jsonb(current_date)),
        ('document_number',to_jsonb(item.receipt_number)),('total_inc_tax','1040'::jsonb)) x(field,val);
  end loop;
  insert into public.goods_receipts(organization_id,store_id,receipt_date,document_number,source_batch_id,total_inc_tax)
    values(org_id,store_a,current_date,'POSTED-1',posted_a,1040);
  insert into private.receipt_account_edits(batch_id,store_id,run_id,source_fingerprint,updated_by,finance_sent_at)
    values(posted_b,store_a,run_id,'fixture',owner_id,now());

  result:=public.get_baihuayuan_receipt_duplicates(store_a);
  assert exists(select 1 from jsonb_array_elements(result) x where x->>'batch_id'=copied::text
    and x->>'reason'='EXACT_PHOTO' and x->>'original_batch_id'=original::text),'exact stored full-page-set candidate';
  assert exists(select 1 from jsonb_array_elements(result) x where x->>'batch_id'=numbered::text
    and x->>'reason'='DOCUMENT_NUMBER' and x->>'status'='SUSPECTED' and x->>'can_exclude'='true'
    and x->>'supplier_name'='日禾食材' and x->>'total'='1040'),'same number needs a manual decision';
  assert not exists(select 1 from jsonb_array_elements(result) x
    where x->>'batch_id'=intentional::text or x->>'original_batch_id'=intentional::text),
    'explicit same-photo accounting entries are independent despite same printed number';
  assert exists(select 1 from jsonb_array_elements(result) x where x->>'batch_id'=posted_b::text
    and x->>'status'='POSTED_REVIEW' and x->>'can_exclude'='false'),'finance handoff is protected';
  assert jsonb_array_length(public.get_baihuayuan_receipt_duplicates(store_b))=0,'comparison is same-store only';
  begin
    perform public.set_baihuayuan_receipt_duplicate(store_a,posted_b,posted_a,'exclude');
    raise exception 'posted duplicate excluded';
  exception when sqlstate 'PT409' then
    assert sqlerrm='RECEIPT_DUPLICATE_POSTED';
  end;
  assert (select total_inc_tax=1040 from public.goods_receipts where source_batch_id=posted_a),'goods accounting unchanged';
  assert (select finance_sent_at is not null from private.receipt_account_edits where batch_id=posted_b),'finance marker unchanged';

  update public.store_memberships set access_mode='VIEW' where store_id=store_a and user_id=owner_id;
  assert exists(select 1 from jsonb_array_elements(public.get_baihuayuan_receipt_duplicates(store_a)) x
    where x->>'batch_id'=numbered::text and x->>'can_exclude'='false'),'read-only view still visible';
  begin
    perform public.set_baihuayuan_receipt_duplicate(store_a,numbered,original,'exclude');
    raise exception 'read-only reviewer excluded a copy';
  exception when insufficient_privilege then null;
  end;
  update public.store_memberships set access_mode='EDIT' where store_id=store_a and user_id=owner_id;
  begin
    perform public.set_baihuayuan_receipt_duplicate(store_a,numbered,posted_a,'exclude');
    raise exception 'unrelated batch excluded';
  exception when sqlstate 'PT409' then
    assert sqlerrm='RECEIPT_DUPLICATE_CHANGED';
  end;
  assert public.set_baihuayuan_receipt_duplicate(store_a,numbered,original,'exclude')='{"saved":true}'::jsonb;
  assert public.set_baihuayuan_receipt_duplicate(store_a,numbered,original,'exclude')='{"saved":true}'::jsonb;
  assert (select count(*)=1 from public.audit_logs where entity_id=numbered::text and action='RECEIPT_DUPLICATE_EXCLUDED'),
    'exclusion retry is idempotent';
  assert not exists(select 1 from jsonb_array_elements(public.get_baihuayuan_receipt_inbox(store_a)) x
    where x->>'batch_id'=numbered::text),'excluded copy no longer in normal inbox';
  assert exists(select 1 from jsonb_array_elements(public.get_baihuayuan_receipt_duplicates(store_a)) x
    where x->>'batch_id'=numbered::text and x->>'status'='EXCLUDED' and x->>'can_restore'='true'),'excluded copy remains recoverable';
  assert jsonb_array_length(public.get_pilot_receipt(numbered)->'documents')=1,'excluded original evidence remains readable';
  begin
    perform public.create_receipt_same_photo(store_a,numbered,null,gen_random_uuid());
    raise exception 'excluded photo reused';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.correct_receipt_store(store_a,original,store_b,'{}',gen_random_uuid());
    raise exception 'linked original moved across stores';
  exception when sqlstate 'PT409' then
    assert sqlerrm='RECEIPT_DUPLICATE_LINKED';
  end;
  assert public.set_baihuayuan_receipt_duplicate(store_a,numbered,original,'restore')='{"saved":true}'::jsonb;
  assert public.set_baihuayuan_receipt_duplicate(store_a,numbered,original,'restore')='{"saved":true}'::jsonb;
  assert not exists(select 1 from private.receipt_duplicate_links where batch_id=numbered),'restored link removed';
  assert (select count(*)=1 from public.audit_logs where entity_id=numbered::text and action='RECEIPT_DUPLICATE_RESTORED'),
    'restore retry is idempotent';
  assert exists(select 1 from jsonb_array_elements(public.get_baihuayuan_receipt_inbox(store_a)) x
    where x->>'batch_id'=numbered::text),'restored copy reappears in inbox';
end $test$;
rollback;
