-- Isolated rollback fixture. Never imports or edits an existing restaurant row.
begin;
do $test$
<<spot_checks>>
declare
 owner_id uuid:=gen_random_uuid(); manager uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); finance uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 org uuid; store_id uuid; other_store uuid; zone1 uuid; zone2 uuid; product uuid; source_id uuid; active_source uuid; e1 uuid; e2 uuid;
 id uuid:=gen_random_uuid(); draft uuid:=gen_random_uuid(); no_diff uuid:=gen_random_uuid(); req uuid; data jsonb; response jsonb; first_response jsonb; payload jsonb; catalog jsonb;
 before_entries jsonb; before_source jsonb; before_stock jsonb; count_before bigint; denied boolean; rev integer;
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
 select u,u||'@spot-check.invalid',now(),now(),now() from unnest(array[owner_id,manager,admin_id,viewer,finance,staff,outsider]) u;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','抽盤隔離測試','business_type','SINGLE_RESTAURANT','store_mode','SINGLE'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code','QASPOT'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);
 org:=(data->>'organization_id')::uuid;store_id:=(data->>'store_id')::uuid;
 insert into public.organization_members(organization_id,user_id,role,work_role,can_manage_business)
 values(org,manager,'SUPERVISOR','SUPERVISOR',false),(org,admin_id,'LOGISTICS','LOGISTICS',false),(org,viewer,'LOGISTICS','LOGISTICS',false),(org,finance,'LOGISTICS','LOGISTICS',false),(org,staff,'STAFF','STAFF',false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by,job_title)
 values(org,manager,'主管',owner_id,null),(org,admin_id,'行政',owner_id,'行政'),(org,viewer,'查看者',owner_id,null),(org,finance,'財務',owner_id,'財務'),(org,staff,'員工',owner_id,null);
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,access_mode)
 values(store_id,org,manager,'manager','SUPERVISOR','SUPERVISOR',owner_id,'EDIT'),(store_id,org,admin_id,'admin','LOGISTICS','LOGISTICS',owner_id,'EDIT'),
 (store_id,org,viewer,'viewer','LOGISTICS','LOGISTICS',owner_id,'VIEW'),(store_id,org,finance,'finance','LOGISTICS','LOGISTICS',owner_id,'EDIT'),(store_id,org,staff,'staff','STAFF','STAFF',owner_id,'EDIT');
 zone1:=public.create_pilot_zone(store_id,'乾貨區');zone2:=public.create_pilot_zone(store_id,'吧台');
 insert into public.products(organization_id,product_code,name,base_unit,count_unit,category) values(org,'SPOT-'||gen_random_uuid(),'測試橄欖油','瓶','瓶','食材') returning products.id into product;
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,completed_at,snapshot)
 values(org,store_id,manager,'CLOSED','2026-09-27 12:00+08',jsonb_build_object('zones',jsonb_build_array(
 jsonb_build_object('zone_id',zone1,'product_id',product,'product_name','盤點時橄欖油','zone_name','原乾貨區','specification','1L'),jsonb_build_object('zone_id',zone2,'product_id',product)))) returning inventory_count_sessions.id into source_id;
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type)
 values(org,source_id,zone1,product,10,'瓶',manager,'INITIAL_COUNT') returning count_entries.id into e1;
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type)
 values(org,source_id,zone2,product,0,'瓶',manager,'INITIAL_COUNT') returning count_entries.id into e2;
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot) values(org,store_id,manager,'IN_PROGRESS','{}') returning inventory_count_sessions.id into active_source;
 select jsonb_agg(to_jsonb(e) order by e.id) into before_entries from public.count_entries e where session_id=source_id;
 select to_jsonb(s) into before_source from public.inventory_count_sessions s where s.id=source_id;
 select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') into before_stock from public.inventory_lots l where l.store_id=spot_checks.store_id;
 assert not has_function_privilege('anon','public.baihuayuan_spot_check(uuid,text,jsonb)','execute'),'anonymous RPC exposed';
 assert not has_table_privilege('authenticated','private.spot_check_items','select'),'raw baseline table exposed';
 assert not has_table_privilege('authenticated','private.spot_check_items','update'),'direct writes exposed';
 assert not has_function_privilege('authenticated','private.spot_check_source(uuid)','execute'),'baseline helper exposed';

 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 set local role authenticated;
 catalog:=public.baihuayuan_spot_check(store_id,'catalog',jsonb_build_object('month','2026-09','source_id',source_id));
 reset role;
 assert jsonb_array_length(catalog->'items')=2,'separate zone items missing';
 assert not exists(select 1 from jsonb_array_elements(catalog->'items') i where i ? 'original_quantity'),'preparation leaked original numbers';
 assert not exists(select 1 from jsonb_array_elements(catalog->'sources') s where s->>'id'=active_source::text),'unfinished count offered as source';
 assert not exists(select 1 from jsonb_array_elements(catalog->'assignees') a where a->>'id' in (viewer::text,finance::text,staff::text)),'readonly/finance/staff assignable';
 payload:=jsonb_build_object('id',id,'request_id',gen_random_uuid(),'source_id',active_source,'entries',jsonb_build_array(e1),'assignee_id',manager,'publish',true);
 denied:=false;begin perform public.baihuayuan_spot_check(store_id,'create',payload);exception when invalid_parameter_value then denied:=true;end;assert denied,'unfinished source accepted';
 payload:=payload||jsonb_build_object('source_id',source_id,'entries',jsonb_build_array(gen_random_uuid()));
 denied:=false;begin perform public.baihuayuan_spot_check(store_id,'create',payload);exception when insufficient_privilege then denied:=true;end;assert denied,'unrelated entry accepted';
 payload:=payload||jsonb_build_object('entries',jsonb_build_array(e1,e1));
 denied:=false;begin perform public.baihuayuan_spot_check(store_id,'create',payload);exception when invalid_parameter_value then denied:=true;end;assert denied,'duplicate entry accepted';
 payload:=payload||jsonb_build_object('entries',jsonb_build_array(e1,e2));
 set local role authenticated;
 response:=public.baihuayuan_spot_check(store_id,'create',payload);
 reset role;
 assert response->>'status'='OPEN','published plan not open';
 assert jsonb_array_length(response->'items')=2,'selected scope wrong';
 assert not exists(select 1 from jsonb_array_elements(response->'items') i where i ? 'original_quantity'),'open plan leaked baseline';
 first_response:=public.baihuayuan_spot_check(store_id,'create',payload);
 assert response=first_response,'idempotent create changed state';
 assert (select count(*) from private.spot_check_events where check_id=spot_checks.id)=1,'create replay duplicated event';
 payload:=payload||jsonb_build_object('assignee_id',admin_id);
 denied:=false;begin perform public.baihuayuan_spot_check(store_id,'create',payload);exception when invalid_parameter_value then denied:=true;end;assert denied,'changed request payload accepted';
 assert not exists(select 1 from jsonb_array_elements(public.baihuayuan_spot_check(store_id,'export','{"month":"2026-09"}')->'checks') a where a->>'id'=id::text),'unsubmitted check exported';
 denied:=false;begin perform public.baihuayuan_spot_check(store_id,'save_entries',jsonb_build_object('id',id,'request_id',gen_random_uuid(),'revision',1,'entries',jsonb_build_array(jsonb_build_object('entry_id',e1,'quantity',8))));exception when insufficient_privilege then denied:=true;end;assert denied,'unassigned user wrote quantities';

 perform set_config('request.jwt.claim.sub',manager::text,true);
 denied:=false;begin perform public.baihuayuan_spot_check(store_id,'submit',jsonb_build_object('id',id,'request_id',gen_random_uuid(),'revision',1));exception when invalid_parameter_value then denied:=true;end;assert denied,'blank quantities submitted';
 payload:=jsonb_build_object('id',id,'request_id',gen_random_uuid(),'revision',1,'entries',jsonb_build_array(jsonb_build_object('entry_id',e1,'quantity',8),jsonb_build_object('entry_id',e2,'quantity',0)));
 response:=public.baihuayuan_spot_check(store_id,'save_entries',payload);
 assert response->>'revision'='2','save revision missing';
 assert public.baihuayuan_spot_check(store_id,'save_entries',payload)=response,'save retry changed response';
 payload:=payload||jsonb_build_object('request_id',gen_random_uuid());
 denied:=false;begin perform public.baihuayuan_spot_check(store_id,'save_entries',payload);exception when serialization_failure then denied:=true;end;assert denied,'stale save overwrote quantities';
 payload:=payload||jsonb_build_object('revision',2,'entries',jsonb_build_array(jsonb_build_object('entry_id',e1,'quantity',7),jsonb_build_object('entry_id',e2,'quantity',-1)));
 denied:=false;begin perform public.baihuayuan_spot_check(store_id,'save_entries',payload);exception when invalid_parameter_value then denied:=true;end;assert denied,'negative quantity accepted';
 assert (select quantity=8 from private.spot_check_items where check_id=spot_checks.id and entry_id=e1),'failed batch partially persisted';
 payload:=jsonb_build_object('id',id,'request_id',gen_random_uuid(),'revision',2);
 response:=public.baihuayuan_spot_check(store_id,'submit',payload);
 assert response->>'status'='REVIEWING','difference did not create pending review';
 assert (select review_status='PENDING' from private.spot_check_items where check_id=spot_checks.id and entry_id=e1),'difference not pending';
 assert (select review_status='SAME' and final_quantity=0 from private.spot_check_items where check_id=spot_checks.id and entry_id=e2),'zero not preserved as matched';
 assert (select original_quantity=10 and name='盤點時橄欖油' and zone='原乾貨區' from private.spot_check_items where check_id=spot_checks.id and entry_id=e1),'historical snapshot incorrect';
 assert public.baihuayuan_spot_check(store_id,'submit',payload)=response,'submit retry duplicated transition';
 payload:=jsonb_build_object('id',id,'request_id',gen_random_uuid(),'revision',3,'entry_id',e1,'quantity',8,'reason','UNKNOWN','note','','final',true);
 denied:=false;begin perform public.baihuayuan_spot_check(store_id,'review',payload);exception when invalid_parameter_value then denied:=true;end;assert denied,'unknown reason sent as confirmed';
 response:=public.baihuayuan_spot_check(store_id,'review',payload||'{"final":false}');
 assert (select review_status='PENDING' from private.spot_check_items where check_id=spot_checks.id and entry_id=e1),'draft reason prematurely reviewed';
 payload:=payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',4,'reason','USED','note','盤點後備料使用 2 瓶。');
 response:=public.baihuayuan_spot_check(store_id,'review',payload);
 assert (select review_status='REVIEWED' and recheck_quantity=8 from private.spot_check_items where check_id=spot_checks.id and entry_id=e1),'supervisor review missing';
 denied:=false;begin perform public.baihuayuan_spot_check(store_id,'close',jsonb_build_object('id',id,'request_id',gen_random_uuid(),'revision',5,'entry_id',e1));exception when insufficient_privilege then denied:=true;end;assert denied,'supervisor assumed administrative close authority';
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 response:=public.baihuayuan_spot_check(store_id,'return',jsonb_build_object('id',id,'request_id',gen_random_uuid(),'revision',5,'entry_id',e1,'note','請補充使用時間'));
 assert (select review_status='PENDING' from private.spot_check_items where check_id=spot_checks.id and entry_id=e1),'return did not reopen review';
 denied:=false;begin perform public.baihuayuan_spot_check(store_id,'close',jsonb_build_object('id',id,'request_id',gen_random_uuid(),'revision',6,'entry_id',e1));exception when invalid_parameter_value then denied:=true;end;assert denied,'unreviewed item closed';
 perform set_config('request.jwt.claim.sub',manager::text,true);
 response:=public.baihuayuan_spot_check(store_id,'review',payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',6,'note','盤點後當晚備料使用 2 瓶。'));
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 payload:=jsonb_build_object('id',id,'request_id',gen_random_uuid(),'revision',7,'entry_id',e1);
 response:=public.baihuayuan_spot_check(store_id,'close',payload);
 assert response->>'status'='CLOSED','all differences resolved but plan still open';
 assert (select final_quantity=8 and original_quantity=10 and quantity=8 from private.spot_check_items where check_id=spot_checks.id and entry_id=e1),'final/original/check values not separate';
 select count(*) into count_before from private.spot_check_events where check_id=spot_checks.id;
 assert public.baihuayuan_spot_check(store_id,'close',payload)=response,'close retry changed response';
 assert (select count(*) from private.spot_check_events where check_id=spot_checks.id)=count_before,'retry duplicated history';
 assert (select count(*) from private.spot_check_events where check_id=spot_checks.id and action='review')=3,'old supervisor replies lost';
 assert (select jsonb_agg(to_jsonb(e) order by e.id) from public.count_entries e where session_id=source_id)=before_entries,'spot check altered original count entries';
 assert (select to_jsonb(s) from public.inventory_count_sessions s where s.id=source_id)=before_source,'spot check altered original session';
 assert (select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from public.inventory_lots l where l.store_id=spot_checks.store_id)=before_stock,'spot check changed stock';

 foreach req in array array[viewer,finance] loop
  perform set_config('request.jwt.claim.sub',req::text,true);
  response:=public.baihuayuan_spot_check(store_id,'export','{"month":"2026-09"}');
  assert jsonb_array_length(response->'checks')=1,'finance/view export missing approved scope';
  denied:=false;begin perform public.baihuayuan_spot_check(store_id,'close',payload);exception when insufficient_privilege then denied:=true;end;assert denied,'viewer replay bypassed mutation permission';
  response:=public.baihuayuan_spot_check(store_id,'list','{"month":"2026-10","pending":true}');
  assert jsonb_array_length(response->'checks')=0,'closed unrelated month appeared';
 end loop;
 foreach req in array array[staff,outsider] loop
  perform set_config('request.jwt.claim.sub',req::text,true);
  denied:=false;begin perform public.baihuayuan_spot_check(store_id,'detail',jsonb_build_object('id',id));exception when insufficient_privilege then denied:=true;end;assert denied,'unauthorized role read spot details';
 end loop;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 denied:=false;begin perform public.baihuayuan_spot_check(gen_random_uuid(),'detail',jsonb_build_object('id',id));exception when insufficient_privilege then denied:=true;end;assert denied,'cross-store read accepted';
 response:=public.baihuayuan_spot_check(store_id,'create',jsonb_build_object('id',draft,'request_id',gen_random_uuid(),'source_id',source_id,'entries',jsonb_build_array(e1),'assignee_id',manager,'publish',false));
 assert response->>'status'='DRAFT','save plan failed';
 response:=public.baihuayuan_spot_check(store_id,'plan',jsonb_build_object('id',draft,'request_id',gen_random_uuid(),'revision',1,'entries',jsonb_build_array(e2),'assignee_id',admin_id,'publish',true));
 assert response->>'status'='OPEN' and jsonb_array_length(response->'items')=1,'draft editing/publishing failed';
 response:=public.baihuayuan_spot_check(store_id,'save_entries',jsonb_build_object('id',draft,'request_id',gen_random_uuid(),'revision',2,'entries',jsonb_build_array(jsonb_build_object('entry_id',e2,'quantity',0))));
 response:=public.baihuayuan_spot_check(store_id,'submit',jsonb_build_object('id',draft,'request_id',gen_random_uuid(),'revision',3));
 assert response->>'status'='CLOSED','no-difference check did not complete';
 update public.store_memberships set is_active=false where user_id=admin_id and store_memberships.store_id=spot_checks.store_id;
 denied:=false;begin perform public.baihuayuan_spot_check(store_id,'export','{"month":"2026-09"}');exception when insufficient_privilege then denied:=true;end;assert denied,'revoked membership still exported';
end $test$;
select 'PASS: scope, roles, blind preparation, immutable originals, revision conflicts, atomic saves, retries, review/return/close, finance export, historical preservation' as result;
rollback;
