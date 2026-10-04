-- Run in the same rollback transaction as recipe_cost.test.sql fixtures.
do $test$
declare s uuid; owner_id uuid; staff uuid; other_s uuid; mid uuid; aid uuid; target uuid; result jsonb; first_result jsonb; req uuid:=gen_random_uuid(); rev integer; payload jsonb; snap text; before_quotes bigint; price_doc jsonb;
begin
 select st.id,st.created_by into s,owner_id from public.stores st where st.name='食譜測試' order by st.created_at desc limit 1;
 select user_id into staff from public.store_memberships where store_id=s and work_role='STAFF';
 select st.id into other_s from public.stores st where st.name='另一店' and st.created_by=owner_id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,review_status) values(s,'蒜仁','g',0.1,'測試表一','2026-09-01',owner_id,'confirmed'),(s,'大蒜仁','g',0.2,'測試表二','2026-09-02',owner_id,'confirmed'),(s,'帶皮蒜頭','g',0.15,'測試表三','2026-09-03',owner_id,'confirmed'),(s,'大蒜仁','ml',0.3,'不同比量','2026-09-03',owner_id,'confirmed');
 perform private.seed_ingredient_masters(s);
 select id,revision into mid,rev from private.ingredient_masters where store_id=s and name='蒜仁' and unit='g';
 assert (select count(*) from private.ingredient_aliases where ingredient_id=mid)=2,'safe aliases merged';
 assert (select cost_price from private.ingredient_masters where id=mid)=0.2,'latest confirmed baseline selected';
 assert (select count(*) from private.ingredient_masters where store_id=s and name='蒜仁')=2,'mass and volume never merged';
 select md5(string_agg(to_jsonb(r)::text,'' order by id)),count(*) into snap,before_quotes from private.recipe_price_entries r where store_id=s;
 payload:=jsonb_build_object('id',mid,'revision',rev,'name','去皮蒜仁','unit','g','cost_price',0.25);
 result:=public.app_operation(s,'ingredient.save',payload,req);first_result:=result;
 assert public.app_operation(s,'ingredient.save',payload,req)=first_result,'save retry is idempotent';
 price_doc:=jsonb_build_object('name','測試','kind','dish','yield','1','unit','份','lines',jsonb_build_array(jsonb_build_object('id','stable','name','蒜仁','ingredient_id',mid,'unit','g','quantity','100')));
 assert (private.recipe_cost(s,price_doc)->>'total')::numeric=25,'stable master id applies renamed price';
 select revision into rev from private.ingredient_masters where id=mid;
 perform public.app_operation(s,'recipe.price',jsonb_build_object('ingredient_id',mid,'ingredient_revision',rev,'name','蒜仁','unit','g','price',0.3),gen_random_uuid());
 assert (private.recipe_cost(s,price_doc)->>'total')::numeric=30,'inline recipe price updates master';
 select revision into rev from private.ingredient_masters where id=mid;
 select id into aid from private.ingredient_aliases where ingredient_id=mid and name='大蒜仁';
 result:=public.app_operation(s,'ingredient.alias',jsonb_build_object('id',mid,'revision',rev,'alias_id',aid,'name','另一種蒜仁'),gen_random_uuid());target:=(result->>'id')::uuid;
 assert (select ingredient_id from private.ingredient_aliases where id=aid)=target,'split persists';
 perform private.seed_ingredient_masters(s);
 assert (select ingredient_id from private.ingredient_aliases where id=aid)=target,'repeat import preserves correction';
 select revision into rev from private.ingredient_masters where id=target;
 begin perform public.app_operation(other_s,'ingredient.save',jsonb_build_object('id',target,'revision',rev,'name','跨店','unit','g','cost_price',1),gen_random_uuid());raise exception 'cross-store write accepted';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.app_workspace(s,'ingredients');raise exception 'staff read accepted';exception when sqlstate '42501' then null;end;
 begin perform public.app_operation(s,'ingredient.save',payload,req);raise exception 'staff replay accepted';exception when sqlstate '42501' then null;end;
 assert (select md5(string_agg(to_jsonb(r)::text,'' order by id)) from private.recipe_price_entries r where store_id=s)=snap,'source quotations unchanged';
 assert (select count(*) from private.recipe_price_entries where store_id=s)=before_quotes,'no duplicate source quotations';
 assert not has_table_privilege('authenticated','private.ingredient_masters','SELECT'),'direct master table access denied';
 assert not has_function_privilege('authenticated','private.seed_ingredient_masters(uuid)','EXECUTE'),'seed helper private';
end $test$;
