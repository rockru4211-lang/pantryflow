begin;
do $$
declare owner_id uuid; person uuid; org uuid; sid uuid; pid uuid; foreign_pid uuid; req uuid; vrev int;
 data jsonb; payload jsonb; result jsonb; saved jsonb; rawrow jsonb; enriched jsonb; fingerprint text; closure_fingerprint text; mode text; r text; denied boolean; sample record;
begin
 select md5(coalesce(string_agg(to_jsonb(d)::text,'' order by d.id),'')) into fingerprint from public.receipt_documents d;
 select md5(coalesce(string_agg(c.payload::text,'' order by c.store_id,c.month),'')) into closure_fingerprint from private.inventory_month_closures c;
 assert not has_table_privilege('authenticated','private.product_categories','select,insert,update,delete'),'override table exposed';
 assert not has_function_privilege('authenticated','private.save_product_category(uuid,jsonb)','execute'),'private mutation exposed';
 assert (select relrowsecurity from pg_class where oid='private.product_categories'::regclass),'category RLS missing';
 for sample in select * from (values ('1/2核桃','食材'),('雞腿','食材'),('奶油','食材'),('保鮮膜','耗材'),('205cc飲料杯','耗材'),('咖啡桶蓋','耗材'),('75%酒精消毒液','耗材'),('紅酒醋','調料'),('料理酒','調料'),('沙拉油','調料'),('咖啡豆','酒水'),('氣泡水','酒水'),('啤酒','酒水'),('紅酒','待分類'),('白葡萄酒','待分類'),('葡萄酒醋','調料'),('130oz炸雞腿蓋(綠)','耗材'),('紅茶蛋糕','食材'),('供應商品項A','待分類')) x(name,category) loop
  assert private.classify_product(sample.name,'其他')=sample.category,format('classification: %s',sample.name);
 end loop;
 foreach mode in array array['SINGLE_RESTAURANT','SINGLE_RESTAURANT','CHAIN_RESTAURANT'] loop
  owner_id:=gen_random_uuid();insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values(owner_id,owner_id||'@category-fixture.invalid',now(),now(),now());
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  data:=public.owner_setup();data:=public.owner_setup('business',jsonb_build_object('organization_name','Category QA','business_type',mode,'store_mode','SINGLE'),0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code','QA'||substr(replace(gen_random_uuid()::text,'-',''),1,14),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
  data:=public.owner_setup('complete','{}',(data->>'revision')::int);org:=(data->>'organization_id')::uuid;sid:=(data->>'store_id')::uuid;
  insert into public.products(organization_id,product_code,name,base_unit,count_unit,category) values(org,'QA-CATEGORY','核桃','包','包','其他') returning id into pid;
  vrev:=0;
  foreach r in array array['OWNER','LOGISTICS','SUPERVISOR','STAFF'] loop
   if r='OWNER' then person:=owner_id;else
    person:=gen_random_uuid();insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values(person,person||'@category-fixture.invalid',now(),now(),now());
    update public.profiles set organization_id=org,role=r::public.app_role where id=person;
    insert into public.organization_members(organization_id,user_id,role) values(org,person,r::public.app_role);
    insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,person,'Category QA '||r,owner_id);
    insert into public.store_memberships(store_id,organization_id,user_id,role,work_role,login_identifier,assigned_by) values(sid,org,person,r::public.app_role,r::public.app_role,lower(r),owner_id);
   end if;
   perform set_config('request.jwt.claim.sub',person::text,true);req:=gen_random_uuid();payload:=jsonb_build_object('id',pid,'category','調料','revision',vrev);
   if mode='CHAIN_RESTAURANT' or r in ('STAFF','SUPERVISOR') then
    denied:=false;begin perform public.app_operation(sid,'product.category',payload,req);exception when insufficient_privilege then denied:=true;end;assert denied,'unauthorized category write';continue;
   end if;
   result:=public.app_operation(sid,'product.category',payload,req);vrev:=(result->>'category_revision')::integer;
   assert public.app_operation(sid,'product.category',payload,req)=result,'retry changed result';
   assert (select count(*) from private.app_requests where store_id=sid and request_id=req)=1,'retry duplicated';
   select x into saved from jsonb_array_elements(public.app_workspace(sid,'catalog')->'products') x where x->>'id'=pid::text;
   assert saved->>'primary_category'='調料' and (saved->>'category_revision')::int=vrev,'catalog category stale';
   assert saved->>'category'='其他','original import category mutated';
   denied:=false;begin perform public.app_operation(sid,'product.category',payload,gen_random_uuid());exception when serialization_failure then denied:=true;end;assert denied,'stale overwrite accepted';
   denied:=false;begin perform public.app_operation(sid,'product.category',payload||jsonb_build_object('revision',vrev,'category','酒類'),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'invalid category accepted';
   rawrow:=jsonb_build_object('product_id',pid,'category','其他','current_quantity',0,'previous_quantity',2,'amount',0,'previous_amount',20,'source_signature','unchanged','acknowledged',true);
   enriched:=private.inventory_category_rows(jsonb_build_object('rows',jsonb_build_array(rawrow),'closed',true,'revision','same'),sid);
   assert enriched#>>'{rows,0,category}'='調料','inventory category differs';
   assert (enriched#>'{rows,0}')-'category'-'category_revision'-'original_category'=rawrow-'category','inventory values rewritten';
   assert enriched->>'revision'='same' and (enriched->>'closed')::boolean,'closure state changed';
   perform public.baihuayuan_inventory_month(sid,'2026-09-01','read','{}');
   if r='OWNER' then
    result:=public.app_operation(sid,'product.save',jsonb_build_object('id',pid,'name','核桃','unit','包','category','其他','updated_at',saved->>'updated_at','primary_category','食材','category_revision',vrev),gen_random_uuid());
    vrev:=vrev+1;assert (select category from private.product_categories where product_id=pid)='食材','catalog form not atomic';
   end if;
   if r='LOGISTICS' then
    update public.store_memberships set role='STAFF',work_role='STAFF' where store_id=sid and user_id=person;
    denied:=false;begin perform public.app_operation(sid,'product.category',payload,req);exception when insufficient_privilege then denied:=true;end;assert denied,'downgraded role replay allowed';
   end if;
  end loop;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  if foreign_pid is not null and mode='SINGLE_RESTAURANT' then
   denied:=false;begin perform public.app_operation(sid,'product.category',jsonb_build_object('id',foreign_pid,'category','酒水','revision',0),gen_random_uuid());exception when no_data_found then denied:=true;end;assert denied,'foreign product write allowed';
  end if;
  foreign_pid:=pid;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 denied:=false;begin perform public.app_operation(sid,'product.category',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'anonymous write allowed';
 assert fingerprint=(select md5(coalesce(string_agg(to_jsonb(d)::text,'' order by d.id),'')) from public.receipt_documents d),'original receipts changed';
 assert closure_fingerprint=(select md5(coalesce(string_agg(c.payload::text,'' order by c.store_id,c.month),'')) from private.inventory_month_closures c),'closed inventory changed';
end $$;
rollback;
