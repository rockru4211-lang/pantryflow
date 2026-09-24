begin;
do $test$
#variable_conflict use_variable
declare
 actor uuid:=gen_random_uuid();admin_user uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();supervisor uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();store_id uuid:=gen_random_uuid();other_store uuid:=gen_random_uuid();cold uuid:=gen_random_uuid();bar uuid:=gen_random_uuid();
 wine uuid:=gen_random_uuid();milk uuid:=gen_random_uuid();flour uuid:=gen_random_uuid();old_session uuid:=gen_random_uuid();current_session uuid:=gen_random_uuid();future_session uuid:=gen_random_uuid();
 row_data jsonb;state jsonb;before_state jsonb;closed_state jsonb;old_revision text;originals jsonb;counter integer;entry_id uuid;final_id uuid;identity_id uuid;
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
 select id,id||'@inventory-month-test.invalid',now(),now(),now() from unnest(array[actor,admin_user,staff,supervisor,outsider]) id;
 insert into public.profiles(id,display_name) select id,'月盤測試' from unnest(array[actor,admin_user,staff,supervisor,outsider]) id on conflict(id) do nothing;
 insert into public.organizations(id,name) values(org,'月盤回滾測試');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(store_id,org,'BeApe','IM'||substr(store_id::text,1,8),actor),(other_store,org,'Gras','IM'||substr(other_store::text,1,8),actor);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
 values(org,actor,'OWNER',true,true),(org,admin_user,'LOGISTICS',false,false),(org,staff,'STAFF',false,false),(org,supervisor,'SUPERVISOR',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'月盤測試',actor from unnest(array[actor,admin_user,staff,supervisor]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
 values(store_id,org,actor,'im-owner','OWNER','OWNER',actor,true),(store_id,org,admin_user,'im-admin','LOGISTICS','LOGISTICS',actor,false),(store_id,org,staff,'im-staff','STAFF','STAFF',actor,false),(store_id,org,supervisor,'im-supervisor','SUPERVISOR','SUPERVISOR',actor,false);
 insert into public.count_zones(id,organization_id,store_id,name) values(cold,org,store_id,'冷藏'),(bar,org,store_id,'吧台');
 insert into public.products(id,organization_id,name,category,count_unit,base_unit) values(wine,org,'酒','酒類','瓶','瓶'),(milk,org,'鮮奶','食材','瓶','瓶'),(flour,org,'麵粉','乾貨','包','包');
 insert into public.inventory_count_sessions(id,organization_id,store_id,started_by,status,completed_at,snapshot)
 values(old_session,org,store_id,actor,'CLOSED','2026-08-01 00:00+08',jsonb_build_object('zones',jsonb_build_array(jsonb_build_object('zone_id',cold,'product_id',wine),jsonb_build_object('zone_id',cold,'product_id',flour)))),
 (current_session,org,store_id,actor,'REVIEWING','2026-09-01 00:00+08',jsonb_build_object('zones',jsonb_build_array(jsonb_build_object('zone_id',cold,'product_id',wine),jsonb_build_object('zone_id',bar,'product_id',wine),jsonb_build_object('zone_id',cold,'product_id',milk),jsonb_build_object('zone_id',cold,'product_id',flour))));
 insert into public.count_zone_progress(organization_id,session_id,zone_id,status) values(org,old_session,cold,'COMPLETED'),(org,current_session,cold,'COMPLETED'),(org,current_session,bar,'COMPLETED');
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type)
 values(org,old_session,cold,wine,8,'瓶',actor,'INITIAL_COUNT'),(org,old_session,cold,flour,2,'包',actor,'INITIAL_COUNT'),
 (org,current_session,cold,wine,5,'瓶',staff,'INITIAL_COUNT'),(org,current_session,bar,wine,7,'瓶',supervisor,'INITIAL_COUNT'),(org,current_session,cold,milk,0,'瓶',staff,'INITIAL_COUNT'),(org,current_session,cold,flour,3,'公斤',staff,'INITIAL_COUNT');
 insert into private.count_price_snapshots(session_id,product_id,unit,unit_price) values(old_session,wine,'瓶',100),(old_session,flour,'包',50),(current_session,wine,'瓶',110),(current_session,milk,'瓶',null),(current_session,flour,'公斤',20);
 select jsonb_agg(to_jsonb(e) order by id) into originals from public.count_entries e where e.session_id in (old_session,current_session);
 assert not has_function_privilege('anon','public.baihuayuan_inventory_month(uuid,date,text,jsonb)','EXECUTE'),'anonymous wrapper denied';
 assert not has_function_privilege('authenticated','private.inventory_month_state(uuid,date,uuid)','EXECUTE'),'internal state denied';
 assert not has_table_privilege('authenticated','private.inventory_month_reviews','SELECT,INSERT,UPDATE,DELETE'),'no direct monthly table grants';
 foreach identity_id in array array[staff,supervisor,outsider] loop
  perform set_config('request.jwt.claim.sub',identity_id::text,true);
  begin perform public.baihuayuan_inventory_month(store_id,'2026-09-01');raise exception 'nonadmin accepted';exception when insufficient_privilege then null;end;
 end loop;
 perform set_config('request.jwt.claim.sub',admin_user::text,true);
 begin perform public.baihuayuan_inventory_month(other_store,'2026-09-01');raise exception 'wrong store accepted';exception when insufficient_privilege then null;end;
 begin perform public.baihuayuan_inventory_month(store_id,'2026-09-01',null);raise exception 'null action accepted';exception when sqlstate '22023' then null;end;
 state:=public.baihuayuan_inventory_month(store_id,'2026-09-01');
 assert state->>'source_id'=current_session::text,'Taiwan month boundary selects September';
 assert state->>'previous_source_id'=old_session::text,'August comparison';
 assert (state->>'source_complete')::boolean,'complete source';
 select r into row_data from jsonb_array_elements(state->'rows') r where r->>'product_id'=wine::text;
 assert (row_data->>'current_quantity')::numeric=12 and (row_data->>'difference')::numeric=4 and jsonb_array_length(row_data->'zones')=2,'multi-zone aggregate once';
 assert (row_data->>'amount')::numeric=1320,'current snapshot price';
 assert state#>>'{summary,missing_prices}'='1','zero quantity with unknown price remains missing';
 assert (select r->>'comparison'='UNIT_CHANGED' and r->>'difference' is null from jsonb_array_elements(state->'rows') r where r->>'row_key'=flour::text||':公斤'),'unit change not converted';
 assert (select r->>'comparison'='MISSING' and r->>'current_quantity' is null from jsonb_array_elements(state->'rows') r where r->>'row_key'=flour::text||':包'),'old unit not fabricated zero';
 before_state:=state;
 begin perform public.baihuayuan_inventory_month(store_id,'2026-09-01','close',jsonb_build_object('revision',state->>'revision'));raise exception 'unreviewed closure accepted';exception when sqlstate '22023' then assert sqlerrm='INVENTORY_REVIEW_REQUIRED';end;
 begin perform public.baihuayuan_inventory_month(store_id,'2026-09-01','review',jsonb_build_object('revision',state->>'revision','row_key',row_data->>'row_key','unit_price',110,'acknowledged',true));raise exception 'missing note accepted';exception when sqlstate '22023' then assert sqlerrm='INVENTORY_REVIEW_NOTE_REQUIRED';end;
 state:=public.baihuayuan_inventory_month(store_id,'2026-09-01','review',jsonb_build_object('revision',state->>'revision','row_key',row_data->>'row_key','unit_price',120,'acknowledged',true,'note','已確認正常庫存增減'));
 assert (select r->>'unit_price'='120' and (r->>'acknowledged')::boolean from jsonb_array_elements(state->'rows') r where r->>'product_id'=wine::text),'write response sees saved review';
 old_revision:=before_state->>'revision';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin perform public.baihuayuan_inventory_month(store_id,'2026-09-01','review',jsonb_build_object('revision',old_revision,'row_key',row_data->>'row_key','unit_price',999));raise exception 'stale second admin overwrote';exception when sqlstate '40001' then null;end;
 -- Correction total must replace the aggregate rather than being added to originals.
 select id into entry_id from public.count_entries where session_id=current_session and product_id=wine and zone_id=cold and entry_type='INITIAL_COUNT';
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,parent_entry_id) values(org,current_session,cold,wine,10,'瓶',actor,'CORRECTION',entry_id) returning id into final_id;
 insert into public.inventory_count_discrepancies(organization_id,session_id,zone_id,product_id,initial_entry_id,final_entry_id,status) values(org,current_session,cold,wine,entry_id,final_id,'RESOLVED');
 state:=public.baihuayuan_inventory_month(store_id,'2026-09-01');
 select r into row_data from jsonb_array_elements(state->'rows') r where r->>'product_id'=wine::text;
 assert (row_data->>'current_quantity')::numeric=10 and (row_data->>'original_quantity')::numeric=12 and (row_data->>'corrected')::boolean,'single correction used once';
 assert not (row_data->>'acknowledged')::boolean and (row_data->>'unit_price')::numeric=110,'source change invalidates prior approval';
 for row_data in select r from jsonb_array_elements(state->'rows') r loop
  state:=public.baihuayuan_inventory_month(store_id,'2026-09-01','review',jsonb_build_object('revision',state->>'revision','row_key',row_data->>'row_key','unit_price',case when row_data->>'current_quantity' is not null then 120 else null end,'acknowledged',true,'note','測試已核對：數量及單位正確'));
 end loop;
 assert state#>>'{summary,pending}'='0','all reviewed';
 update public.count_zone_progress set status='NOT_STARTED' where session_id=current_session and zone_id=bar;
 state:=public.baihuayuan_inventory_month(store_id,'2026-09-01');
 begin perform public.baihuayuan_inventory_month(store_id,'2026-09-01','close',jsonb_build_object('revision',state->>'revision'));raise exception 'incomplete source accepted';exception when sqlstate '22023' then assert sqlerrm='INVENTORY_COUNT_INCOMPLETE';end;
 update public.count_zone_progress set status='COMPLETED' where session_id=current_session and zone_id=bar;
 state:=public.baihuayuan_inventory_month(store_id,'2026-09-01');
 closed_state:=public.baihuayuan_inventory_month(store_id,'2026-09-01','close',jsonb_build_object('revision',state->>'revision'));
 assert (closed_state->>'closed')::boolean,'closure freezes payload';
 select count(*) into counter from public.audit_logs a where a.store_id=store_id and action='INVENTORY_MONTH_CONFIRMED' and organization_id=org;
 assert public.baihuayuan_inventory_month(store_id,'2026-09-01','close','{}')=closed_state,'close retry idempotent';
 assert (select count(*) from public.audit_logs a where a.store_id=store_id and action='INVENTORY_MONTH_CONFIRMED' and organization_id=org)=counter,'no duplicate close audit';
 begin perform public.baihuayuan_inventory_month(store_id,'2026-09-01','review','{}');raise exception 'closed month editable';exception when sqlstate '22023' then assert sqlerrm='INVENTORY_MONTH_CLOSED';end;
 update public.products set name='之後改名' where id=wine;
 update private.count_price_snapshots set unit_price=999 where session_id=current_session;
 assert public.baihuayuan_inventory_month(store_id,'2026-09-01','export')=closed_state,'frozen export survives later catalogue and price change';
 insert into public.inventory_count_sessions(id,organization_id,store_id,started_by,status,completed_at,snapshot) values(future_session,org,store_id,actor,'CLOSED','2026-10-01 00:00+08',jsonb_build_object('zones',jsonb_build_array(jsonb_build_object('zone_id',cold,'product_id',wine))));
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type) values(org,future_session,cold,wine,9,'瓶',actor,'INITIAL_COUNT');
 insert into public.count_zone_progress(organization_id,session_id,zone_id,status) values(org,future_session,cold,'COMPLETED');
 state:=public.baihuayuan_inventory_month(store_id,'2026-10-01');
 select r into row_data from jsonb_array_elements(state->'rows') r where r->>'product_id'=wine::text;
 assert (row_data->>'previous_quantity')::numeric=10 and (row_data->>'previous_amount')::numeric=1200,'next month uses frozen previous month values';
 state:=public.baihuayuan_inventory_month(store_id,'2026-12-01');assert state->>'source_id' is null and not (state->>'has_previous')::boolean,'no carry-forward across missing calendar month';
 assert originals=(select jsonb_agg(to_jsonb(e) order by id) from public.count_entries e where e.session_id in(old_session,current_session) and entry_type='INITIAL_COUNT'),'original entries untouched';
 raise notice 'inventory monthly: role boundaries, aggregation, pricing, revisions, corrections, closure, exports, historical preservation passed';
end $test$;
rollback;
