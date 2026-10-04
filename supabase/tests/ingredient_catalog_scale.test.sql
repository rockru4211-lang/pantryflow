-- Run with recipe_cost.test.sql fixtures in a rollback transaction.
do $test$
declare actor uuid; org uuid; target uuid; source_store record; mapping jsonb; entry record; doc jsonb; ws jsonb; started timestamptz; elapsed numeric;
begin
 select st.created_by,st.organization_id into actor,org from public.stores st where st.name='食譜測試' order by st.created_at desc limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 for source_store in select s.id,s.name from public.stores s where s.name in ('BeApe','Gras') and exists(select 1 from private.recipe_price_entries p where p.store_id=s.id and p.source_ref->>'import_batch'='three-workbook-price-baseline-20261004-v1') loop
 target:=gen_random_uuid();
 insert into public.stores(id,organization_id,name,store_code,created_by) values(target,org,'隔離效能副本','QA'||substr(target::text,1,8),actor);
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(target,org,actor,'qa-owner-'||target,'OWNER','OWNER',actor,true);
 insert into private.recipe_price_entries(store_id,name,product_id,unit,price,source,effective_date,actor_id,created_at,purchase,cost_price,source_kind,review_status,source_ref)
 select target,name,product_id,unit,price,source,effective_date,actor,created_at,purchase,cost_price,source_kind,review_status,source_ref from private.recipe_price_entries where store_id=source_store.id;
 select jsonb_object_agg(id::text,gen_random_uuid()::text) into mapping from private.recipe_cards where store_id=source_store.id;
 for entry in select * from private.recipe_cards where store_id=source_store.id loop
 select jsonb_set(entry.document,'{lines}',coalesce(jsonb_agg(case when mapping ? (value->>'recipe_id') then jsonb_set(value,'{recipe_id}',mapping->(value->>'recipe_id')) else value end order by ord),'[]'::jsonb)) into doc from jsonb_array_elements(entry.document->'lines') with ordinality as l(value,ord);
 insert into private.recipe_cards(id,store_id,document,revision,updated_by) values((mapping->>entry.id::text)::uuid,target,doc,entry.revision,actor);
 end loop;
 perform private.seed_ingredient_masters(target);
 analyze private.ingredient_masters; analyze private.ingredient_aliases; analyze private.recipe_price_entries;
 started:=clock_timestamp();
 ws:=public.app_workspace(target,'recipes');
 elapsed:=extract(epoch from clock_timestamp()-started);
 assert elapsed<8,source_store.name||' catalog exceeded 8 seconds: '||elapsed;
 assert jsonb_array_length(ws->'recipes')=(select count(*) from private.recipe_cards where store_id=source_store.id),'recipe count preserved';
 assert jsonb_array_length(ws->'price_references')>=1700,'price catalog complete';
 end loop;
end $test$;
