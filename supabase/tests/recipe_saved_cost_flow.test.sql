begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();chef uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();s uuid:=gen_random_uuid();other_s uuid:=gen_random_uuid();p uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();dish uuid:=gen_random_uuid();req uuid:=gen_random_uuid();
 doc jsonb;payload jsonb;result jsonb;retry jsonb;ws jsonb;before_count integer; mid uuid; rev integer; saved_hash text; prep uuid:=gen_random_uuid(); salt uuid:=gen_random_uuid(); review jsonb; first_request uuid; newdoc jsonb; before_hash text; started timestamptz; elapsed numeric;
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



 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status)
 select s,'效能食材'||n,'g',0.032,'請購表',date '2026-10-06',owner_id,'purchase','confirmed' from generate_series(1,1600) n;
 perform private.seed_ingredient_masters(s);
 select md5(jsonb_agg(to_jsonb(m) order by id)::text) into before_hash from private.ingredient_masters m where store_id=s;
 doc:=jsonb_build_object('name','效能測試白醬','kind','prep','yield','1000','unit','g','notes','','lines',
 (select jsonb_agg(jsonb_build_object('id','line'||n,'name','效能食材'||n,'quantity','100','unit','g')) from generate_series(1,5) n));
 payload:=jsonb_build_object('id',rid,'revision',0,'document',doc,'prices',(select jsonb_agg(jsonb_build_object('line_id','line'||n,'name','效能食材'||n,'unit','g','price',0.04,'source','手動補價','effective_date','2026-10-06','purchase',jsonb_build_object('amount',40,'quantity',1,'unit','包','content_quantity',1000,'content_unit','g','conversion_basis','package'))) from generate_series(1,5) n));
 started:=clock_timestamp();
 result:=public.app_operation(s,'recipe.commit',payload,req);
 elapsed:=extract(epoch from clock_timestamp()-started)*1000;
 assert (result#>>'{cost,total}')::numeric=20,'five explicit legacy-name quotes saved in one transaction';
 assert jsonb_array_length(result->'accepted_lines')=5,'all five price drafts acknowledged';
 assert (private.recipe_saved_snapshot(rid)#>>'{cost,total}')::numeric=20,'list snapshot agrees';
 assert elapsed<5000,format('Saving five prices with 1600 catalog sources must stay below five seconds, took %s ms',elapsed);
 assert result=public.app_operation(s,'recipe.commit',payload,req),'retry must be idempotent';
 assert (select count(*) from private.recipe_price_entries where store_id=s)=1600,'save must not add catalog quotes';
 assert (select md5(jsonb_agg(to_jsonb(m) order by id)::text) from private.ingredient_masters m where store_id=s)=before_hash,'save must not modify ingredient masters';
 update private.recipe_price_entries set price=999 where store_id=s;
 result:=public.app_operation(s,'recipe.commit',jsonb_build_object('id',rid,'revision',1,'document',doc,'prices','[]'::jsonb),gen_random_uuid());
 assert (result#>>'{cost,total}')::numeric=20,'repeat save must keep locked cost despite new catalog prices';
 assert (private.recipe_workspace_saved(s)#>'{recipes,0,cost}')=result->'cost','reload must use saved result';

 -- Legacy pending requests must also bypass the catalog and preserve the snapshot.
 result:=public.app_operation(s,'recipe.save',jsonb_build_object('id',rid,'revision',2,'document',doc),gen_random_uuid());
 assert (result#>>'{cost,total}')::numeric=20,'legacy retry keeps stored cost';
 -- A main recipe uses the saved component total, then survives a cold saved-workspace read.
 newdoc:=jsonb_build_object('name','主食譜整段測試','kind','dish','yield','1','unit','份','notes','','lines',jsonb_build_array(jsonb_build_object('id','prep-use','name','白醬','recipe_id',rid,'quantity','100','unit','g')));
 result:=public.app_operation(s,'recipe.commit',jsonb_build_object('id',dish,'revision',0,'document',newdoc,'prices','[]'::jsonb),gen_random_uuid());
 assert (result#>>'{cost,total}')::numeric=2,'parent uses saved child cost';
 ws:=private.recipe_workspace_saved(s);
 assert (select value#>'{cost}' from jsonb_array_elements(ws->'recipes') where value->>'id'=dish::text)=result->'cost','cold read equals commit result';
 -- Existing parent remains locked when the child is edited independently.
 payload:=jsonb_set(payload,'{revision}','3');
 payload:=jsonb_set(payload,'{prices,0,purchase,amount}','80');
 result:=public.app_operation(s,'recipe.commit',payload,gen_random_uuid());
 assert (result#>>'{cost,total}')::numeric=24,'explicit child quote changes child only';
 assert (private.recipe_saved_snapshot(dish)#>>'{cost,total}')::numeric=2,'parent snapshot stays locked';
 -- Returning the changed child to this parent explicitly updates its cost revision.
 newdoc:=jsonb_set(newdoc,'{lines,0,cost_revision}',to_jsonb(gen_random_uuid()::text));
 result:=public.app_operation(s,'recipe.commit',jsonb_build_object('id',dish,'revision',1,'document',newdoc,'prices','[]'::jsonb),gen_random_uuid());
 assert (result#>>'{cost,total}')::numeric=2.4,'explicit parent update adopts saved child';
 -- Transfer carries this exact result, despite an unrelated changed catalog.
 review:=private.recipe_transfer_plan(s,other_s,dish);
 newdoc:=jsonb_build_object('id',dish,'target_store_id',other_s,'token',review->>'token');
 first_request:=gen_random_uuid();started:=clock_timestamp();
 result:=public.app_operation(s,'recipe.transfer',newdoc,first_request);
 assert extract(epoch from clock_timestamp()-started)<5,'transfer does not scan catalog';
 assert result=public.app_operation(s,'recipe.transfer',newdoc,first_request),'transfer replay is idempotent';
 assert (private.recipe_saved_snapshot(dish)#>>'{cost,total}')::numeric=2.4,'transfer preserves parent';
 assert (private.recipe_saved_snapshot(rid)#>>'{cost,total}')::numeric=24,'transfer preserves child';
 assert not exists(select 1 from jsonb_array_elements(private.recipe_workspace_saved(s)->'recipes') where value->>'id'=dish::text),'source no longer lists transferred recipe';
 assert exists(select 1 from jsonb_array_elements(private.recipe_workspace_saved(other_s)->'recipes') where value->>'id'=dish::text and (value#>>'{cost,total}')::numeric=2.4),'destination shows exact saved total';
 select document,revision into doc,rev from private.recipe_cards where id=rid;
 result:=public.app_operation(other_s,'recipe.commit',jsonb_build_object('id',rid,'revision',rev,'document',doc,'prices','[]'::jsonb),gen_random_uuid());
 assert (result#>>'{cost,total}')::numeric=24,'transferred recipe can be saved without repricing';
 begin perform public.app_operation(s,'recipe.commit',payload,gen_random_uuid());raise exception 'stale revision accepted';exception when serialization_failure then null;end;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin perform public.app_operation(s,'recipe.commit',payload,req);raise exception 'outsider accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.app_operation(s,'recipe.commit',payload,req);raise exception 'staff accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform private.recipe_commit(s,payload,req);raise exception 'anonymous accepted';exception when insufficient_privilege then null;end;
 assert (select count(*) from public.receipt_lines)=before_count,'existing receipt data preserved';
 perform set_config('recipe_test.elapsed_ms',elapsed::text,true);
end $test$;
select current_setting('recipe_test.elapsed_ms') as commit_ms;
rollback;
