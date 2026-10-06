begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();chef uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();s uuid:=gen_random_uuid();other_s uuid:=gen_random_uuid();p uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();dish uuid:=gen_random_uuid();req uuid:=gen_random_uuid();
 doc jsonb;payload jsonb;result jsonb;retry jsonb;ws jsonb;before_count integer; mid uuid; rev integer; saved_hash text;
begin
 select count(*) into before_count from public.receipt_lines;
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select id,id||'@recipe-test.invalid',now(),now(),now() from unnest(array[owner_id,chef,staff,outsider]) id;
 insert into public.profiles(id,display_name) select id,'食譜回滾測試' from unnest(array[owner_id,chef,staff,outsider]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type) values(org,'食譜回滾測試','SINGLE_RESTAURANT');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(s,org,'食譜測試','RC'||substr(s::text,1,8),owner_id),(other_s,org,'另一店','RC'||substr(other_s::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,owner_id,'OWNER',true,true),(org,chef,'SUPERVISOR',false,false),(org,staff,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'食譜測試',owner_id from unnest(array[owner_id,chef,staff]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(s,org,owner_id,'rc-owner','OWNER','OWNER',owner_id,true),(s,org,chef,'rc-chef','SUPERVISOR','SUPERVISOR',owner_id,false),(s,org,staff,'rc-staff','STAFF','STAFF',owner_id,false);

 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 payload:=jsonb_build_object('name','包裝測試','unit','瓶','cost_price',180,'purchase',jsonb_build_object('amount',180,'quantity',1,'unit','瓶'));
 result:=public.app_operation(s,'ingredient.save',payload,req);mid:=(result->>'id')::uuid;
 assert result=public.app_operation(s,'ingredient.save',payload,req),'idempotent package save';
 ws:=public.app_workspace(s,'ingredients');
 assert (select value#>>'{purchase,unit}' from jsonb_array_elements(ws->'ingredients') where value->>'id'=mid::text)='瓶','purchase retained on reload';
 doc:=jsonb_build_object('name','半瓶食譜','kind','dish','yield','1','unit','份','lines',jsonb_build_array(jsonb_build_object('id','one','name','包裝測試','ingredient_id',mid,'quantity','0.5','unit','瓶')));
 assert (private.recipe_cost(s,doc)->>'total')::numeric=90,'half bottle without weight';
 result:=public.app_operation(s,'recipe.save',jsonb_build_object('id',rid,'revision',0,'document',doc),gen_random_uuid());
 select md5(to_jsonb(c)::text) into saved_hash from private.recipe_cards c where id=rid;
 doc:=jsonb_set(doc,'{lines,0,unit}','"g"');
 assert private.recipe_cost(s,doc)->>'total' is null,'missing conversion is not zero';
 select revision into rev from private.ingredient_masters where id=mid;
 perform public.app_operation(s,'recipe.price',jsonb_build_object('ingredient_id',mid,'ingredient_revision',rev,'name','包裝測試','unit','g','price',0.4,'purchase',jsonb_build_object('amount',200,'quantity',1,'unit','瓶','content_quantity',500,'content_unit','g','conversion_basis','package')),gen_random_uuid());
 assert (select purchase->>'amount' from private.ingredient_masters where id=mid)='200','recipe price preserves package';
 doc:=jsonb_set(doc,'{lines,0,quantity}','"100"');
 assert (private.recipe_cost(s,doc)->>'total')::numeric=40,'100g package conversion';
 assert (select md5(to_jsonb(c)::text) from private.recipe_cards c where id=rid)=saved_hash,'price update preserves saved recipe';
 doc:=jsonb_set(jsonb_set(doc,'{lines,0,unit}','"瓶"'),'{lines,0,quantity}','"0.5"');
 assert (private.recipe_cost(s,doc)->>'total')::numeric=100,'normalized quote still prices half bottle';
 -- A selected historical baseline must not hide a confirmed requisition quote.
 insert into private.recipe_price_entries(id,store_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,purchase)
 values(p,s,'來源順序麵粉','g',0.1,'歷史食譜：麵粉','2026-10-05',owner_id,'history','confirmed','{"amount":100,"quantity":1,"unit":"包","content_quantity":1000,"content_unit":"g"}');
 insert into private.ingredient_masters(id,store_id,name,unit,cost_price,review_status,selected_reference,manual)
 values(dish,s,'來源順序麵粉','g',0.1,'confirmed',p,false);
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,reference_ids)
 values(s,dish,'來源順序麵粉','n:來源順序麵粉','g',array[p]);
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,purchase)
 values(s,'來源順序麵粉','g',0.032,'請購表：進貨明細','2026-09-01',owner_id,'purchase','confirmed','{"amount":32,"quantity":1,"unit":"包","content_quantity":1000,"content_unit":"g"}');
 ws:=private.recipe_prices(s);
 assert (select value->>'source' from jsonb_array_elements(ws) where value->>'key'='i:'||dish)='請購表：進貨明細','purchase wins even when history is newer';
 assert (select (value#>>'{purchase,amount}')::numeric from jsonb_array_elements(ws) where value->>'key'='i:'||dish)=32,'original bag price preserved';
 doc:=jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('id','flour','name','來源順序麵粉','ingredient_id',dish,'quantity','400','unit','g')));
 assert (private.recipe_cost(s,doc)->>'total')::numeric=12.8,'server cost agrees with purchase';
 assert (select cost_price from private.ingredient_masters where id=dish)=0.1,'master preserved';
 assert (select md5(to_jsonb(c)::text) from private.recipe_cards c where id=rid)=saved_hash,'saved recipes preserved';
 select revision into rev from private.ingredient_masters where id=mid;
 begin perform public.app_operation(other_s,'ingredient.save',jsonb_build_object('id',mid,'revision',rev,'name','跨店','unit','瓶','cost_price',1),gen_random_uuid());raise exception 'cross store write accepted';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.app_operation(s,'ingredient.save',payload,req);raise exception 'staff replay accepted';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.app_workspace(s,'ingredients');raise exception 'anonymous accepted';exception when sqlstate '42501' then null;end;
 assert not has_table_privilege('authenticated','private.ingredient_masters','SELECT'),'private table denied';
 assert not has_function_privilege('anon','private.ingredient_operation(uuid,text,jsonb,uuid)','EXECUTE'),'anon function denied';
 assert (select count(*) from public.receipt_lines)=before_count,'receipts unchanged';
end $test$;
rollback;
