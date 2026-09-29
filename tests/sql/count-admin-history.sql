begin;
do $$
#variable_conflict use_variable
declare actor uuid:=gen_random_uuid();viewer uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();org uuid;store_id uuid;data jsonb;z uuid;p uuid;p2 uuid;cs uuid;oldcs uuid;month date:=date_trunc('month',now() at time zone 'Asia/Taipei')::date;stamp timestamptz;oldstamp timestamptz;payload jsonb;result jsonb;req uuid:=gen_random_uuid();denied boolean;before_snapshot jsonb; removed_at text; other_store uuid; other_zone uuid; rev text;
begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@receipt-detail.invalid',now() from unnest(array[actor,viewer,staff])id;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','進貨隔離測試','business_type','SINGLE_RESTAURANT','store_mode','SINGLE'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code','QAREVIEW'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);
 org:=(data->>'organization_id')::uuid;store_id:=(data->>'store_id')::uuid;

 insert into public.count_zones(organization_id,store_id,name) values(org,store_id,'食材') returning id into z;
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'後腳','公斤','公斤') returning id,updated_at into p,stamp;
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'未盤品項','包','包') returning id into p2;
 insert into public.zone_products(zone_id,product_id,count_unit) values(z,p,'公斤'),(z,p2,'包');
 before_snapshot:=jsonb_build_object('zones',jsonb_build_array(jsonb_build_object('zone_id',z,'zone_name','食材','product_id',p,'product_name','後腳','unit','公斤'),jsonb_build_object('zone_id',z,'zone_name','食材','product_id',p2,'product_name','未盤品項','unit','包')));
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot,started_at,completed_at) values(org,store_id,actor,'REVIEWING',before_snapshot,now()-interval '2 hours',now()-interval '1 hour') returning id into oldcs;
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type) values(org,oldcs,z,p,1,'公斤',actor,'INITIAL_COUNT');
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot) values(org,store_id,actor,'IN_PROGRESS',before_snapshot) returning id into cs;
 insert into public.count_zone_progress(organization_id,session_id,zone_id,status) values(org,cs,z,'IN_PROGRESS');
 result:=public.save_pilot_count_drafts_v2(cs,gen_random_uuid(),jsonb_build_array(jsonb_build_object('zone_id',z,'product_id',p,'quantity',0,'note','目前沒在使用','expected_updated_at',null)));
 oldstamp:=(result->0->>'updated_at')::timestamptz;

 insert into public.stores(organization_id,name,created_by,store_code) values(org,'Other store',actor,'QAOTHER'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))) returning id into other_store;
 insert into public.count_zones(organization_id,store_id,name) values(org,other_store,'食材') returning id into other_zone;
 insert into public.zone_products(zone_id,product_id,count_unit) values(other_zone,p,'公斤');
 insert into public.organization_members(organization_id,user_id,role,work_role) values(org,viewer,'STAFF','STAFF');
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,viewer,'現場員工',actor);
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,access_mode) values(store_id,org,viewer,'qa-field-staff','STAFF','STAFF',actor,'EDIT');
 perform set_config('request.jwt.claim.sub',viewer::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',viewer,'role','authenticated')::text,true);
 payload:=jsonb_build_object('session_id',cs,'product_id',p,'versions',jsonb_build_object(z,oldstamp));
 rev:=public.get_count_store_revision(store_id);
 set local role authenticated;
 result:=public.app_operation(store_id,'count.field-remove',payload,req);
 assert result=public.app_operation(store_id,'count.field-remove',payload,req),'remove retry differs';
 data:=public.get_count_field_removed(store_id);
 reset role;
 removed_at:=result->>'removed_at';
 assert jsonb_array_length(data)=1 and data->0->>'removed_by'='現場員工','list missing actor';
 assert exists(select 1 from private.count_item_changes c where c.store_id=store_id and c.product_id=p and c.action='移出盤點' and c.actor_id=viewer and c.after_data->>'status'='已移出'),'removal history missing';
 assert rev<>public.get_count_store_revision(store_id),'other device revision unchanged';
 assert (select jsonb_array_length(snapshot->'zones')=1 and jsonb_array_length(snapshot->'removed_zones')=1 from public.inventory_count_sessions where id=cs),'card not moved out';
 assert (select quantity=0 and note='目前沒在使用' from public.count_drafts where session_id=cs and product_id=p),'draft lost';
 assert (select is_active from public.products where id=p),'global product disabled';
 assert exists(select 1 from public.zone_products where zone_id=other_zone and product_id=p),'other store changed';
 denied:=false;begin perform public.app_operation(other_store,'count.field-remove',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'cross store removal';
 denied:=false;begin perform public.save_pilot_count_drafts_v2(cs,gen_random_uuid(),jsonb_build_array(jsonb_build_object('zone_id',z,'product_id',p,'quantity',3,'expected_updated_at',oldstamp)));exception when insufficient_privilege then denied:=true;end;assert denied,'stale device resurrected removed item';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 data:=public.baihuayuan_inventory_month(store_id,month);
 assert (select r#>>'{zones,0,note}'='目前沒在使用' and (r->>'current_quantity')::numeric=0 from jsonb_array_elements(data->'rows')r where r->>'product_id'=p::text),'admin evidence missing';
 result:=public.app_operation(store_id,'count.field-restore',jsonb_build_object('product_id',p,'removed_at',removed_at),gen_random_uuid());
 assert (result->>'restored_in_current')::boolean,'not restored to current';
 assert (select jsonb_array_length(snapshot->'zones')=2 and jsonb_array_length(snapshot->'removed_zones')=0 from public.inventory_count_sessions where id=cs),'restore snapshot failed';
 assert (select quantity=0 and note='目前沒在使用' from public.count_drafts where session_id=cs and product_id=p),'restore evidence lost';
 data:=public.get_count_item_changes(store_id,null);
 assert exists(select 1 from jsonb_array_elements(data)x where x->>'action'='恢復使用' and x->>'product_id'=p::text),'restoration history missing';
 assert exists(select 1 from jsonb_array_elements(data)x where x->>'action'='移出盤點' and x->>'product_id'=p::text),'removal history lost after restoration';
 assert not exists(select 1 from jsonb_array_elements(data)x where x->>'product_name' is null or x->>'actor_name' is null),'history labels missing';
 -- A delayed retry cannot remove an item again after restoration.
 perform set_config('request.jwt.claim.sub',viewer::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',viewer,'role','authenticated')::text,true);
 perform public.app_operation(store_id,'count.field-remove',payload,req);
 assert not exists(select 1 from private.count_field_removed where count_field_removed.store_id=store_id and product_id=p),'old remove retry re-removes';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 result:=public.app_operation(store_id,'count.field-remove',payload,gen_random_uuid());removed_at:=result->>'removed_at';
 -- Blank and nonzero items cannot be hidden.
 denied:=false;begin perform public.app_operation(store_id,'count.field-remove',jsonb_build_object('session_id',cs,'product_id',p2,'versions','{}'::jsonb),gen_random_uuid());exception when others then denied:=sqlerrm='COUNT_FIELD_ZERO_REQUIRED';end;assert denied,'blank removed';
 result:=public.save_pilot_count_drafts_v2(cs,gen_random_uuid(),jsonb_build_array(jsonb_build_object('zone_id',z,'product_id',p2,'quantity',2,'expected_updated_at',null)));
 denied:=false;begin perform public.app_operation(store_id,'count.field-remove',jsonb_build_object('session_id',cs,'product_id',p2,'versions',jsonb_build_object(z,result->0->>'updated_at')),gen_random_uuid());exception when others then denied:=sqlerrm='COUNT_FIELD_ZERO_REQUIRED';end;assert denied,'nonzero removed';
 -- Removing the last visible card must not strand an empty zone.
 begin
  select updated_at into stamp from public.count_drafts where session_id=cs and product_id=p2;
  result:=public.save_pilot_count_drafts_v2(cs,gen_random_uuid(),jsonb_build_array(jsonb_build_object('zone_id',z,'product_id',p2,'quantity',0,'expected_updated_at',stamp)));
  perform public.app_operation(store_id,'count.field-remove',jsonb_build_object('session_id',cs,'product_id',p2,'versions',jsonb_build_object(z,result->0->>'updated_at')),gen_random_uuid());
  perform public.complete_pilot_count_zone(cs,z);
  assert (select status='REVIEWING' from public.inventory_count_sessions where id=cs),'all-removed completion stalled';
  perform private.assert_count_ready_for_close(cs);
  raise exception 'rollback all-removed scenario' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null;
 end;
 perform public.complete_pilot_count_zone(cs,z);
 assert (select status='REVIEWING' from public.inventory_count_sessions where id=cs),'completion stalled';
 assert (select quantity=0 and note='目前沒在使用' from public.count_entries where session_id=cs and product_id=p),'completed evidence lost';
 assert (select snapshot=before_snapshot from public.inventory_count_sessions where id=oldcs),'old history rewritten';
 -- Next count must omit the item; restoration adds it without inventing a quantity.
 perform public.start_pilot_count(store_id,null);
 select id into cs from public.inventory_count_sessions where inventory_count_sessions.store_id=store_id and status='IN_PROGRESS';
 assert (select not exists(select 1 from jsonb_array_elements(snapshot->'zones')x where x->>'product_id'=p::text) from public.inventory_count_sessions where id=cs),'next count includes removed';
 result:=public.app_operation(store_id,'count.field-restore',jsonb_build_object('product_id',p,'removed_at',removed_at),gen_random_uuid());
 assert (result->>'restored_in_current')::boolean,'later restoration missing';
 assert not exists(select 1 from public.count_drafts where session_id=cs and product_id=p),'restoration invented quantity';
 perform set_config('request.jwt.claim.sub',staff::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 denied:=false;begin perform public.get_count_item_changes(store_id,null);exception when insufficient_privilege then denied:=true;end;assert denied,'outsider change history';
 denied:=false;begin perform public.get_count_field_removed(store_id);exception when insufficient_privilege then denied:=true;end;assert denied,'outsider list';
 denied:=false;begin perform public.app_operation(store_id,'count.field-remove',payload,req);exception when insufficient_privilege then denied:=true;end;assert denied,'outsider cached removal';
end $$;
rollback;
select 'PASS: durable field change history, admin visibility after restore, role denial and count lifecycle preserved' as result;
