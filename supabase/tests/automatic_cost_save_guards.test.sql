-- Reconstructed guard coverage from retained test semantics; not byte-identical recovery.
-- Reconstructed from the prior verified fixture and retained source; all writes roll back.
begin;
do $test$
declare
 actor uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 shop uuid:=gen_random_uuid(); peer uuid:=gen_random_uuid(); product uuid:=gen_random_uuid(); peer_product uuid:=gen_random_uuid(); zero_product uuid:=gen_random_uuid();
 master uuid:=gen_random_uuid(); peer_master uuid:=gen_random_uuid(); duplicate uuid:=gen_random_uuid();
 old_batch uuid:=gen_random_uuid(); new_batch uuid:=gen_random_uuid(); peer_batch uuid:=gen_random_uuid(); pending_batch uuid:=gen_random_uuid();
 old_price uuid:=gen_random_uuid(); peer_price uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();
 name_recipe uuid:=gen_random_uuid(); ambiguous_master uuid:=gen_random_uuid(); supplier uuid:=gen_random_uuid();
 recipe uuid:=gen_random_uuid(); prep uuid:=gen_random_uuid(); doc jsonb; saved_cost jsonb; before_history jsonb; trial jsonb;
 q jsonb; payload jsonb; req uuid:=gen_random_uuid();move uuid:=gen_random_uuid();today date:=(now() at time zone 'Asia/Taipei')::date;
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

 q:=private.resolved_cost_quote(shop,product,null,'包',today);
 assert (q->>'price')::numeric=300;
 payload:=jsonb_build_object('name','測試塔殼','quantity','2','unit','包','price','300','purchase_price','300','date',today,'reason','保存不當','price_mode','automatic','expected_cost_quote',q);
 update private.recipe_price_entries set price=350 where source_key='receipt:'||new_batch||':a';
 update private.receipt_entry_items set unit_price=350 where batch_id=new_batch and row_key='a';
 begin perform public.save_baihuayuan_sheet_row(shop,'waste',null,payload,'{}',req);raise exception 'stale waste saved';exception when serialization_failure then assert sqlerrm='COST_QUOTE_CHANGED';end;
 assert not exists(select 1 from private.operations_sheet_requests osr where osr.request_id=req),'failed quote left request token';
 q:=private.resolved_cost_quote(shop,product,null,'包',today);
 payload:=payload||jsonb_build_object('price','350','purchase_price','350','expected_cost_quote',q);
 r:=public.save_baihuayuan_sheet_row(shop,'waste',null,payload,'{}',req);
 assert (select unit_price=350 and amount=700 from private.waste_reviews where waste_id=(r->>'id')::uuid),'fresh waste snapshot';
 update private.recipe_price_entries set price=400 where source_key='receipt:'||new_batch||':a';
 update private.receipt_entry_items set unit_price=400 where batch_id=new_batch and row_key='a';
 assert public.save_baihuayuan_sheet_row(shop,'waste',null,payload,'{}',req)=r,'retry repriced old waste';
 assert (select unit_price=350 and amount=700 from private.waste_reviews where waste_id=(r->>'id')::uuid),'receipt rewrote saved waste';
 payload:=payload||jsonb_build_object('price','7','purchase_price','7','price_mode','manual');
 r:=public.save_baihuayuan_sheet_row(shop,'waste',null,payload,'{}',gen_random_uuid());
 assert (select unit_price=7 from private.waste_reviews where waste_id=(r->>'id')::uuid),'manual override';
 insert into private.store_movements(id,organization_id,from_store_id,to_store_id,kind,product_id,name,quantity,unit,status,created_by,review_status,occurred_at)
 values(move,org,shop,peer,'TRANSFER',product,'測試塔殼',2,'包','COMPLETE',actor,'PENDING',now());
 q:=private.resolved_cost_quote(shop,product,null,'包',today);
 payload:=jsonb_build_object('id',move,'revision',1,'quantity',2,'unit','包','unit_price',400,'price_mode','automatic','expected_cost_quote',q);
 req:=gen_random_uuid();
 update private.recipe_price_entries set price=450 where source_key='receipt:'||new_batch||':a';
 update private.receipt_entry_items set unit_price=450 where batch_id=new_batch and row_key='a';
 begin perform public.app_operation(shop,'movement.transfer-confirm',payload,req);raise exception 'stale transfer saved';exception when serialization_failure then assert sqlerrm='COST_QUOTE_CHANGED';end;
 assert (select review_status='PENDING' from private.store_movements where id=move),'stale transfer altered row';
 q:=private.resolved_cost_quote(shop,product,null,'包',today);
 payload:=payload||jsonb_build_object('unit_price',450,'expected_cost_quote',q);
 r:=public.app_operation(shop,'movement.transfer-confirm',payload,req);
 assert (select unit_price_snapshot=450 and amount_snapshot=900 from private.store_movements where id=move),'fresh transfer snapshot';
 update private.recipe_price_entries set price=500 where source_key='receipt:'||new_batch||':a';update private.receipt_entry_items set unit_price=500 where batch_id=new_batch and row_key='a';
 assert public.app_operation(shop,'movement.transfer-confirm',payload,req)=r,'transfer retry';
 assert (select unit_price_snapshot=450 and amount_snapshot=900 from private.store_movements where id=move),'saved transfer rewritten';
 begin perform private.checked_automatic_cost_quote('{"price":null}','{"price":0}');raise exception 'null became zero';exception when serialization_failure then null;end;
 begin perform private.checked_automatic_cost_quote('{"price":1,"reference_id":"new"}','{"price":1,"reference_id":"old"}');raise exception 'changed reference accepted';exception when serialization_failure then null;end;
 assert private.checked_automatic_cost_quote('{"price":0}','{"price":0}')=0;
 assert private.checked_automatic_cost_quote('{"price":null}','{"price":null}') is null;
 assert (select cost_price=.4 from private.ingredient_masters where id=master),'baseline rewritten';
end $test$;
rollback;
