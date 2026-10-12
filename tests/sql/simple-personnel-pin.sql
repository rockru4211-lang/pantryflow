-- All fixtures roll back even when this validation accompanies a production migration.
do $test$
declare owner_id uuid:=gen_random_uuid();staff_id uuid:=gen_random_uuid();office_id uuid:=gen_random_uuid();limited_id uuid:=gen_random_uuid();other_id uuid:=gen_random_uuid();
 org uuid;a uuid;b uuid;data jsonb;person jsonb;revision text;scopes jsonb;result jsonb;handoffs jsonb;before_auth jsonb;before_pin jsonb;history_before jsonb;task_a uuid;task_b uuid;history_id uuid;req uuid:=gen_random_uuid();denied boolean;
 name text:='移除測試'||substr(gen_random_uuid()::text,1,8);login text:='REMOVE'||replace(gen_random_uuid()::text,'-','');code text:='REMOVE'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
begin
 begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@functions-qa.invalid',now() from unnest(array[owner_id,staff_id,office_id,limited_id,other_id])id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','功能權限隔離測試','business_type','SINGLE_RESTAURANT','store_mode','MULTI'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code',code,'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);a:=(data->>'store_id')::uuid;org:=(data->>'organization_id')::uuid;
 data:=public.app_operation(a,'store.create','{"name":"Gras"}',gen_random_uuid());b:=(data->>'id')::uuid;
 insert into public.organization_members(organization_id,user_id,role,work_role,can_manage_business) values(org,office_id,'LOGISTICS','LOGISTICS',false),(org,staff_id,'STAFF','STAFF',false),(org,limited_id,'SUPERVISOR','SUPERVISOR',true),(org,other_id,'STAFF','STAFF',false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,office_id,'office-'||name,owner_id),(org,staff_id,name,owner_id),(org,limited_id,'limited-'||name,owner_id),(org,other_id,'other-'||name,owner_id);
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(a,org,office_id,'office-'||login,'LOGISTICS','LOGISTICS',owner_id,false),(b,org,office_id,'office-'||login,'LOGISTICS','LOGISTICS',owner_id,false),(a,org,staff_id,login,'STAFF','STAFF',owner_id,false),(a,org,limited_id,'limited-'||login,'SUPERVISOR','SUPERVISOR',owner_id,true),(a,org,other_id,'other-'||login,'STAFF','STAFF',owner_id,false);
 insert into private.staff_pin_credentials(user_id,pin_hash) values(staff_id,extensions.crypt('482613',extensions.gen_salt('bf')));

 perform set_config('request.jwt.claim.sub',office_id::text,true);
 result:=public.set_person_pin(a,staff_id,'736194',req);
 assert result->>'saved'='true','office cannot set PIN';
 select to_jsonb(c) into before_pin from private.staff_pin_credentials c where user_id=staff_id;
 assert public.set_person_pin(a,staff_id,'736194',req)=result,'retry not idempotent';
 assert (select to_jsonb(c)=before_pin from private.staff_pin_credentials c where user_id=staff_id),'retry rewrote credential';
 assert (select extensions.crypt('736194',pin_hash)=pin_hash from private.staff_pin_credentials where user_id=staff_id),'PIN hash mismatch';
 assert not exists(select 1 from private.app_requests where request_id=req and payload::text like '%736194%'),'PIN leaked in request';
 assert not has_function_privilege('anon','public.set_person_pin(uuid,uuid,text,uuid)','EXECUTE'),'anonymous RPC allowed';
 denied:=false;begin perform public.set_person_pin(a,owner_id,'736194',gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'owner reset allowed';
 perform set_config('request.jwt.claim.sub',other_id::text,true);
 denied:=false;begin perform public.set_person_pin(a,staff_id,'736194',gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'staff reset allowed';
 perform set_config('request.jwt.claim.sub',office_id::text,true);
 perform public.issue_staff_activation(other_id,repeat('fixture-only-',4));
 result:=public.set_person_pin(a,other_id,'736194',gen_random_uuid());
 assert result->>'saved'='true','new identity PIN failed';
 assert not exists(select 1 from private.staff_activation_tokens where user_id=other_id and consumed_at is null),'activation remains usable';
 update public.store_memberships set is_active=false where user_id=staff_id;
 denied:=false;begin perform public.set_person_pin(a,staff_id,'736194',gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'inactive reset allowed';
 raise exception 'FIXTURE_ROLLBACK' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null;
 end;
end $test$;
