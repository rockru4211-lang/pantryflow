-- Isolated production-schema fixture. The inner exception rolls back all test rows.
do $test$
declare owner_id uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid();
 st uuid:=gen_random_uuid(); other_st uuid:=gen_random_uuid(); doc uuid:=gen_random_uuid(); contract uuid:=gen_random_uuid(); supplier uuid:=gen_random_uuid(); used_supplier uuid:=gen_random_uuid();
 req uuid:=gen_random_uuid(); payload jsonb; result jsonb; before_docs bigint; before_suppliers bigint; r integer; aid uuid:=gen_random_uuid(); path text;
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
  payload:=jsonb_build_object('kind','document','target',doc,'operation','prepare','name','測試.png','mime','image/png','size',4,'sha256',repeat('a',64));
  result:=public.app_operation(st,'directory.attachments',payload,aid);path:=result->>'storage_path';
  assert result->>'id'=aid::text;
  assert public.app_operation(st,'directory.attachments',payload,aid)=result,'prepare retry';
  assert private.directory_attachment_storage(path,true),'owner upload';
  begin perform public.app_operation(st,'directory.attachments',payload||'{"mime":"text/html"}',gen_random_uuid());raise exception 'unsafe type accepted';exception when sqlstate '22023' then null;end;
  begin perform public.app_operation(other_st,'directory.attachments',payload,gen_random_uuid());raise exception 'other store accepted';exception when sqlstate '42501' then null;end;
  begin perform public.app_operation(st,'directory.attachments',jsonb_build_object('kind','document','target',doc,'operation','complete','id',aid),gen_random_uuid());raise exception 'missing upload accepted';exception when sqlstate '22023' then null;end;
  insert into storage.objects(bucket_id,name,metadata) values('directory-attachments',path,'{"size":4,"mimetype":"image/png"}');
  payload:=jsonb_build_object('kind','document','target',doc,'operation','complete','id',aid);
  result:=public.app_operation(st,'directory.attachments',payload,gen_random_uuid());
  assert public.app_operation(st,'directory.attachments',payload,gen_random_uuid())=result,'complete retry';
  assert not private.directory_attachment_storage(path,true),'ready cannot overwrite';
  execute 'set local role authenticated';
  assert (select count(*) from storage.objects where bucket_id='directory-attachments' and name=path)=1,'storage RLS owner read';
  execute 'reset role';
  assert jsonb_array_length(public.app_operation(st,'directory.attachments',jsonb_build_object('kind','document','target',doc,'operation','list'),gen_random_uuid()))=1;
  perform set_config('request.jwt.claim.sub',staff::text,true);
  assert private.directory_attachment_storage(path,false),'field can read equipment';
  begin perform public.app_operation(st,'directory.attachments',jsonb_build_object('kind','document','target',contract,'operation','list'),gen_random_uuid());raise exception 'staff read contract';exception when sqlstate '42501' then null;end;
  begin perform public.app_operation(st,'directory.attachments',jsonb_build_object('kind','supplier','target',supplier,'operation','list'),gen_random_uuid());raise exception 'staff read supplier files';exception when sqlstate '42501' then null;end;
  update public.store_memberships set access_mode='VIEW' where store_id=st and user_id=staff;
  begin perform public.app_operation(st,'directory.attachments',payload||'{"operation":"remove"}',gen_random_uuid());raise exception 'readonly removed';exception when sqlstate '42501' then null;end;
  assert private.directory_attachment_storage(path,false);
  perform set_config('request.jwt.claim.sub','',true);
  assert not private.directory_attachment_storage(path,false),'anonymous denied';
  execute 'set local role authenticated';
  assert (select count(*) from storage.objects where bucket_id='directory-attachments' and name=path)=0,'no-identity RLS denial';
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  result:=public.app_operation(st,'directory.attachments',payload||'{"operation":"remove"}',gen_random_uuid());
  assert public.app_operation(st,'directory.attachments',payload||'{"operation":"remove"}',gen_random_uuid())=result,'remove retry';
  assert not private.directory_attachment_storage(path,false),'removed no read';
  assert (select count(*) from storage.objects where bucket_id='directory-attachments' and name=path)=1,'removal keeps original';
  assert (select note from private.administrative_documents where id=doc)='original note';
  assert not has_function_privilege('authenticated','private.directory_attachment_operation(uuid,jsonb,uuid)','EXECUTE');
  raise exception using errcode='ZX001',message='rollback directory fixtures';
 exception when sqlstate 'ZX001' then null;end;
 assert (select count(*) from private.administrative_documents)=before_docs;
 assert (select count(*) from public.suppliers)=before_suppliers;
end $test$;
