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

 payload:=jsonb_build_object('name','鎖定麵粉','unit','g','cost_price',0.032,'purchase','{"amount":32,"quantity":1,"unit":"包","content_quantity":1000,"content_unit":"g","conversion_basis":"package"}'::jsonb);
 result:=public.app_operation(s,'ingredient.save',payload,req);mid:=(result->>'id')::uuid;
 doc:=jsonb_build_object('name','鎖定食譜','kind','dish','yield','1','unit','份','notes','','lines',jsonb_build_array(jsonb_build_object('id','flour','name','鎖定麵粉','ingredient_id',mid,'quantity','400','unit','g')));
 perform public.app_operation(s,'recipe.save',jsonb_build_object('id',rid,'revision',0,'document',doc),gen_random_uuid());
 perform public.app_operation(s,'recipe.save',jsonb_build_object('id',dish,'revision',0,'document',doc),gen_random_uuid());
 assert (private.recipe_saved_snapshot(rid)#>>'{cost,total}')::numeric=12.8,'initial locked price';
 select revision into rev from private.ingredient_masters where id=mid;
 perform public.app_operation(s,'ingredient.save',payload||jsonb_build_object('id',mid,'revision',rev,'purchase','{"amount":40,"quantity":1,"unit":"包","content_quantity":1000,"content_unit":"g","conversion_basis":"package"}'::jsonb),gen_random_uuid());
 assert (private.recipe_saved_snapshot(rid)#>>'{cost,total}')::numeric=12.8,'catalog cannot update A';
 assert (private.recipe_saved_snapshot(dish)#>>'{cost,total}')::numeric=12.8,'catalog cannot update B';
 ws:=private.recipe_workspace(s);
 assert (select (value#>>'{proposed_cost,total}')::numeric from jsonb_array_elements(ws->'recipes') where value->>'id'=rid::text)=16,'new cost is a proposal';
 result:=private.recipe_cost(s,doc,array[dish]);
 perform public.app_operation(s,'recipe.cost.confirm',jsonb_build_object('id',dish,'revision',1,'approval_id',null,'expected_token',md5(result::text)),gen_random_uuid());
 assert (private.recipe_saved_snapshot(dish)#>>'{cost,total}')::numeric=16,'confirm updates B only';
 assert (private.recipe_saved_snapshot(rid)#>>'{cost,total}')::numeric=12.8,'confirm B preserves A';
 select revision into rev from private.ingredient_masters where id=mid;
 payload:=jsonb_build_object('recipe_id',rid,'recipe_revision',1,'line_id','flour','ingredient_id',mid,'ingredient_revision',rev,'name','鎖定麵粉','unit','g','price',0.032,'source','手動補價','effective_date','2026-10-06','purchase','{"amount":32,"quantity":1,"unit":"袋","content_quantity":1000,"content_unit":"g","conversion_basis":"package"}'::jsonb);
 req:=gen_random_uuid();result:=public.app_operation(s,'recipe.price',payload,req);
 assert public.app_operation(s,'recipe.price',payload,req)=result,'retry is idempotent';
 assert (select count(*) from private.recipe_cost_approvals where recipe_id=rid)=1,'retry cannot create another lock';
 assert (private.recipe_saved_snapshot(rid)#>>'{cost,lines,0,price,purchase,unit}')='袋','edited unit survives snapshot';
 assert (private.recipe_saved_snapshot(rid)#>>'{cost,lines,0,price,purchase,content_quantity}')::numeric=1000,'edited content survives snapshot';
 assert (private.recipe_saved_snapshot(dish)#>>'{cost,total}')::numeric=16,'manual A does not affect B';
 ws:=private.recipe_workspace_saved(s);
 assert (select value#>>'{cost,lines,0,price,purchase,unit}' from jsonb_array_elements(ws->'recipes') where value->>'id'=rid::text)='袋','reload retains unit';
 ws:=private.recipe_workspace(s);
 assert (select (value#>>'{cost,total}')::numeric from jsonb_array_elements(ws->'recipes') where value->>'id'=dish::text)=16,'review retains confirmed B';
 -- A compatible usage unit change must use the locked rate even after catalog changes.
 saved_hash:=md5(private.recipe_saved_snapshot(dish)::text);
 result:=private.recipe_locked_cost(jsonb_set(jsonb_set(doc,'{lines,0,quantity}','"0.4"'),'{lines,0,unit}','"公斤"'),doc,private.recipe_saved_snapshot(rid)->'cost',private.recipe_cost(s,doc,array[rid]));
 assert (result->>'total')::numeric=12.8,'kg change preserves locked amount';
 result:=private.recipe_locked_cost(jsonb_set(jsonb_set(doc,'{lines,0,quantity}','"1"'),'{lines,0,unit}','"袋"'),doc,private.recipe_saved_snapshot(rid)->'cost',private.recipe_cost(s,doc,array[rid]));
 assert (result->>'total')::numeric=32,'whole bag uses stored package';
 assert md5(private.recipe_saved_snapshot(dish)::text)=saved_hash,'unit change cannot alter B';
 -- A later normal document save must preserve the explicitly entered quote.
 perform public.app_operation(s,'recipe.save',jsonb_build_object('id',rid,'revision',1,'document',doc),gen_random_uuid());
 assert private.recipe_saved_snapshot(rid)#>>'{cost,lines,0,price,purchase,unit}'='袋','document save retains chosen package';
 -- A genuinely later purchase raises a proposal but cannot overwrite saved quotes.
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,purchase)
 values(s,'鎖定麵粉','g',0.05,'請購表：新月份','2099-01-01',owner_id,'purchase','confirmed','{"amount":50,"quantity":1,"unit":"袋","content_quantity":1000,"content_unit":"g","conversion_basis":"package"}');
 ws:=private.recipe_workspace_review(s,rid);
 assert (ws#>>'{cost,total}')::numeric=12.8,'later purchase keeps locked cost';
 assert (ws#>>'{proposed_cost,total}')::numeric=20,'later purchase produces notification proposal';
 assert jsonb_array_length(ws->'cost_history')>=3,'history includes original versions and explicit edits';
 begin perform public.app_operation(s,'recipe.price',payload,gen_random_uuid());raise exception 'stale revision accepted';exception when sqlstate '40001' then null;end;
 begin perform public.app_operation(other_s,'recipe.price',payload,gen_random_uuid());raise exception 'cross store accepted';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.app_operation(s,'recipe.price',payload,req);raise exception 'staff replay accepted';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.app_operation(s,'recipe.price',payload,req);raise exception 'anon replay accepted';exception when sqlstate '42501' then null;end;
 assert not has_function_privilege('authenticated','private.recipe_save_line_price(uuid,jsonb,uuid)','EXECUTE'),'private helper is not exposed';
 assert (select count(*) from public.receipt_lines)=before_count,'receipts unchanged';
end $test$;
rollback;
