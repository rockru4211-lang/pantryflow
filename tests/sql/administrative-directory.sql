begin;
do $$
declare person uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); org uuid; sid uuid; data jsonb; payload jsonb; saved jsonb; req uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid(); denied boolean; baseline text;
begin
 select md5(coalesce(string_agg(id::text||updated_at::text,'' order by id),'')) into baseline from public.suppliers;
 assert (select relrowsecurity from pg_class where oid='private.administrative_documents'::regclass),'RLS missing';
 assert not has_table_privilege('authenticated','private.administrative_documents','select,insert,update,delete'),'direct table access';
 assert not has_function_privilege('anon','private.administrative_save(uuid,jsonb,uuid)','execute'),'anonymous write';
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values(person,person||'@admin-fixture.invalid',now(),now(),now()),(stranger,stranger||'@admin-fixture.invalid',now(),now(),now());
 perform set_config('request.jwt.claim.sub',person::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','Administrative fixture','business_type','SINGLE_RESTAURANT','store_mode','SINGLE'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','Administrative fixture','store_code','QA'||substr(replace(gen_random_uuid()::text,'-',''),1,14),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
 data:=public.owner_setup('complete','{}',(data->>'revision')::int);org:=(data->>'organization_id')::uuid;sid:=(data->>'store_id')::uuid;
 payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',rid,'name','租約','revision',0)));
 saved:=public.app_operation(sid,'administrative.save',payload,req);
 assert public.app_operation(sid,'administrative.save',payload,req)=saved,'retry duplicated';
 assert jsonb_array_length(public.app_workspace(sid,'administrative')->'rows')=1,'read failed';
 assert saved->'rows'->0->>'summary'='','partial data blocked';
 payload:=jsonb_build_object('rows',jsonb_build_array((saved->'rows'->0)||'{"archived":true}'));
 saved:=public.app_operation(sid,'administrative.save',payload,gen_random_uuid());
 assert (saved->'rows'->0->>'archived')::boolean,'archive failed';
 denied:=false;begin perform public.app_operation(sid,'administrative.save',payload,gen_random_uuid());exception when serialization_failure then denied:=true;end;assert denied,'stale overwrite accepted';
 payload:=jsonb_build_object('rows',jsonb_build_array((saved->'rows'->0)||'{"archived":false}'));
 saved:=public.app_operation(sid,'administrative.save',payload,gen_random_uuid());
 assert not (saved->'rows'->0->>'archived')::boolean,'restore failed';
 -- A later invalid row rolls back the entire batch, preserving the valid first row.
 payload:=jsonb_build_object('rows',jsonb_build_array((saved->'rows'->0)||'{"name":"must rollback"}',jsonb_build_object('id',gen_random_uuid(),'name','','revision',0)));
 denied:=false;begin perform public.app_operation(sid,'administrative.save',payload,gen_random_uuid());exception when check_violation then denied:=true;end;assert denied,'invalid batch accepted';
 assert (public.app_workspace(sid,'administrative')->'rows'->0->>'name')='租約','partial batch mutated';
 perform set_config('request.jwt.claim.sub',stranger::text,true);
 denied:=false;begin perform public.app_workspace(sid,'administrative');exception when insufficient_privilege then denied:=true;end;assert denied,'foreign read';
 denied:=false;begin perform public.app_operation(sid,'administrative.save',payload,req);exception when insufficient_privilege then denied:=true;end;assert denied,'foreign write';
 -- Staff and supervisors cannot read administrative documents; office logistics can.
 update public.profiles set organization_id=org,role='STAFF' where id=stranger;
 insert into public.organization_members(organization_id,user_id,role) values(org,stranger,'STAFF');
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,stranger,'Fixture staff',person);
 insert into public.store_memberships(store_id,organization_id,user_id,role,work_role,login_identifier,assigned_by) values(sid,org,stranger,'STAFF','STAFF','fixture',person);
 denied:=false;begin perform public.app_workspace(sid,'administrative');exception when insufficient_privilege then denied:=true;end;assert denied,'staff read';
 update public.store_memberships set work_role='SUPERVISOR',role='SUPERVISOR' where store_id=sid and user_id=stranger;
 denied:=false;begin perform public.app_workspace(sid,'administrative');exception when insufficient_privilege then denied:=true;end;assert denied,'supervisor read';
 update public.store_memberships set work_role='LOGISTICS',role='LOGISTICS' where store_id=sid and user_id=stranger;
 assert jsonb_array_length(public.app_workspace(sid,'administrative')->'rows')=1,'office read';
 assert exists(select 1 from public.audit_logs where entity_id=rid::text and action='administrative.save'),'audit missing';
 assert baseline=(select md5(coalesce(string_agg(id::text||updated_at::text,'' order by id),'')) from public.suppliers),'supplier history altered';
end $$;
rollback;
