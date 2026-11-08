-- The whole fixture is isolated and rolled back.
begin;
do $test$
declare
  actor uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
  first_store uuid:=gen_random_uuid(); second_store uuid:=gen_random_uuid(); supplier uuid:=gen_random_uuid();
  location uuid:=gen_random_uuid(); product uuid; batch uuid; run uuid; original uuid; ignored uuid;
  chosen_store uuid; path text; account jsonb; input jsonb; saved jsonb; request_id uuid;
begin
  assert not has_function_privilege('authenticated','private.sync_receipt_entry_items(uuid,jsonb)','execute');
  assert not has_table_privilege('authenticated','private.receipt_entry_items','SELECT,INSERT,UPDATE,DELETE');
  insert into auth.users(id,email,email_confirmed_at)
  select id,id||'@receipt-shared.invalid',now() from unnest(array[actor,staff]) id;
  insert into public.profiles(id,display_name)
  select id,'進貨共用測試' from unnest(array[actor,staff]) id on conflict(id) do nothing;
  insert into public.organizations(id,name,business_type,store_mode)
  values(org,'進貨共用測試','SINGLE_RESTAURANT','MULTI');
  insert into public.stores(id,organization_id,name,store_code,created_by)
  values(first_store,org,'BeApe','RS'||left(first_store::text,8),actor),
    (second_store,org,'Gras','RS'||left(second_store::text,8),actor);
  insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
  values(org,actor,'OWNER',true,true),(org,staff,'STAFF',false,false);
  insert into public.staff_identities(organization_id,user_id,display_name,created_by)
  select org,id,'進貨共用測試',actor from unnest(array[actor,staff]) id;
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
  values(first_store,org,actor,'shared-owner','OWNER','OWNER',actor,true),
    (second_store,org,actor,'shared-owner-b','OWNER','OWNER',actor,true),
    (first_store,org,staff,'shared-staff','STAFF','STAFF',actor,false);
  insert into public.suppliers(id,organization_id,name) values(supplier,org,'測試供應商');
  perform set_config('request.jwt.claim.sub',actor::text,true);

  for i in 1..4 loop
    chosen_store:=case when i=3 then second_store else first_store end;
    batch:=gen_random_uuid();
    run:=gen_random_uuid();
    path:=org||'/'||batch||'/fixture.png';
    insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,batch_number,status,group_mode,upload_completed_at)
    select batch,org,s.id,s.name,current_date,actor,'RS-'||batch,'READY_FOR_REVIEW','SEPARATE_RECEIPTS',now()
    from public.stores s where s.id=chosen_store;
    insert into public.receipt_documents(organization_id,batch_id,storage_path,original_filename,page_order,mime_type,uploaded_by,content_sha256,byte_size)
    values(org,batch,path,'fixture.png',1,'image/png',actor,encode(extensions.digest(batch::text,'sha256'),'hex'),4);
    insert into storage.objects(bucket_id,name,metadata) values('receipt-documents',path,'{"size":4}');
    insert into public.receipt_ocr_runs(id,organization_id,batch_id,version,provider,model,prompt_version,status,started_by)
    values(run,org,batch,1,'fixture','rollback-only','fixture','PROCESSING',actor);
    insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status)
    select org,batch,run,'document',key,value,value,1,'TRUSTED'
    from jsonb_each(jsonb_build_object('supplier_name','測試供應商','receipt_date',current_date,'document_number','SHARED-1','subtotal_ex_tax',100,'tax',0,'total_inc_tax',100))
    union all
    select org,batch,run,'line-0001',key,value,value,1,'TRUSTED'
    from jsonb_each(jsonb_build_object('product',case when i=2 then '1 測試新食材' else '測試新食材' end,
      'unit','公斤','quantity',case when i=4 then 4 else 2 end,'unit_price_ex_tax',50,'subtotal_ex_tax',100));
    update public.receipt_ocr_runs set status='SUCCEEDED' where id=run;

    if i=2 then
      ignored:=batch;
      assert exists(select 1 from private.receipt_duplicate_links where batch_id=ignored and original_batch_id=original);
      assert public.get_baihuayuan_receipt_accounts(first_store,null,null,null,ignored)='[]'::jsonb;
      assert exists(select 1 from public.receipt_documents where batch_id=ignored),'duplicate original image must remain';
      continue;
    end if;
    assert not exists(select 1 from private.receipt_duplicate_links where batch_id=batch),'different store or different line was hidden';
    if i=4 then continue; end if;
    if i=1 then original:=batch; end if;
    account:=public.get_baihuayuan_receipt_accounts(chosen_store,null,null,null,batch)->0;
    input:=jsonb_build_object('source_fingerprint',account->>'source_fingerprint','revision',account->'revision',
      'header',jsonb_build_object('supplier_name','測試供應商','receipt_date',current_date,'document_number','SHARED-1'),
      'lines',account->'lines','adjustment',0,'adjustment_note','','tax',0,'total',100,'note','','checked',false);
    if i=1 then
      saved:=public.save_baihuayuan_receipt_review(chosen_store,batch,input,gen_random_uuid());
      assert not exists(select 1 from private.receipt_entry_items where batch_id=batch),'draft reached shared catalog';
      input:=input||jsonb_build_object('source_fingerprint',saved->'account'->>'source_fingerprint','revision',saved->'account'->'revision');
    end if;
    input:=input||'{"review_completed":true,"entry_completed":true}'::jsonb;
    request_id:=gen_random_uuid();
    saved:=public.save_baihuayuan_receipt_review(chosen_store,batch,input,request_id);
    assert saved=public.save_baihuayuan_receipt_review(chosen_store,batch,input,request_id),'completion retry changed';
    assert saved#>>'{account,finance_sent_at}' is not null,'finance handoff missing';
    assert saved#>>'{account,lines,0,product_id}' is not null,'shared product missing from receipt';
    if i=1 then product:=(saved#>>'{account,lines,0,product_id}')::uuid;
    else assert saved#>>'{account,lines,0,product_id}'=product::text,'both stores must reuse the product';end if;
    assert (select count(*)=1 from private.recipe_price_entries r where r.store_id=chosen_store
      and r.source_ref->>'batch_id'=batch::text and r.product_id=product and r.price=50),'reference price missing or duplicated';
    assert exists(select 1 from jsonb_array_elements(private.receipt_count_candidates(chosen_store)) c
      where c->>'id'=product::text and c->>'supplier'='測試供應商'),'inventory candidate missing';
    assert not exists(select 1 from public.goods_receipts g where g.source_batch_id=batch),'catalog assignment posted stock';
  end loop;

  insert into public.count_zones(id,organization_id,store_id,name) values(location,org,first_store,'測試儲物區');
  input:=jsonb_build_object('ids',jsonb_build_array(product),'zone_id',location);
  perform set_config('request.jwt.claim.sub',staff::text,true);
  begin
    perform public.baihuayuan_receipt_count_candidates(first_store,'add',input,gen_random_uuid());
    raise exception 'staff may assign the catalog without permission';
  exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  request_id:=gen_random_uuid();
  saved:=public.baihuayuan_receipt_count_candidates(first_store,'add',input,request_id);
  assert saved=public.baihuayuan_receipt_count_candidates(first_store,'add',input,request_id),'zone assignment retry changed';
  assert (select count(*)=1 from public.zone_products zp where zp.product_id=product and zp.zone_id=location);
  assert not exists(select 1 from jsonb_array_elements(private.receipt_count_candidates(first_store)) c where c->>'id'=product::text);
  assert exists(select 1 from jsonb_array_elements(private.receipt_count_candidates(second_store)) c where c->>'id'=product::text);
end $test$;
rollback;
