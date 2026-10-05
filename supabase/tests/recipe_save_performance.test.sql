-- Run after recipe_cost.test.sql in its rollback transaction.
do $test$
declare s uuid; actor uuid; rid uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); payload jsonb; result jsonb; ws jsonb; started timestamptz; baseline jsonb;
begin
 select st.id,st.created_by into s,actor from public.stores st where st.name='食譜測試' order by st.created_at desc limit 1;
 assert s is not null,'isolated fixture missing';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_ref)
 select s,'效能食材'||n,'g',0.1,'隔離測試','2026-10-05',actor,jsonb_build_object('review_note',repeat('保留來源',200)) from generate_series(1,2000)n;
 perform private.seed_ingredient_masters(s);
 payload:=jsonb_build_object('id',rid,'revision',0,'document',jsonb_build_object('name','隔離儲存測試','kind','dish','yield','1','unit','份','notes','','lines',jsonb_build_array(jsonb_build_object('id','line','name','效能食材1000','unit','g','quantity','25'))));
 started:=clock_timestamp();
 result:=public.app_operation(s,'recipe.save',payload,request);
 assert extract(epoch from clock_timestamp()-started)<8,'recipe save exceeds interactive budget';
 assert (result#>>'{cost,total}')::numeric=2.5,'cost changed';
 assert (select document=payload->'document' from private.recipe_cards where id=rid),'save did not persist';
 assert public.app_operation(s,'recipe.save',payload,request)=result,'retry changed result';
 assert (select count(*)=1 from private.recipe_versions where recipe_id=rid),'retry duplicated history';
 baseline:=private.recipe_cost_indexed(s,payload->'document',array[rid],private.recipe_price_index(private.recipe_prices(s)));
 assert baseline=result->'cost','filtered index differs from full index';
 ws:=public.app_workspace(s,'recipes');
 assert exists(select 1 from jsonb_array_elements(ws->'recipes')r where r->>'id'=rid::text and r->'document'=payload->'document'),'saved recipe cannot be read back';
 assert not exists(select 1 from private.recipe_cost_approvals where recipe_id=rid),'save unexpectedly approved cost';
end $test$;
