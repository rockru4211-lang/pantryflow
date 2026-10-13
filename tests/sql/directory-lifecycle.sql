-- Isolated production-schema fixture. The inner exception rolls back all test rows.
do $test$
declare owner_id uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid();
 st uuid:=gen_random_uuid(); other_st uuid:=gen_random_uuid(); doc uuid:=gen_random_uuid(); contract uuid:=gen_random_uuid(); supplier uuid:=gen_random_uuid(); used_supplier uuid:=gen_random_uuid();
 req uuid:=gen_random_uuid(); payload jsonb; result jsonb; before_docs bigint; before_suppliers bigint; r integer;
begin
 select count(*) into before_docs from private.administrative_documents;select count(*) into before_suppliers from public.suppliers;
 begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select u,u||'@directory-test.invalid',now(),now(),now() from unnest(array[owner_id,staff]) u;
  insert into public.profiles(id,display_name) select u,'Directory lifecycle fixture' from unnest(array[owner_id,staff]) u on conflict(id) do nothing;
  insert into public.organizations(id,name,business_type) values(org,'Directory fixture','SINGLE_RESTAURANT'),(other_org,'Other fixture','SINGLE_RESTAURANT');
  insert into public.stores(id,organization_id,name,store_code,created_by) values(st,org,'BeApe','DL'||substr(st::text,1,8),owner_id),(other_st,other_org,'Gras','DL'||substr(other_st::text,1,8),owner_id);
  insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,owner_id,'OWNER',true,true),(org,staff,'STAFF',false,false);
  insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,u,'Directory fixture',owner_id from unnest(array[owner_id,staff]) u;
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
   values(st,org,owner_id,'dl-owner','OWNER','OWNER',owner_id,true),(st,org,staff,'dl-staff','STAFF','STAFF',owner_id,false);
  insert into private.administrative_documents(id,store_id,name,category,summary,note,updated_by,contract_end)
   values(doc,st,'Fixture freezer','設備資料','服務事項：冷凍','original note',owner_id,null),(contract,st,'Fixture lease','合約文件','','',owner_id,current_date+365);
  insert into public.suppliers(id,organization_id,name) values(supplier,org,'Unused fixture supplier'),(used_supplier,org,'Used fixture supplier');
  insert into private.supplier_details(supplier_id,phone,updated_by) values(supplier,'0123456789',owner_id);
  insert into public.products(organization_id,product_code,name,base_unit,current_supplier_id) values(org,'DL-P','Fixture item','kg',used_supplier);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  payload:=jsonb_build_object('kind','equipment','id',doc,'operation','deactivate','revision',1);
  result:=public.app_operation(st,'directory.lifecycle',payload,req);
  assert public.app_operation(st,'directory.lifecycle',payload,req)=result,'retry is idempotent';
  assert (select archived and not is_removed and note='original note' from private.administrative_documents where id=doc),'deactivate preserves details';
  begin perform public.app_operation(st,'directory.lifecycle',payload||'{"operation":"remove"}',req);raise exception 'request conflict accepted';exception when sqlstate '23505' then null;end;
  begin perform public.app_operation(st,'directory.lifecycle',payload||'{"operation":"remove"}',gen_random_uuid());raise exception 'stale revision accepted';exception when sqlstate '40001' then null;end;
  perform public.app_operation(st,'directory.lifecycle',payload||'{"operation":"remove","revision":2}',gen_random_uuid());
  assert (select archived and is_removed from private.administrative_documents where id=doc);
  begin perform public.app_operation(st,'administrative.save',jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',doc,'name','Overwrite','category','設備資料','revision',3))),gen_random_uuid());raise exception 'removed record edited';exception when sqlstate '22023' then null;end;
  perform public.app_operation(st,'directory.lifecycle',payload||'{"operation":"restore","revision":3}',gen_random_uuid());
  assert (select archived and not is_removed from private.administrative_documents where id=doc),'restore stays inactive';
  perform public.app_operation(st,'directory.lifecycle',payload||'{"operation":"activate","revision":4}',gen_random_uuid());
  assert (select not archived and not is_removed from private.administrative_documents where id=doc);
  perform public.app_operation(st,'directory.lifecycle',payload||'{"operation":"remove","revision":5}',gen_random_uuid());
  perform set_config('request.jwt.claim.sub',staff::text,true);
  begin perform public.app_operation(st,'directory.lifecycle',payload||'{"operation":"delete","revision":6}',gen_random_uuid());raise exception 'staff permanently deleted';exception when sqlstate '42501' then null;end;
  begin perform public.app_operation(st,'directory.lifecycle',jsonb_build_object('kind','contract','id',contract,'operation','remove','revision',1),gen_random_uuid());raise exception 'staff changed contract';exception when sqlstate '42501' then null;end;
  begin perform public.app_operation(other_st,'directory.lifecycle',payload,gen_random_uuid());raise exception 'cross store changed';exception when sqlstate '42501' then null;end;
  -- Field may remove/restore equipment, but read-only membership wins, including cached retry.
  req:=gen_random_uuid();payload:=payload||'{"operation":"restore","revision":6}';
  result:=public.app_operation(st,'directory.lifecycle',payload,req);
  update public.store_memberships set access_mode='VIEW' where store_id=st and user_id=staff;
  begin perform public.app_operation(st,'directory.lifecycle',payload,req);raise exception 'read only retry accepted';exception when sqlstate '42501' then null;end;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.app_operation(st,'directory.lifecycle',payload||'{"operation":"remove","revision":7}',gen_random_uuid());
  req:=gen_random_uuid();payload:=payload||'{"operation":"delete","revision":8}';
  result:=public.app_operation(st,'directory.lifecycle',payload,req);
  assert not exists(select 1 from private.administrative_documents where id=doc);
  assert public.app_operation(st,'directory.lifecycle',payload,req)=result,'delete retry works after row is gone';
  -- Supplier removal is org scoped and does not touch related products/history.
  payload:=jsonb_build_object('kind','supplier','id',used_supplier,'operation','remove','updated_at',(select updated_at from public.suppliers where id=used_supplier));
  perform public.app_operation(st,'directory.lifecycle',payload,gen_random_uuid());
  assert (select not is_active and is_removed from public.suppliers where id=used_supplier);
  assert exists(select 1 from public.products where current_supplier_id=used_supplier);
  payload:=payload||jsonb_build_object('operation','delete','updated_at',(select updated_at from public.suppliers where id=used_supplier));
  begin perform public.app_operation(st,'directory.lifecycle',payload,gen_random_uuid());raise exception 'referenced supplier deleted';exception when sqlstate '23503' then null;end;
  payload:=jsonb_build_object('kind','supplier','id',supplier,'operation','remove','updated_at',(select updated_at from public.suppliers where id=supplier));
  perform public.app_operation(st,'directory.lifecycle',payload,gen_random_uuid());
  payload:=payload||jsonb_build_object('operation','delete','updated_at',(select updated_at from public.suppliers where id=supplier));
  perform public.app_operation(st,'directory.lifecycle',payload,gen_random_uuid());
  assert not exists(select 1 from public.suppliers where id=supplier);assert not exists(select 1 from private.supplier_details where supplier_id=supplier);
  -- Paused/removed contracts no longer queue reminders; reminders already recorded prevent deletion.
  payload:=jsonb_build_object('kind','contract','id',contract,'operation','deactivate','revision',1);
  perform public.app_operation(st,'directory.lifecycle',payload,gen_random_uuid());
  update private.administrative_documents set contract_end=current_date where id=contract;
  perform private.enqueue_contract_reminders();
  assert not exists(select 1 from private.contract_reminders where document_id=contract),'paused contract produced reminder';
  perform public.app_operation(st,'directory.lifecycle',payload||'{"operation":"activate","revision":2}',gen_random_uuid());
  assert exists(select 1 from private.contract_reminders where document_id=contract),'restored active contract reminder missing';
  perform public.app_operation(st,'directory.lifecycle',payload||'{"operation":"remove","revision":3}',gen_random_uuid());
  begin perform public.app_operation(st,'directory.lifecycle',payload||'{"operation":"delete","revision":4}',gen_random_uuid());raise exception 'historical contract deleted';exception when sqlstate '23503' then null;end;
  perform set_config('request.jwt.claim.sub','',true);
  begin perform public.app_operation(st,'directory.lifecycle',payload,gen_random_uuid());raise exception 'anonymous accepted';exception when sqlstate '42501' then null;end;
  assert not has_function_privilege('authenticated','private.directory_lifecycle(uuid,jsonb,uuid)','EXECUTE');
  raise exception using errcode='ZX001',message='rollback directory fixtures';
 exception when sqlstate 'ZX001' then null;end;
 assert (select count(*) from private.administrative_documents)=before_docs,'document fixture leaked';
 assert (select count(*) from public.suppliers)=before_suppliers,'supplier fixture leaked';
end $test$;
