begin;
select '1..1';
do $test$
declare
  owner_id uuid:=gen_random_uuid();
  staff_id uuid:=gen_random_uuid();
  admin_id uuid:=gen_random_uuid();
  stranger_id uuid:=gen_random_uuid();
  data jsonb; org uuid; store_id uuid; other_store uuid; zone_id uuid; product_id uuid; result jsonb;
  before_price numeric; after_price numeric;
begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
  select id,id||'@store-shared-count.invalid',now(),now(),now()
  from unnest(array[owner_id,staff_id,admin_id,stranger_id]) id;

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  data:=public.owner_setup();
  data:=public.owner_setup('business','{"organization_name":"門市盤點共用測試","business_type":"CHAIN_RESTAURANT","store_mode":"MULTI"}',0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','A 店','store_code','SA'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),(data->>'revision')::int);
  data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
  data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);
  store_id:=(data->>'store_id')::uuid; org:=(data->>'organization_id')::uuid;
  other_store:=(public.app_operation(store_id,'store.create','{"name":"B 店"}',gen_random_uuid())->>'id')::uuid;

  insert into public.organization_members(organization_id,user_id,role)
  values(org,staff_id,'STAFF'),(org,admin_id,'LOGISTICS');
  insert into public.staff_identities(organization_id,user_id,display_name,created_by)
  values(org,staff_id,'現場員工',owner_id),(org,admin_id,'行政',owner_id);
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by)
  values(store_id,org,staff_id,'shared-staff','STAFF','STAFF',owner_id),
        (store_id,org,admin_id,'shared-admin','LOGISTICS','LOGISTICS',owner_id);

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  result:=public.import_pilot_inventory_quick(
    store_id,
    jsonb_build_object(
      'file',jsonb_build_object(
        'original_filename','A店盤點.xlsx',
        'file_sha256',repeat('d',64),
        'storage_path',org||'/'||store_id||'/a-store.xlsx',
        'sheet_names','["盤點"]'::jsonb
      ),
      'rows','[{"source_id":"ham","name":"伊比利火腿","product_code":"HAM-A","count_unit":"包","unit_price":120,"opening_quantity":3}]'::jsonb
    )
  );
  assert not exists(select 1 from jsonb_array_elements(result) r where r->>'status'='FAILED'),result::text;
  product_id:=(result->0->>'product_id')::uuid;
  select z.id into zone_id from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
  where z.store_id=store_id and zp.product_id=product_id limit 1;
  assert zone_id is not null,'administration can build initial count data for an assigned chain store';
  assert not exists(
    select 1 from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
    where z.store_id=other_store and zp.product_id=product_id
  ),'initial count data remains scoped to the selected store';

  select unit_price into before_price from public.store_product_costs where store_id=store_id and product_id=product_id limit 1;

  perform set_config('request.jwt.claim.sub',staff_id::text,true);
  result:=public.update_pilot_count_item_basic(store_id,product_id,'伊比利火腿（現場）','盒','500g',null);
  assert result->>'name'='伊比利火腿（現場）' and result->>'count_unit'='盒' and result->>'specification'='500g','staff can maintain basic count item data';
  assert exists(
    select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
    where z.store_id=store_id and zp.product_id=product_id and zp.count_unit='盒'
  ),'staff unit edit updates the selected store count configuration';
  select unit_price into after_price from public.store_product_costs where store_id=store_id and product_id=product_id limit 1;
  assert after_price is not distinct from before_price,'restricted staff basic edit cannot change price';

  begin
    perform public.update_pilot_count_item_basic(other_store,product_id,'越權修改','箱',null,null);
    raise exception 'staff edited an unassigned store';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub',stranger_id::text,true);
  begin
    perform public.update_pilot_count_item_basic(store_id,product_id,'陌生人修改','箱',null,null);
    raise exception 'stranger edit accepted';
  exception when insufficient_privilege then null; end;
end
$test$;
select 'ok 1 - administration builds store-scoped initial count data and staff maintain only basic fields';
rollback;
