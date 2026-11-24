begin;
do $test$
declare u uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();org uuid:=gen_random_uuid();s uuid:=gen_random_uuid();t uuid:=gen_random_uuid();a uuid; b uuid; c uuid;vendor uuid:=gen_random_uuid();r jsonb;before_rows jsonb;payload jsonb;req uuid:=gen_random_uuid();ac text;bc text;name_req uuid:=gen_random_uuid();name_result jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select id,id||'@shared-test.invalid',now(),now(),now() from unnest(array[u,outsider]) id;
 insert into public.profiles(id,display_name) select id,'共用品項回滾測試' from unnest(array[u,outsider]) id on conflict do nothing;
 insert into public.organizations(id,name,business_type) values(org,'共用品項回滾測試','SINGLE_RESTAURANT');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(s,org,'BeApe','SC'||substr(s::text,1,8),u),(t,org,'Gras','SC'||substr(t::text,1,8),u);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,u,'OWNER',true,true);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,u,'共用測試',u);
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(s,org,u,'shared-owner-a','OWNER','OWNER',u,true),(t,org,u,'shared-owner-b','OWNER','OWNER',u,true);
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.suppliers(id,organization_id,name) values(vendor,org,'測試供應商');
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,updated_by) values(s,'AL洗潔精','桶',45,true,u) returning id,ingredient_code into a,ac;
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,updated_by) values(t,'Ａ.L洗潔精4桶','桶',50,true,u) returning id,ingredient_code into b,bc;
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,updated_by) values(t,'AL洗潔精箱','箱',45,true,u) returning id into c;
 insert into private.receipt_ingredient_bindings(store_id,supplier,name,unit,specification,ingredient_id,updated_by) values(s,'測試供應商','al原貨單','桶','',a,u);
 select jsonb_agg(to_jsonb(m) order by id) into before_rows from private.ingredient_masters m where store_id in(s,t);
 payload:=jsonb_build_object('id',b,'expected_code',bc,'target_id',a,'target_code',ac);
 r:=public.baihuayuan_code_management(t,'link',payload,req);
 assert r=public.baihuayuan_code_management(t,'link',payload,req),'link retry must be idempotent';
 assert private.shared_ingredient_name(b)='AL洗潔精','shared display name';
 assert private.managed_ingredient_code(b)=ac,'shared code';
 assert (select jsonb_agg(to_jsonb(m) order by id) from private.ingredient_masters m where store_id in(s,t))=before_rows,'link cannot mutate names, codes, prices, IDs or history';
 r:=private.ingredient_usage_rows(t,jsonb_build_array(jsonb_build_object('id',b,'name','Ａ.L洗潔精4桶','cost_price',50)));
 assert r->0->>'name'='AL洗潔精' and r->0->>'original_name'='Ａ.L洗潔精4桶' and r->0->>'cost_price'='50','name overlay retains original and local price';
 r:=public.baihuayuan_ingredient_prices(t,'read');
 assert (select value->>'name'='AL洗潔精' and value->>'shared_name'='AL洗潔精' from jsonb_array_elements(r->'ingredients') where value->>'id'=b::text),'price sheet returns common name';
 insert into private.reviewed_ingredient_items(
  organization_id,review_code,formal_name,receipt_name,supplier_name,unit,specification,category,status,reason,
  ingredient_id,source_names,latest_date,imported_at
 ) values(org,'P0001','核對後的洗潔精','al原貨單','測試供應商','桶','','耗材','MATCHED','',a,
  array['al原貨單','al別名','al別名'],current_date,now()-interval '1 day');
 r:=private.ingredient_usage_rows(t,jsonb_build_array(
  jsonb_build_object('id',b,'name','Ａ.L洗潔精4桶','cost_price',50),
  jsonb_build_object('id',a,'name','其他門市')));
 assert r->0->>'name'='核對後的洗潔精' and r->0->>'reviewed_name'='核對後的洗潔精'
  and r->0->'reviewed_aliases' @> '["al原貨單","al別名"]'::jsonb
  and jsonb_array_length(r->0->'reviewed_aliases')=2
  and r->0->>'cost_price'='50','reviewed names and aliases use the shared root and retain local prices';
 assert r->1->>'name'='其他門市' and r->1->'reviewed_aliases'='[]'::jsonb,'catalog lookup stays scoped to its store';
 insert into private.ingredient_usage_names(ingredient_id,store_id,formal_name,updated_by)
  values(a,s,'較新的正式品名',u);
 r:=private.ingredient_usage_rows(t,jsonb_build_array(jsonb_build_object('id',b,'name','Ａ.L洗潔精4桶')));
 assert r->0->>'name'='較新的正式品名' and r->0->>'reviewed_name' is null,'newer manual name takes precedence';
 delete from private.ingredient_usage_names where ingredient_id=a;
 delete from private.reviewed_ingredient_items where organization_id=org;
 r:=public.baihuayuan_code_management(t);
 assert (select value->>'name'='AL洗潔精' from jsonb_array_elements(r->'rows') where value->>'id'=b::text),'code directory returns common name';
 assert (select ingredient_id=b from private.shared_receipt_bindings(t) where name='al原貨單'),'approved peer alias maps to LOCAL identity';
 assert private.receipt_entry_ingredient(t,org,gen_random_uuid(),'{"product_name":"al原貨單","unit":"桶"}','測試供應商',vendor,'')=b,'receipt resolves confirmed shared alias without new master';
 r:=public.get_baihuayuan_ingredient_matching(t);
 assert exists(select 1 from jsonb_array_elements(r->'bindings') x where x->>'ingredient_id'=b::text and x->>'name'='al原貨單'),'receipt UI receives local binding';
 begin perform public.baihuayuan_code_management(t,'link',jsonb_build_object('id',c,'expected_code',private.managed_ingredient_code(c),'target_id',a,'target_code',ac),gen_random_uuid());raise exception 'box/bucket accepted';exception when sqlstate '22023' then null;end;
 insert into private.ingredient_supply_state(store_id,ingredient_id,supplier_key,supplier_name,stopped,reason,disposition,note,updated_by)
 values(s,a,'*','',true,'其他','暫停使用','隔離測試',u);
 assert not exists(select 1 from private.shared_receipt_bindings(t)),'peer stop only disables inherited aliases';
 assert private.receipt_entry_ingredient(t,org,gen_random_uuid(),jsonb_build_object('product_name','AL洗潔精','unit','桶','ingredient_id',b),'測試供應商',vendor,'')=b,'peer stop cannot block explicit local ingredient';
 delete from private.ingredient_supply_state where store_id=s and ingredient_id=a;
 insert into private.ingredient_supply_state(store_id,ingredient_id,supplier_key,supplier_name,stopped,reason,disposition,note,updated_by)
 values(t,b,'*','',true,'其他','暫停使用','隔離測試',u);
 assert (select stopped from private.shared_receipt_bindings(t) limit 1),'local stop remains enforced';
 assert private.receipt_entry_ingredient(t,org,gen_random_uuid(),'{"product_name":"al原貨單","unit":"桶"}','測試供應商',vendor,'') is null,'local stopped alias cannot create or link';
 delete from private.ingredient_supply_state where store_id=t and ingredient_id=b;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin perform public.baihuayuan_code_management(t);raise exception 'outsider allowed';exception when insufficient_privilege then null;end;
 begin perform public.baihuayuan_shared_ingredient_name(t,b,'不得寫入',0,gen_random_uuid());raise exception 'outsider shared rename allowed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.get_baihuayuan_ingredient_matching(t);raise exception 'anonymous allowed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',u::text,true);
 update public.store_memberships set access_mode='VIEW' where store_id=s and user_id=u;
 assert private.recipe_allowed(t,true) and private.recipe_allowed(s) and not private.recipe_allowed(s,true),'fixture root read-only';
 begin perform public.baihuayuan_shared_ingredient_name(t,b,'不得跨店寫入',0,gen_random_uuid());raise exception 'read-only root modified';exception when insufficient_privilege then null;end;
 update public.store_memberships set is_active=false where store_id=s and user_id=u;
 assert private.recipe_allowed(t,true) and not private.recipe_allowed(s),'fixture single-store access';
 begin perform public.baihuayuan_shared_ingredient_name(t,b);raise exception 'unreadable root exposed';exception when insufficient_privilege then null;end;
 assert not exists(select 1 from private.shared_receipt_bindings(t)),'inaccessible peer aliases not exposed';
 update public.store_memberships set is_active=true,access_mode='EDIT' where store_id=s and user_id=u;
 insert into private.ingredient_usage_names(ingredient_id,store_id,formal_name,count_name,recipe_aliases,updated_by)
 values(a,s,'AL洗潔精','本店盤點名','["廚師名"]',u),(b,t,'分店原名稱','分店盤點名','["分店別名"]',u);
 name_result:=public.baihuayuan_shared_ingredient_name(t,b,'AL統一洗潔精',1,name_req);
 assert name_result=public.baihuayuan_shared_ingredient_name(t,b,'AL統一洗潔精',1,name_req),'shared rename retry idempotent';
 assert private.shared_ingredient_name(b)='AL統一洗潔精','rename common name';
 assert (select count_name='本店盤點名' and recipe_aliases='["廚師名"]'::jsonb from private.ingredient_usage_names where ingredient_id=a),'root local metadata unchanged';
 assert (select formal_name='分店原名稱' and count_name='分店盤點名' and recipe_aliases='["分店別名"]'::jsonb from private.ingredient_usage_names where ingredient_id=b),'source store metadata unchanged';
 assert (select count(*)=1 from private.receipt_ingredient_bindings where store_id in(s,t)),'supplier bindings untouched';
 delete from private.ingredient_usage_names where ingredient_id in(a,b);
 perform public.baihuayuan_code_management(t,'unlink',jsonb_build_object('id',b,'expected_code',ac),gen_random_uuid());
 assert private.shared_ingredient_name(b)='Ａ.L洗潔精4桶' and private.managed_ingredient_code(b)=bc,'unlink restores old name and code';
 assert not exists(select 1 from private.shared_receipt_bindings(t)),'unlink removes inherited aliases';
 assert (select jsonb_agg(to_jsonb(m) order by id) from private.ingredient_masters m where store_id in(s,t))=before_rows,'all original records preserved';
 assert not has_function_privilege('authenticated','private.shared_receipt_bindings(uuid)','EXECUTE'),'private helper not exposed';
end $test$;
rollback;
