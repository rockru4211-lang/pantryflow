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
 doc:=jsonb_build_object('name','效能測試白醬','kind','prep','yield','1000','unit','g','notes','','lines',
 (select jsonb_agg(jsonb_build_object('id','line'||n,'name','效能食材'||n,'quantity','100','unit','g')) from generate_series(1,5) n));
 payload:=jsonb_build_object('id',rid,'revision',0,'document',doc,'prices',(select jsonb_agg(jsonb_build_object('line_id','line'||n,'name','效能食材'||n,'unit','g','price',0.04,'source','手動補價','effective_date','2026-10-06','purchase',jsonb_build_object('amount',40,'quantity',1,'unit','包','content_quantity',1000,'content_unit','g','conversion_basis','package'))) from generate_series(1,5) n));
 started:=clock_timestamp();
 result:=public.app_operation(s,'recipe.commit',payload,gen_random_uuid());
 elapsed:=extract(epoch from clock_timestamp()-started)*1000;
 assert (result#>>'{cost,total}')::numeric=20,'five explicit legacy-name quotes saved in one transaction';
 assert jsonb_array_length(result->'accepted_lines')=5,'all five price drafts acknowledged';
 assert (private.recipe_saved_snapshot(rid)#>>'{cost,total}')::numeric=20,'list snapshot agrees';
 assert elapsed<5000,format('Saving five prices with 1600 catalog sources must stay below five seconds, took %s ms',elapsed);
 perform set_config('recipe_test.elapsed_ms',elapsed::text,true);
end $test$;
select current_setting('recipe_test.elapsed_ms') as commit_ms;
rollback;
