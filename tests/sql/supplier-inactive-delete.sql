-- Exercise the public supplier read/write paths. Roll back every fixture row.
do $test$
declare
 owner_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 beape uuid:=gen_random_uuid(); gras uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid();
 unused_supplier uuid:=gen_random_uuid(); receipt_supplier uuid:=gen_random_uuid(); product_supplier uuid:=gen_random_uuid();
 request_id uuid:=gen_random_uuid(); payload jsonb; result jsonb; snapshot jsonb;
begin
 begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
   select id,id||'@supplier-delete-test.invalid',now(),now(),now() from unnest(array[owner_id,staff_id]) u(id);
  insert into public.profiles(id,display_name)
   select id,'Supplier delete fixture' from unnest(array[owner_id,staff_id]) u(id) on conflict(id) do nothing;
  insert into public.organizations(id,name,business_type) values(org,'Supplier delete fixture','SINGLE_RESTAURANT');
  insert into public.stores(id,organization_id,name,store_code,created_by)
   values(beape,org,'BeApe','SD'||substr(beape::text,1,8),owner_id),(gras,org,'Gras','SD'||substr(gras::text,1,8),owner_id);
  insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
   values(org,owner_id,'OWNER',true,true),(org,staff_id,'STAFF',false,false);
  insert into public.staff_identities(organization_id,user_id,display_name,created_by)
   select org,id,'Supplier delete fixture',owner_id from unnest(array[owner_id,staff_id]) u(id);
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
   values(beape,org,owner_id,'sd-owner','OWNER','OWNER',owner_id,true),(gras,org,owner_id,'sd-peer','OWNER','OWNER',owner_id,true),
     (beape,org,staff_id,'sd-staff','STAFF','STAFF',owner_id,false);

  insert into public.suppliers(id,organization_id,name,is_active)
   values(unused_supplier,org,'Unused fixture supplier',true),(receipt_supplier,org,'Named receipt supplier',false),
     (product_supplier,org,'Product supplier',false);
  insert into private.supplier_details(supplier_id,phone,aliases,updated_by)
   values(unused_supplier,'0123456789','{}',owner_id),(receipt_supplier,'',array['Older receipt alias'],owner_id);
  insert into public.products(organization_id,product_code,name,base_unit,current_supplier_id)
   values(org,'SD-TEST','Fixture item','kg',product_supplier);
  insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,batch_number,status,group_mode)
   values(receipt,org,gras,'Gras',current_date,owner_id,'SD-RECEIPT','COMPLETED','SAME_RECEIPT');
  insert into private.receipt_account_edits(batch_id,store_id,header,source_fingerprint,updated_by)
   values(receipt,gras,'{"supplier_name":"older receipt alias"}','supplier-delete-test',owner_id);
  select to_jsonb(e) into snapshot from private.receipt_account_edits e where batch_id=receipt;

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  payload:=jsonb_build_object('kind','supplier','id',unused_supplier,'operation','delete',
   'updated_at',(select updated_at from public.suppliers where id=unused_supplier));
  begin
   perform public.app_operation(beape,'directory.lifecycle',payload,gen_random_uuid());
   raise exception 'Active supplier deleted';
  exception when serialization_failure then null;end;
  perform public.app_operation(beape,'directory.lifecycle',payload||'{"operation":"deactivate"}',gen_random_uuid());
  begin
   perform public.app_operation(beape,'directory.lifecycle',payload||jsonb_build_object('updated_at','2000-01-01T00:00:00Z'),gen_random_uuid());
   raise exception 'Stale supplier revision accepted';
  exception when serialization_failure then null;end;
  payload:=payload||jsonb_build_object('updated_at',(select updated_at from public.suppliers where id=unused_supplier));

  result:=public.app_workspace(beape,'suppliers','{"include_delete_eligibility":true}');
  assert exists(select 1 from jsonb_array_elements(result->'suppliers') r where r->>'id'=unused_supplier::text and r->>'can_delete'='true'),
   'Unlinked paused supplier is not eligible';
  assert (select count(*) from jsonb_array_elements(result->'suppliers') r
   where r->>'id' in (receipt_supplier::text,product_supplier::text) and r->>'can_delete'='false')=2,'A linked supplier is eligible';
  assert not exists(select 1 from jsonb_array_elements(public.app_workspace(gras,'suppliers','{}')->'suppliers') r where r->>'can_delete'='true'),
   'Receipt picker was sent delete eligibility without opting in';

  for result in
   select jsonb_build_object('kind','supplier','operation','delete','id',id,'updated_at',updated_at)
   from public.suppliers where id in (receipt_supplier,product_supplier)
  loop
   begin
    perform public.app_operation(beape,'directory.lifecycle',result,gen_random_uuid());
    raise exception 'Linked supplier deleted';
   exception when foreign_key_violation then null;end;
  end loop;
  assert (select to_jsonb(e) from private.receipt_account_edits e where batch_id=receipt)=snapshot,'Linked receipt was changed';
  assert exists(select 1 from public.products where current_supplier_id=product_supplier),'Linked product was changed';
  assert (select count(*) from public.suppliers where id in (receipt_supplier,product_supplier) and not is_active and not is_removed)=2,
   'Linked supplier state changed';

  perform set_config('request.jwt.claim.sub',staff_id::text,true);
  begin
   perform public.app_operation(beape,'directory.lifecycle',payload,request_id);
   raise exception 'Staff deleted a supplier';
  exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  update public.store_memberships set access_mode='VIEW' where store_id=beape and user_id=owner_id;
  assert not exists(select 1 from jsonb_array_elements(public.app_workspace(beape,'suppliers','{"include_delete_eligibility":true}')->'suppliers') r
   where r->>'can_delete'='true'),'Read-only owner was offered deletion';
  begin
   perform public.app_operation(beape,'directory.lifecycle',payload,request_id);
   raise exception 'Read-only owner deleted a supplier';
  exception when insufficient_privilege then null;end;

  result:=public.app_operation(gras,'directory.lifecycle',payload,request_id);
  assert result->>'deleted'='true' and public.app_operation(gras,'directory.lifecycle',payload,request_id)=result,'Delete retry changed result';
  assert (select count(*) from public.audit_logs where organization_id=org and entity_id=unused_supplier::text and action='directory.delete')=1,
   'Delete audit was not recorded exactly once';
  assert not exists(select 1 from public.suppliers where id=unused_supplier);
  assert not exists(select 1 from private.supplier_details where supplier_id=unused_supplier);
  assert not has_function_privilege('authenticated','private.supplier_directory_has_history(public.suppliers)','EXECUTE');

  raise exception using errcode='ZX001',message='rollback supplier delete fixtures';
 exception when sqlstate 'ZX001' then null;end;
 assert not exists(select 1 from public.organizations where id=org),'Supplier fixture leaked';
 assert not exists(select 1 from public.receipt_upload_batches where id=receipt),'Receipt fixture leaked';
end $test$;
