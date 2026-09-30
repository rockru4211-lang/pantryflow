-- Entire fixture runs inside BEGIN/ROLLBACK. No restaurant records are edited.
do $test$
declare actor uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();viewer uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 org uuid;shop uuid;zone uuid;other uuid;product uuid;cs uuid;data jsonb;before_entries jsonb;other_before jsonb;payload jsonb;
 stamp timestamptz;stamp2 timestamptz;version timestamptz;eid uuid;denied boolean;who uuid;token text;result jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@spot-current.invalid',now() from unnest(array[actor,outsider,staff,viewer]) id;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','抽盤品項隔離測試','business_type','SINGLE_RESTAURANT','store_mode','SINGLE'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','抽盤測試店','store_code','QASPOT'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);
 org:=(data->>'organization_id')::uuid;shop:=(data->>'store_id')::uuid;
 insert into public.organization_members(organization_id,user_id,role,work_role,can_manage_business) values(org,staff,'SUPERVISOR','SUPERVISOR',false),(org,viewer,'LOGISTICS','LOGISTICS',false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,staff,'主管',actor),(org,viewer,'查看者',actor);
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,access_mode) values(shop,org,staff,'qa-supervisor','SUPERVISOR','SUPERVISOR',actor,'EDIT'),(shop,org,viewer,'qa-viewer','LOGISTICS','LOGISTICS',actor,'VIEW');
 insert into public.count_zones(organization_id,store_id,name) values(org,shop,'酒類') returning id into zone;
 insert into public.count_zones(organization_id,store_id,name) values(org,shop,'其他區') returning id into other;
 insert into public.products(organization_id,product_code,name,category,base_unit,count_unit) values(org,'QA-'||gen_random_uuid()::text,'紅酒','酒水','瓶','瓶') returning id into product;
 insert into public.zone_products(zone_id,product_id,count_unit) values(zone,product,'瓶'),(other,product,'瓶');
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot)
 values(org,shop,actor,'IN_PROGRESS',jsonb_build_object('zones',jsonb_build_array(jsonb_build_object('zone_id',zone,'zone_name','酒類','product_id',product,'product_name','紅酒','unit','瓶'),jsonb_build_object('zone_id',other,'zone_name','其他區','product_id',product,'product_name','紅酒','unit','瓶')),'opening_captured',true)) returning id into cs;
 insert into public.count_zone_progress(organization_id,session_id,zone_id) values(org,cs,zone),(org,cs,other);
 insert into public.count_drafts(organization_id,session_id,zone_id,product_id,quantity,unit,note,entered_by) values(org,cs,zone,product,0,'瓶','原備註',actor),(org,cs,other,product,7,'瓶','其他區保留',actor);
 perform public.complete_pilot_count_zone(cs,zone);
 select completed_at into stamp from public.count_zone_progress where session_id=cs and zone_id=zone;
 select jsonb_agg(to_jsonb(e) order by id) into before_entries from public.count_entries e where session_id=cs;
 select to_jsonb(d) into other_before from public.count_drafts d where session_id=cs and zone_id=other;
 select id into eid from public.count_entries where session_id=cs and zone_id=zone;
 token:=public.get_count_store_revision(shop);
 foreach who in array array[viewer,outsider] loop
  perform set_config('request.jwt.claim.sub',who::text,true);
  denied:=false;begin perform public.reopen_pilot_count_zone(cs,zone,stamp);exception when insufficient_privilege then denied:=true;end;assert denied,'unauthorized reopen';
 end loop;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 perform public.reopen_pilot_count_zone(cs,zone,stamp);
 assert token<>public.get_count_store_revision(shop),'reopen did not change sync token';
 assert (select quantity=0 and note='原備註' and entered_by=actor from public.count_drafts where session_id=cs and zone_id=zone),'original input not restored';
 assert (select to_jsonb(d) from public.count_drafts d where session_id=cs and zone_id=other)=other_before,'other zone changed';
 assert (select jsonb_agg(to_jsonb(e) order by id) from public.count_entries e where session_id=cs)=before_entries,'immutable originals changed';
 assert not exists(select 1 from private.current_count_entries where session_id=cs and zone_id=zone),'superseded entries still counted';
 select updated_at into version from public.count_drafts where session_id=cs and zone_id=zone;
 perform public.save_pilot_count_drafts_v2(cs,gen_random_uuid(),jsonb_build_array(jsonb_build_object('zone_id',zone,'product_id',product,'quantity',0.8,'note','修改備註','expected_updated_at',version)));
 perform public.reopen_pilot_count_zone(cs,zone,stamp);
 assert (select quantity=0.8 and note='修改備註' from public.count_drafts where session_id=cs and zone_id=zone),'retry overwrote newer draft';
 assert (select count(*) from private.count_zone_revisions where session_id=cs)=1,'retry created another revision';
 assert (select sum((r->>'quantity')::numeric) from jsonb_array_elements(private.inventory_month_source(cs)) r)=7.8,'admin current view used old values';
 perform public.complete_pilot_count_zone(cs,zone);
 assert (select sum(quantity) from private.current_count_entries where session_id=cs)=0.8,'completion double counted';
 assert (select count(*) from public.count_entries where session_id=cs)=2,'original entry not retained';
 result:=public.get_pilot_count_results(cs);
 assert jsonb_array_length(result)=1 and (result->0->>'quantity')::numeric=0.8,'field results still show old revision';
 perform public.reopen_pilot_count_zone(cs,zone,stamp);
 assert (select status='COMPLETED' from public.count_zone_progress where session_id=cs and zone_id=zone),'old reopen replay reopened new completion';
 select completed_at into stamp2 from public.count_zone_progress where session_id=cs and zone_id=zone;
 -- clock_timestamp is required: repeated completions in one transaction must be distinguishable.
 assert stamp2 is distinct from stamp,'completion generation timestamp reused';
 perform public.reopen_pilot_count_zone(cs,zone,stamp2);
 assert (select quantity=0.8 and note='修改備註' from public.count_drafts where session_id=cs and zone_id=zone),'second reopen failed';
 perform public.complete_pilot_count_zone(cs,zone);
 perform public.complete_pilot_count_zone(cs,other);
 assert (select status='REVIEWING' from public.inventory_count_sessions where id=cs),'final submission did not review';
 assert (select sum(quantity) from private.current_count_entries where session_id=cs)=7.8,'final totals include old counts';
 assert (select sum((r->>'quantity')::numeric) from jsonb_array_elements(private.inventory_month_source(cs)) r)=7.8,'admin final totals differ';
 assert (private.stock_snapshot(shop,product,'瓶')->>'total')::numeric=7.8,'stock snapshot includes superseded entries';
 assert (select to_jsonb(e) from public.count_entries e where id=eid)=before_entries->0,'original entry changed after all completions';
 foreach who in array array[viewer,outsider] loop
  perform set_config('request.jwt.claim.sub',who::text,true);
  denied:=false;begin perform public.reopen_pilot_count_zone(cs,zone,stamp);exception when insufficient_privilege then denied:=true;end;assert denied,'unauthorized replay';
 end loop;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 select completed_at into stamp2 from public.count_zone_progress where session_id=cs and zone_id=zone;
 denied:=false;begin perform public.reopen_pilot_count_zone(cs,zone,stamp2);exception when invalid_parameter_value then denied:=true;end;assert denied,'submitted session reopened';
 assert not has_function_privilege('anon','public.reopen_pilot_count_zone(uuid,uuid,timestamptz)','EXECUTE'),'anonymous RPC exposed';
 assert not has_table_privilege('authenticated','private.count_superseded_entries','INSERT'),'client can supersede arbitrary entries';
end $test$;
