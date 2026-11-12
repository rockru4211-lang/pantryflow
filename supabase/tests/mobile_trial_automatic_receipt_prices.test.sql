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
 mobile_id uuid:=gen_random_uuid(); mobile_request uuid:=gen_random_uuid(); old_snapshot jsonb; expected_revision integer; q jsonb; zero_master uuid:=gen_random_uuid(); missing_master uuid:=gen_random_uuid();
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


 assert not has_function_privilege('authenticated','private.automatic_cost_context_inner(uuid,date)','EXECUTE');
 assert not has_function_privilege('anon','public.mobile_recipe_workspace(uuid,text)','EXECUTE');
 perform public.save_person_data_access(shop,staff,'{"RECIPE":{"view":true,"edit":false}}',0,gen_random_uuid());
 perform set_config('request.jwt.claim.sub',staff::text,true);
 assert private.has_data_access(shop,'RECIPE') and not private.recipe_allowed(shop),'fixture field-user gate distinction';
 begin perform private.automatic_cost_context(shop,current_date);raise exception 'office context widened';exception when sqlstate '42501' then null;end;
 set local role authenticated;
 begin perform private.automatic_cost_context_inner(shop,current_date);raise exception 'private context exposed';exception when insufficient_privilege then null;end;
 select value into d from jsonb_array_elements(public.mobile_recipe_workspace(shop,'prices')->'prices') where value->>'id'=master::text;
 assert (d->>'price')::numeric=.6,'mobile must use receipt over .4 baseline';
 q:=d->'current_quote';expected_revision:=(d->>'revision')::integer;
 doc:=jsonb_build_object('name','手機最新進價試算','portions','2','notes','','lines',jsonb_build_array(jsonb_build_object('ingredient_id',master,'price_revision',expected_revision,'quantity','0.1','unit','公斤','expected_cost_quote',q)));
 r:=public.save_mobile_recipe_trial(shop,mobile_id,0,doc,mobile_request);
 assert (r#>>'{document,subtotal}')::numeric=60 and (r#>>'{document,per_portion}')::numeric=30,'mobile server receipt conversion';
 assert r#>>'{document,lines,0,expected_cost_quote,batch_id}'=new_batch::text,'snapshot evidence';
 assert public.save_mobile_recipe_trial(shop,mobile_id,0,doc,mobile_request)=r,'mobile idempotency';
 reset role;
 old_snapshot:=r->'document';
 update private.receipt_entry_items set unit_price=350 where batch_id=new_batch;
 update private.recipe_price_entries set price=350 where source_ref->>'batch_id'=new_batch::text;
 assert (select revision from private.ingredient_masters where id=master)=expected_revision,'receipt must not change baseline revision';
 begin perform public.save_mobile_recipe_trial(shop,mobile_id,1,doc,gen_random_uuid());raise exception 'stale receipt accepted';exception when others then if sqlerrm<>'COST_QUOTE_CHANGED' then raise;end if;end;
 assert public.save_mobile_recipe_trial(shop,mobile_id,0,doc,mobile_request)=r,'retry after price change returns original';
 assert (select document from private.mobile_recipe_trials where id=mobile_id)=old_snapshot,'stale save changed snapshot';
 select value->'current_quote' into q from jsonb_array_elements(public.mobile_recipe_workspace(shop,'prices')->'prices') where value->>'id'=master::text;
 doc:=jsonb_set(doc,'{lines,0,expected_cost_quote}',q);
 r:=public.save_mobile_recipe_trial(shop,mobile_id,1,doc,gen_random_uuid());
 assert (r#>>'{document,subtotal}')::numeric=70,'refreshed mobile quote';
 begin perform public.save_mobile_recipe_trial(shop,mobile_id,2,jsonb_set(doc,'{lines,0}',(doc#>'{lines,0}')-'expected_cost_quote'),gen_random_uuid());raise exception 'legacy silently repriced';exception when others then if sqlerrm<>'TRIAL_PRICE_CHANGED' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into private.ingredient_masters(id,store_id,name,unit,cost_price,manual,review_status,updated_by) values
 (zero_master,shop,'免費試算材料','g',0,true,'confirmed',actor),(missing_master,shop,'缺價試算材料','g',null,true,'pending',actor);
 perform set_config('request.jwt.claim.sub',staff::text,true);
 select jsonb_agg(jsonb_build_object('ingredient_id',v->>'id','price_revision',v->'revision','quantity','10','unit','g','expected_cost_quote',v->'current_quote')) into d
 from jsonb_array_elements(public.mobile_recipe_workspace(shop,'prices')->'prices') v where v->>'id' in(zero_master::text,missing_master::text);
 doc:=jsonb_build_object('name','零價與缺價','portions','1','notes','','lines',d);
 r:=public.save_mobile_recipe_trial(shop,gen_random_uuid(),0,doc,gen_random_uuid());
 assert (r#>>'{document,missing}')::integer=1 and r#>'{document,per_portion}'='null'::jsonb,'mobile null not zero';
 assert exists(select 1 from jsonb_array_elements(r#>'{document,lines}') v where v->>'ingredient_id'=zero_master::text and (v->>'amount')::numeric=0),'explicit zero preserved';
 begin perform public.mobile_recipe_workspace(peer,'prices');raise exception 'cross-store mobile read';exception when sqlstate '42501' then null;end;
 update public.store_memberships set access_mode='VIEW' where store_id=shop and user_id=staff;
 begin perform public.save_mobile_recipe_trial(shop,gen_random_uuid(),0,doc,gen_random_uuid());raise exception 'view-only mobile save';exception when sqlstate '42501' then null;end;
 update public.store_memberships set access_mode='EDIT' where store_id=shop and user_id=staff;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin perform public.save_mobile_recipe_trial(shop,mobile_id,2,doc,gen_random_uuid());raise exception 'other actor mobile write';exception when sqlstate '42501' then null;end;
 perform public.save_person_data_access(shop,staff,'{}',1,gen_random_uuid());
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.mobile_recipe_workspace(shop,'prices');raise exception 'revoked mobile read';exception when sqlstate '42501' then null;end;
 begin perform public.save_mobile_recipe_trial(shop,mobile_id,0,doc,mobile_request);raise exception 'revoked replay';exception when sqlstate '42501' then null;end;
 assert (select cost_price from private.ingredient_masters where id=master)=.4,'baseline unchanged';
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.mobile_recipe_workspace(shop,'prices');raise exception 'anonymous mobile read';exception when sqlstate '42501' then null;end;
end $test$;
rollback;
