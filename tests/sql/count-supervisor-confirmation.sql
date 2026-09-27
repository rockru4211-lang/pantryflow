-- Self-contained rollback fixture: separate zone submission from whole-store confirmation.
begin;
do $test$
declare
  owner_id uuid:=gen_random_uuid(); manager_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); viewer_id uuid:=gen_random_uuid();
  org uuid; store_id uuid; cold uuid; bar uuid; product_id uuid; count_id uuid; pending_id uuid; entry_id uuid;
  data jsonb; before_entries jsonb; before_closed jsonb; result jsonb; first_result jsonb;
  audit_before bigint; audit_after bigint; denied boolean;
begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
  select u,u||'@count-confirm.invalid',now(),now(),now() from unnest(array[owner_id,manager_id,staff_id,viewer_id]) u;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  data:=public.owner_setup();
  data:=public.owner_setup('business',jsonb_build_object('organization_name','盤點確認隔離測試','business_type','SINGLE_RESTAURANT','store_mode','SINGLE'),0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code','QAFINAL'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
  data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
  data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);
  org:=(data->>'organization_id')::uuid;store_id:=(data->>'store_id')::uuid;
  insert into public.organization_members(organization_id,user_id,role,work_role,can_manage_business)
  values(org,manager_id,'SUPERVISOR','SUPERVISOR',false),(org,staff_id,'STAFF','STAFF',false),(org,viewer_id,'SUPERVISOR','SUPERVISOR',false);
  insert into public.staff_identities(organization_id,user_id,display_name,created_by)
  values(org,manager_id,'確認主管',owner_id),(org,staff_id,'盤點員工',owner_id),(org,viewer_id,'僅查看主管',owner_id);
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,access_mode)
  values(store_id,org,manager_id,'confirm-manager','SUPERVISOR','SUPERVISOR',owner_id,'EDIT'),
    (store_id,org,staff_id,'confirm-staff','STAFF','STAFF',owner_id,'EDIT'),
    (store_id,org,viewer_id,'confirm-viewer','SUPERVISOR','SUPERVISOR',owner_id,'VIEW');
  cold:=public.create_pilot_zone(store_id,'冷藏庫');bar:=public.create_pilot_zone(store_id,'吧台');
  insert into public.products(organization_id,product_code,name,base_unit,count_unit,category)
  values(org,'QA-MILK-'||gen_random_uuid(),'測試鮮奶','瓶','瓶','食材') returning id into product_id;
  insert into public.zone_products(zone_id,product_id,count_unit) values(cold,product_id,'瓶'),(bar,product_id,'瓶');
  insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,paper_required,snapshot)
  values(org,store_id,manager_id,'IN_PROGRESS',true,jsonb_build_object('opening_captured',true,'zones',jsonb_build_array(
    jsonb_build_object('zone_id',cold,'product_id',product_id,'unit','瓶'),jsonb_build_object('zone_id',bar,'product_id',product_id,'unit','瓶')))) returning id into count_id;
  insert into public.count_zone_progress(organization_id,session_id,zone_id) values(org,count_id,cold),(org,count_id,bar);

  perform set_config('request.jwt.claim.sub',staff_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);
  perform public.save_pilot_count_drafts_v2(count_id,gen_random_uuid(),jsonb_build_array(jsonb_build_object('zone_id',cold,'product_id',product_id,'quantity',3,'expected_updated_at',null)));
  perform public.complete_pilot_count_zone(count_id,cold);
  assert (select status='IN_PROGRESS' from public.inventory_count_sessions where id=count_id),'first completed zone prematurely ended the count';
  perform set_config('request.jwt.claim.sub',manager_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_id,'role','authenticated')::text,true);
  denied:=false;begin perform public.confirm_pilot_count_session(count_id);exception when invalid_parameter_value then denied:=true;end;
  assert denied,'manager confirmed with an incomplete zone';
  denied:=false;begin update public.inventory_count_sessions set status='CLOSED' where id=count_id;exception when invalid_parameter_value then denied:=true;end;
  assert denied,'direct status update bypassed incomplete-zone guard';

  perform set_config('request.jwt.claim.sub',staff_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);
  perform public.save_pilot_count_drafts_v2(count_id,gen_random_uuid(),jsonb_build_array(jsonb_build_object('zone_id',bar,'product_id',product_id,'quantity',2,'expected_updated_at',null)));
  perform public.complete_pilot_count_zone(count_id,bar);
  assert (select status='REVIEWING' from public.inventory_count_sessions where id=count_id),'all zones without discrepancies must await final confirmation';
  assert not exists(select 1 from public.inventory_count_discrepancies where session_id=count_id),'no-baseline count unexpectedly created discrepancies';
  assert (select sum(quantity)=5 and count(*)=2 from public.count_entries where session_id=count_id),'independent zones did not retain the combined count';
  denied:=false;begin perform public.confirm_pilot_count_session(count_id);exception when insufficient_privilege then denied:=true;end;
  assert denied,'STAFF confirmed entire count';
  denied:=false;begin update public.inventory_count_sessions set status='CLOSED' where id=count_id;exception when insufficient_privilege then denied:=true;end;
  assert denied,'STAFF bypassed confirmation via direct status update';
  perform set_config('request.jwt.claim.sub',viewer_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',viewer_id,'role','authenticated')::text,true);
  denied:=false;begin perform public.confirm_pilot_count_session(count_id);exception when insufficient_privilege then denied:=true;end;
  assert denied,'VIEW supervisor confirmed count';

  perform set_config('request.jwt.claim.sub',manager_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_id,'role','authenticated')::text,true);
  select jsonb_agg(to_jsonb(e) order by id) into before_entries from public.count_entries e where session_id=count_id;
  select count(*) into audit_before from public.audit_logs where entity_id=count_id::text;
  first_result:=public.confirm_pilot_count_session(count_id);
  assert (select status='CLOSED' from public.inventory_count_sessions where id=count_id),'supervisor confirmation did not close the count';
  assert (select paper_required and paper_completed_at is null and paper_reviewed_at is null from public.inventory_count_sessions where id=count_id),'confirmation silently completed independent paper workflow';
  assert (select jsonb_agg(to_jsonb(e) order by id) from public.count_entries e where session_id=count_id)=before_entries,'confirmation rewrote count quantities or entry history';
  select count(*) into audit_after from public.audit_logs where entity_id=count_id::text;
  assert (select count(*) from public.audit_logs where entity_id=count_id::text and action='COUNT_SUPERVISOR_CONFIRMED')=1,'confirmation must add exactly one supervisor-confirmation audit';
  select to_jsonb(s) into before_closed from public.inventory_count_sessions s where id=count_id;
  result:=public.confirm_pilot_count_session(count_id);
  assert result=first_result,'confirmation retry changed result';
  assert (select count(*) from public.audit_logs where entity_id=count_id::text)=audit_after,'confirmation retry duplicated audit';
  assert (select to_jsonb(s) from public.inventory_count_sessions s where id=count_id)=before_closed,'already CLOSED session changed on retry';
  assert (select jsonb_agg(to_jsonb(e) order by id) from public.count_entries e where session_id=count_id)=before_entries,'confirmation retry changed historical quantities';

  -- Pending discrepancies remain a separate mandatory resolution step.
  insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot)
  values(org,store_id,manager_id,'REVIEWING',jsonb_build_object('zones',jsonb_build_array(jsonb_build_object('zone_id',cold,'product_id',product_id,'unit','瓶')))) returning id into pending_id;
  insert into public.count_zone_progress(organization_id,session_id,zone_id,status,completed_by,completed_at)
  values(org,pending_id,cold,'COMPLETED',staff_id,now());
  insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type)
  values(org,pending_id,cold,product_id,7,'瓶',staff_id,'INITIAL_COUNT') returning id into entry_id;
  insert into public.inventory_count_discrepancies(organization_id,session_id,zone_id,product_id,initial_entry_id,previous_quantity,estimated_quantity,difference,status)
  values(org,pending_id,cold,product_id,entry_id,5,7,2,'PENDING');
  denied:=false;begin perform public.confirm_pilot_count_session(pending_id);exception when invalid_parameter_value then denied:=true;end;
  assert denied,'pending discrepancy bypassed final confirmation guard';
  assert (select status='REVIEWING' from public.inventory_count_sessions where id=pending_id),'failed confirmation changed reviewing status';
  perform public.resolve_pilot_count_discrepancy((select id from public.inventory_count_discrepancies where session_id=pending_id),'OTHER','RECOUNT',7);
  assert (select status='CLOSED' from public.inventory_count_sessions where id=pending_id),'last discrepancy resolution lost existing close behavior';
  assert not has_function_privilege('anon','public.confirm_pilot_count_session(uuid)','execute'),'anonymous count confirmation granted';
end $test$;
rollback;
select 'PASS: independent zone completion; supervisor/EDIT final confirmation; totals and history retained; idempotent audit; paper independence; pending-discrepancy denial' result;
