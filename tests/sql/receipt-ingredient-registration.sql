-- Exercise the normal receipt save and count assignment in an isolated tenant.
begin;
do $test$
declare
  owner_id uuid:=gen_random_uuid();
  staff_id uuid:=gen_random_uuid();
  org uuid:=gen_random_uuid();
  beape uuid:=gen_random_uuid();
  gras uuid:=gen_random_uuid();
  vendor uuid:=gen_random_uuid();
  zone uuid:=gen_random_uuid();
  beape_batch uuid:=gen_random_uuid();
  gras_batch uuid:=gen_random_uuid();
  beape_run uuid:=gen_random_uuid();
  gras_run uuid:=gen_random_uuid();
  known_product uuid:=gen_random_uuid();
  known_ingredient uuid:=gen_random_uuid();
  request_id uuid:=gen_random_uuid();
  item record;
  entry jsonb;
  data jsonb;
  saved jsonb;
  pending jsonb;
  new_id uuid;
  new_product uuid;
  new_code text;
begin
  assert not has_function_privilege('authenticated','private.receipt_entry_ingredient(uuid,uuid,uuid,jsonb,text,uuid,text)','execute');
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
  select id,id||'@receipt-new-ingredient.invalid',now(),now(),now() from unnest(array[owner_id,staff_id]) id;
  insert into public.profiles(id,display_name)
  select id,'新品隔離測試' from unnest(array[owner_id,staff_id]) id on conflict(id) do nothing;
  insert into public.organizations(id,name,business_type,store_mode)
  values(org,'新品隔離測試','SINGLE_RESTAURANT','MULTI');
  insert into public.stores(id,organization_id,name,store_code,created_by) values
  (beape,org,'BeApe','RI'||substr(beape::text,1,8),owner_id),
  (gras,org,'Gras','RI'||substr(gras::text,1,8),owner_id);
  insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
  values(org,owner_id,'OWNER',true,true),(org,staff_id,'STAFF',false,false);
  insert into public.staff_identities(organization_id,user_id,display_name,created_by)
  select org,id,'新品隔離測試',owner_id from unnest(array[owner_id,staff_id]) id;
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
  values(beape,org,owner_id,'ri-owner','OWNER','OWNER',owner_id,true),
        (gras,org,owner_id,'ri-owner-g','OWNER','OWNER',owner_id,true),
        (beape,org,staff_id,'ri-staff','STAFF','STAFF',owner_id,false);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);

  insert into public.suppliers(id,organization_id,name) values(vendor,org,'新品測試供應商');
  insert into public.count_zones(id,organization_id,store_id,name,is_active) values(zone,org,beape,'乾貨',true);
  insert into public.products(id,organization_id,product_code,name,base_unit,count_unit,specification)
  values(known_product,org,'RI-KNOWN','測試蝸牛','包','包','500g');
  insert into private.ingredient_masters(id,store_id,name,unit,manual,cost_price,review_status)
  values(known_ingredient,beape,'測試蝸牛','包',true,123,'confirmed');
  insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,specification)
  values(beape,known_ingredient,'測試蝸牛','p:'||known_product,'包','500g');

  for item in select * from (values
    (beape,beape_batch,beape_run,'BeApe'),(gras,gras_batch,gras_run,'Gras')
  ) v(store_id,batch_id,run_id,store_name) loop
    insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,batch_number,status,group_mode)
    values(item.batch_id,org,item.store_id,item.store_name,current_date,owner_id,'INGREDIENT-'||item.store_name,'READY_FOR_REVIEW','SAME_RECEIPT');
    insert into public.receipt_ocr_runs(id,organization_id,batch_id,version,provider,model,prompt_version,status,started_by)
    values(item.run_id,org,item.batch_id,1,'FIXTURE','rollback-only','ingredient-fixture','SUCCEEDED',owner_id);
    insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status)
    select org,item.batch_id,item.run_id,location,key,value,value,1,'TRUSTED'
    from (values
      ('document',jsonb_build_object('supplier_name','新品測試供應商','receipt_date',current_date)),
      ('line-1',jsonb_build_object('product','測試新品奶油','unit','包','quantity',2,'unit_price_ex_tax',185,'subtotal_ex_tax',370)),
      ('line-2',jsonb_build_object('product','測試蝸牛（小）','unit','包','quantity',1,'unit_price_ex_tax',111,'subtotal_ex_tax',111)),
      ('line-3',jsonb_build_object('product','測試蝸牛（大）','unit','包','quantity',1,'unit_price_ex_tax',150,'subtotal_ex_tax',150))
    ) s(location,values) cross join lateral jsonb_each(s.values)
    where item.store_id=beape or location in ('document','line-1');

    entry:=public.get_baihuayuan_receipt_accounts(item.store_id,null,null,null,item.batch_id)->0;
    data:=jsonb_build_object(
      'source_fingerprint',entry->>'source_fingerprint','revision',entry->'revision',
      'header',jsonb_build_object('supplier_name','新品測試供應商','receipt_date',current_date),
      'lines',(select jsonb_agg(l||case l->>'row_key'
        when 'line-1' then '{"create_ingredient":true,"specification":"454g","category":"食材"}'::jsonb
        when 'line-2' then jsonb_build_object('ingredient_id',known_ingredient,'specification','500g')
        else '{"specification":"1kg"}'::jsonb end order by l->>'row_key')
        from jsonb_array_elements(entry->'lines') l),
      'adjustment',0,'tax',null,'total',case when item.store_id=beape then 631 else 370 end,'note','','checked',false);

    if item.store_id=beape then
      set local role authenticated;
      saved:=public.save_baihuayuan_receipt_review(beape,beape_batch,data,gen_random_uuid());
      reset role;
      assert not exists(select 1 from private.ingredient_masters where store_id=beape and id<>known_ingredient),'draft assigned a code';
      assert saved#>'{account,lines,0,create_ingredient}'='true'::jsonb,'draft lost the confirmed-new choice';
      data:=data||jsonb_build_object('source_fingerprint',saved#>>'{account,source_fingerprint}','revision',saved#>'{account,revision}');
      perform set_config('request.jwt.claim.sub',staff_id::text,true);
      begin
        perform public.save_baihuayuan_receipt_review(beape,beape_batch,data||'{"review_completed":true}',gen_random_uuid());
        raise exception 'Staff was allowed to register a new master';
      exception when insufficient_privilege then null;end;
      perform set_config('request.jwt.claim.sub',owner_id::text,true);
    end if;

    request_id:=gen_random_uuid();
    data:=data||'{"review_completed":true,"entry_completed":true}';
    set local role authenticated;
    saved:=public.save_baihuayuan_receipt_review(item.store_id,item.batch_id,data,request_id);
    assert public.save_baihuayuan_receipt_review(item.store_id,item.batch_id,data,request_id)=saved,'completion retry changed the result';
    reset role;

    if item.store_id=beape then
      new_id:=(saved#>>'{account,lines,0,ingredient_id}')::uuid;
      new_product:=(saved#>>'{account,lines,0,product_id}')::uuid;
      new_code:=saved#>>'{account,lines,0,ingredient_code}';
      assert new_code ~ '^F[0-9]{6,}$' and new_id is not null and new_product is not null,'receipt missing the new identity';
      assert saved#>>'{account,lines,1,ingredient_id}'=known_ingredient::text and saved#>>'{account,lines,1,product_id}'=known_product::text,'existing alias minted a duplicate';
      assert saved#>>'{account,lines,2,ingredient_status}'='REVIEW','ambiguous package not marked for review';
      assert not exists(select 1 from private.receipt_entry_items where batch_id=beape_batch and row_key='line-3' and retired_at is null),'ambiguous row entered the count catalog';
      assert (select count(*)=2 from private.ingredient_masters where store_id=beape),'created more than one new ingredient';
      assert (select cost_price=123 from private.ingredient_masters where id=known_ingredient),'prior standard was overwritten';
      assert not exists(select 1 from public.zone_products where product_id=new_product),'entered a zone before selection';
      assert not exists(select 1 from public.inventory_lot_events where organization_id=org),'registration posted physical stock';

      entry:=public.baihuayuan_ingredient_prices(beape);
      assert exists(select 1 from jsonb_array_elements(entry->'ingredients') i
        cross join lateral jsonb_array_elements(i->'sources') s where i->>'id'=new_id::text
          and i->>'canonical_code'=new_code and s->>'receipt_supplier'='新品測試供應商'
          and s->>'receipt_unit'='包' and (s->>'receipt_price')::numeric=185),'missing original supplier price in the price sheet';
      pending:=public.baihuayuan_receipt_count_candidates(beape);
      assert exists(select 1 from jsonb_array_elements(pending->'rows') x where x->>'id'=new_product::text),'missing pending count item';
      set local role authenticated;
      perform public.baihuayuan_receipt_count_candidates(beape,'add',
        jsonb_build_object('ids',jsonb_build_array(new_product),'zone_id',zone),gen_random_uuid());
      reset role;
      assert (select count_unit='包' from public.zone_products where zone_id=zone and product_id=new_product),'count unit changed';
      assert exists(select 1 from jsonb_array_elements(public.get_count_ingredient_names(beape)) x
        where x->>'product_id'=new_product::text and x->>'code'=new_code),'count did not use the official code';
    else
      assert saved#>>'{account,lines,0,product_id}'=new_product::text,'peer store duplicated the shared product';
      assert saved#>>'{account,lines,0,ingredient_code}'=new_code,'peer store did not reuse the official code';
      assert saved#>>'{account,lines,0,ingredient_id}'<>new_id::text,'peer store used the first store editing identity';
      assert not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
        where z.store_id=gras and zp.product_id=new_product),'peer store inherited a zone';
    end if;
  end loop;
end
$test$;
rollback;
select 'receipt_ingredient_registration_ok' as result;
