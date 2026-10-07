-- Isolated rollback fixture; no customer records are changed.
do $test$
declare owner_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid(); s uuid; r uuid:=gen_random_uuid();
 data jsonb; doc jsonb; saved jsonb; result jsonb; quote jsonb; req uuid:=gen_random_uuid(); denied boolean; ref_id uuid; prod uuid; org uuid; batch uuid; receipt uuid;
 product2 uuid; quote_result jsonb; other_store uuid; source_quote uuid; alias_master uuid;
 code text:='NOTE'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
begin
 begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@recipe-note-qa.invalid',now() from unnest(array[owner_id,outsider_id])id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','食譜備註換算測試','business_type','SINGLE_RESTAURANT','store_mode','MULTI'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code',code,'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);s:=(data->>'store_id')::uuid;


 select organization_id into org from public.stores where id=s;
 insert into public.products(organization_id,product_code,name,base_unit,count_unit) values(org,'COSTFIX','價格測試','公斤','公斤') returning id into prod;
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,purchase)
 values(s,'價格測試','g',.3,'請購表','2026-08-01',owner_id,'purchase','{"amount":180,"quantity":1,"unit":"斤"}'),
 (s,'價格測試','g',.9,'歷史食譜','2026-10-01',owner_id,'history','{"amount":900,"quantity":1,"unit":"公斤"}'),
 (s,'價格測試','g',.5,'已核對進貨明細','2026-10-01',owner_id,'purchase','{"amount":500,"quantity":1,"unit":"公斤"}');
 assert (private.cost_quote(s,prod,null,'公斤','2026-09-30')->>'price')::numeric=300,'purchase priority or month boundary';
 assert (private.cost_quote(s,prod,null,'公斤','2026-10-31')->>'price')::numeric=500,'future receipt not propagated';
 insert into private.ingredient_masters(store_id,name,unit,cost_price,selected_reference,review_status) select s,'別名食材','g',.3,id,'confirmed' from private.recipe_price_entries where store_id=s and name='價格測試' and source='請購表' limit 1 returning id into ref_id;
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,reference_ids) values(s,ref_id,'另一種名稱','n:另一種名稱','g','{}');
 assert (private.cost_quote(s,null,'另一種名稱','公斤','2026-09-30')->>'price')::numeric=300,'empty reference alias lost selected source';
 assert (private.cost_quote(s,prod,null,'支','2026-10-31')->>'price') is null,'guessed piece conversion';
 assert private.cost_package_measure('5kg/桶','榛果醬')->>'quantity'='5000','explicit package unit';
 assert private.cost_package_measure('包','食材450-550g') is null,'range guessed';
 assert private.cost_package_measure('包','麵粉 1K')->>'quantity'='1000','explicit K package';
 assert private.cost_purchase_price('{"amount":450,"quantity":1,"unit":"瓶","content_quantity":750,"content_unit":"ml"}','ml')=.6,'package conversion';
 assert private.cost_purchase_price('{"amount":450,"quantity":1,"unit":"瓶"}','g') is null,'mass volume mixing';
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,review_status) values(s,'價格測試','g',.4,true,'confirmed');
 assert (private.cost_quote(s,prod,null,'公斤','2026-10-31')->>'price')::numeric=400,'manual price changed';
 quote_result:=public.baihuayuan_cost_quotes(s,jsonb_build_array(jsonb_build_object('product_id',prod,'unit','公斤','date','2026-09-30')));
 assert (quote_result->0->>'price')::numeric=400,'batch quote';

 insert into public.stores(organization_id,name,store_code,created_by) values(org,'Gras',code||'B',owner_id) returning id into other_store;
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,purchase)
 values(other_store,'原表茶包15入','包',150,'請購表','2026-09-01',owner_id,'purchase','{"amount":150,"quantity":1,"unit":"包"}') returning id into source_quote;
 insert into private.ingredient_masters(store_id,name,unit) values(s,'現場茶包','顆') returning id into alias_master;
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,reference_ids,corrected,cost_mapping)
 values(s,alias_master,'現場茶包','n:現場茶包','顆',array[source_quote],true,'{"unit":"包","quantity":0.06666666666666666667,"target_unit":"個","reason":"原表15入"}');
 assert abs((private.cost_quote(s,null,'現場茶包','個','2026-09-30')->>'price')::numeric-10)<.000001,'reviewed cross-store package match';
 assert private.cost_quote(s,null,'原表茶包15入','包','2026-09-30')->>'price' is null,'unreviewed cross-store quote leaked';
 assert private.cost_quote(s,null,'現場茶包','個','2026-08-31')->>'price' is null,'reviewed future source leaked';
 perform private.seed_ingredient_masters(s);
 assert abs((private.cost_quote(s,null,'現場茶包','個','2026-09-30')->>'price')::numeric-10)<.000001,'seeding lost reviewed match';
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,review_status) values(s,'重新指定的食材','顆',12,true,'confirmed') returning id into product2;
 perform private.ingredient_operation(s,'ingredient.alias',jsonb_build_object('id',alias_master,'revision',1,'alias_id',(select id from private.ingredient_aliases where ingredient_id=alias_master),'target_id',product2,'target_revision',1),gen_random_uuid());
 assert (select cost_mapping is null and cardinality(reference_ids)=0 from private.ingredient_aliases where ingredient_id=product2 and name='現場茶包'),'manual reassignment retained old cost mapping';
 assert (private.cost_quote(s,null,'現場茶包','個','2026-09-30')->>'price')::numeric=12,'reassigned alias ignored new master';
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);
 denied:=false;begin perform public.baihuayuan_cost_quotes(s,'[]');exception when insufficient_privilege then denied:=true;end;
 assert denied,'cross-store access';
 raise exception 'FIXTURE_ROLLBACK' using errcode='P0002';
 exception when sqlstate 'P0002' then null;
 end;
end $test$;
