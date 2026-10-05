-- Run after recipe_cost.test.sql and ingredient_catalog.test.sql in their rollback fixture.
do $test$
declare s uuid; owner_id uuid; mid uuid; old_id uuid; payload jsonb; req uuid:=gen_random_uuid(); result jsonb; snap text; aliases_before text; catalog jsonb; source jsonb; rev integer; org uuid; prod uuid; batch uuid; receipt uuid; receipt_master uuid;
begin
 select id,created_by into s,owner_id from public.stores where name='食譜測試' order by created_at desc limit 1;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into private.recipe_price_entries(store_id,name,unit,price,source,source_kind,effective_date,actor_id,review_status,source_ref) values
 (s,'乾巴西里','g',0.8,'請購表：2026/08','purchase','2026-08-01',owner_id,'confirmed','{}'),
 (s,'乾巴西里碎','g',1.5,'舊食譜','history','2026-10-01',owner_id,'confirmed','{"specification":"原表計價基準：1500 元／1000 g"}'),
 (s,'乾巴西里','ml',2,'不同單位','history','2026-10-01',owner_id,'confirmed','{}'),
 (s,'基礎缺價測試','g',0,'空白原表','history',null,owner_id,'pending','{"missing_price":true}');
 insert into private.ingredient_masters(store_id,name,unit,cost_price) values(s,'乾巴西里碎 · 原表計價基準：1500 元／1000 g','g',1.5) returning id into old_id;
 select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) into snap from private.recipe_price_entries r where store_id=s;
 perform private.seed_ingredient_masters(s);
 select id,revision into mid,rev from private.ingredient_masters where store_id=s and name='乾巴西里' and unit='g';
 assert (select cost_price from private.ingredient_masters where id=mid)=0.8,'purchasing wins over newer recipe history';
 assert (select count(*) from private.ingredient_aliases where ingredient_id=mid)=2,'historical denominator is not a separate ingredient';
 assert exists(select 1 from private.ingredient_masters where id=old_id and cost_price=1.5),'old master identity and saved value retained';
 assert exists(select 1 from private.ingredient_masters where store_id=s and name='乾巴西里' and unit='ml'),'volume stays separate';
 catalog:=public.app_workspace(s,'ingredients');
 select value into source from jsonb_array_elements(catalog->'ingredients') where value->>'id'=mid::text;
 assert source->>'source'='請購表：2026/08','catalog includes real provenance';
 assert public.app_workspace(s,'ingredient.sources',jsonb_build_object('id',mid))#>>'{0,source}'='請購表：2026/08','three visible source suggestions start with purchasing';
 assert exists(select 1 from jsonb_array_elements(private.recipe_prices(s)) p where p->>'key'='n:乾巴西里碎' and (p->>'price')::numeric=0.8),'aliases resolve baseline automatically';
 payload:=jsonb_build_object('id',mid,'revision',rev,'name','乾巴西里','unit','g','cost_price',null);
 result:=public.app_operation(s,'ingredient.save',payload,req);
 assert public.app_operation(s,'ingredient.save',payload,req)=result,'missing-price save retry is idempotent';
 assert (select cost_price is null and review_status='pending' from private.ingredient_masters where id=mid),'blank price saves without blocking';
 perform private.seed_ingredient_masters(s);
 assert (select cost_price is null from private.ingredient_masters where id=mid),'manual blank is not replaced';
 assert (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.recipe_price_entries r where store_id=s)=snap,'all raw prices unchanged';
 select md5(string_agg(to_jsonb(a)::text,'' order by a.id)) into aliases_before from private.ingredient_aliases a where store_id=s;
 perform private.seed_ingredient_masters(s);
 assert (select md5(string_agg(to_jsonb(a)::text,'' order by a.id)) from private.ingredient_aliases a where store_id=s)=aliases_before,'repeated baseline preparation retains aliases';
 -- A future verified receipt reaches a master ID as a proposal, never an unreviewed upload.
 select organization_id into org from public.stores where id=s;
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'基準進貨測試','g','g') returning id into prod;
 insert into private.recipe_price_entries(store_id,product_id,name,unit,price,source,source_kind,effective_date,actor_id,review_status)
 values(s,prod,'基準進貨測試','g',0.2,'請購表','purchase','2026-09-01',owner_id,'confirmed');
 perform private.seed_ingredient_masters(s);
 select id into receipt_master from private.ingredient_masters where store_id=s and name='基準進貨測試';
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,status)
 values(org,s,'價格來源測試',owner_id,'2026-10-06','COMPLETED') returning id into batch;
 insert into public.goods_receipts(organization_id,store_id,source_batch_id,receipt_date) values(org,s,batch,'2026-10-06') returning id into receipt;
 insert into public.receipt_lines(organization_id,receipt_id,product_id,unit,quantity,unit_price_ex_tax) values(org,receipt,prod,'g',100,0.4);
 select value into source from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='i:'||receipt_master;
 assert (source->>'price')::numeric=0.4 and source->>'source'='已核對進貨','reviewed receipt feeds current master proposal';
 assert (select cost_price from private.ingredient_masters where id=receipt_master)=0.2,'receipt proposal does not rewrite baseline';
 update public.receipt_upload_batches set status='READY_FOR_REVIEW' where id=batch;
 select value into source from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='i:'||receipt_master;
 assert (source->>'price')::numeric=0.2,'unreviewed receipts cannot replace baseline';
 assert not has_function_privilege('authenticated','private.consolidate_ingredient_baseline(uuid)','EXECUTE'),'cleanup helper private';
end $test$;
