begin;
do $$
declare owner_id uuid; person uuid; org uuid; sid uuid; foreign_store uuid; batch uuid;
 data jsonb; result jsonb; mode text; r text; denied boolean; original text;
begin
 select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by c.id),'')) into original from public.inventory_count_sessions c;
 assert not has_table_privilege('authenticated','private.historical_source_records','select,insert,update,delete'),'history table exposed';
 assert not has_table_privilege('anon','private.historical_imports','select,insert,update,delete'),'imports exposed';
 assert not has_function_privilege('authenticated','private.historical_workspace(uuid,jsonb)','execute'),'private history helper exposed';
 foreach mode in array array['SINGLE_RESTAURANT','CHAIN_RESTAURANT'] loop
  owner_id:=gen_random_uuid();insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values(owner_id,owner_id||'@history-fixture.invalid',now(),now(),now());
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  data:=public.owner_setup();
  data:=public.owner_setup('business',jsonb_build_object('organization_name','History QA','business_type',mode,'store_mode','SINGLE'),0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','History QA','store_code','QA'||substr(replace(gen_random_uuid()::text,'-',''),1,14),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
  data:=public.owner_setup('complete','{}',(data->>'revision')::int);org:=(data->>'organization_id')::uuid;sid:=(data->>'store_id')::uuid;
  insert into private.historical_imports(store_id,dataset_key,source_month,source_file,source_sha256,expected_records)
  values(sid,'fixture','2026-08-01','fixture.xlsx','fixture',2) returning id into batch;
  insert into private.historical_source_records values(batch,'INVENTORY','a',1,'{"name":"甲","quantity":null,"supplier":"廠商"}','{"quantity":""}','[]',true);
  if mode='SINGLE_RESTAURANT' then
   result:=public.app_workspace(sid,'historical-records','{"kind":"INVENTORY"}');
   assert jsonb_array_length(result->'rows')=0,'partial import exposed';
  end if;
  insert into private.historical_source_records values(batch,'INVENTORY','b',2,'{"name":"乙","quantity":"0","supplier":"廠商"}','{"quantity":"0"}','[]',false);
  insert into private.historical_source_records values(batch,'INVENTORY','a',1,'{}','{}','[]',true) on conflict do nothing;
  assert (select count(*) from private.historical_source_records where import_id=batch)=2,'retry duplicated records';
  assert (select h.data->>'name' from private.historical_source_records h where import_id=batch and source_id='a')='甲','retry overwrote source';
  update private.historical_imports set state='READY' where id=batch;
  foreach r in array array['OWNER','LOGISTICS','SUPERVISOR','STAFF'] loop
   if r='OWNER' then person:=owner_id;else
    person:=gen_random_uuid();insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values(person,person||'@history-fixture.invalid',now(),now(),now());
    update public.profiles set organization_id=org,role=r::public.app_role where id=person;
    insert into public.organization_members(organization_id,user_id,role) values(org,person,r::public.app_role);
    insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,person,'History QA '||r,owner_id);
    insert into public.store_memberships(store_id,organization_id,user_id,role,work_role,login_identifier,assigned_by) values(sid,org,person,r::public.app_role,r::public.app_role,lower(r),owner_id);
   end if;
   perform set_config('request.jwt.claim.sub',person::text,true);
   if mode='CHAIN_RESTAURANT' or r in ('STAFF','SUPERVISOR') then
    denied:=false;begin perform public.app_workspace(sid,'historical-records','{"kind":"INVENTORY"}');exception when insufficient_privilege then denied:=true;end;assert denied,'unauthorized history read';continue;
   end if;
   result:=public.app_workspace(sid,'historical-records','{"kind":"INVENTORY"}');
   assert result->>'total'='2' and result->>'pending'='1','history totals incorrect';
   assert result->'rows'->0->'data'->>'quantity' is null and result->'rows'->1->'data'->>'quantity'='0','blank converted to zero';
   assert jsonb_array_length(public.app_workspace(sid,'historical-records','{"kind":"INVENTORY","pending":true}')->'rows')=1,'pending filter incorrect';
   assert jsonb_array_length(public.app_workspace(sid,'historical-records','{"kind":"INVENTORY","month":"2026-09"}')->'rows')=0,'history leaks across months';
   assert jsonb_array_length(public.app_workspace(sid,'historical-records','{"kind":"RECEIVING"}')->'rows')=0,'record kinds mixed';
   assert jsonb_array_length(public.app_workspace(sid,'historical-records','{"kind":"INVENTORY","search":"乙"}')->'rows')=1,'search incorrect';
  end loop;
  if foreign_store is not null then
   perform set_config('request.jwt.claim.sub',owner_id::text,true);
   denied:=false;begin perform public.app_workspace(foreign_store,'historical-records','{"kind":"INVENTORY"}');exception when insufficient_privilege then denied:=true;end;assert denied,'foreign history read exposed';
  end if;
  foreign_store:=sid;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 denied:=false;begin perform public.app_workspace(sid,'historical-records','{"kind":"INVENTORY"}');exception when insufficient_privilege then denied:=true;end;assert denied,'unauthenticated read allowed';
 assert original=(select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by c.id),'')) from public.inventory_count_sessions c),'current counts changed';
end $$;
rollback;
