begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();chef uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();s uuid:=gen_random_uuid();other_s uuid:=gen_random_uuid();p uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();dish uuid:=gen_random_uuid();req uuid:=gen_random_uuid();
 doc jsonb;payload jsonb;result jsonb;retry jsonb;ws jsonb;before_count integer; mid uuid; rev integer; saved_hash text; prep uuid:=gen_random_uuid(); salt uuid:=gen_random_uuid(); review jsonb; first_request uuid; newdoc jsonb; before_hash text;
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


 payload:=jsonb_build_object('name','測試麵粉','unit','g','cost_price',0.032,'purchase','{"amount":32,"quantity":1,"unit":"包","content_quantity":1000,"content_unit":"g","conversion_basis":"package"}'::jsonb);
 result:=public.app_operation(s,'ingredient.save',payload,gen_random_uuid());mid:=(result->>'id')::uuid;
 result:=public.app_operation(s,'ingredient.save','{"name":"測試鹽","unit":"g","cost_price":1}'::jsonb,gen_random_uuid());salt:=(result->>'id')::uuid;
 doc:=jsonb_build_object('name','配件','kind','prep','yield','1000','unit','g','notes','','lines',jsonb_build_array(
 jsonb_build_object('id','flour','name','測試麵粉','ingredient_id',mid,'quantity','400','unit','g'),
 jsonb_build_object('id','salt','name','測試鹽','ingredient_id',salt,'quantity','10','unit','g')));
 req:=gen_random_uuid();result:=public.app_operation(s,'recipe.commit',jsonb_build_object('id',prep,'revision',0,'document',doc,'prices','[]'::jsonb),req);
 assert (result#>>'{cost,total}')::numeric=22.8,'auto-filled unedited prices saved atomically';
 assert result=public.app_operation(s,'recipe.commit',jsonb_build_object('id',prep,'revision',0,'document',doc,'prices','[]'::jsonb),req),'commit retry identical';
 newdoc:=jsonb_build_object('name','主菜','kind','dish','yield','1','unit','份','notes','','lines',jsonb_build_array(jsonb_build_object('id','child','name','配件','recipe_id',prep,'quantity','500','unit','g')));
 perform public.app_operation(s,'recipe.commit',jsonb_build_object('id',dish,'revision',0,'document',newdoc),gen_random_uuid());
 assert (private.recipe_saved_snapshot(dish)#>>'{cost,total}')::numeric=11.4,'parent uses saved prep';
 select revision into rev from private.ingredient_masters where id=mid;
 perform public.app_operation(s,'ingredient.save',payload||jsonb_build_object('id',mid,'revision',rev,'cost_price',0.04,'purchase','{"amount":40,"quantity":1,"unit":"包","content_quantity":1000,"content_unit":"g","conversion_basis":"package"}'::jsonb),gen_random_uuid());
 select revision into rev from private.ingredient_masters where id=salt;
 perform public.app_operation(s,'ingredient.save',jsonb_build_object('id',salt,'revision',rev,'name','測試鹽','unit','g','cost_price',2),gen_random_uuid());
 perform public.app_operation(s,'recipe.commit',jsonb_build_object('id',dish,'revision',1,'document',newdoc),gen_random_uuid());
 assert (private.recipe_saved_snapshot(dish)#>>'{cost,total}')::numeric=11.4,'ordinary save preserves old price';
 review:=public.app_operation(s,'recipe.ingredient.review',jsonb_build_object('key','i:'||mid),gen_random_uuid());
 assert jsonb_array_length(review->'rows')=2,'review includes direct prep and indirect parent';
 assert (select (value#>>'{after,total}')::numeric from jsonb_array_elements(review->'rows') where value->>'id'=prep::text)=26,'only flour updated, salt kept at ten';
 assert (select (value#>>'{after,total}')::numeric from jsonb_array_elements(review->'rows') where value->>'id'=dish::text)=13,'parent scoped proposal';
 req:=gen_random_uuid();payload:=jsonb_build_object('key','i:'||mid,'token',review->>'token');
 result:=public.app_operation(s,'recipe.ingredient.confirm',payload,req);
 assert (result->>'updated')::int=2,'atomic bulk update all related';
 assert result=public.app_operation(s,'recipe.ingredient.confirm',payload,req),'bulk retry idempotent';
 assert (private.recipe_saved_snapshot(prep)#>>'{cost,total}')::numeric=26,'prep updated';
 assert (private.recipe_saved_snapshot(dish)#>>'{cost,total}')::numeric=13,'parent updated';
 begin perform public.app_operation(s,'recipe.ingredient.confirm',payload,gen_random_uuid());raise exception 'stale token accepted';exception when serialization_failure then null;end;
 -- A missing amount remains null and never prevents saving a partial recipe.
 doc:=jsonb_set(doc,'{lines}',(doc->'lines')||'[{"id":"unknown","name":"未知食材","quantity":"2","unit":"包"}]'::jsonb);
 result:=public.app_operation(s,'recipe.commit',jsonb_build_object('id',rid,'revision',0,'document',doc),gen_random_uuid());
 assert result#>'{cost,total}'='null'::jsonb and (result#>>'{cost,subtotal}')::numeric=36,'partial saves retain real sums';
 -- Duplicate ingredient lines are independent, while the master revision advances internally.
 doc:=jsonb_set(doc,'{lines}',jsonb_build_array(doc#>'{lines,0}',jsonb_set(doc#>'{lines,0}','{id}','"flour2"')));
 select revision into rev from private.ingredient_masters where id=mid;
 payload:=jsonb_build_object('line_id','flour','ingredient_id',mid,'ingredient_revision',rev,'name','測試麵粉','unit','g','price',0.032,'source','手動補價','effective_date','2026-10-06','purchase','{"amount":32,"quantity":1,"unit":"包","content_quantity":1000,"content_unit":"g","conversion_basis":"package"}'::jsonb);
 first_request:=gen_random_uuid();newdoc:=jsonb_build_object('id',rid,'revision',1,'document',doc,'prices',jsonb_build_array(payload,payload||'{"line_id":"flour2"}'::jsonb));
 result:=public.app_operation(s,'recipe.commit',newdoc,first_request);
 assert (result#>>'{cost,total}')::numeric=25.6,'duplicate master lines both persisted';
 assert jsonb_array_length(result->'accepted_lines')=2,'both edits acknowledged';
 assert private.recipe_workspace_saved(s)->'recipes' is not null,'reload available';
 assert (private.recipe_saved_snapshot(dish)#>>'{cost,total}')::numeric=13,'editing A preserves B';
 begin perform public.app_operation(other_s,'recipe.commit',newdoc,gen_random_uuid());raise exception 'cross-store accepted';exception when insufficient_privilege or serialization_failure then null;end;
 begin perform public.app_operation(s,'recipe.commit',newdoc,gen_random_uuid());raise exception 'stale revision accepted';exception when serialization_failure then null;end;
 -- A child can be updated independently; its parent's locked breakdown stays isolated.
 select document into doc from private.recipe_cards where id=prep;
 result:=private.recipe_cost(s,doc,array[prep]);
 select id into p from private.recipe_cost_approvals where recipe_id=prep order by created_at desc,id desc limit 1;
 perform public.app_operation(s,'recipe.cost.confirm',jsonb_build_object('id',prep,'revision',1,'approval_id',p,'expected_token',md5(result::text)),gen_random_uuid());
 review:=public.app_operation(s,'recipe.ingredient.review',jsonb_build_object('key','i:'||mid),gen_random_uuid());
 assert (select (value#>>'{after,total}')::numeric from jsonb_array_elements(review->'rows') where value->>'id'=dish::text)=11.4,'parent flour change excludes independently changed child salt';
 select document into doc from private.recipe_cards where id=dish;
 doc:=jsonb_set(doc,'{lines,0,cost_revision}',to_jsonb(gen_random_uuid()::text));
 result:=public.app_operation(s,'recipe.commit',jsonb_build_object('id',dish,'revision',2,'document',doc),gen_random_uuid());
 assert abs((result#>>'{cost,total}')::numeric-16.4)<0.000001,'explicit return from prep saves its current cost in active parent';
 assert (private.recipe_saved_snapshot(rid)#>>'{cost,total}')::numeric=25.6,'explicit parent update cannot alter unrelated recipe';
 select document into doc from private.recipe_cards where id=rid;
 select revision into rev from private.ingredient_masters where id=mid;
 payload:=payload||jsonb_build_object('ingredient_revision',rev);
 before_hash:=md5(private.recipe_saved_snapshot(rid)::text);
 begin
  perform public.app_operation(s,'recipe.commit',jsonb_build_object('id',rid,'revision',2,'document',doc,'prices',jsonb_build_array(payload||'{"line_id":"not-a-line"}'::jsonb)),gen_random_uuid());
  raise exception 'invalid price target accepted';
 exception when invalid_parameter_value then null;end;
 assert md5(private.recipe_saved_snapshot(rid)::text)=before_hash,'failed atomic price rolls back document and cost';
 assert (select revision from private.recipe_cards where id=rid)=2,'failed commit rolls back revision';
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.app_operation(s,'recipe.commit',newdoc,first_request);raise exception 'staff replay accepted';exception when insufficient_privilege then null;end;
 begin perform public.app_operation(s,'recipe.ingredient.confirm',payload,req);raise exception 'staff bulk accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform private.recipe_commit(s,newdoc,first_request);raise exception 'anon replay accepted';exception when insufficient_privilege then null;end;
 assert not has_function_privilege('authenticated','private.recipe_commit(uuid,jsonb,uuid)','EXECUTE'),'internal commit hidden';
 assert not has_function_privilege('anon','private.recipe_ingredient_confirm(uuid,jsonb,uuid)','EXECUTE'),'internal bulk hidden';
 assert (select count(*) from public.receipt_lines)=before_count,'receipt data unchanged';
end $test$;
rollback;
