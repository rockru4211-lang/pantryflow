-- Isolated real-role fixture: every row is rolled back.
begin;
do $test$
declare owner_id uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 s uuid:=gen_random_uuid();other_s uuid:=gen_random_uuid();item_id uuid:=gen_random_uuid();repair_id uuid:=gen_random_uuid();req uuid:=gen_random_uuid();
 payload jsonb;result jsonb;attachment jsonb;path text;before_count bigint;
begin
 select count(*) into before_count from private.administrative_documents;
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
 execute 'set local role authenticated';
 payload:=jsonb_build_object('operation','create','id',item_id,'name','測試刮刀','quantity',2,'unit','支','reason','原始原因');
 result:=public.app_operation(s,'purchase.notes',payload,req);
 assert result->'row'->>'status'='PENDING';
 assert public.app_operation(s,'purchase.notes',payload,req)=result;
 assert jsonb_array_length(public.app_operation(s,'purchase.notes','{"operation":"list"}',gen_random_uuid())->'rows')=1;
 begin perform public.app_operation(other_s,'purchase.notes','{"operation":"list"}',gen_random_uuid());raise exception 'cross-store list allowed';exception when sqlstate '42501' then null;end;
 begin perform public.app_operation(s,'purchase.notes',payload||'{"name":"changed"}',req);raise exception 'request mutation allowed';exception when sqlstate '23505' then null;end;
 begin perform 1 from private.purchase_notes;raise exception 'private table accessible';exception when sqlstate '42501' then null;end;
 result:=public.app_operation(s,'purchase.notes',payload||jsonb_build_object('operation','save','revision',1,'status','SENT','reference','TEST-ONLY','note','已送外部系統'),gen_random_uuid());
 assert result->'row'->>'status'='SENT';
 begin perform public.app_operation(s,'purchase.notes',payload||'{"operation":"save","revision":1,"status":"ARRIVED"}',gen_random_uuid());raise exception 'stale write allowed';exception when sqlstate '40001' then null;end;
 result:=public.app_operation(s,'purchase.notes',payload||'{"operation":"save","revision":2,"status":"ARRIVED"}',gen_random_uuid());
 assert result->'row'->>'reason'='原始原因';assert jsonb_array_length(result->'row'->'events')=3;
 attachment:=public.app_operation(s,'directory.attachments',jsonb_build_object('kind','document','target',item_id,'operation','prepare','name','測試.mp4','mime','video/mp4','size',12,'sha256',repeat('a',64)),gen_random_uuid());
 path:=attachment->>'storage_path';assert path like '%.mp4';
 -- Test storage INSERT under the actual authenticated role, not service-role bypass.
 insert into storage.objects(bucket_id,name,metadata) values('directory-attachments',path,'{"size":12,"mimetype":"video/mp4"}');
 perform public.app_operation(s,'directory.attachments',jsonb_build_object('kind','document','target',item_id,'operation','complete','id',attachment->>'id'),gen_random_uuid());
 assert (select count(*) from storage.objects where name=path)=1;
 begin perform public.app_operation(other_s,'directory.attachments',jsonb_build_object('kind','document','target',item_id,'operation','list'),gen_random_uuid());raise exception 'cross-store attachments allowed';exception when sqlstate '42501' then null;end;
 result:=public.equipment_workflow(s,'create',jsonb_build_object('id',repair_id,'name','測試冰箱','problem','原故障'),gen_random_uuid());
 assert result->'job'->>'status'='PENDING';
 begin perform public.equipment_workflow(s,'plan',jsonb_build_object('id',repair_id,'revision',1),gen_random_uuid());raise exception 'field planning allowed';exception when sqlstate '42501' then null;end;
 result:=public.equipment_workflow(s,'report',jsonb_build_object('id',repair_id,'revision',1,'status','OTHER','body','已接手','report_date',current_date),gen_random_uuid());
 result:=public.equipment_workflow(s,'report',jsonb_build_object('id',repair_id,'revision',2,'status','DONE','body','維修完成','report_date',current_date),gen_random_uuid());
 assert result->'job'->>'problem'='原故障';assert jsonb_array_length(result->'job'->'events')=3;
 execute 'reset role';
 update public.store_memberships set access_mode='VIEW' where store_id=s and user_id=staff;
 execute 'set local role authenticated';
 begin perform public.app_operation(s,'purchase.notes',payload,req);raise exception 'readonly write allowed';exception when sqlstate '42501' then null;end;
 execute 'reset role';
 update public.store_memberships set is_active=false where store_id=s and user_id=staff;
 execute 'set local role authenticated';
 begin perform public.app_operation(s,'purchase.notes','{"operation":"list"}',gen_random_uuid());raise exception 'removed member allowed';exception when sqlstate '42501' then null;end;
 assert not exists(select 1 from storage.objects where name=path);
 execute 'reset role';
 perform set_config('request.jwt.claim.sub','',true);
 execute 'set local role anon';
 begin perform public.app_operation(s,'purchase.notes','{"operation":"list"}',gen_random_uuid());raise exception 'anon allowed';exception when sqlstate '42501' then null;end;
 execute 'reset role';
 assert (select count(*) from private.administrative_documents)=before_count+2;
end $test$;
rollback;
