-- Equipment is basic BeApe/Gras field work. Keep explicit legacy grants,
-- store membership checks, read-only stores and confidential-data gates intact.
create or replace function private.has_data_access(s uuid,feature text,editing boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select auth.uid() is not null and private.app_role(s) is not null
 and (not editing or private.can_edit_store(s)) and (private.app_role(s)='OWNER'
 or (feature='EQUIPMENT' and private.feature_scope(s)
     and private.person_work_functions(st.organization_id,auth.uid()) && array['FIELD','OFFICE']::text[])
 or (private.person_data_permissions(st.organization_id,auth.uid())#>>array[feature,case when editing then 'edit' else 'view' end])::boolean)
 from public.stores st where st.id=s and st.is_active),false)
$$;
revoke all on function private.has_data_access(uuid,text,boolean) from public,anon,authenticated;

-- Isolated fixtures verify actual reads/saves and are rolled back before commit.
do $test$
declare owner_id uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 s uuid:=gen_random_uuid(); other_s uuid:=gen_random_uuid(); item_id uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
 payload jsonb; result jsonb; before_count bigint;
begin
 select count(*) into before_count from private.administrative_documents;
 begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
   select u,u||'@equipment-basic-test.invalid',now(),now(),now() from unnest(array[owner_id,staff]) u;
  insert into public.profiles(id,display_name) select u,'設備基本權限測試' from unnest(array[owner_id,staff]) u on conflict(id) do nothing;
  insert into public.organizations(id,name,business_type) values(org,'設備基本權限測試','SINGLE_RESTAURANT');
  insert into public.stores(id,organization_id,name,store_code,created_by)
   values(s,org,'BeApe','EB'||substr(s::text,1,8),owner_id),(other_s,org,'Gras','EB'||substr(other_s::text,1,8),owner_id);
  insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
   values(org,owner_id,'OWNER',true,true),(org,staff,'STAFF',false,false);
  insert into public.staff_identities(organization_id,user_id,display_name,created_by)
   select org,u,'設備基本權限測試',owner_id from unnest(array[owner_id,staff]) u;
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
   values(s,org,owner_id,'eb-owner','OWNER','OWNER',owner_id,true),(s,org,staff,'eb-staff','STAFF','STAFF',owner_id,false);
  insert into private.person_data_access(organization_id,user_id,permissions,updated_by)
   values(org,staff,'{"EQUIPMENT":{"view":false,"edit":false}}',owner_id);
  perform set_config('request.jwt.claim.sub',staff::text,true);
  assert private.has_data_access(s,'EQUIPMENT',true),'field equipment is basic even for existing unchecked grants';
  assert not private.has_data_access(s,'RECIPE') and not private.has_data_access(s,'SUPPLIERS') and not private.has_data_access(s,'SPOT'),'optional grants stay denied';
  result:=public.app_workspace(s,'equipment');
  assert jsonb_array_length(result->'rows')=0;
  payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',item_id,'name','測試冰箱','category','維修紀錄','revision',0,'repair_reason','測試原因','repair_result','測試處理')));
  result:=public.app_operation(s,'administrative.save',payload,req);
  assert jsonb_array_length(result->'rows')=1,'field can save repairs without optional grant';
  assert not ((result->'rows'->0)?'contract_start'),'contract details remain hidden';
  assert public.app_operation(s,'administrative.save',payload,req)=result,'repair retry is idempotent';
  assert jsonb_array_length(public.app_workspace(s,'equipment')->'rows')=1,'saved repair is readable';
  begin perform public.app_operation(s,'administrative.save',jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',item_id,'name','X','category','合約文件','revision',1))),gen_random_uuid());raise exception 'contract edit was allowed';exception when sqlstate '42501' then null;end;
  begin perform public.app_workspace(s,'administrative');raise exception 'contract read was allowed';exception when sqlstate '42501' then null;end;
  begin perform public.app_workspace(other_s,'equipment');raise exception 'cross-store equipment allowed';exception when sqlstate '42501' then null;end;
  update public.store_memberships set access_mode='VIEW' where store_id=s and user_id=staff;
  assert private.has_data_access(s,'EQUIPMENT') and not private.has_data_access(s,'EQUIPMENT',true),'read-only store wins';
  begin perform public.app_operation(s,'administrative.save',payload,req);raise exception 'read-only retry allowed';exception when sqlstate '42501' then null;end;
  update public.store_memberships set is_active=false where store_id=s and user_id=staff;
  assert not private.has_data_access(s,'EQUIPMENT'),'disabled member denied';
  perform set_config('request.jwt.claim.sub','',true);
  assert not private.has_data_access(s,'EQUIPMENT'),'anonymous denied';
  assert not has_function_privilege('authenticated','private.has_data_access(uuid,text,boolean)','EXECUTE');
  raise exception using errcode='ZX001',message='rollback equipment fixtures';
 exception when sqlstate 'ZX001' then null;end;
 assert (select count(*) from private.administrative_documents)=before_count,'fixtures rolled back';
end $test$;
notify pgrst,'reload schema';
