-- Run against an isolated migrated database. Everything is rolled back.
begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid(); a_actor uuid:=gen_random_uuid(); b_actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid(); foreign_org uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); foreign_b uuid:=gen_random_uuid();
 za uuid:=gen_random_uuid(); zb uuid:=gen_random_uuid(); pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid();
 payload jsonb; result jsonb; ws jsonb; req uuid; move_id uuid; recorder uuid; actor uuid; source uuid; destination uuid; product uuid;
 before_receipts bigint; before_stock jsonb; direction_index integer;
begin
 select count(*) into before_receipts from public.receipt_lines;
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
 select id,id||'@transfer-directions.invalid',now(),now(),now() from unnest(array[owner_id,a_actor,b_actor,outsider]) id;
 insert into public.profiles(id,display_name)
 select id,'調撥回滾測試' from unnest(array[owner_id,a_actor,b_actor,outsider]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type,store_mode)
 values(org,'調撥方向回滾測試','SINGLE_RESTAURANT','MULTI'),(foreign_org,'跨組織拒絕測試','SINGLE_RESTAURANT','MULTI');
 insert into public.stores(id,organization_id,name,store_code,created_by)
 values(a,org,'BeApe','TD'||substr(a::text,1,8),owner_id),(b,org,'Gras','TD'||substr(b::text,1,8),owner_id),
 (foreign_b,foreign_org,'Gras','TD'||substr(foreign_b::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
 values(org,owner_id,'OWNER',true,true),(org,a_actor,'STAFF',false,false),(org,b_actor,'SUPERVISOR',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by)
 select org,id,'調撥回滾測試',owner_id from unnest(array[owner_id,a_actor,b_actor]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
 values(a,org,owner_id,'td-owner','OWNER','OWNER',owner_id,true),
 (a,org,a_actor,'td-a','STAFF','STAFF',owner_id,false),(b,org,b_actor,'td-b','SUPERVISOR','SUPERVISOR',owner_id,false);
 insert into public.count_zones(id,organization_id,store_id,name) values(za,org,a,'食材'),(zb,org,b,'食材');
 insert into public.products(id,organization_id,name,base_unit,count_unit)
 values(pa,org,'一店火腿','公斤','公斤'),(pb,org,'二店食材','盒','盒');
 insert into public.zone_products(zone_id,product_id,count_unit) values(za,pa,'公斤'),(zb,pb,'盒');
 select coalesce(jsonb_agg(to_jsonb(sp) order by to_jsonb(sp)::text),'[]') into before_stock from private.stock_positions sp where sp.store_id in (a,b);

 -- Each store can record either direction without membership of the other store.
 foreach recorder in array array[a,b] loop
  actor:=case when recorder=a then a_actor else b_actor end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  ws:=public.app_workspace(recorder,'transfers','{}');
  assert jsonb_array_length(ws->'transfer_catalogs')=2,'catalog must stay within the two same-organization stores';
  assert exists(select 1 from jsonb_array_elements(ws->'transfer_catalogs') c, jsonb_array_elements(c->'products') p
    where c->>'store_id'=a::text and p->>'id'=pa::text),'source-only product missing';
  assert not exists(select 1 from jsonb_array_elements(ws->'transfer_catalogs') c, jsonb_array_elements(c->'products') p
    where c->>'store_id'=b::text and p->>'id'=pa::text),'wrong store catalog';
  assert not exists(select 1 from jsonb_array_elements(ws->'transfer_catalogs') c, jsonb_array_elements(c->'products') p,
    jsonb_object_keys(p) k where k not in ('id','name','unit','available_for_transfer')),'catalog leaks unrelated metadata';
  for direction_index in 1..2 loop
   source:=case when direction_index=1 then a else b end;
   destination:=case when direction_index=1 then b else a end;
   product:=case when direction_index=1 then pa else pb end;
   req:=gen_random_uuid();
   payload:=jsonb_build_object('from_store_id',source,'to_store_id',destination,'product_id',product,'quantity',2,'note','方向測試');
   result:=public.app_operation(recorder,'movement.transfer-create',payload,req);
   move_id:=(result->>'id')::uuid;
   assert result->>'from_store_id'=source::text and result->>'to_store_id'=destination::text,'recording store overwrote direction';
   assert result->>'created_by'=actor::text and result->>'review_status'='PENDING','actor or review status changed';
   assert (result->>'stock_warning')::boolean,'low system stock must warn without blocking';
   assert public.app_operation(recorder,'movement.transfer-create',payload,req)=result,'retry created another transfer';
   assert (select count(*) from private.store_movement_events where movement_id=move_id)=1,'retry duplicated event';
   assert exists(select 1 from private.store_movement_events where movement_id=move_id and store_id=recorder and actor_id=actor),'recorder event changed';
   begin perform public.app_operation(recorder,'movement.transfer-create',payload||'{"quantity":3}',req);
    raise exception 'conflicting retry accepted';exception when unique_violation then null;end;
   assert exists(select 1 from jsonb_array_elements(public.app_workspace(recorder,'transfers','{}')->'records') r where r->>'id'=move_id::text),'record missing from recorder view';
  end loop;
 end loop;
 assert (select count(*) from private.store_movements where organization_id=org)=4,'more than one movement per successful request';
 assert private.app_role(a) is null,'incoming registration granted general source-store access';
 assert not exists(select 1 from public.store_memberships where store_id=a and user_id=b_actor),'source membership was created';

 perform set_config('request.jwt.claim.sub',a_actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a_actor,'role','authenticated')::text,true);
 assert exists(select 1 from jsonb_array_elements(public.app_workspace(a,'transfers','{}')->'records') r where r->>'id'=move_id::text),'other participant cannot see shared movement';
 result:=public.app_operation(a,'movement.transfer-create',jsonb_build_object('to_store_id',b,'product_id',pa,'quantity',1),gen_random_uuid());
 assert result->>'from_store_id'=a::text and result->>'to_store_id'=b::text,'legacy outbound changed';
 payload:=jsonb_build_object('from_store_id',a,'to_store_id',b,'product_id',pa,'quantity',1);
 begin perform public.app_operation(a,'movement.transfer-create',payload||'{"from_store_id":""}',gen_random_uuid());raise exception 'blank source accepted';exception when invalid_parameter_value then null;end;
 begin perform public.app_operation(a,'movement.transfer-create',payload||jsonb_build_object('to_store_id',a),gen_random_uuid());raise exception 'same store accepted';exception when invalid_parameter_value then null;end;
 begin perform public.app_operation(a,'movement.transfer-create',payload||jsonb_build_object('to_store_id',foreign_b),gen_random_uuid());raise exception 'foreign destination accepted';exception when invalid_parameter_value then null;end;
 begin perform public.app_operation(a,'movement.transfer-create',payload||jsonb_build_object('product_id',pb),gen_random_uuid());raise exception 'destination-only product accepted';exception when invalid_parameter_value then null;end;
 begin perform public.app_operation(a,'movement.transfer-create',payload||'{"quantity":0}',gen_random_uuid());raise exception 'zero quantity accepted';exception when invalid_parameter_value then null;end;
 begin perform public.app_operation(a,'movement.transfer-create',payload||'{"quantity":"NaN"}',gen_random_uuid());raise exception 'NaN quantity accepted';exception when invalid_parameter_value then null;end;

 -- Removal is checked against the source, not the receiving store.
 insert into private.count_field_removed(store_id,product_id,removed_by) values(b,pa,owner_id);
 perform set_config('request.jwt.claim.sub',b_actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b_actor,'role','authenticated')::text,true);
 result:=public.app_operation(b,'movement.transfer-create',payload,gen_random_uuid());
 assert result->>'product_id'=pa::text,'receiver removal blocked incoming source product';
 insert into private.count_field_removed(store_id,product_id,removed_by) values(a,pa,owner_id);
 begin perform public.app_operation(b,'movement.transfer-create',payload,gen_random_uuid());raise exception 'removed source product accepted';exception when invalid_parameter_value then null;end;
 ws:=public.app_workspace(b,'transfers','{}');
 assert not exists(select 1 from jsonb_array_elements(ws->'transfer_catalogs') c,jsonb_array_elements(c->'products') p where p->>'id'=pa::text),'removed source product offered';
 delete from private.count_field_removed where store_id=a and product_id=pa;
 update public.stores set is_active=false where id=a;
 begin perform public.app_operation(b,'movement.transfer-create',payload,gen_random_uuid());raise exception 'inactive source accepted';exception when invalid_parameter_value then null;end;
 update public.stores set is_active=true where id=a;

 payload:=jsonb_build_object('from_store_id',a,'to_store_id',b,'manual',true,'name','臨時食材','unit','卷','quantity',2,'note','現場補登');
 req:=gen_random_uuid();result:=public.app_operation(b,'movement.transfer-create',payload,req);move_id:=(result->>'id')::uuid;
 assert result->>'product_id' is null and result->>'unit'='卷' and result->>'note'='現場補登','manual incoming details lost';
 assert result->>'reference_price' is null and result->>'transfer_amount' is null,'field invented cost';
 assert public.app_operation(b,'movement.transfer-create',payload,req)=result,'manual retry duplicated';
 assert not exists(select 1 from public.products where organization_id=org and name='臨時食材'),'manual entry created catalog';
 begin perform public.app_operation(b,'movement.transfer-confirm',jsonb_build_object('id',move_id,'revision',1,'quantity',2,'unit_price',30),gen_random_uuid());raise exception 'supervisor confirmed costs';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 result:=public.app_operation(a,'movement.transfer-confirm',jsonb_build_object('id',move_id,'revision',1,'quantity',2,'unit','卷','unit_price',30),gen_random_uuid());
 assert result->>'id'=move_id::text and (result->>'transfer_amount')::numeric=60,'admin did not confirm same record';
 assert (select coalesce(jsonb_agg(to_jsonb(sp) order by to_jsonb(sp)::text),'[]') from private.stock_positions sp where sp.store_id in (a,b))=before_stock,'record-only flow changed stock';
 assert (select count(*) from public.receipt_lines)=before_receipts,'receipt data changed';
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 begin perform public.app_operation(b,'movement.transfer-create',payload,gen_random_uuid());raise exception 'outsider created transfer';exception when insufficient_privilege then null;end;
 begin perform public.app_workspace(b,'transfers','{}');raise exception 'outsider read catalogs';exception when insufficient_privilege then null;end;
end;
$test$;
rollback;
