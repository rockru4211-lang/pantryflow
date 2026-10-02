-- Every fixture is created in a rollback-only subtransaction.
do $test$
declare owner_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid(); s uuid; r uuid:=gen_random_uuid();
 data jsonb; doc jsonb; saved jsonb; result jsonb; quote jsonb; req uuid:=gen_random_uuid(); denied boolean; ref_id uuid; prod uuid; org uuid; batch uuid; receipt uuid;
 supplier_a uuid; supplier_b uuid; foreign_supplier uuid; foreign_org uuid;
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
 insert into public.suppliers(organization_id,supplier_code,name) values(org,'REGISTER-A','供應商甲') returning id into supplier_a;
 insert into public.suppliers(organization_id,supplier_code,name) values(org,'REGISTER-B','供應商乙') returning id into supplier_b;
 insert into public.organizations(name) values('隔離測試其他企業') returning id into foreign_org;
 insert into public.suppliers(organization_id,supplier_code,name) values(foreign_org,'REGISTER-X','外部供應商') returning id into foreign_supplier;
 quote:=jsonb_build_object('name','測試食材','unit','g','price',999,'source','手動補價','effective_date','2026-10-01','supplier_id',supplier_a,'supplier_name','應以主檔名稱為準','specification','750g／包','purchase','{"amount":150,"quantity":1,"unit":"包","content_quantity":750,"content_unit":"g"}'::jsonb);
 req:=gen_random_uuid();result:=private.recipe_operation(s,'recipe.price',quote,req);
 assert private.recipe_operation(s,'recipe.price',quote,req)=result,'retry duplicated a supplier quote';
 select value into result from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='n:測試食材';
 assert (result->>'price')::numeric=.2,'server trusted fake normalized price';
 assert result->'source_ref'->>'supplier_name'='供應商甲','supplier identity not canonical';
 assert result->'source_ref'->>'specification'='750g／包','specification missing';
 doc:='{"name":"來源測試","kind":"prep","yield":"1100","unit":"g","lines":[{"id":"a","name":"測試食材","quantity":"500","unit":"g"}],"notes":""}';
 saved:=private.recipe_operation(s,'recipe.save',jsonb_build_object('id',r,'revision',0,'document',doc),gen_random_uuid());
 assert (saved->'cost'->>'total')::numeric=100,'recipe cost did not use saved base unit';
 quote:=quote||jsonb_build_object('supplier_id',supplier_b,'effective_date','2026-10-02','purchase','{"amount":180,"quantity":1,"unit":"包","content_quantity":750,"content_unit":"g"}'::jsonb);
 perform private.recipe_operation(s,'recipe.price',quote,gen_random_uuid());
 data:=private.recipe_workspace(s);
 assert jsonb_array_length(data->'price_references')=2,'supplier history collapsed';
 assert jsonb_array_length(data->'suppliers')=2,'suppliers leaked from another organization';
 assert (private.recipe_cost(s,doc)->>'total')::numeric=120,'latest supplier price not applied';
 denied:=false;begin perform private.recipe_operation(s,'recipe.price',quote||jsonb_build_object('supplier_id',foreign_supplier),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'foreign supplier accepted';
 -- Package conversion may follow this supplier only.
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'進貨名稱750g','包','包') returning id into prod;
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,purchase,source_ref)
 values(s,'食譜別名','g',.4,'歷史食譜',null,owner_id,'history','{"amount":300,"quantity":1,"unit":"包","content_quantity":750,"content_unit":"g"}',jsonb_build_object('product_id',prod,'supplier_id',supplier_a));
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,status) values(org,s,'價格對照測試',owner_id,'2026-10-03','COMPLETED') returning id into batch;
 insert into public.goods_receipts(organization_id,store_id,source_batch_id,receipt_date,supplier_id) values(org,s,batch,'2026-10-03',supplier_b) returning id into receipt;
 insert into public.receipt_lines(organization_id,receipt_id,product_id,unit,quantity,unit_price_ex_tax) values(org,receipt,prod,'包',1,375);
 select value into result from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='n:食譜別名';assert (result->>'price')::numeric=.4,'unrelated supplier reused package conversion';
 insert into public.receipt_lines(organization_id,receipt_id,product_id,supplier_id,unit,quantity,unit_price_ex_tax) values(org,receipt,prod,supplier_a,'包',1,375);
 select value into result from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='n:食譜別名';assert (result->>'price')::numeric=.5,'confirmed supplier package did not follow receipts';
 assert result->>'supplier_name'='供應商甲','line supplier ignored';
 -- Explicit matching must retain the recipe name identity and its high estimate.
 quote:=jsonb_build_object('name','食譜別名','unit','g','price',.4,'source','手動補價','effective_date','2026-10-02','supplier_id',supplier_a,'matched_product_id',prod,
 'purchase','{"amount":300,"quantity":1,"unit":"包","content_quantity":750,"content_unit":"g","cost_unit_price":450}'::jsonb);
 perform private.recipe_operation(s,'recipe.price',quote,gen_random_uuid());
 select value into result from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='n:食譜別名';
 assert (result->>'cost_price')::numeric=.6,'new receipt discarded high estimate';
 doc:='{"name":"連動配件","kind":"prep","yield":"500","unit":"g","lines":[{"id":"a","name":"食譜別名","quantity":"500","unit":"g"}],"notes":""}';
 ref_id:=gen_random_uuid();
 perform private.recipe_operation(s,'recipe.save',jsonb_build_object('id',ref_id,'revision',0,'document',doc),gen_random_uuid());
 saved:=jsonb_build_object('name','連動主食譜','kind','dish','yield','1','unit','份','lines',jsonb_build_array(jsonb_build_object('id','p','name','連動配件','recipe_id',ref_id,'quantity','100','unit','g')),'notes','');
 assert (private.recipe_cost(s,saved)->>'total')::numeric=60,'initial parent cost incorrect';
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,status) values(org,s,'價格連動測試',owner_id,'2026-10-04','COMPLETED') returning id into batch;
 insert into public.goods_receipts(organization_id,store_id,source_batch_id,receipt_date,supplier_id) values(org,s,batch,'2026-10-04',supplier_a) returning id into receipt;
 insert into public.receipt_lines(organization_id,receipt_id,product_id,unit,quantity,unit_price_ex_tax) values(org,receipt,prod,'包',1,600);
 select value into result from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='n:食譜別名';
 assert (result->>'price')::numeric=.8 and (result->>'cost_price')::numeric=.8,'rise above estimate not applied';
 assert (result->>'previous_price')::numeric=.5,'comparable prior receipt missing';
 assert (private.recipe_cost(s,saved)->>'total')::numeric=80,'price increase did not cascade to parent';
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,status) values(org,s,'價格連動測試',owner_id,'2026-10-05','COMPLETED') returning id into batch;
 insert into public.goods_receipts(organization_id,store_id,source_batch_id,receipt_date,supplier_id) values(org,s,batch,'2026-10-05',supplier_a) returning id into receipt;
 insert into public.receipt_lines(organization_id,receipt_id,product_id,unit,quantity,unit_price_ex_tax) values(org,receipt,prod,'包',1,375);
 select value into result from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='n:食譜別名';
 assert (result->>'price')::numeric=.5 and (result->>'cost_price')::numeric=.6,'fall should retain high estimate';
 assert (result->>'previous_price')::numeric=.8,'movement used estimate instead of actual price';
 assert (private.recipe_cost(s,saved)->>'total')::numeric=60,'fall recalculation incorrect';
 assert (select document=doc and revision=1 from private.recipe_cards where id=ref_id),'automatic update changed quantities';
 assert (select (cost_snapshot->>'total')::numeric=300 from private.recipe_versions where recipe_id=ref_id),'historical component snapshot changed';
 -- A changed recorded package cannot reuse an old package weight.
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,status) values(org,s,'價格連動測試',owner_id,'2026-10-06','COMPLETED') returning id into batch;
 insert into public.goods_receipts(organization_id,store_id,source_batch_id,receipt_date,supplier_id) values(org,s,batch,'2026-10-06',supplier_a) returning id into receipt;
 insert into public.receipt_lines(organization_id,receipt_id,product_id,unit,quantity,unit_price_ex_tax,specification) values(org,receipt,prod,'包',1,1000,'1kg／包');
 select value into result from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='n:食譜別名';
 assert (result->>'price')::numeric=.5,'changed package reused 750g conversion';
 assert (result->>'conversion_pending')::boolean,'changed package was not flagged for confirmation';
 select value into result from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'='p:'||prod;
 assert result->>'previous_price' is null,'unlike package marked as a comparable price change';
 -- Matching a different organization's product is forbidden.
 insert into public.products(organization_id,name,base_unit,count_unit) values(foreign_org,'外部食材','包','包') returning id into req;
 denied:=false;begin perform private.recipe_operation(s,'recipe.price',quote||jsonb_build_object('matched_product_id',req),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'foreign product alias accepted';
 doc:='{"name":"來源測試","kind":"prep","yield":"1100","unit":"g","lines":[{"id":"a","name":"測試食材","quantity":"500","unit":"g"}],"notes":""}';
  -- Existing manual high estimates remain intact.
 quote:='{"name":"測試食材","unit":"g","price":0.3,"source":"手動補價","effective_date":"2026-10-04","purchase":{"amount":180,"quantity":1,"unit":"台斤","cost_unit_price":210}}';
 perform private.recipe_operation(s,'recipe.price',quote,gen_random_uuid());
 assert (private.recipe_cost(s,doc)->>'total')::numeric=175,'manual estimate lost';
 assert (select document=doc and revision=1 from private.recipe_cards where id=r),'price updates changed the recipe';
 assert (select (cost_snapshot->>'total')::numeric=100 from private.recipe_versions where recipe_id=r),'historical snapshot was rewritten';
 assert (select relrowsecurity from pg_class where oid='private.recipe_price_entries'::regclass),'RLS disabled';
 assert not has_table_privilege('authenticated','private.recipe_price_entries','SELECT'),'raw quotes exposed directly';
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);
 denied:=false;begin perform private.recipe_operation(s,'recipe.price',quote,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'outsider wrote prices';
 denied:=false;begin perform private.recipe_workspace(s);exception when insufficient_privilege then denied:=true;end;assert denied,'outsider read candidates';
 assert private.recipe_prices(s)='[]'::jsonb,'outsider read prices';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 assert private.recipe_prices(s)='[]'::jsonb,'anonymous read prices';
 raise exception using errcode='Z9905',message='PRICE_REGISTER_TEST_ROLLBACK';
 exception when sqlstate 'Z9905' then null;
 end;
end $test$;
