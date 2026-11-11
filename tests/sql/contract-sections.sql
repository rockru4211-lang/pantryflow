-- Isolated fixtures; all created identities and documents roll back.
do $test$
declare owner_id uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); st uuid:=gen_random_uuid(); other_st uuid:=gen_random_uuid();
 doc uuid:=gen_random_uuid(); equip uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); payload jsonb; result jsonb; snapshot jsonb; nonrenew_payload jsonb; nonrenew_request uuid:=gen_random_uuid();
begin
 select jsonb_agg(to_jsonb(d) order by id) into snapshot from private.administrative_documents d;
 begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select u,u||'@contract-test.invalid',now(),now(),now() from unnest(array[owner_id,staff]) u;
  insert into public.profiles(id,display_name) select u,'Contract fixture' from unnest(array[owner_id,staff]) u on conflict(id) do nothing;
  insert into public.organizations(id,name,business_type) values(org,'Contract fixture','SINGLE_RESTAURANT');
  insert into public.stores(id,organization_id,name,store_code,created_by) values(st,org,'BeApe','CT'||substr(st::text,1,8),owner_id),(other_st,org,'Gras','CT'||substr(other_st::text,1,8),owner_id);
  insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,owner_id,'OWNER',true,true),(org,staff,'STAFF',false,false);
  insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,u,'Contract fixture',owner_id from unnest(array[owner_id,staff]) u;
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
   values(st,org,owner_id,'ct-owner','OWNER','OWNER',owner_id,true),(st,org,staff,'ct-staff','STAFF','STAFF',owner_id,false);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',doc,'name','自訂分類合約','directory_section','contracts','category','設備保養方案','revision',0,'summary','原始內容完整保留','note','原備註','link','https://example.com/contract','contract_payment','每月付款','contract_contact','窗口資訊','contract_end',current_date)));
  result:=public.app_operation(st,'administrative.save',payload,req);
  assert result=public.app_operation(st,'administrative.save',payload,req),'idempotency';
  assert result#>>'{rows,0,directory_section}'='contracts','custom category ownership';
  assert exists(select 1 from private.contract_reminders where document_id=doc),'custom category reminder';
  assert private.directory_attachment_access(st,'document',doc,true),'office attachments';
  assert not exists(select 1 from jsonb_array_elements(private.equipment_workspace(st)->'rows') r where r->>'id'=doc::text),'contract leaked into equipment';
  -- Legacy client omitting new fields preserves them, despite a new category.
  payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',doc,'name','自訂分類合約','category','其他服務','revision',1,'summary','原始內容完整保留','note','原備註','link','https://example.com/contract')));
  perform public.app_operation(st,'administrative.save',payload,gen_random_uuid());
  assert (select directory_section='contracts' and contract_payment='每月付款' and contract_contact='窗口資訊' and contract_end=current_date and summary='原始內容完整保留' and note='原備註' from private.administrative_documents where id=doc),'legacy save lost fields';
  begin perform public.app_operation(st,'administrative.save',payload,gen_random_uuid());raise exception 'stale accepted';exception when sqlstate '40001' then null;end;
  begin perform public.app_operation(other_st,'administrative.save',payload,gen_random_uuid());raise exception 'cross-store accepted';exception when sqlstate '42501' then null;end;
  nonrenew_payload:=jsonb_build_object('kind','contract','id',doc,'revision',2,'operation','nonrenew','reason','不再使用');
  begin perform public.app_operation(st,'directory.lifecycle',nonrenew_payload||'{"revision":1}',gen_random_uuid());raise exception 'stale nonrenewal accepted';exception when sqlstate '40001' then null;end;
  begin perform public.app_operation(st,'directory.lifecycle',nonrenew_payload||'{"kind":"equipment"}',gen_random_uuid());raise exception 'nonrenewal allowed for equipment';exception when sqlstate '22023' then null;end;
  result:=public.app_operation(st,'directory.lifecycle',nonrenew_payload,nonrenew_request);
  assert result=public.app_operation(st,'directory.lifecycle',nonrenew_payload,nonrenew_request),'nonrenewal retry changed the result';
  assert result->>'contract_nonrenewal_reason'='不再使用','missing nonrenewal outcome';
  assert (select archived and not is_removed and contract_nonrenewed_at is not null and contract_nonrenewal_reason='不再使用'
    and contract_end=current_date and note='原備註' and link='https://example.com/contract' and revision=3
    from private.administrative_documents where id=doc),'nonrenewal changed original contract data';
  assert (select count(*)=1 from private.contract_reminders where document_id=doc),'recorded reminder was lost';
  assert private.directory_attachment_access(st,'document',doc),'archived contract attachments inaccessible';
  assert exists(select 1 from jsonb_array_elements(private.administrative_workspace(st)->'rows') r
    where r->>'id'=doc::text and r->>'contract_nonrenewal_reason'='不再使用' and r->>'notified_at' is not null),'workspace lost outcome or notification';
  update private.administrative_documents set contract_end=current_date+1 where id=doc;
  perform private.enqueue_contract_reminders();
  assert (select count(*)=1 from private.contract_reminders where document_id=doc),'nonrenewal created a new reminder';
  perform public.app_operation(st,'directory.lifecycle',nonrenew_payload||'{"operation":"activate","revision":3}',gen_random_uuid());
  assert (select not archived and contract_nonrenewed_at is null and contract_nonrenewal_reason='' from private.administrative_documents where id=doc),'reactivation retained a current nonrenewal state';
  perform set_config('request.jwt.claim.sub',staff::text,true);
  begin perform public.app_operation(st,'directory.lifecycle',nonrenew_payload||'{"revision":4}',gen_random_uuid());raise exception 'staff nonrenewal allowed';exception when sqlstate '42501' then null;end;
  assert not private.directory_attachment_access(st,'document',doc),'field attachment leak';
  begin perform public.app_operation(st,'administrative.save',payload,gen_random_uuid());raise exception 'staff contract save allowed';exception when sqlstate '42501' then null;end;
  payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',equip,'name','設備測試','category','設備資料','directory_section','contracts','revision',0)));
  begin perform public.app_operation(st,'administrative.save',payload,gen_random_uuid());raise exception 'staff forged contract';exception when sqlstate '42501' then null;end;
  payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',equip,'name','設備測試','category','設備資料','directory_section',null,'revision',0)));
  result:=public.app_operation(st,'administrative.save',payload,gen_random_uuid());
  assert result#>>'{rows,0,directory_section}'='equipment','legacy equipment save';
  assert not ((result#>'{rows,0}')?'contract_payment'),'contract field leak';
  update public.store_memberships set access_mode='VIEW' where store_id=st and user_id=staff;
  begin perform public.app_operation(st,'administrative.save',payload,gen_random_uuid());raise exception 'readonly accepted';exception when sqlstate '42501' then null;end;
  perform set_config('request.jwt.claim.sub','',true);
  begin perform public.app_operation(st,'administrative.save',payload,gen_random_uuid());raise exception 'anonymous accepted';exception when sqlstate '42501' then null;end;
  raise exception using errcode='ZX001',message='rollback fixtures';
 exception when sqlstate 'ZX001' then null;end;
 assert (select jsonb_agg(to_jsonb(d) order by id) from private.administrative_documents d) is not distinct from snapshot,'existing data changed';
end $test$;
