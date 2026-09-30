-- Run in a transaction and roll back: no restaurant records are test fixtures.
do $test$
<<fixture>>
declare
 actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid();
 org uuid; shop uuid; zone uuid; product uuid; blank uuid; removed uuid; cs uuid; historical uuid;
 data jsonb; catalog jsonb; payload jsonb; result jsonb; saved jsonb; eid uuid; blankid uuid; checkid uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
 initial_sheet jsonb; initial_drafts jsonb; denied boolean;
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
 insert into public.count_zones(organization_id,store_id,name) values(org,shop,'測試區') returning id into zone;
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'零庫存','瓶','瓶') returning id into product;
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'未填數量','包','包') returning id into blank;
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'已移除','盒','盒') returning id into removed;
 insert into public.zone_products(zone_id,product_id,count_unit) values(zone,product,'瓶'),(zone,blank,'包'),(zone,removed,'盒');
 initial_sheet:=jsonb_build_object('zones',jsonb_build_array(jsonb_build_object('zone_id',zone,'zone_name','測試區','product_id',product,'product_name','零庫存','unit','瓶'),jsonb_build_object('zone_id',zone,'zone_name','測試區','product_id',blank,'product_name','未填數量','unit','包'),jsonb_build_object('zone_id',zone,'zone_name','測試區','product_id',removed,'product_name','已移除','unit','盒')));
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot) values(org,shop,actor,'IN_PROGRESS',initial_sheet) returning id into cs;
 insert into public.count_drafts(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by) values(org,cs,zone,product,0,'瓶',actor);
 insert into private.count_field_removed(store_id,product_id,removed_by) values(shop,removed,actor);
 select to_jsonb(s) into initial_sheet from public.inventory_count_sessions s where id=cs;
 select jsonb_agg(to_jsonb(d)) into initial_drafts from public.count_drafts d where session_id=cs;
 catalog:=public.baihuayuan_spot_check(shop,'catalog',jsonb_build_object('month',to_char(now() at time zone 'Asia/Taipei','YYYY-MM')));
 assert catalog->>'source_id'=cs::text,'current sheet not automatically selected';
 assert jsonb_array_length(catalog->'items')=2,'blank item missing or removed item leaked';
 assert not exists(select 1 from jsonb_array_elements(catalog->'items')i where i?'original_quantity'),'blind selection leaked quantity';
 select (i->>'entry_id')::uuid into eid from jsonb_array_elements(catalog->'items')i where i->>'product_id'=product::text;
 select (i->>'entry_id')::uuid into blankid from jsonb_array_elements(catalog->'items')i where i->>'product_id'=blank::text;
 payload:=jsonb_build_object('id',checkid,'request_id',req,'source_id',cs,'entries',jsonb_build_array(eid),'assignee_id',actor,'publish',true);
 result:=public.baihuayuan_spot_check(shop,'create',payload);
 result:=public.baihuayuan_spot_check(shop,'save_entries',jsonb_build_object('id',checkid,'request_id',gen_random_uuid(),'revision',1,'entries',jsonb_build_array(jsonb_build_object('entry_id',eid,'quantity',8))));
 select to_jsonb(i) into saved from private.spot_check_items i where check_id=checkid and entry_id=eid;
 payload:=jsonb_build_object('id',checkid,'request_id',gen_random_uuid(),'revision',2,'entries',jsonb_build_array(blankid));
 result:=public.baihuayuan_spot_check(shop,'add_items',payload);
 assert result->>'status'='OPEN' and result->>'revision'='3' and jsonb_array_length(result->'items')=2,'append did not retain current open check';
 assert (select to_jsonb(i) from private.spot_check_items i where check_id=checkid and entry_id=eid)=saved,'append changed prior input or baseline';
 assert (select quantity is null and original_quantity is null from private.spot_check_items where check_id=checkid and entry_id=blankid),'new row not blank';
 assert public.baihuayuan_spot_check(shop,'add_items',payload)=result,'retry duplicated appended items';
 assert (select count(*) from private.spot_check_events where check_id=checkid and action='add_items')=1,'retry duplicated event';
 denied:=false;begin perform public.baihuayuan_spot_check(shop,'add_items',payload||jsonb_build_object('request_id',gen_random_uuid()));exception when serialization_failure then denied:=true;end;assert denied,'stale revision accepted';
 denied:=false;begin perform public.baihuayuan_spot_check(shop,'add_items',payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',3));exception when serialization_failure then denied:=true;end;assert denied,'existing item accepted twice';
 denied:=false;begin perform public.baihuayuan_spot_check(shop,'add_items',payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',3,'entries',jsonb_build_array(gen_random_uuid())));exception when insufficient_privilege then denied:=true;end;assert denied,'foreign item accepted';
 assert (select to_jsonb(s) from public.inventory_count_sessions s where id=cs)=initial_sheet,'source sheet mutated';
 assert (select jsonb_agg(to_jsonb(d)) from public.count_drafts d where session_id=cs)=initial_drafts,'source drafts mutated';
 foreach req in array array[viewer,staff,outsider] loop
  perform set_config('request.jwt.claim.sub',req::text,true);
  denied:=false;begin perform public.baihuayuan_spot_check(shop,'add_items',payload);exception when insufficient_privilege then denied:=true;end;assert denied,'unauthorized append/retry accepted';
 end loop;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 result:=public.baihuayuan_spot_check(shop,'save_entries',jsonb_build_object('id',checkid,'request_id',gen_random_uuid(),'revision',3,'entries',jsonb_build_array(jsonb_build_object('entry_id',blankid,'quantity',5))));
 result:=public.baihuayuan_spot_check(shop,'submit',jsonb_build_object('id',checkid,'request_id',gen_random_uuid(),'revision',4));
 denied:=false;begin perform public.baihuayuan_spot_check(shop,'add_items',payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',5));exception when invalid_parameter_value then denied:=true;end;assert denied,'submitted check still editable';
end $test$;
