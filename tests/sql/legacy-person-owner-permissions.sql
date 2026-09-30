-- Synthetic identities only. The exception rolls back every fixture mutation.
do $test$
declare owner_id uuid:=gen_random_uuid();target_id uuid:=gen_random_uuid();manager_id uuid:=gen_random_uuid();office_id uuid:=gen_random_uuid();limited_id uuid:=gen_random_uuid();successor_id uuid:=gen_random_uuid();
 org uuid;a uuid;b uuid;c uuid;data jsonb;person jsonb;scopes jsonb;revision text;result jsonb;req uuid;denied boolean;task_id uuid;history_id uuid;
 before_auth jsonb;before_pin jsonb;before_legacy jsonb;before_history jsonb;
 login text:='LEGACY'||replace(gen_random_uuid()::text,'-','');code text:='LEGACY'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
begin
 begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@legacy-owner-qa.invalid',now() from unnest(array[owner_id,target_id,manager_id,office_id,limited_id,successor_id])id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','舊角色隔離測試','business_type','SINGLE_RESTAURANT','store_mode','MULTI'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code',code,'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);a:=(data->>'store_id')::uuid;org:=(data->>'organization_id')::uuid;
 data:=public.app_operation(a,'store.create','{"name":"Gras"}',gen_random_uuid());b:=(data->>'id')::uuid;
 data:=public.app_operation(a,'store.create','{"name":"舊門市"}',gen_random_uuid());c:=(data->>'id')::uuid;
 insert into public.organization_members(organization_id,user_id,role,work_role,is_owner,can_manage_business) values
 (org,target_id,'OWNER','OWNER',false,false),(org,manager_id,'LOGISTICS','LOGISTICS',false,true),(org,office_id,'LOGISTICS','LOGISTICS',false,false),(org,limited_id,'SUPERVISOR','SUPERVISOR',false,true),(org,successor_id,'STAFF','STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'legacy-'||id::text,owner_id from unnest(array[target_id,manager_id,office_id,limited_id,successor_id])id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business,is_active) values
 (a,org,target_id,login,'SUPERVISOR','SUPERVISOR',owner_id,true,true),(c,org,target_id,login,'OWNER','OWNER',owner_id,false,false),
 (a,org,manager_id,'manager-'||login,'LOGISTICS','LOGISTICS',owner_id,true,true),(b,org,manager_id,'manager-'||login,'LOGISTICS','LOGISTICS',owner_id,true,true),
 (a,org,office_id,'office-'||login,'LOGISTICS','LOGISTICS',owner_id,false,true),(b,org,office_id,'office-'||login,'LOGISTICS','LOGISTICS',owner_id,false,true),
 (b,org,limited_id,'limited-'||login,'SUPERVISOR','SUPERVISOR',owner_id,true,true),(a,org,successor_id,'successor-'||login,'STAFF','STAFF',owner_id,false,true);
 insert into private.staff_pin_credentials(user_id,pin_hash) values(target_id,extensions.crypt('482613',extensions.gen_salt('bf')));
 select to_jsonb(u) into before_auth from auth.users u where id=target_id;
 select to_jsonb(p) into before_pin from private.staff_pin_credentials p where user_id=target_id;
 select to_jsonb(m) into before_legacy from public.store_memberships m where user_id=target_id and store_id=c;
 scopes:=jsonb_build_array(jsonb_build_object('store_id',a,'access_mode','EDIT'));
 perform set_config('request.jwt.claim.sub',manager_id::text,true);
 select value into person from jsonb_array_elements(public.get_baihuayuan_people(b)->'partners') where value->>'user_id'=target_id::text;
 assert not(person->>'is_owner')::boolean and (person->>'can_edit_functions')::boolean and (person->>'can_remove')::boolean,'legacy OWNER locks a non-owner in the other store editor';
 assert person->'work_functions' ? 'MANAGE','current management function lost';
 revision:=person->>'revision';
 -- Authoritative ownership and active OWNER roles are still protected separately.
 assert not private.can_manage_member_store_access(b,owner_id) and not private.can_remove_baihuayuan_person(b,owner_id),'actual owner unprotected';
 update public.organization_members set is_owner=true where organization_id=org and user_id=target_id;
 assert not private.can_manage_member_store_access(b,target_id) and not private.can_remove_baihuayuan_person(b,target_id),'owner flag ignored';
 update public.organization_members set is_owner=false where organization_id=org and user_id=target_id;
 update public.organizations set owner_user_id=target_id where id=org;
 assert not private.can_manage_member_store_access(b,target_id) and not private.can_remove_baihuayuan_person(b,target_id),'organization owner ignored';
 update public.organizations set owner_user_id=owner_id where id=org;
 update public.store_memberships set role='OWNER',work_role='OWNER' where user_id=target_id and store_id=a;
 assert not private.can_manage_member_store_access(b,target_id) and not private.can_remove_baihuayuan_person(b,target_id),'active store owner ignored';
 update public.store_memberships set role='SUPERVISOR',work_role='SUPERVISOR' where user_id=target_id and store_id=a;
 perform set_config('request.jwt.claim.sub',target_id::text,true);
 assert not private.can_manage_member_store_access(a,target_id) and not private.can_remove_baihuayuan_person(a,target_id),'self modification allowed';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 assert not private.can_manage_member_store_access(b,target_id) and not private.can_remove_baihuayuan_person(b,target_id),'unauthenticated management allowed';
 -- OFFICE cannot remove or change someone who has system administration.
 perform set_config('request.jwt.claim.sub',office_id::text,true);
 select value into person from jsonb_array_elements(public.get_baihuayuan_people(b)->'partners') where value->>'user_id'=target_id::text;
 assert not(person->>'can_edit_functions')::boolean and not(person->>'can_remove')::boolean,'office offered system-manager actions';
 denied:=false;begin perform public.save_person_function_access(b,target_id,person->>'revision','Legacy target',scopes,array['FIELD'],a,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'office changed system manager';
 denied:=false;begin perform public.remove_person_access(b,target_id,person->>'revision','[]',gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'office removed system manager';
 perform set_config('request.jwt.claim.sub',limited_id::text,true);
 assert not private.can_manage_member_store_access(b,target_id) and not private.can_remove_baihuayuan_person(b,target_id),'limited manager bypassed target store scope';
 -- The actual RPCs work from Gras for a BeApe-only person and preserve credentials/history.
 perform set_config('request.jwt.claim.sub',manager_id::text,true);
 select value into person from jsonb_array_elements(public.get_baihuayuan_people(b)->'partners') where value->>'user_id'=target_id::text;revision:=person->>'revision';req:=gen_random_uuid();
 result:=public.save_person_function_access(b,target_id,revision,'Legacy target',scopes,array['FIELD','MANAGE'],a,req);
 assert (result->>'saved')::boolean,'authorized edit rejected';
 assert public.save_person_function_access(b,target_id,revision,'Legacy target',scopes,array['FIELD','MANAGE'],a,req)=result,'edit retry not idempotent';
 insert into private.app_records(store_id,kind,title,responsible_id,created_by,status) values(a,'handover','Pending fixture',target_id,target_id,'OPEN') returning id into task_id;
 insert into private.app_records(store_id,kind,title,responsible_id,created_by,completed_by,status) values(a,'handover','Completed fixture',target_id,target_id,target_id,'COMPLETE') returning id into history_id;
 select to_jsonb(r) into before_history from private.app_records r where id=history_id;
 select value into person from jsonb_array_elements(public.get_baihuayuan_people(b)->'partners') where value->>'user_id'=target_id::text;revision:=person->>'revision';req:=gen_random_uuid();
 denied:=false;begin perform public.remove_person_access(b,target_id,revision,'[]',req);exception when invalid_parameter_value then denied:=sqlerrm='HANDOFF_REQUIRED';end;assert denied,'pending work abandoned';
 data:=jsonb_build_array(jsonb_build_object('store_id',a,'user_id',successor_id));
 result:=public.remove_person_access(b,target_id,revision,data,req);
 assert (result->>'removed')::boolean and not exists(select 1 from public.store_memberships where user_id=target_id and is_active),'authorized removal failed';
 assert public.remove_person_access(b,target_id,revision,data,req)=result,'removal retry not idempotent';
 assert (select responsible_id=successor_id and created_by=target_id from private.app_records where id=task_id),'handoff lost original author';
 assert (select to_jsonb(r) from private.app_records r where id=history_id)=before_history,'completed history changed';
 assert (select to_jsonb(m) from public.store_memberships m where user_id=target_id and store_id=c)=before_legacy,'inactive owner history changed';
 assert (select to_jsonb(u) from auth.users u where id=target_id)=before_auth,'auth identity changed';
 assert (select to_jsonb(p) from private.staff_pin_credentials p where user_id=target_id)=before_pin,'PIN changed';
 assert public.resolve_staff_login(login) is null,'removed login still available';
 raise exception using errcode='Z9904',message='LEGACY_OWNER_TEST_ROLLBACK';
 exception when sqlstate 'Z9904' then null;
 end;
end $test$;
