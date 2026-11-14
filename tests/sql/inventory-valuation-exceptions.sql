begin;
do $test$
declare
 actor uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 shop uuid:=gen_random_uuid(); product uuid:=gen_random_uuid(); supplier uuid:=gen_random_uuid();
 batch uuid:=gen_random_uuid(); other_batch uuid:=gen_random_uuid(); newer_batch uuid:=gen_random_uuid();
 zone uuid; session_id uuid; row_id text; r jsonb; q jsonb; expected jsonb; choice jsonb; offers jsonb; edit jsonb; master uuid; historical_reference uuid; month date:='2026-10-01';
begin
 assert not has_function_privilege('anon','public.baihuayuan_inventory_price_lookup(uuid,text,date,text,text)','EXECUTE');
 assert not has_function_privilege('anon','public.save_baihuayuan_inventory_valuation(uuid,date,uuid,text,jsonb,jsonb)','EXECUTE');
 assert not has_function_privilege('anon','public.save_baihuayuan_inventory_valuation(uuid,date,uuid,text,jsonb,jsonb,jsonb)','EXECUTE');
 assert not has_table_privilege('authenticated','private.inventory_unit_conversions','SELECT');
 assert not has_function_privilege('authenticated','private.inventory_count_quote(uuid,uuid,text,text,date,text)','EXECUTE');
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@inventory-valuation.invalid',now() from unnest(array[actor,staff]) id;
 insert into public.profiles(id,display_name) select id,'計價測試' from unnest(array[actor,staff]) id on conflict do nothing;
 insert into public.organizations(id,name,business_type,store_mode) values(org,'計價測試','SINGLE_RESTAURANT','MULTI');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(shop,org,'BeApe','V'||substr(shop::text,1,8),actor);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values
  (org,actor,'OWNER',true,true),(org,staff,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'計價測試',actor from unnest(array[actor,staff]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values
  (shop,org,actor,'valuation-owner','OWNER','OWNER',actor,true),(shop,org,staff,'valuation-staff','STAFF','STAFF',actor,false);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.products(id,organization_id,name,category,count_unit,base_unit,specification)
 values(product,org,'測試白蝦','食材','隻','隻','20尾');
 insert into public.suppliers(id,organization_id,name) values(supplier,org,'甲供應商');
 insert into private.supplier_details(supplier_id,aliases,updated_by) values(supplier,array['甲公司'],actor);
 insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,batch_number,status,group_mode) values
  (batch,org,shop,'BeApe','2026-10-11',actor,'IV-OLD','READY_FOR_REVIEW','SAME_RECEIPT'),
  (other_batch,org,shop,'BeApe','2026-10-16',actor,'IV-OTHER','READY_FOR_REVIEW','SAME_RECEIPT'),
  (newer_batch,org,shop,'BeApe','2026-10-30',actor,'IV-FUTURE','READY_FOR_REVIEW','SAME_RECEIPT');
 insert into private.recipe_price_entries(store_id,product_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,source_ref,source_key)
 select shop,product,'測試白蝦','公斤',price,'已核對進貨明細',receipt_date,actor,'purchase','confirmed',
  jsonb_build_object('batch_id',id,'row_key','a','specification','20尾','supplier_name',seller),'receipt:'||id||':a'
 from (values(batch,240,'2026-10-11'::date,'甲供應商'),(other_batch,600,'2026-10-16'::date,'乙供應商'),
  (newer_batch,300,'2026-10-30'::date,'甲公司')) q(id,price,receipt_date,seller);
 insert into private.receipt_entry_items(batch_id,row_key,product_id,supplier_name,receipt_date,unit,unit_price,recorded_by)
 select (source_ref->>'batch_id')::uuid,'a',r.product_id,source_ref->>'supplier_name',effective_date,unit,price,actor
 from private.recipe_price_entries r where store_id=shop;
 insert into public.count_zones(organization_id,store_id,name) values(org,shop,'計價區') returning id into zone;
 insert into public.zone_products(zone_id,product_id,count_unit) values(zone,product,'隻');
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot,started_at,completed_at)
 values(org,shop,actor,'REVIEWING',jsonb_build_object('zones',jsonb_build_array(
  jsonb_build_object('zone_id',zone,'zone_name','計價區','product_id',product,'product_name','測試白蝦','unit','隻','supplier','甲公司'))),
  '2026-10-20 03:00Z','2026-10-31 08:00Z') returning id into session_id;
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,entered_at)
 values(org,session_id,zone,product,8,'隻',actor,'INITIAL_COUNT','2026-10-20 11:00Z');

 r:=public.baihuayuan_inventory_month(shop,month)#>'{rows,0}';
 row_id:=r->>'row_key'; q:=r->'inventory_cost_quote';
 assert q->>'batch_id'=batch::text and q#>>'{purchase,amount}'='240' and r->>'amount' is null,'used future or other supplier price, or guessed the conversion';
 expected:=jsonb_build_object('source_signature',r->'source_signature','values',jsonb_build_object(
  'name',r->'name','unit',r->'unit','quantity',r->'current_quantity','price',r->'unit_price','note',r->'review_note'));
 choice:=jsonb_build_object('quote',q,'automatic',true,'count_per_unit',20);
 set local role authenticated;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.save_baihuayuan_inventory_valuation(shop,month,session_id,row_id,expected,choice);
  raise exception 'staff saved a conversion'; exception when insufficient_privilege then null;end;
 begin perform public.baihuayuan_inventory_price_lookup(shop,'測試白蝦','2026-10-20');
  raise exception 'staff looked up inventory prices'; exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 offers:=public.baihuayuan_inventory_price_lookup(shop,'測試白蝦','2026-10-20','','甲公司');
 assert jsonb_array_length(offers)=2 and offers#>>'{0,quote,purchase,amount}'='240','lookup ignored date or supplier rank';
 begin
  perform public.save_baihuayuan_inventory_valuation(shop,month,session_id,row_id,expected,
   jsonb_build_object('quote',offers->0->'quote','automatic',false,'weight_kg',0.42));
  r:=public.baihuayuan_inventory_month(shop,month)#>'{rows,0}';
  assert (r->>'amount')::numeric=100.80,'searched offer did not save valuation';
  raise exception using errcode='ZX003',message='rollback lookup save scenario';
 exception when sqlstate 'ZX003' then null;end;
 begin
  choice:=jsonb_build_object('quote',offers->0->'quote','automatic',false,'weight_kg',0.42);
  edit:=jsonb_build_object('name','編輯白蝦','unit','隻','quantity',10,'note','同次核對','request_id',gen_random_uuid());
  assert (public.save_baihuayuan_inventory_valuation(shop,month,session_id,row_id,expected,choice,edit)->>'saved')::boolean;
  r:=public.baihuayuan_inventory_month(shop,month)#>'{rows,0}';
  assert r->>'name'='編輯白蝦' and (r->>'current_quantity')::numeric=10 and r->>'review_note'='同次核對','row edits did not save with price';
  assert r#>>'{price_purchase,amount}'='240' and (r->>'amount')::numeric=100.80,'saved price did not use current draft quantity';
  assert (public.save_baihuayuan_inventory_valuation(shop,month,session_id,row_id,expected,choice,edit)->>'replayed')::boolean;
  begin perform public.save_baihuayuan_inventory_valuation(shop,month,session_id,row_id,expected,choice,jsonb_set(edit,'{quantity}','11'));
   raise exception 'different edits reused saved request';exception when serialization_failure then null;end;
  raise exception using errcode='ZX004',message='rollback edit and price scenario';
 exception when sqlstate 'ZX004' then null;end;
 choice:=jsonb_build_object('quote',q,'automatic',true,'count_per_unit',20);
 begin perform public.save_baihuayuan_inventory_valuation(shop,month,session_id,row_id,expected,
  jsonb_set(choice,'{quote,purchase,amount}','123'));
  raise exception 'stale receipt accepted'; exception when serialization_failure then null;end;
 begin
  choice:=jsonb_build_object('quote',q,'automatic',true,'weight_kg',0.42);
  perform public.save_baihuayuan_inventory_valuation(shop,month,session_id,row_id,expected,choice);
  r:=public.baihuayuan_inventory_month(shop,month)#>'{rows,0}';
  assert (r->>'amount')::numeric=100.80 and (r->>'current_quantity')::numeric=8 and r->>'unit'='隻','actual weight changed physical count or value';
  assert r#>>'{price_purchase,amount}'='240','original purchase lost';
  assert (public.save_baihuayuan_inventory_valuation(shop,month,session_id,row_id,expected,choice)->>'replayed')::boolean;
  raise exception using errcode='ZX002',message='rollback actual-weight scenario';
 exception when sqlstate 'ZX002' then null;end;
 choice:=jsonb_build_object('quote',q,'automatic',true,'count_per_unit',20);
 perform public.save_baihuayuan_inventory_valuation(shop,month,session_id,row_id,expected,choice);
 r:=public.baihuayuan_inventory_month(shop,month)#>'{rows,0}';
 assert (r->>'amount')::numeric=96 and (r->>'price_is_automatic')::boolean,'conversion was not saved as automatic';
 assert (public.save_baihuayuan_inventory_valuation(shop,month,session_id,row_id,expected,choice)->>'replayed')::boolean;
 reset role;
 assert (private.inventory_count_quote(shop,product,null,'隻','2026-11-01','甲供應商')->>'price')::numeric=15,'same product and supplier did not reuse conversion';
 assert private.inventory_count_quote(shop,product,null,'隻','2026-11-01','乙供應商')->>'price' is null,'conversion leaked to another supplier';
 assert (select count(*) from private.inventory_unit_conversions where store_id=shop)=1,'duplicate conversion';
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,source_ref,purchase)
 values(shop,'歷史麵粉 1K','包',32,'請購表','2026-07-15',actor,'purchase','confirmed','{"supplier_name":"甲供應商"}','{"unit":"包","amount":32,"quantity":1}')
 returning id into historical_reference;
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,selected_reference,review_status,updated_by)
 values(shop,'歷史麵粉 1K','包',32,true,historical_reference,'confirmed',actor) returning id into master;
 insert into private.ingredient_supply_state(store_id,ingredient_id,supplier_key,supplier_name,stopped,updated_by)
 values(shop,master,'*','',true,actor);
 offers:=public.baihuayuan_inventory_price_lookup(shop,'歷史麵粉1k','2026-10-20',private.managed_ingredient_code(master),'甲公司');
 assert jsonb_array_length(offers)=1 and (offers#>>'{0,stopped}')::boolean and offers#>>'{0,quote,purchase,amount}'='32','stopped history was hidden';
 assert private.inventory_manual_source_exists(shop,offers->0->'quote');
 assert (select unit='隻' and quantity=8 from public.count_entries where product_id=product),'original physical count changed';
end
$test$;
rollback;
select 'PASS: count-date price, supplier aliases, conversion, actual weight, staff denial and retry' as result;
