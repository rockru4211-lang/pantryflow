begin;
select '1..1';
do $test$
declare
  manager uuid:=gen_random_uuid(); employee uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  shop uuid; org uuid; item uuid; today uuid; tomorrow uuid; zone uuid; setup jsonb; items jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
    select id,id||'@xu-count.invalid',now(),now(),now() from unnest(array[manager,employee,outsider]) id;
  perform set_config('request.jwt.claim.sub',manager::text,true);
  setup:=public.owner_setup();
  setup:=public.owner_setup('business','{"organization_name":"測試品牌","business_type":"CHAIN_RESTAURANT","store_mode":"MULTI"}',0);
  setup:=public.owner_setup('store',setup->'draft'||jsonb_build_object('store_name','測試店','store_code','XU'||substr(replace(manager::text,'-',''),1,12)),(setup->>'revision')::int);
  setup:=public.owner_setup('identity',setup->'draft'||'{"work_role":"OWNER"}',(setup->>'revision')::int);
  setup:=public.owner_setup('complete',setup->'draft',(setup->>'revision')::int);
  shop:=(setup->>'store_id')::uuid; org:=(setup->>'organization_id')::uuid;
  insert into public.organization_members(organization_id,user_id,role) values(org,employee,'STAFF');
  insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,employee,'員工',manager);
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by)
    values(shop,org,employee,'count-staff','STAFF','STAFF',manager);
  items:=public.import_pilot_inventory_quick(shop,jsonb_build_object('file',jsonb_build_object('original_filename','原表.xlsx','file_sha256',repeat('f',64),'storage_path',org||'/'||shop||'/test.xlsx','sheet_names','["盤點"]'::jsonb),
    'rows','[{"source_id":"ham","name":"火腿","product_code":"HAM","count_unit":"包","opening_quantity":7}]'::jsonb));
  item:=(items->0->>'product_id')::uuid;
  perform set_config('request.jwt.claim.sub',employee::text,true);
  today:=public.ensure_pilot_daily_count(shop);
  assert today is not null and today=public.ensure_pilot_daily_count(shop);
  assert exists(select 1 from public.inventory_count_sessions where id=today and not paper_required);
  select (snapshot->'zones'->0->>'zone_id')::uuid into zone from public.inventory_count_sessions where id=today;
  perform public.xu_count_orders(today,item,true);
  assert cardinality(public.xu_count_orders(today,item,true))=1;
  assert cardinality(public.xu_count_orders(today,item,false))=0;
  perform public.xu_count_orders(today,item,true);
  begin perform public.xu_submit_count(today); raise exception 'blank submitted'; exception when sqlstate '22023' then null; end;
  begin perform public.xu_order_inbox(shop); raise exception 'staff read manager inbox'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',manager::text,true);
  assert jsonb_array_length(public.xu_order_inbox(shop))=0;
  perform set_config('request.jwt.claim.sub',employee::text,true);
  perform public.save_pilot_count_drafts(today,jsonb_build_array(jsonb_build_object('zone_id',zone,'product_id',item,'quantity',0,'expected_updated_at',null)));
  perform public.xu_submit_count(today); perform public.xu_submit_count(today);
  assert today=public.ensure_pilot_daily_count(shop);
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  begin perform public.xu_submit_count(today); raise exception 'outsider accepted'; exception when insufficient_privilege then null; end;
  begin perform public.xu_count_orders(today); raise exception 'outsider read flags'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',manager::text,true);
  items:=public.xu_order_inbox(shop);
  assert jsonb_array_length(items)=1 and (items->0->'items'->0->>'quantity')::numeric=0;
  assert jsonb_array_length(public.xu_order_inbox(shop,today))=0;
  update public.inventory_count_sessions set started_at=started_at-interval '1 day',completed_at=completed_at-interval '1 day' where id=today;
  tomorrow:=public.ensure_pilot_daily_count(shop);
  assert tomorrow<>today;
  assert exists(select 1 from private.count_opening_snapshots where session_id=tomorrow and product_id=item and quantity=0);
  assert not exists(select 1 from public.count_drafts where session_id=tomorrow and quantity is not null);
  assert exists(select 1 from public.count_entries where session_id=today and product_id=item and quantity=0);
end $test$;
select 'ok 1 - Xu submits once, preserves blind opening and scopes order reminders';
rollback;
