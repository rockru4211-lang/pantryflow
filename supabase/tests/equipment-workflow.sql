do $test$
declare owner_id uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 s uuid:=gen_random_uuid(); other_s uuid:=gen_random_uuid(); item_id uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid();
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

 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform private.administrative_save(s,jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',legacy,'name','舊紀錄','category','維修紀錄','revision',0,'repair_reason','保留舊原因'))),gen_random_uuid());
 payload:=jsonb_build_object('id',item_id,'name','測試冰箱','problem','原故障','vendor','測試廠商');
 result:=public.equipment_workflow(s,'create',payload,req);
 assert public.equipment_workflow(s,'create',payload,req)=result;
 assert (select count(*) from private.equipment_job_events where job_id=item_id)=1;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 assert jsonb_array_length(public.equipment_workflow(s)->'jobs')=1;
 assert private.directory_attachment_access(s,'document',item_id,true),'repair attachments remain available';
 begin perform private.directory_lifecycle(s,jsonb_build_object('kind','equipment','operation','deactivate','id',item_id,'revision',1),gen_random_uuid());raise exception 'field archive allowed';exception when sqlstate '42501' then null;end;
 begin perform public.equipment_workflow(s,'create',payload,gen_random_uuid());raise exception 'field create allowed';exception when sqlstate '42501' then null;end;
 begin perform public.equipment_workflow(s,'plan',jsonb_build_object('id',item_id,'revision',1),gen_random_uuid());raise exception 'field plan allowed';exception when sqlstate '42501' then null;end;
 begin perform public.equipment_workflow(other_s);raise exception 'cross store allowed';exception when sqlstate '42501' then null;end;
 payload:=jsonb_build_object('id',item_id,'revision',1,'status','QUOTE','body','等待廠商報價','report_date',current_date);req:=gen_random_uuid();
 result:=public.equipment_workflow(s,'report',payload,req);
 assert result->'job'->>'status'='QUOTE';
 assert public.equipment_workflow(s,'report',payload,req)=result;
 assert (select count(*) from private.equipment_job_events where job_id=item_id)=2;
 assert (select repair_reason from private.administrative_documents where id=item_id)='原故障';
 begin perform public.equipment_workflow(s,'report',payload,gen_random_uuid());raise exception 'stale revision allowed';exception when sqlstate '40001' then null;end;
 begin perform public.equipment_workflow(s,'report',payload||'{"body":"changed"}',req);raise exception 'request changed allowed';exception when sqlstate '23505' then null;end;
 begin perform private.administrative_save(s,jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',item_id,'name','改寫','category','維修紀錄','revision',2))),gen_random_uuid());raise exception 'legacy rewrite allowed';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 result:=public.equipment_workflow(s,'plan',jsonb_build_object('id',item_id,'revision',2,'vendor','新廠商'),gen_random_uuid());
 assert result->'job'->>'status'='PENDING';
 perform set_config('request.jwt.claim.sub',staff::text,true);
 payload:=jsonb_build_object('id',item_id,'revision',3,'status','DONE','body','已更換零件並試機','report_date',current_date);req:=gen_random_uuid();
 result:=public.equipment_workflow(s,'report',payload,req);
 assert result->'job'->>'status'='DONE';
 assert public.equipment_workflow(s,'report',payload,req)=result;
 assert jsonb_array_length(result->'job'->'events')=4;
 assert (select repair_reason from private.administrative_documents where id=legacy)='保留舊原因';
 update public.store_memberships set access_mode='VIEW' where store_id=s and user_id=staff;
 begin perform public.equipment_workflow(s,'report',payload,req);raise exception 'readonly retry allowed';exception when sqlstate '42501' then null;end;
 update public.store_memberships set is_active=false where store_id=s and user_id=staff;
 begin perform public.equipment_workflow(s);raise exception 'disabled read allowed';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.equipment_workflow(s);raise exception 'anon read allowed';exception when sqlstate '42501' then null;end;
 assert not has_function_privilege('anon','public.equipment_workflow(uuid,text,jsonb,uuid)','EXECUTE');
 assert not has_table_privilege('authenticated','private.equipment_jobs','SELECT');
 raise exception using errcode='ZX001',message='rollback repair fixtures';
 exception when sqlstate 'ZX001' then null;end;
 assert (select count(*) from private.administrative_documents)=before_count,'fixtures rolled back';
end $test$;
