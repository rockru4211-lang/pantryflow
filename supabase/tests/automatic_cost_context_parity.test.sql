-- Reconstructed independent cached/scalar full JSON parity; isolated rollback only.
begin;
do $clone$ begin execute replace(pg_get_functiondef('private.automatic_cost_quote(uuid,uuid,text,text,date,uuid)'::regprocedure),'FUNCTION private.automatic_cost_quote(', 'FUNCTION private.test_reference_automatic_cost_quote(');end $clone$;
create or replace function private.automatic_cost_quote(s uuid,product uuid,nm text,u text,cutoff date,ingredient uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare original jsonb; cached jsonb; context jsonb;
begin
 original:=private.test_reference_automatic_cost_quote(s,product,nm,u,cutoff,ingredient);
 if cutoff is not null and auth.uid() is not null and private.recipe_allowed(s) and exists(select 1 from public.stores where id=s and is_active and name in('BeApe','Gras')) then
  context:=private.automatic_cost_context(s,cutoff);
  cached:=private.automatic_cost_quote_cached(s,product,nm,u,cutoff,ingredient,context);
  if original is distinct from cached then raise exception 'CACHE_PARITY_MISMATCH store=% product=% name=% unit=% cutoff=% ingredient=% original=% cached=%',s,product,nm,u,cutoff,ingredient,original,cached;end if;
 end if;
 return original;
end $$;
create function private.test_cost_parity_matrix(shop uuid,peer uuid,product uuid,peer_product uuid,master uuid,peer_master uuid) returns void
language plpgsql as $$
declare store_id uuid; day date; unit text; identity record; context jsonb;
begin
 foreach store_id in array array[shop,peer] loop
  foreach day in array array['2026-09-01'::date,'2026-10-20'::date,'2026-11-01'::date,'2026-12-20'::date] loop
   foreach unit in array array['g','公斤','包','顆','ml','','瓶'] loop
    for identity in select * from (values (product,null::text,null::uuid),(peer_product,null::text,null::uuid),(null::uuid,'測試塔殼',null::uuid),(null::uuid,'測試塔殼同編碼',null::uuid),(null::uuid,'unknown',null::uuid),(null::uuid,null::text,master),(null::uuid,null::text,peer_master),(gen_random_uuid(),null::text,null::uuid)) v(product_id,nm,ingredient_id) loop
     perform private.automatic_cost_quote(store_id,identity.product_id,identity.nm,unit,day,identity.ingredient_id);
    end loop;
   end loop;
  end loop;
 end loop;
 context:=private.automatic_cost_context(shop,null);
 assert private.automatic_cost_quote_cached(shop,product,null,'g',null,null,context)=private.test_reference_automatic_cost_quote(shop,product,null,'g',null,null),'null cutoff response';
 context:=private.automatic_cost_context(shop,'2026-10-20');
 begin perform private.automatic_cost_quote_cached(peer,product,null,'g','2026-10-20',null,context);raise exception 'wrong store context accepted';exception when raise_exception then if sqlerrm<>'INVALID_PRICE_CONTEXT' then raise;end if;end;
 begin perform private.automatic_cost_quote_cached(shop,product,null,'g','2026-10-21',null,context);raise exception 'wrong date context accepted';exception when raise_exception then if sqlerrm<>'INVALID_PRICE_CONTEXT' then raise;end if;end;
 assert not has_function_privilege('anon','private.automatic_cost_context(uuid,date)','EXECUTE');
 assert not has_function_privilege('authenticated','private.automatic_cost_context(uuid,date)','EXECUTE');
 assert not has_function_privilege('authenticated','private.automatic_cost_quote_cached(uuid,uuid,text,text,date,uuid,jsonb)','EXECUTE');
end $$;
-- Reconstructed from the prior verified fixture and retained source; all writes roll back.

do $test$
declare
 actor uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 shop uuid:=gen_random_uuid(); peer uuid:=gen_random_uuid(); product uuid:=gen_random_uuid(); peer_product uuid:=gen_random_uuid(); zero_product uuid:=gen_random_uuid();
 master uuid:=gen_random_uuid(); peer_master uuid:=gen_random_uuid(); duplicate uuid:=gen_random_uuid();
 old_batch uuid:=gen_random_uuid(); new_batch uuid:=gen_random_uuid(); peer_batch uuid:=gen_random_uuid(); pending_batch uuid:=gen_random_uuid();
 old_price uuid:=gen_random_uuid(); peer_price uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();
 name_recipe uuid:=gen_random_uuid(); ambiguous_master uuid:=gen_random_uuid(); supplier uuid:=gen_random_uuid();
 recipe uuid:=gen_random_uuid(); prep uuid:=gen_random_uuid(); doc jsonb; saved_cost jsonb; before_history jsonb; trial jsonb;
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

 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform private.automatic_cost_context(shop,'2026-10-20');raise exception 'outsider context accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform private.automatic_cost_context(shop,'2026-10-20');raise exception 'anonymous context accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform private.test_cost_parity_matrix(shop,peer,product,peer_product,master,peer_master);
 d:=private.inventory_price_quote(shop,product,null,'包','2026-10-20');
 assert (d->>'price')::numeric=240 and d->>'batch_id'=old_batch::text,'store priority, cut-off or provenance';
 assert (private.inventory_price_quote(shop,product,null,'公斤','2026-10-20')->>'price')::numeric=480,'package to kilograms';
 perform set_config('app.standard_effective_date','2026-12-01',true);
 update private.ingredient_masters set purchase='{"amount":400,"quantity":1,"unit":"包","content_quantity":1000,"content_unit":"g"}',revision=revision+1 where id=master;
 assert (private.automatic_cost_quote(shop,null,'測試塔殼','包','2026-10-20',master)->>'price')::numeric=240,'future package conversion leaked into backdated quote';
 perform set_config('app.standard_effective_date','2026-12-02',true);
 update private.ingredient_masters set purchase='{"amount":200,"quantity":1,"unit":"包","content_quantity":500,"content_unit":"g"}',revision=revision+1 where id=master;
 perform set_config('app.standard_effective_date','2026-10-01',true);

 assert private.inventory_price_quote(shop,product,null,'打','2026-10-20')->>'price' is null,'unverified conversion';
 assert private.inventory_price_quote(shop,product,null,'包','2026-09-30')->>'price' is null,'future standard';
 assert (private.inventory_price_quote(shop,product,null,'包','2026-10-09')->>'price')::numeric=200,'as-of standard';
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

 -- Latest business date wins over insertion time; invalid latest data blocks.
 assert (private.resolved_cost_quote(shop,product,null,'包','2026-11-01')->>'price')::numeric=300;
 update private.recipe_price_entries set created_at=now()+interval '1 hour' where id=old_price;
 assert (private.resolved_cost_quote(shop,product,null,'包','2026-11-01')->>'price')::numeric=300,'backdated save superseded newer receipt date';
 insert into private.recipe_price_entries(store_id,product_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,source_ref,source_key)
 values(shop,product,'測試塔殼','包',300.0000001,'已核對進貨明細','2026-10-30',actor,'purchase','confirmed',
 jsonb_build_object('batch_id',new_batch,'row_key','conflict','specification','500g','supplier_name','測試供應商'),'receipt:'||new_batch||':conflict');
 insert into private.receipt_entry_items(batch_id,row_key,product_id,supplier_name,receipt_date,unit,unit_price,recorded_by)
 values(new_batch,'conflict',product,'測試供應商','2026-10-30','包',300.0000001,actor);
 assert private.resolved_cost_quote(shop,product,null,'包','2026-11-01')->>'price' is null,'same-day conflict used a baseline';
 update private.receipt_entry_items set retired_at=now() where batch_id=new_batch and row_key='conflict';
 assert (private.resolved_cost_quote(shop,product,null,'包','2026-11-01')->>'price')::numeric=300;
 update private.recipe_price_entries set source_ref=source_ref||'{"specification":""}' where source_key='receipt:'||new_batch||':a';
 assert private.resolved_cost_quote(shop,product,null,'包','2026-11-01')->>'price' is null,'unknown latest package used an older quote';
 assert (private.resolved_cost_quote(shop,product,null,'包','2026-11-01')#>>'{purchase,amount}')::numeric=300,'unconvertible receipt lost its original purchase evidence';
 update private.recipe_price_entries set source_ref=source_ref||'{"specification":"500g"}' where source_key='receipt:'||new_batch||':a';
 update private.recipe_price_entries set source_ref=source_ref||'{"missing_price":true}' where source_key='receipt:'||new_batch||':a';
 assert private.resolved_cost_quote(shop,product,null,'包','2026-11-01')->>'price' is null,'invalid active newest evidence fell back to older cost';
 update private.recipe_price_entries set source_ref=source_ref||'{"missing_price":false}' where source_key='receipt:'||new_batch||':a';
 update private.receipt_entry_items set unit_price=301 where batch_id=new_batch and row_key='a';
 assert private.resolved_cost_quote(shop,product,null,'包','2026-11-01')->>'price' is null,'mismatched newest projection fell back';
 update private.receipt_entry_items set unit_price=300 where batch_id=new_batch and row_key='a';
 insert into public.suppliers(id,organization_id,name,is_active) values(supplier,org,'停用供應商測試',false);
 update private.receipt_entry_items set supplier_id=supplier where batch_id=new_batch and row_key='a';
 update private.recipe_price_entries set source_ref=source_ref||jsonb_build_object('supplier_id',supplier) where source_key='receipt:'||new_batch||':a';
 assert private.resolved_cost_quote(shop,product,null,'包','2026-11-01')->>'price' is null,'inactive supplier reused as current receipt';
 update public.suppliers set is_active=true where id=supplier;
 insert into private.ingredient_supply_state(store_id,ingredient_id,supplier_key,stopped,updated_by) values(shop,master,'id:'||supplier,true,actor);
 perform private.resolved_cost_quote(shop,product,null,'g','2026-11-01');
 update private.ingredient_supply_state set supplier_key='*' where store_id=shop and ingredient_id=master and supplier_key='id:'||supplier;
 perform private.resolved_cost_quote(shop,product,null,'g','2026-11-01');
 delete from private.ingredient_supply_state where store_id=shop and ingredient_id=master and supplier_key='*';

 update private.receipt_entry_items set unit_price=100 where batch_id=new_batch and row_key='a';
 update private.recipe_price_entries set price=100,source_ref=source_ref||'{"specification":"300g"}' where source_key='receipt:'||new_batch||':a';
 assert (private.resolved_cost_quote(shop,product,null,'g','2026-11-01')->>'price')::numeric=0.333333,'emitted decimal was not canonicalized after conflict detection';
 update private.receipt_entry_items set unit_price=300 where batch_id=new_batch and row_key='a';
 update private.recipe_price_entries set price=300,source_ref=source_ref||'{"specification":"500g"}' where source_key='receipt:'||new_batch||':a';

 -- Latest nested trial remains separate from the saved recipe baseline.
 doc:=jsonb_build_object('name','價格試算備料','kind','prep','yield',100,'unit','g','lines',jsonb_build_array(
 jsonb_build_object('id','a','name','測試塔殼','product_id',product,'quantity',100,'unit','g')));
 saved_cost:='{"total":40,"subtotal":40,"missing":0,"lines":[{"id":"a","amount":40}]}'::jsonb;
 insert into private.recipe_cards(id,store_id,document,updated_by) values(prep,shop,doc,actor);
 insert into private.recipe_versions(recipe_id,revision,document,cost_snapshot,actor_id) values(prep,1,doc,saved_cost,actor);
 doc:=jsonb_build_object('name','價格試算料理','kind','dish','yield',1,'unit','份','lines',jsonb_build_array(
 jsonb_build_object('id','prep','name','價格試算備料','recipe_id',prep,'quantity',50,'unit','g')));
 insert into private.recipe_cards(id,store_id,document,updated_by) values(recipe,shop,doc,actor);
 insert into private.recipe_versions(recipe_id,revision,document,cost_snapshot,actor_id) values(recipe,1,doc,'{"total":20,"subtotal":20,"missing":0,"lines":[]}',actor);
 select jsonb_agg(to_jsonb(v) order by v.recipe_id) into before_history from private.recipe_versions v where v.recipe_id in(recipe,prep);
 trial:=private.recipe_workspace_pricing(shop);
 assert exists(select 1 from jsonb_array_elements(trial->'latest_costs') v where v->>'id'=prep::text and (v#>>'{latest_cost,total}')::numeric=60),'latest prep cost';
 assert exists(select 1 from jsonb_array_elements(trial->'latest_costs') v where v->>'id'=recipe::text and (v#>>'{latest_cost,total}')::numeric=30),'latest nested cost';
 assert trial=private.recipe_workspace_pricing(shop),'read retry differs';
 -- Explicit count-to-weight notes use the established conversion, not loss inference.
 insert into private.recipe_price_entries(store_id,product_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,source_ref,source_key)
 values(shop,zero_product,'無價格品項','顆',20,'已核對進貨明細','2026-10-30',actor,'purchase','confirmed',
 jsonb_build_object('batch_id',new_batch,'row_key','piece','specification','','supplier_name','測試供應商'),'receipt:'||new_batch||':piece');
 insert into private.receipt_entry_items(batch_id,row_key,product_id,supplier_name,receipt_date,unit,unit_price,recorded_by)
 values(new_batch,'piece',zero_product,'測試供應商','2026-10-30','顆',20,actor);
 insert into private.recipe_cards(id,store_id,document,updated_by) values(gen_random_uuid(),shop,
 jsonb_build_object('name','顆重換算','kind','dish','yield',1,'unit','份','lines',jsonb_build_array(
 jsonb_build_object('id','piece','name','無價格品項','product_id',zero_product,'quantity',100,'unit','g','note','100g(2顆)'))),actor);
 assert exists(select 1 from jsonb_array_elements(private.recipe_workspace_pricing(shop)->'latest_costs') c
 cross join lateral jsonb_array_elements(c#>'{latest_cost,lines}') l where l->>'id'='piece' and (l->>'amount')::numeric=40),'explicit note count conversion lost';
 update private.recipe_price_entries set unit='g' where source_key='receipt:'||new_batch||':piece';
 update private.receipt_entry_items set unit='g' where batch_id=new_batch and row_key='piece';
 assert exists(select 1 from jsonb_array_elements(private.recipe_workspace_pricing(shop)->'latest_costs') c
 cross join lateral jsonb_array_elements(c#>'{latest_cost,lines}') l where l->>'id'='piece' and (l->>'amount')::numeric=2000),'null count quote displaced valid weight quote';
 update private.recipe_price_entries set unit='顆' where source_key='receipt:'||new_batch||':piece';
 update private.receipt_entry_items set unit='顆' where batch_id=new_batch and row_key='piece';
 assert (select jsonb_agg(to_jsonb(v) order by v.recipe_id) from private.recipe_versions v where v.recipe_id in(recipe,prep))=before_history,'latest trial rewrote saved history';
 assert not has_function_privilege('authenticated','private.automatic_cost_quote(uuid,uuid,text,text,date,uuid)','EXECUTE');
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.baihuayuan_cost_quotes(shop,jsonb_build_array(jsonb_build_object('product_id',product,'unit','包','date','2026-11-01')));
 raise exception 'outsider quote accepted';exception when insufficient_privilege then null;end;
 begin perform private.recipe_workspace_pricing(shop);raise exception 'outsider recipe accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);

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
 assert (r->>'unit_price')::numeric=240 and (r->>'amount')::numeric=480 and r->>'price_batch_id'=old_batch::text,'automatic report valuation';
 select x into r from jsonb_array_elements(d->'rows') x where x->>'product_id'=zero_product::text;
 assert (r->>'amount')::numeric=0 and not (r->>'missing_price')::boolean,'zero quantity';
 assert exists(select 1 from jsonb_array_elements(public.baihuayuan_ingredient_prices(shop)->'ingredients') m
  cross join lateral jsonb_array_elements(m->'sources') ref where ref->>'id'=old_price::text and (ref->>'receipt_price')::numeric=240),'price sheet receipt evidence';
 reset role;

 insert into private.inventory_month_closures(store_id,month,session_id,payload,confirmed_by) values(shop,'2026-10-01',session_id,d,actor);
 update private.recipe_price_entries set price=500 where id=old_price;
 assert (private.inventory_month_state(shop,'2026-10-01',null)#>>'{summary,subtotal}')::numeric=480,'closed amount changed';
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
 perform set_config('request.jwt.claim.sub',actor::text,true);
 -- Batched exact-name resolution retains ambiguity and corrected aliases.
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,reference_ids,corrected)
 values(shop,master,'精準測試別名','n:精準測試別名','g',array[old_price],true);
 insert into private.recipe_cards(id,store_id,document,updated_by) values(name_recipe,shop,
 jsonb_build_object('name','名稱批次報價','kind','dish','yield',1,'unit','份','lines',jsonb_build_array(
 jsonb_build_object('id','exact','name','測試塔殼','quantity',100,'unit','g'),
 jsonb_build_object('id','repeat','name','測試塔殼','quantity',50,'unit','g'),
 jsonb_build_object('id','alias','name','精準測試別名','quantity',100,'unit','g'),
 jsonb_build_object('id','unknown','name','尚未對應測試名稱','quantity',1,'unit','g'))),actor);
 trial:=private.recipe_current_prices(shop);
 assert (select count(*) from jsonb_array_elements(trial) p where p->>'key'='n:測試塔殼' and p->>'unit'='g')=1,'key/unit quote not deduplicated';
 perform private.test_cost_parity_matrix(shop,peer,product,peer_product,master,peer_master);
 assert exists(select 1 from jsonb_array_elements(trial) p where p->>'key'='n:測試塔殼' and (p->>'price')::numeric=.6),'exact batch name missing';
 perform private.automatic_cost_quote(shop,null,'精準測試別名','g','2026-11-01',null);
 assert exists(select 1 from jsonb_array_elements(trial) p where p->>'key'='n:精準測試別名' and (p->>'price')::numeric=.6),'corrected alias batch mapping missing';
 assert exists(select 1 from jsonb_array_elements(trial) p where p->>'key'='n:尚未對應測試名稱' and p->>'price' is null),'unknown name guessed';
 insert into private.ingredient_masters(id,store_id,name,unit,cost_price,manual,review_status,purchase,updated_by)
 values(ambiguous_master,shop,'測試塔殼','ml',1,true,'confirmed','{"amount":1,"quantity":1,"unit":"ml"}',actor);
 trial:=private.recipe_current_prices(shop);
 assert exists(select 1 from jsonb_array_elements(trial) p where p->>'key'='n:測試塔殼' and p->>'price' is null),'ambiguous exact name guessed';
end $test$;
rollback;
select 'PASS: automatic receipt pricing, exact identity, current recipe trial and current receipt valuation, package conversion, store isolation, count date, price history, closed month, and merge permissions' as result;
