-- Self-contained rollback fixture: separate zone submission from whole-store confirmation.
begin;
do $test$
declare
  owner_id uuid:=gen_random_uuid(); manager_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); viewer_id uuid:=gen_random_uuid();
  org uuid; store_id uuid; cold uuid; bar uuid; product_id uuid; count_id uuid; pending_id uuid; entry_id uuid;
  data jsonb; before_entries jsonb; before_closed jsonb; result jsonb; first_result jsonb;
  preview jsonb; audit_before bigint; audit_after bigint; denied boolean;
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
  insert into public.count_drafts(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,updated_at) values(org,count_id,cold,product_id,3,'瓶',staff_id,'2026-09-30 12:00Z');

  preview:=public.get_count_finish_preview(count_id);
  assert jsonb_array_length(preview->'missing')=1,'missing area not listed';
  denied:=false;begin perform public.finish_pilot_count(count_id,preview->>'revision',false);exception when invalid_parameter_value then denied:=true;end;
  assert denied,'missing rows submitted without confirmation';
  assert not exists(select 1 from private.count_unobserved where session_id=count_id),'failed operation leaked skip evidence';
  denied:=false;begin perform public.finish_pilot_count(count_id,'stale',true);exception when serialization_failure then denied:=true;end;
  assert denied,'stale shared data accepted';
  perform set_config('request.jwt.claim.sub',viewer_id::text,true);
  denied:=false;begin perform public.finish_pilot_count(count_id,preview->>'revision',true);exception when insufficient_privilege then denied:=true;end;
  assert denied,'read-only user submitted count';
  perform set_config('request.jwt.claim.sub',staff_id::text,true);
  perform public.finish_pilot_count(count_id,preview->>'revision',true);
  assert (select entered_at='2026-09-30 12:00Z'::timestamptz from public.count_entries where session_id=count_id),'finish replaced physical observation date';
  assert private.inventory_count_date(count_id)='2026-09-30'::date,'finished count moved months';
  assert (select status='REVIEWING' from public.inventory_count_sessions where id=count_id),'count not submitted';
  assert (select count(*)=1 and sum(quantity)=3 from public.count_entries where session_id=count_id),'unobserved became zero entry';
  assert (select count(*)=1 from private.count_unobserved where session_id=count_id),'missing evidence';
  result:=private.inventory_month_source(count_id);
  assert result->0->>'quantity' is null,'partial two-zone count became whole-store total';
  assert (result->0->>'quantity_pending')::boolean,'missing pending marker';
  assert jsonb_array_length(result->0->'zones')=2,'missing zone dropped from office source';
  assert not exists(select 1 from public.inventory_count_discrepancies where session_id=count_id),'partial count became discrepancy';
  result:=private.stock_snapshot(store_id,product_id,'瓶');
  assert result->>'total' is null,'partial count became stock baseline';
  perform public.finish_pilot_count(count_id,'old-revision',true);
  assert (select count(*)=1 from public.count_entries where session_id=count_id),'retry duplicated entries';
  perform set_config('request.jwt.claim.sub',manager_id::text,true);
  perform public.confirm_pilot_count_session(count_id);
  assert (select status='CLOSED' from public.inventory_count_sessions where id=count_id),'explicit skip could not be confirmed';
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  denied:=false;begin perform public.get_count_finish_preview(count_id);exception when insufficient_privilege then denied:=true;end;
  assert denied,'outsider read count names';
  denied:=false;begin perform public.finish_pilot_count(count_id,'old',true);exception when insufficient_privilege then denied:=true;end;
  assert denied,'outsider replay bypass';
end $test$;
rollback;
