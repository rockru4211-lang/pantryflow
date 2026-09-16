begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.admin_receipt_contract() returns setof text language plpgsql as $$
declare
  creator uuid:=gen_random_uuid();
  staff uuid:=gen_random_uuid();
  org uuid;
  store uuid;
  data jsonb;
  batch uuid;
  run uuid;
  doc jsonb;
  token text;
  request uuid:=gen_random_uuid();
  arrival_request uuid:=gen_random_uuid();
  before_status public.receipt_batch_status;
begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
    values(creator,creator||'@admin-receipt.invalid',now(),now(),now()),
          (staff,staff||'@admin-receipt.invalid',now(),now(),now());

  perform set_config('request.jwt.claim.sub',creator::text,true);
  data:=public.owner_setup();
  data:=public.owner_setup('business','{"organization_name":"行政核對測試","business_type":"SINGLE_RESTAURANT","store_mode":"SINGLE"}',0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','測試門市','store_code','AR'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),(data->>'revision')::int);
  data:=public.owner_setup('identity',data->'draft'||'{"work_role":"LOGISTICS"}',(data->>'revision')::int);
  data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);
  store:=(data->>'store_id')::uuid;
  org:=(data->>'organization_id')::uuid;

  return next is(private.app_role(store),'LOGISTICS','independent backoffice uses LOGISTICS identity');
  return next is((public.get_admin_receipt_register(store)->>'show_codes')::boolean,false,'product codes default off');

  insert into public.organization_members(organization_id,user_id,role,work_role)
    values(org,staff,'STAFF','STAFF');
  insert into public.staff_identities(organization_id,user_id,display_name,created_by)
    values(org,staff,'Field staff',creator);
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by)
    values(store,org,staff,'field','STAFF','STAFF',creator);

  insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,batch_number)
    values(org,store,'測試門市',staff,'2026-09-16','AR-001') returning id,status into batch,before_status;
  insert into public.receipt_ocr_runs(organization_id,batch_id,version,provider,model,prompt_version,status,started_by)
    values(org,batch,1,'test','test','v1','SUCCEEDED',creator) returning id into run;
  insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,review_status)
    values
      (org,batch,run,'document','supplier_name',to_jsonb('測試供應商'::text),to_jsonb('測試供應商'::text),'TRUSTED'),
      (org,batch,run,'1','product',to_jsonb('海鹽'::text),to_jsonb('海鹽'::text),'TRUSTED'),
      (org,batch,run,'1','unit',to_jsonb('包'::text),to_jsonb('包'::text),'TRUSTED'),
      (org,batch,run,'1','quantity',to_jsonb(2::numeric),to_jsonb(2::numeric),'TRUSTED'),
      (org,batch,run,'1','unit_price_ex_tax',to_jsonb(50::numeric),to_jsonb(50::numeric),'TRUSTED'),
      (org,batch,run,'1','subtotal_ex_tax',to_jsonb(100::numeric),to_jsonb(100::numeric),'TRUSTED');
  insert into private.receipt_delivery(batch_id,arrived_on,issues,revision,updated_by)
    values(batch,'2026-09-16','[]'::jsonb,0,creator);

  doc:=public.get_admin_receipt_document(batch);
  token:=doc->'admin'->'tokens'->>'1';
  return next ok(token is not null,'admin detail returns source token for the OCR row');
  return next is((public.get_admin_receipt_register(store)->'batches'->0->>'row_count')::int,1,'register counts receipt detail rows');

  doc:=public.save_admin_receipt_row(batch,run,'1',0,token,jsonb_build_object('quantity',3,'product_code','0007','note','行政修正'),true,request);
  return next is((doc->'admin'->'rows'->0->'values'->>'quantity')::numeric,3::numeric,'admin correction is stored separately');
  return next is((select normalized_value#>>'{}' from public.receipt_ocr_fields where ocr_run_id=run and row_key='1' and field_name='quantity'),'2','original OCR value is unchanged');
  return next is((select count(*)::int from private.admin_receipt_changes where batch_id=batch and action='ROW_SAVED'),1,'one change-history row is written');
  perform public.save_admin_receipt_row(batch,run,'1',0,token,jsonb_build_object('quantity',3,'product_code','0007','note','行政修正'),true,request);
  return next is((select count(*)::int from private.admin_receipt_changes where batch_id=batch and action='ROW_SAVED'),1,'same request id retries idempotently');
  return next throws_ok(format('select public.save_admin_receipt_row(%L,%L,%L,0,%L,%L::jsonb,true,%L)',batch,run,'1',token,'{"quantity":4}',gen_random_uuid()),'40001','REVISION_CONFLICT','stale revision cannot overwrite a saved correction');

  return next is(public.set_admin_receipt_codes(store,true),true,'code preference can be enabled explicitly');
  return next is((public.get_admin_receipt_register(store)->>'show_codes')::boolean,true,'code preference persists for this user and store');
  return next is((doc->'admin'->'rows'->0->'values'->>'product_code'),'0007','stored product code keeps leading zeros');

  doc:=public.save_admin_receipt_arrival(batch,0,'2026-09-17',arrival_request);
  return next is(doc->'batch'->'delivery'->>'arrived_on','2026-09-17','admin can correct the actual arrival date');
  return next is((select count(*)::int from private.admin_receipt_changes where batch_id=batch and action='ARRIVAL_CHANGED'),1,'arrival edit has its own audit row');
  return next is((select status from public.receipt_upload_batches where id=batch),before_status,'administrative reconciliation does not confirm receipt');
  return next ok(not exists(select 1 from public.goods_receipts where source_batch_id=batch),'administrative reconciliation creates no goods receipt');
  return next ok(not exists(select 1 from public.inventory_lots where organization_id=org and source_id=batch),'administrative reconciliation posts no inventory lot');

  perform set_config('request.jwt.claim.sub',staff::text,true);
  return next throws_ok(format('select public.get_admin_receipt_register(%L)',store),'42501','ADMIN_RECEIPT_ACCESS_DENIED','field staff cannot open administrative reconciliation');

  perform set_config('request.jwt.claim.sub',creator::text,true);
  update public.store_memberships set is_active=false where store_id=store and user_id=creator;
  return next throws_ok(format('select public.save_admin_receipt_row(%L,%L,%L,1,%L,%L::jsonb,true,%L)',batch,run,'1',token,'{"quantity":3}',request),'42501','ADMIN_RECEIPT_ACCESS_DENIED','revoked backoffice cannot replay a previously successful request');
end $$;

select * from pg_temp.admin_receipt_contract();
select * from finish();
rollback;
