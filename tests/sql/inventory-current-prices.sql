begin;
do $test$
declare
 actor uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 shop uuid:=gen_random_uuid(); peer uuid:=gen_random_uuid(); product uuid:=gen_random_uuid(); peer_product uuid:=gen_random_uuid(); zero_product uuid:=gen_random_uuid();
 master uuid:=gen_random_uuid(); peer_master uuid:=gen_random_uuid(); duplicate uuid:=gen_random_uuid();
 old_batch uuid:=gen_random_uuid(); new_batch uuid:=gen_random_uuid(); peer_batch uuid:=gen_random_uuid(); pending_batch uuid:=gen_random_uuid();
 old_price uuid:=gen_random_uuid(); peer_price uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();
 alternate_supplier uuid:=gen_random_uuid(); legacy_supplier uuid:=gen_random_uuid(); alternate_receipt uuid; alternate_line uuid; kept_code text;
 z uuid; session_id uuid; posted_receipt uuid; posted_line uuid; d jsonb; r jsonb; snapshot jsonb; change jsonb; versions jsonb;
begin
 assert not has_table_privilege('authenticated','private.live_ingredient_receipt_prices','SELECT'),'receipt prices exposed directly';
 assert not has_function_privilege('authenticated','private.inventory_price_quote(uuid,uuid,text,text,date)','EXECUTE'),'private quotes exposed';
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@inventory-price.invalid',now() from unnest(array[actor,staff]) id;
 insert into public.profiles(id,display_name) select id,'價格隔離測試' from unnest(array[actor,staff]) id on conflict do nothing;
 insert into public.organizations(id,name,business_type,store_mode) values(org,'價格隔離測試','SINGLE_RESTAURANT','MULTI');
 insert into public.stores(id,organization_id,name,store_code,created_by) values
  (shop,org,'BeApe','PV'||substr(shop::text,1,8),actor),(peer,org,'Gras','PV'||substr(peer::text,1,8),actor);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values
  (org,actor,'OWNER',true,true),(org,staff,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'價格隔離測試',actor from unnest(array[actor,staff]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values
  (shop,org,actor,'pv-owner','OWNER','OWNER',actor,true),(peer,org,actor,'pv-owner-b','OWNER','OWNER',actor,true),(shop,org,staff,'pv-staff','STAFF','STAFF',actor,false);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.products(id,organization_id,name,category,count_unit,base_unit,specification) values
  (product,org,'測試塔殼','食材','包','包','500g'),(peer_product,org,'測試塔殼同編碼','食材','包','包','500g'),(zero_product,org,'無價格品項','食材','顆','顆','');
 insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,batch_number,status,group_mode) values
  (old_batch,org,shop,'BeApe','2026-10-11',actor,'PV-OLD','COMPLETED','SAME_RECEIPT'),
  (new_batch,org,shop,'BeApe','2026-10-30',actor,'PV-NEW','COMPLETED','SAME_RECEIPT'),
  (peer_batch,org,peer,'Gras','2026-10-15',actor,'PV-PEER','COMPLETED','SAME_RECEIPT'),
  (pending_batch,org,shop,'BeApe','2026-10-18',actor,'PV-PENDING','READY_FOR_REVIEW','SAME_RECEIPT');
 insert into private.recipe_price_entries(id,store_id,product_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,source_ref,source_key)
 select id,store_id,item,'測試塔殼','包',price,'已核對進貨明細',effective_date,actor,'purchase','confirmed',
  jsonb_build_object('batch_id',batch,'row_key','a','specification','500g','supplier_name','測試供應商'),'receipt:'||batch||':a'
 from (values
  (old_price,shop,product,240,'2026-10-11'::date,old_batch),
  (gen_random_uuid(),shop,product,300,'2026-10-30'::date,new_batch),
  (peer_price,peer,peer_product,260,'2026-10-15'::date,peer_batch),
  (gen_random_uuid(),shop,product,999,'2026-10-18'::date,pending_batch)
 ) q(id,store_id,item,price,effective_date,batch);
 -- Batch status alone is not confirmed price evidence: model completed entry.
 insert into private.receipt_entry_items(batch_id,row_key,product_id,supplier_name,receipt_date,unit,unit_price,recorded_by)
 select (r.source_ref->>'batch_id')::uuid,'a',r.product_id,'測試供應商',r.effective_date,r.unit,r.price,actor
 from private.recipe_price_entries r where r.store_id in(shop,peer) and r.source_ref->>'batch_id'<>pending_batch::text;
 update public.receipt_upload_batches set status='READY_FOR_REVIEW' where id in(old_batch,new_batch,peer_batch);
 perform set_config('app.standard_effective_date','2026-10-01',true);
 insert into private.ingredient_masters(id,store_id,name,unit,cost_price,manual,review_status,purchase,updated_by) values
  (master,shop,'測試塔殼','g',0.4,true,'confirmed','{"amount":200,"quantity":1,"unit":"包","content_quantity":500,"content_unit":"g"}',actor),
  (peer_master,peer,'測試塔殼同編碼','g',0.45,true,'confirmed','{"amount":225,"quantity":1,"unit":"包","content_quantity":500,"content_unit":"g"}',actor),
  (duplicate,shop,'舊測試塔殼','包',199,false,'confirmed','{"amount":199,"quantity":1,"unit":"包"}',actor);
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,reference_ids) values
  (shop,master,'測試塔殼','p:'||product,'包',array[old_price]),
  (peer,peer_master,'測試塔殼同編碼','p:'||peer_product,'包',array[peer_price]);
 insert into private.ingredient_code_links(ingredient_id,target_id,actor_id) values(peer_master,master,actor);

 d:=private.inventory_price_quote(shop,product,null,'包','2026-10-20');
 assert (d->>'price')::numeric=240 and d->>'batch_id'=old_batch::text,'store priority, cut-off or provenance';
 assert (private.inventory_price_quote(shop,product,null,'公斤','2026-10-20')->>'price')::numeric=480,'package to kilograms';
 assert private.inventory_price_quote(shop,product,null,'打','2026-10-20')->>'price' is null,'unverified conversion';
 assert private.inventory_price_quote(shop,product,null,'包','2026-09-30')->>'price' is null,'future standard';
 assert (private.inventory_price_quote(shop,product,null,'包','2026-10-09')->>'price')::numeric=200,'as-of standard';
 assert (private.inventory_latest_price_quote(shop,product,null,'包','2026-10-20')->>'price')::numeric=300,'latest price for open inventory';
 assert not has_function_privilege('anon','public.baihuayuan_receipt_price_changes(uuid,uuid,jsonb)','EXECUTE');
 set local role authenticated;
 change:=jsonb_build_object('header',jsonb_build_object('supplier_name','測試供應商','receipt_date','2026-10-20'),
  'lines',jsonb_build_array(jsonb_build_object('row_key','a','product_name','測試塔殼','specification','500g','unit','包','unit_price',255)));
 r:=public.baihuayuan_receipt_price_changes(shop,pending_batch,change);
 assert (r#>>'{0,before}')::numeric=240 and (r#>>'{0,after}')::numeric=255,'raw price comparison';
 assert public.baihuayuan_receipt_price_changes(shop,pending_batch,change)=r,'same read changed the price or receipt';
 assert public.baihuayuan_receipt_price_changes(shop,pending_batch,jsonb_set(change,'{lines,0,specification}','"1kg"'))='[]'::jsonb,'compared a different package';
 begin perform public.baihuayuan_receipt_price_changes(peer,pending_batch,change);
  raise exception 'cross-store price lookup accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.baihuayuan_receipt_price_changes(shop,pending_batch,change);
  raise exception 'staff price lookup accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 reset role;
 insert into private.baihuayuan_record_flags(organization_id,store_id,entity_type,entity_id,state,updated_by) values(org,shop,'RECEIPT_BATCH',old_batch,'REMOVED',actor);
 d:=private.inventory_price_quote(shop,product,null,'包','2026-10-20');
 assert (d->>'price')::numeric=200 and d->>'basis'='standard' and d->>'store_id' is null,'local standard stays in scope instead of borrowing a peer receipt';
 assert private.inventory_price_quote(shop,peer_product,null,'包','2026-10-20')->>'price' is null,'shared product alone cannot pull the peer receipt into local inventory';
 assert (private.inventory_price_quote(peer,peer_product,null,'包','2026-10-20')->>'price')::numeric=260,'peer receipt remains available in its own store';
 update private.recipe_price_entries set source_ref=source_ref||'{"specification":"1kg"}' where id=peer_price;
 assert (private.inventory_price_quote(shop,product,null,'包','2026-10-20')->>'price')::numeric=200,'incompatible peer package';
 -- Previously confirmed small-pack count prices retain the explicit pack split.
 update private.ingredient_standard_versions set actor_id=null where ingredient_id=master;
 insert into private.ingredient_standard_baselines(store_id,product_id,name,unit,quote)
 values(shop,product,'測試塔殼','包','{"price":15.8,"date":"2026-10-01","basis":"confirmed_baseline"}');
 assert (private.inventory_price_quote(shop,product,null,'包','2026-10-20')->>'price')::numeric=15.8,'confirmed pack split replaced with bulk price';
 update private.baihuayuan_record_flags set state='LIVE' where entity_id=old_batch;
 assert private.inventory_price_quote(shop,product,null,'包','2026-10-20')->>'price' is null,'cost-only count pack silently assumed bulk package';
 update private.ingredient_standard_baselines set quote=quote||'{"purchase":{"amount":15.8,"quantity":1,"unit":"包","content_quantity":500,"content_unit":"g"}}' where store_id=shop and product_id=product;
 assert (private.inventory_price_quote(shop,product,null,'包','2026-10-20')->>'price')::numeric=240,'explicit count package conversion not used';


 update public.receipt_upload_batches set status='COMPLETED' where id=peer_batch;
 insert into public.goods_receipts(organization_id,store_id,source_batch_id,receipt_date,document_number,subtotal_ex_tax,reviewed_by,reviewed_at)
 values(org,peer,peer_batch,'2026-10-16','PV-POSTED',360,actor,now()) returning id into posted_receipt;
 insert into public.receipt_lines(organization_id,receipt_id,product_id,quantity,unit,unit_price_ex_tax,specification)
 values(org,posted_receipt,peer_product,1,'包',360,'500g') returning id into posted_line;
 assert exists(select 1 from private.live_ingredient_receipt_prices where id=posted_line and price=360),'posted legacy receipt missing';

 insert into public.count_zones(organization_id,store_id,name) values(org,shop,'測試區') returning id into z;
 insert into public.zone_products(zone_id,product_id,count_unit) values(z,product,'包'),(z,zero_product,'顆');
 snapshot:=jsonb_build_object('zones',jsonb_build_array(
  jsonb_build_object('zone_id',z,'zone_name','測試區','product_id',product,'product_name','測試塔殼','unit','包'),
  jsonb_build_object('zone_id',z,'zone_name','測試區','product_id',zero_product,'product_name','無價格品項','unit','顆')));
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot,started_at,completed_at)
 values(org,shop,actor,'REVIEWING',snapshot,'2026-10-20 03:00Z','2026-10-31 08:00Z') returning id into session_id;
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,entered_at)
 values(org,session_id,z,product,2,'包',actor,'INITIAL_COUNT','2026-10-20 11:00Z'),
  (org,session_id,z,zero_product,0,'顆',actor,'INITIAL_COUNT','2026-10-20 11:05Z');

 set local role authenticated;
 d:=public.baihuayuan_inventory_month(shop,'2026-10-01');
 assert d->>'count_date'='2026-10-20','physical count date';
 select x into r from jsonb_array_elements(d->'rows') x where x->>'product_id'=product::text;
 assert (r->>'unit_price')::numeric=300 and (r->>'amount')::numeric=600 and r->>'price_batch_id'=new_batch::text,'automatic report valuation uses the latest confirmed data';
 assert r#>>'{price_purchase,amount}'='300' and r#>>'{price_purchase,unit}'='包','report does not expose the original purchase evidence';
 assert r->>'price_source' like '%原進價 NT$ 300／包','original purchase evidence is missing from the price details';
 assert not has_function_privilege('authenticated','private.inventory_purchase_label(jsonb)','execute');
 select x into r from jsonb_array_elements(d->'rows') x where x->>'product_id'=zero_product::text;
 assert (r->>'amount')::numeric=0 and not (r->>'missing_price')::boolean,'zero quantity';
 assert exists(select 1 from jsonb_array_elements(public.baihuayuan_ingredient_prices(shop)->'ingredients') m
  cross join lateral jsonb_array_elements(m->'sources') ref where ref->>'id'=old_price::text and (ref->>'receipt_price')::numeric=240),'price sheet receipt evidence';
 reset role;

 insert into private.inventory_month_closures(store_id,month,session_id,payload,confirmed_by) values(shop,'2026-10-01',session_id,d,actor);
 update private.recipe_price_entries set price=500 where id=old_price;
 assert (private.inventory_month_state(shop,'2026-10-01',null)#>>'{summary,subtotal}')::numeric=600,'closed amount changed';
 select jsonb_agg(to_jsonb(v) order by id) into versions from private.ingredient_standard_versions v where store_id=shop;
 change:=jsonb_build_object('id',duplicate,'revision',(select revision from private.ingredient_masters where id=duplicate),
  'target_id',master,'target_revision',(select revision from private.ingredient_masters where id=master));

 set local role authenticated;
 r:=public.baihuayuan_ingredient_prices(shop,'merge_duplicate',change,request_id);
 assert r->>'target_id'=master::text,'duplicate link failed';
 assert public.baihuayuan_ingredient_prices(shop,'merge_duplicate',change,request_id)=r,'duplicate retry';
 begin perform public.baihuayuan_ingredient_prices(shop,'merge_duplicate',change,gen_random_uuid());
  raise exception 'stale revision accepted';exception when serialization_failure then null;end;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.baihuayuan_ingredient_prices(shop,'merge_duplicate',change,request_id);
  raise exception 'staff merge accepted';exception when insufficient_privilege then null;end;
 reset role;
 assert (select canonical_ingredient_id=master and cost_price=199 from private.ingredient_masters where id=duplicate),'legacy price or identity lost';
 assert (select jsonb_agg(to_jsonb(v) order by id) from private.ingredient_standard_versions v where store_id=shop) is not distinct from versions,'standard history modified by merge';

 assert not has_function_privilege('authenticated','private.locked_ingredient_quote(jsonb,date,text,text,jsonb)','EXECUTE');
 change:=jsonb_build_object('id',master,'revision',(select revision from private.ingredient_masters where id=master),
  'name','測試塔殼','unit','g','cost_price',0.4,'effective_date','2026-10-20','change_reason','鎖定進價',
  'purchase',jsonb_build_object('amount',200,'quantity',1,'unit','包','content_quantity',500,'content_unit','g'));
 request_id:=gen_random_uuid();
 set local role authenticated;
 begin perform public.baihuayuan_ingredient_prices(shop,'save',change,request_id);
  raise exception 'staff locked a price';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 r:=public.baihuayuan_ingredient_prices(shop,'save',change,request_id);
 assert public.baihuayuan_ingredient_prices(shop,'save',change,request_id)=r,'lock retry';
 reset role;
 assert (select count(*) from private.ingredient_standard_versions where ingredient_id=master and reason='鎖定進價')=1,'lock history duplicated';
 assert (private.inventory_latest_price_quote(shop,product,null,'包','2026-10-31')->>'price')::numeric=200,'open inventory ignored lock';
 d:=private.resolved_cost_quote(shop,product,null,'包','2026-10-31');
 assert d->>'basis'='locked' and (d->>'price')::numeric=200,'transfer and waste ignored lock';
 d:=private.automatic_cost_quote_cached(shop,null,'測試塔殼','公斤','2026-10-31',master,private.automatic_cost_context(shop,'2026-10-31'));
 assert d->>'basis'='locked' and (d->>'price')::numeric=400 and d#>>'{purchase,unit}'='包','recipe unit or source purchase incorrect';
 assert (private.inventory_month_state(shop,'2026-10-01',null)#>>'{summary,subtotal}')::numeric=600,'lock changed a closed month';
 insert into public.suppliers(id,organization_id,name,is_active) values
  (alternate_supplier,org,'測試新供應商',true),(legacy_supplier,org,'新供應商簡稱',true);
 insert into private.supplier_name_links(organization_id,name_key,source_name,supplier_id,evidence)
 values(org,private.history_key('新供應商簡稱'),'新供應商簡稱',alternate_supplier,'FIXTURE');
 insert into private.supplier_name_links(organization_id,name_key,source_name,supplier_id,evidence)
 select org,private.history_key('測試供應商'),'測試供應商',alternate_supplier,'FIXTURE';
 update public.receipt_upload_batches set status='COMPLETED' where id=new_batch;
 insert into public.goods_receipts(organization_id,store_id,source_batch_id,receipt_date,document_number,subtotal_ex_tax,reviewed_by,reviewed_at,supplier_id)
 values(org,shop,new_batch,'2026-10-30','PV-SUPPLIER',220,actor,now(),legacy_supplier) returning id into alternate_receipt;
 insert into public.receipt_lines(organization_id,receipt_id,product_id,quantity,unit,unit_price_ex_tax,specification)
 values(org,alternate_receipt,product,1,'包',220,'800g') returning id into alternate_line;
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,specification,reference_ids)
 values(shop,master,'測試塔殼','p:'||product,'包','800g','{}');
 update private.ingredient_masters set canonical_ingredient_id=master where id=duplicate;
 kept_code:=private.managed_ingredient_code(master);
 change:=jsonb_build_object('id',master,'revision',(select revision from private.ingredient_masters where id=master),
  'name','新貨單塔殼','unit','g','cost_price',0.275,'effective_date','2026-10-31','change_reason','鎖定進價',
  'supplier_id',alternate_supplier,'supplier_receipt_id',alternate_line,
  'purchase',jsonb_build_object('amount',220,'quantity',1,'unit','包','content_quantity',800,'content_unit','g'));
 request_id:=gen_random_uuid();
 set local role authenticated;
 d:=public.baihuayuan_ingredient_prices(shop);
 assert not exists(select 1 from jsonb_array_elements(d->'suppliers') sp where sp->>'id'=legacy_supplier::text),'legacy supplier offered in the selector';
 assert exists(select 1 from jsonb_array_elements(d->'ingredients') i cross join lateral jsonb_array_elements(i->'sources') s
  where i->>'id'=master::text and s->>'id'=alternate_line::text and s->>'receipt_supplier'='測試新供應商'
   and s->>'supplier_key'='id:'||alternate_supplier and (s->>'receipt_price')::numeric=220),'receipt supplier name or price incorrect';
 assert exists(select 1 from jsonb_array_elements(d->'ingredients') i cross join lateral jsonb_array_elements(i->'sources') s
  where s#>>'{source_ref,supplier_name}'='測試供應商' and s->>'supplier_name'='測試新供應商'),'legacy source not projected or original changed';
 begin
  perform public.baihuayuan_ingredient_prices(shop,'save',jsonb_set(change,'{purchase,amount}','1'),gen_random_uuid());
  raise exception 'unverified supplier price accepted';exception when serialization_failure then null;
 end;
 r:=public.baihuayuan_ingredient_prices(shop,'save',change,request_id);
 assert r=public.baihuayuan_ingredient_prices(shop,'save',change,request_id),'supplier switch retry';
 reset role;
 assert (select supplier_id from public.goods_receipts where id=alternate_receipt)=legacy_supplier,'original supplier reference changed';
 assert private.managed_ingredient_code(master)=kept_code and (select canonical_ingredient_id=master from private.ingredient_masters where id=duplicate),'supplier switch changed the identity';
 assert exists(select 1 from private.ingredient_aliases where ingredient_id=master and name='測試塔殼'),'old invoice name lost';
 d:=private.resolved_cost_quote(shop,product,null,'公斤','2026-11-01');
 assert (d->>'price')::numeric=275 and d->>'supplier_name'='測試新供應商','supplier pack conversion or selection failed';
 assert (private.inventory_month_state(shop,'2026-10-01',null)#>>'{summary,subtotal}')::numeric=600,'supplier switch changed a closed month';
end $test$;
rollback;
select 'PASS: current receipt valuation, package conversion, store isolation, count date, price history, closed month, and merge permissions' as result;
