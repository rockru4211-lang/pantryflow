-- Every fixture is created in a rollback-only subtransaction.
do $test$
declare owner_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid(); s uuid; r uuid:=gen_random_uuid();
 data jsonb; doc jsonb; saved jsonb; result jsonb; quote jsonb; req uuid:=gen_random_uuid(); denied boolean; ref_id uuid; prod uuid; org uuid; batch uuid; receipt uuid;
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

 -- A later imported historical value must never beat a known purchase price.
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,purchase)
 values(s,'測試食材','g',0.8,'歷史食譜',null,owner_id,'history','{"amount":800,"quantity":1,"unit":"公斤"}');
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,purchase)
 values(s,'測試食材','g',0.3,'請購表','2026-08-01',owner_id,'purchase','{"amount":180,"quantity":1,"unit":"台斤"}');
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind)
 values(s,'測試食材','g',0.9,'歷史食譜','2026-09-30',owner_id,'history');
 select value into result from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='n:測試食材';
 assert (result->>'price')::numeric=0.3,'history beat a purchase price';
 doc:='{"name":"來源測試","kind":"prep","yield":"1100","unit":"g","lines":[{"id":"a","name":"測試食材","quantity":"500","unit":"g"}],"notes":""}';
 data:=jsonb_build_object('id',r,'revision',0,'document',doc);
 saved:=private.recipe_operation(s,'recipe.save',data,gen_random_uuid());
 assert (saved->'cost'->>'total')::numeric=150,'purchase conversion incorrect';
 -- A zero candidate cannot silently turn unknown cost into free ingredients.
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,source_ref,purchase)
 values(s,'待確認食材','g',0,'歷史食譜',null,owner_id,'history','pending','{"import_key":"fixture-reference","name":"原始品名"}','{"amount":0,"quantity":1,"unit":"g"}') returning id into ref_id;
 assert not exists(select 1 from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='n:待確認食材'),'pending quote leaked into costing';
 assert jsonb_array_length(private.recipe_workspace(s)->'price_candidates')=1,'pending candidate not visible';
 quote:=jsonb_build_object('name','待確認食材','unit','g','price',0,'source','歷史食譜','effective_date',null,'reference_id',ref_id,'purchase','{"amount":0,"quantity":1,"unit":"g"}'::jsonb);
 req:=gen_random_uuid(); result:=private.recipe_operation(s,'recipe.price',quote,req);
 assert private.recipe_operation(s,'recipe.price',quote,req)=result,'confirmation retry not idempotent';
 assert jsonb_array_length(private.recipe_workspace(s)->'price_candidates')=0,'confirmed candidate remained pending';
 assert exists(select 1 from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='n:待確認食材' and value->>'effective_date' is null and value->>'source_kind'='history'),'unknown historical date was fabricated';
 denied:=false;begin perform private.recipe_operation(s,'recipe.price',quote||'{"name":"另一食材"}',gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;
 assert denied,'reference reused for a different ingredient';

 -- A future completed receipt follows an approved alias and its package size.
 select organization_id into org from public.stores where id=s;
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'進貨名稱 750g','包','包') returning id into prod;
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,status)
 values(org,s,'價格來源測試',owner_id,'2026-10-01','COMPLETED') returning id into batch;
 insert into public.goods_receipts(organization_id,store_id,source_batch_id,receipt_date)
 values(org,s,batch,'2026-10-01') returning id into receipt;
 insert into public.receipt_lines(organization_id,receipt_id,product_id,unit,quantity,unit_price_ex_tax)
 values(org,receipt,prod,'包',1,375);
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,purchase,source_ref)
 values(s,'食譜別名','g',0.4,'歷史食譜',null,owner_id,'history','{"amount":300,"quantity":1,"unit":"包","content_quantity":750,"content_unit":"g"}',jsonb_build_object('product_id',prod));
 select value into result from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='n:食譜別名' and value->>'unit'='g';
 assert (result->>'price')::numeric=0.5,'new receipt package conversion failed';
 assert result->>'source_kind'='purchase','new receipt retained historical classification';
 update public.receipt_upload_batches set status='READY_FOR_REVIEW' where id=batch;
 select value into result from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='n:食譜別名' and value->>'unit'='g';
 assert (result->>'price')::numeric=0.4,'unreviewed receipt replaced history';

 -- Existing manual high estimates remain intact.
 quote:='{"name":"測試食材","unit":"g","price":0.3,"source":"手動補價","effective_date":"2026-10-01","purchase":{"amount":180,"quantity":1,"unit":"台斤","cost_unit_price":210}}';
 perform private.recipe_operation(s,'recipe.price',quote,gen_random_uuid());
 assert (private.recipe_cost(s,doc)->>'total')::numeric=175,'manual estimate lost';
 assert (select document=doc and revision=1 from private.recipe_cards where id=r),'price updates changed the recipe';
 assert (select (cost_snapshot->>'total')::numeric=150 from private.recipe_versions where recipe_id=r),'historical snapshot was rewritten';
 assert (select relrowsecurity from pg_class where oid='private.recipe_price_entries'::regclass),'RLS disabled';
 assert not has_table_privilege('authenticated','private.recipe_price_entries','SELECT'),'raw quotes exposed directly';
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);
 denied:=false;begin perform private.recipe_operation(s,'recipe.price',quote,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'outsider wrote prices';
 denied:=false;begin perform private.recipe_workspace(s);exception when insufficient_privilege then denied:=true;end;assert denied,'outsider read candidates';
 assert private.recipe_prices(s)='[]'::jsonb,'outsider read prices';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 assert private.recipe_prices(s)='[]'::jsonb,'anonymous read prices';
 raise exception using errcode='Z9904',message='PRICE_SOURCE_TEST_ROLLBACK';
 exception when sqlstate 'Z9904' then null;
 end;
end $test$;
