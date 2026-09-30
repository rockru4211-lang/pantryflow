begin;
do $$
#variable_conflict use_variable
declare actor uuid:=gen_random_uuid();viewer uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();org uuid;store_id uuid;data jsonb;z uuid;p uuid;p2 uuid;cs uuid;oldcs uuid;month date:=date_trunc('month',now() at time zone 'Asia/Taipei')::date;stamp timestamptz;oldstamp timestamptz;payload jsonb;result jsonb;req uuid:=gen_random_uuid();denied boolean;before_snapshot jsonb; removed_at text; other_store uuid; move_id uuid; catalog jsonb; other_zone uuid; rev text;
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


 update public.organizations set store_mode='MULTI' where id=org;
 insert into public.stores(organization_id,name,created_by,store_code) values(org,'Gras',actor,'QAT'||substr(gen_random_uuid()::text,1,8)) returning id into other_store;
 insert into public.count_zones(organization_id,store_id,name) values(org,store_id,'食材') returning id into z;
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'牛肋條','公斤','公斤') returning id into p;
 insert into public.zone_products(zone_id,product_id,count_unit) values(z,p,'公斤');
 insert into public.organization_members(organization_id,user_id,role) values(org,staff,'STAFF');
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,staff,'測試現場',actor);
 insert into public.store_memberships(store_id,organization_id,user_id,role,login_identifier,assigned_by) values(store_id,org,staff,'STAFF','qa',actor);
 perform set_config('request.jwt.claim.sub',staff::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 payload:=jsonb_build_object('to_store_id',other_store,'product_id',p,'quantity',2,'note','測試');
 result:=public.app_operation(store_id,'movement.transfer-create',payload,req);
 assert result->>'unit'='公斤' and result->>'review_status'='PENDING','selected product failed';
 assert public.app_operation(store_id,'movement.transfer-create',payload,req)=result,'retry duplicated';
 payload:=jsonb_build_object('to_store_id',other_store,'manual',true,'name','臨時食材','unit','包','quantity',3,'note','活動支援');
 req:=gen_random_uuid();result:=public.app_operation(store_id,'movement.transfer-create',payload,req);move_id:=(result->>'id')::uuid;
 assert result->>'product_id' is null and result->>'name'='臨時食材' and result->>'unit'='包','manual data lost';
 assert result->>'review_status'='PENDING' and result->>'note'='活動支援','manual review failed';
 assert public.app_operation(store_id,'movement.transfer-create',payload,req)=result,'manual retry duplicated';
 assert not exists(select 1 from public.products where organization_id=org and name='臨時食材'),'manual created catalog';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 catalog:=public.app_workspace(store_id,'transfers','{}');
 assert exists(select 1 from jsonb_array_elements(catalog->'records')r where r->>'id'=move_id::text),'admin missing manual';
 result:=public.app_operation(store_id,'movement.transfer-confirm',jsonb_build_object('id',move_id,'revision',1,'quantity',3,'unit','包','unit_price',25),gen_random_uuid());
 assert (select review_status='CONFIRMED' and amount_snapshot=75 from private.store_movements where id=move_id),'manual confirmation failed';
 insert into private.count_field_removed(store_id,product_id,removed_by) values(store_id,p,actor);
 catalog:=public.app_workspace(store_id,'transfers','{}');
 assert exists(select 1 from jsonb_array_elements(catalog->'products')r where r->>'id'=p::text and r->>'available_for_transfer'='false'),'removed not excluded';
 denied:=false;begin perform public.app_operation(store_id,'movement.transfer-create',jsonb_build_object('to_store_id',other_store,'product_id',p,'quantity',1),gen_random_uuid());exception when others then denied:=sqlerrm='INVALID_PRODUCT';end;assert denied,'removed selection accepted';
 denied:=false;begin perform public.app_operation(store_id,'movement.transfer-create',payload||'{"name":""}',gen_random_uuid());exception when others then denied:=sqlerrm='INVALID_PRODUCT';end;assert denied,'blank manual accepted';
 perform set_config('request.jwt.claim.sub',viewer::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',viewer,'role','authenticated')::text,true);
 denied:=false;begin perform public.app_operation(store_id,'movement.transfer-create',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'outsider accepted';
end $$;
rollback;
