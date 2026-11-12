-- Reconstructed from the prior verified fixture and retained source; all writes roll back.
begin;
do $test$
<<automatic_inventory_report_unit_test>>
declare
 actor uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 shop uuid:=gen_random_uuid(); peer uuid:=gen_random_uuid(); product uuid:=gen_random_uuid(); peer_product uuid:=gen_random_uuid(); zero_product uuid:=gen_random_uuid();
 master uuid:=gen_random_uuid(); peer_master uuid:=gen_random_uuid(); duplicate uuid:=gen_random_uuid();
 old_batch uuid:=gen_random_uuid(); new_batch uuid:=gen_random_uuid(); peer_batch uuid:=gen_random_uuid(); pending_batch uuid:=gen_random_uuid();
 old_price uuid:=gen_random_uuid(); peer_price uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();
 name_recipe uuid:=gen_random_uuid(); ambiguous_master uuid:=gen_random_uuid(); supplier uuid:=gen_random_uuid();
 recipe uuid:=gen_random_uuid(); prep uuid:=gen_random_uuid(); doc jsonb; saved_cost jsonb; before_history jsonb; trial jsonb;
 null_case text; q jsonb; expected jsonb; saved jsonb; review_before jsonb;
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

 -- Count in kilograms; report in grams without pinning a converted quote.
 update public.products set base_unit='公斤',count_unit='公斤',specification='' where id=product;
 insert into public.count_zones(organization_id,store_id,name) values(org,shop,'測試區') returning id into z;
 insert into public.zone_products(zone_id,product_id,count_unit) values(z,product,'公斤');
 snapshot:=jsonb_build_object('zones',jsonb_build_array(jsonb_build_object('zone_id',z,'zone_name','測試區','product_id',product,'product_name','測試塔殼','unit','公斤')));
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot,started_at,completed_at)
 values(org,shop,actor,'REVIEWING',snapshot,'2026-10-20 03:00Z','2026-10-31 08:00Z') returning id into session_id;
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,entered_at)
 values(org,session_id,z,product,2,'公斤',actor,'INITIAL_COUNT','2026-10-20 11:00Z');
 -- Two authentic early-null paths intentionally omit unit: receipt conflict and
 -- multiple exact product roots. Both may change report units without guessing.
 foreach null_case in array array['conflict','ambiguous'] loop
  begin
  if null_case='conflict' then
   insert into private.recipe_price_entries(store_id,product_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,source_ref,source_key)
   values(shop,product,'測試塔殼','包',241,'test conflict','2026-10-11',actor,'purchase','confirmed',jsonb_build_object('batch_id',old_batch,'row_key','null-conflict','specification','500g'),'receipt:'||old_batch||':null-conflict');
   insert into private.receipt_entry_items(batch_id,row_key,product_id,supplier_name,receipt_date,unit,unit_price,recorded_by)
   values(old_batch,'null-conflict',product,'測試供應商','2026-10-11','包',241,actor);
  else
   insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit) values(shop,duplicate,'不同對應','p:'||product,'g');
  end if;
  d:=public.baihuayuan_inventory_month(shop,'2026-10-01');r:=d->'rows'->0;
  q:=private.inventory_price_quote(shop,product,null,'g','2026-10-20');
  assert q->>'price' is null and not(q?'unit'),'fixture must use authentic no-unit null quote';
  expected:=jsonb_build_object('source_signature',r->'source_signature','values',jsonb_build_object('name',r->'name','unit',r->'unit','quantity',r->'current_quantity','price',r->'unit_price','note',r->'review_note'),'price_mode','automatic','expected_cost_quote',q);
  set local role authenticated;
  begin perform public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',jsonb_set(expected,'{expected_cost_quote,price}','0'),r->>'name','g',2000,null,'null test');raise exception 'expected null replaced by zero';exception when serialization_failure then assert sqlerrm='COST_QUOTE_CHANGED';end;
  begin perform public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',expected,r->>'name','g',2000,0,'null test');raise exception 'submitted null replaced by zero';exception when serialization_failure then assert sqlerrm='COST_QUOTE_CHANGED';end;
  begin perform public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',jsonb_set(expected,'{expected_cost_quote,reason}','"incorrect reason"'),r->>'name','g',2000,null,'null test');raise exception 'changed null reason accepted';exception when serialization_failure then assert sqlerrm='COST_QUOTE_CHANGED';end;
  begin perform public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',jsonb_set(expected,'{expected_cost_quote,reference_id}',to_jsonb(gen_random_uuid())),r->>'name','g',2000,null,'null test');raise exception 'fabricated null source accepted';exception when serialization_failure then assert sqlerrm='COST_QUOTE_CHANGED';end;
  saved:=public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',expected,r->>'name','g',2000,null,'null test');
  d:=public.baihuayuan_inventory_month(shop,'2026-10-01');r:=d->'rows'->0;
  assert r->>'unit'='g' and r->>'unit_price' is null and r->>'amount' is null and (r->>'missing_price')::boolean and (r->>'price_is_automatic')::boolean,'authentic null unit save guessed price';
  reset role;
  assert (select not price_set and unit_price is null from private.inventory_month_reviews imr where imr.session_id=automatic_inventory_report_unit_test.session_id),'null automatic review pinned';
  raise exception using errcode='ZX002',message='rollback isolated null scenario';
  exception when sqlstate 'ZX002' then null;end;
 end loop;
 d:=public.baihuayuan_inventory_month(shop,'2026-10-01');r:=d->'rows'->0;
 assert r->>'unit'='公斤' and (r->>'unit_price')::numeric=480 and (r->>'amount')::numeric=960,'initial kg quote '||r::text;
 q:=private.inventory_price_quote(shop,product,null,'g','2026-10-20');assert (q->>'price')::numeric=.48;
 expected:=jsonb_build_object('source_signature',r->'source_signature','values',jsonb_build_object('name',r->'name','unit',r->'unit','quantity',r->'current_quantity','price',r->'unit_price','note',r->'review_note'),'price_mode','automatic','expected_cost_quote',q);
 set local role authenticated;
 saved:=public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',expected,r->>'name','g',2000,.48,'auto g');
 d:=public.baihuayuan_inventory_month(shop,'2026-10-01');r:=d->'rows'->0;
 assert r->>'unit'='g' and (r->>'unit_price')::numeric=.48 and (r->>'amount')::numeric=960 and (r->>'price_is_automatic')::boolean,'auto unit edit pinned or mis-scaled';
 saved:=public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',expected,r->>'name','g',2000,.48,'auto g');
 assert (saved->>'replayed')::boolean,'automatic identical retry';
 reset role;
 assert (select not price_set and unit_price is null and report_unit='g' from private.inventory_month_reviews imr where imr.session_id=automatic_inventory_report_unit_test.session_id),'auto review pinned';
 update private.recipe_price_entries set price=250 where id=old_price;update private.receipt_entry_items set unit_price=250 where batch_id=old_batch and row_key='a';
 d:=public.baihuayuan_inventory_month(shop,'2026-10-01');r:=d->'rows'->0;
 assert (r->>'unit_price')::numeric=.5 and (r->>'amount')::numeric=1000 and (r->>'price_is_automatic')::boolean,'new500/kg not live .5/g';
 q:=private.inventory_price_quote(shop,product,null,'g','2026-10-20');
 expected:=jsonb_build_object('source_signature',r->'source_signature','values',jsonb_build_object('name',r->'name','unit',r->'unit','quantity',r->'current_quantity','price',r->'unit_price','note',r->'review_note'),'price_mode','automatic','expected_cost_quote',q);
 -- Same amount, changed receipt reference: CAS values still match, provenance must not.
 update private.recipe_price_entries set id=gen_random_uuid() where id=old_price;
 select to_jsonb(v) into review_before from private.inventory_month_reviews v where v.session_id=automatic_inventory_report_unit_test.session_id;
 set local role authenticated;
 begin perform public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',expected,r->>'name','g',2000,.5,'stale source');raise exception 'stale same-price reference accepted';exception when serialization_failure then assert sqlerrm='COST_QUOTE_CHANGED';end;
 begin perform public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',expected||'{"expected_cost_quote":{"price":0.5,"unit":"g"}}',r->>'name','g',2000,.5,'missing provenance');raise exception 'missing provenance accepted';exception when serialization_failure then assert sqlerrm='COST_QUOTE_CHANGED';end;
 reset role;
 assert (select to_jsonb(v)=review_before from private.inventory_month_reviews v where v.session_id=automatic_inventory_report_unit_test.session_id),'stale attempt changed review';
 -- Legacy/manual edits stay fixed, and retries retain their existing behavior.
 expected:=expected-'price_mode'-'expected_cost_quote';
 set local role authenticated;
 saved:=public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',expected,r->>'name','g',2000,.7,'manual');
 saved:=public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',expected,r->>'name','g',2000,.7,'manual');assert (saved->>'replayed')::boolean,'legacy retry';
 reset role;
 update private.recipe_price_entries set price=260 where source_key='receipt:'||old_batch||':a';update private.receipt_entry_items set unit_price=260 where batch_id=old_batch and row_key='a';
 d:=public.baihuayuan_inventory_month(shop,'2026-10-01');r:=d->'rows'->0;
 assert (r->>'unit_price')::numeric=.7 and (r->>'amount')::numeric=1400 and not (r->>'price_is_automatic')::boolean,'manual override changed';
 insert into private.inventory_month_closures(store_id,month,session_id,payload,confirmed_by) values(shop,'2026-10-01',session_id,d,actor);
 update private.recipe_price_entries set price=300 where source_key='receipt:'||old_batch||':a';update private.receipt_entry_items set unit_price=300 where batch_id=old_batch and row_key='a';
 assert (private.inventory_month_state(shop,'2026-10-01',null)#>>'{summary,subtotal}')::numeric=1400,'closed amount changed';
 set local role authenticated;
 begin perform public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',expected,r->>'name','g',2000,.8,'closed');raise exception 'closed edit accepted';exception when invalid_parameter_value then assert sqlerrm='INVENTORY_MONTH_CLOSED';end;
 reset role;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 set local role authenticated;
 begin perform public.save_baihuayuan_inventory_inline_v3(shop,'2026-10-01',session_id,r->>'row_key',expected,r->>'name','g',2000,.7,'manual');raise exception 'staff replay accepted';exception when insufficient_privilege then null;end;
 reset role;
 assert (select unit='公斤' and quantity=2 from public.count_entries ce where ce.session_id=automatic_inventory_report_unit_test.session_id),'raw count evidence changed';
 assert (select ics.snapshot=automatic_inventory_report_unit_test.snapshot from public.inventory_count_sessions ics where ics.id=automatic_inventory_report_unit_test.session_id),'raw session snapshot changed';
end $test$;
rollback;
