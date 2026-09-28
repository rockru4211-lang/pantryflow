begin;
do $test$
declare owner_id uuid:=gen_random_uuid(); company_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); limited_id uuid:=gen_random_uuid(); org uuid; a uuid; b uuid; data jsonb; person jsonb; before_state jsonb; profile jsonb; patch jsonb; result jsonb; old_revision text; req uuid:=gen_random_uuid(); denied boolean; auth_before jsonb; pin_before jsonb; login_before text; audit_count bigint;
begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@people-qa.invalid',now() from unnest(array[owner_id,company_id,staff_id,limited_id])id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','人員管理隔離測試','business_type','SINGLE_RESTAURANT','store_mode','MULTI'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code','PEOPLE'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);org:=(data->>'organization_id')::uuid;a:=(data->>'store_id')::uuid;
 data:=public.app_operation(a,'store.create','{"name":"Gras"}',gen_random_uuid());b:=(data->>'id')::uuid;
 insert into public.organization_members(organization_id,user_id,role,work_role,can_manage_business) values(org,company_id,'LOGISTICS','LOGISTICS',true),(org,staff_id,'STAFF','STAFF',false),(org,limited_id,'LOGISTICS','LOGISTICS',true);
 insert into public.staff_identities(organization_id,user_id,display_name,job_title,created_by) values(org,company_id,'QA行政','行政',owner_id),(org,staff_id,'QA員工',null,owner_id),(org,limited_id,'單店行政','行政',owner_id);
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business,access_mode,extra_permissions) values
 (a,org,company_id,'qa-admin','LOGISTICS','LOGISTICS',owner_id,true,'EDIT',array['REPORTS_VIEW','DATA_EXPORT']),
 (b,org,company_id,'qa-admin-b','LOGISTICS','LOGISTICS',owner_id,true,'VIEW',array['REPORTS_VIEW']),
 (a,org,staff_id,'qa-staff','STAFF','STAFF',owner_id,false,'EDIT','{}'),
 (a,org,limited_id,'qa-limited','LOGISTICS','LOGISTICS',owner_id,true,'EDIT',array['REPORTS_VIEW','DATA_EXPORT']);
 insert into private.staff_pin_credentials(user_id,pin_hash) values(staff_id,extensions.crypt('827491',extensions.gen_salt('bf')));
 select to_jsonb(u) into auth_before from auth.users u where id=staff_id;select to_jsonb(c) into pin_before from private.staff_pin_credentials c where user_id=staff_id;select login_identifier into login_before from public.store_memberships where user_id=staff_id and store_id=a;
 set local role authenticated;
 data:=public.get_baihuayuan_people(a);
 reset role;
 assert jsonb_array_length(data->'partners')=4,'unified list missing people';
 select value into person from jsonb_array_elements(data->'partners') where value->>'user_id'=owner_id::text;assert not(person->>'can_manage_access')::boolean and not(person->>'can_edit_profile')::boolean,'owner editable';
 select value into person from jsonb_array_elements(data->'partners') where value->>'user_id'=company_id::text;
 assert (person->>'can_edit_profile')::boolean,'company cannot be edited by owner';old_revision:=person->>'revision';
 profile:='{"display_name":"QA財務","title":"財務","export_mode":"KEEP"}';patch:=jsonb_build_array(jsonb_build_object('store_id',a,'access_mode','VIEW'));
 set local role authenticated;
 result:=public.save_baihuayuan_person(a,company_id,old_revision,profile,patch,req);
 reset role;
 assert (result->>'saved')::boolean,'save not acknowledged';
 assert (select job_title='財務' and display_name='QA財務' from public.staff_identities where user_id=company_id and organization_id=org),'profile not saved';
 assert (select bool_and(access_mode='VIEW') from public.store_memberships where user_id=company_id),'mode not retained';
 assert (select 'DATA_EXPORT'=any(extra_permissions) from public.store_memberships where user_id=company_id and store_id=a),'existing export removed';
 assert (select not('DATA_EXPORT'=any(extra_permissions)) from public.store_memberships where user_id=company_id and store_id=b),'export spread between stores';
 select count(*) into audit_count from public.audit_logs where entity_id=company_id::text;
 assert public.save_baihuayuan_person(a,company_id,old_revision,profile,patch,req)=result,'retry mismatch';
 assert (select count(*) from public.audit_logs where entity_id=company_id::text)=audit_count,'retry duplicated mutation';
 denied:=false;begin perform public.save_baihuayuan_person(a,company_id,old_revision,profile,'[]',gen_random_uuid());exception when serialization_failure then denied:=true;end;assert denied,'stale profile overwrote current';
 -- Owner/self and staff cannot mutate settings, even with a reused successful request.
 denied:=false;begin perform public.save_baihuayuan_person(a,owner_id,'any',profile,'[]',gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'owner profile writable';
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 denied:=false;begin perform public.save_baihuayuan_person(a,company_id,old_revision,profile,patch,req);exception when insufficient_privilege then denied:=true;end;assert denied,'cached response bypassed staff authorization';
 perform set_config('request.jwt.claim.sub',limited_id::text,true);
 data:=public.get_baihuayuan_people(a);select value into person from jsonb_array_elements(data->'partners') where value->>'user_id'=company_id::text;assert not(person->>'can_edit_profile')::boolean,'single-store admin can edit company-wide profile';
 denied:=false;begin perform public.save_baihuayuan_person(a,company_id,person->>'revision',profile,'[]',gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'out-of-scope profile accepted';
 denied:=false;begin perform public.save_baihuayuan_person(a,company_id,person->>'revision',null,jsonb_build_array(jsonb_build_object('store_id',b,'access_mode','EDIT')),gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'out-of-scope store accepted';
 -- A late profile-scope failure rolls back an otherwise valid new VIEW grant.
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business,access_mode)
 values(b,org,limited_id,'qa-limited-b','SUPERVISOR','SUPERVISOR',owner_id,false,'EDIT');
 data:=public.get_baihuayuan_people(a);select value into person from jsonb_array_elements(data->'partners') where value->>'user_id'=staff_id::text;
 assert (person->>'can_edit_profile')::boolean,'fixture profile must initially be editable';
 before_state:=person;
 denied:=false;begin perform public.save_baihuayuan_person(a,staff_id,person->>'revision','{"display_name":"不得部分儲存","title":"員工","export_mode":"KEEP"}',jsonb_build_array(jsonb_build_object('store_id',b,'access_mode','VIEW')),gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'profile outside new store scope accepted';
 assert private.baihuayuan_person_revision(org,staff_id)=before_state->>'revision','late profile failure did not roll back access grant';
 -- A normal employee can be renamed/promoted with a cross-store grant atomically, preserving PIN/login.
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 data:=public.get_baihuayuan_people(a);select value into person from jsonb_array_elements(data->'partners') where value->>'user_id'=staff_id::text;
 result:=public.save_baihuayuan_person(a,staff_id,person->>'revision','{"display_name":"QA主管","title":"主管","export_mode":"KEEP"}',jsonb_build_array(jsonb_build_object('store_id',b,'access_mode','VIEW')),gen_random_uuid());
 assert (select bool_and(work_role='SUPERVISOR') from public.store_memberships where user_id=staff_id and is_active),'role update not applied';
 assert (select access_mode='VIEW' from public.store_memberships where user_id=staff_id and store_id=b),'new scope not VIEW';
 assert (select login_identifier from public.store_memberships where user_id=staff_id and store_id=a)=login_before,'login changed';
 assert (select to_jsonb(u) from auth.users u where id=staff_id)=auth_before,'auth changed';assert (select to_jsonb(c) from private.staff_pin_credentials c where user_id=staff_id)=pin_before,'PIN changed';
 -- A profile error after a valid access patch rolls the access patch back.
 data:=public.get_baihuayuan_people(a);select value into person from jsonb_array_elements(data->'partners') where value->>'user_id'=staff_id::text;before_state:=person;
 denied:=false;begin perform public.save_baihuayuan_person(a,staff_id,person->>'revision','{"display_name":"不得寫入","title":"老闆","export_mode":"KEEP"}',jsonb_build_array(jsonb_build_object('store_id',b,'access_mode','EDIT')),gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'invalid title accepted';
 assert private.baihuayuan_person_revision(org,staff_id)=before_state->>'revision','failed save changed records';
 denied:=false;begin perform public.save_baihuayuan_person(a,staff_id,person->>'revision',null,jsonb_build_array(jsonb_build_object('store_id',a,'access_mode','NONE'),jsonb_build_object('store_id',b,'access_mode','NONE')),gen_random_uuid());exception when others then denied:=sqlerrm='MEMBER_ACTIVE_STORE_REQUIRED';end;assert denied,'all stores removed';
 assert private.baihuayuan_person_revision(org,staff_id)=before_state->>'revision','failed removal changed records';
 assert not has_function_privilege('anon','public.save_baihuayuan_person(uuid,uuid,text,jsonb,jsonb,uuid)','execute'),'anonymous write enabled';
 assert not has_function_privilege('authenticated','private.baihuayuan_person_revision(uuid,uuid)','execute'),'internal snapshot exposed';
end $test$;
rollback;
select 'PASS: unified people, atomic profile/access, owner/self/role/store boundaries, CAS, retry, per-store grants, unchanged auth and PIN' result;
