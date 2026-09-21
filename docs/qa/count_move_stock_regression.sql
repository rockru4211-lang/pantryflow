-- Status: pending verification in an isolated database, not a CI gate.
-- Source review predicts a stock reconciliation defect; this file has not yet
-- completed successfully against an isolated full Supabase database.
-- All identities, stores and stock are synthetic.
-- Run the entire file in a single database call. It always ends in ROLLBACK.
-- If the predicted defect exists, the final assertion reports all cases.
-- A card assignment changes count scope, not physical stock at click time.
-- Only completed authoritative observations may replace a moved source scope;
-- unselected areas and independent physical stock movements must survive.
begin;
select '1..1';
create temporary table count_move_stock_checks(
  case_number integer primary key,
  scenario text not null,
  expected jsonb not null,
  actual jsonb not null,
  passed boolean not null
) on commit drop;

do $test$
#variable_conflict use_variable
declare
  owner_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid();
  org uuid; first_store uuid; store_id uuid; product_id uuid; second_product uuid;
  source_zone uuid; target_zone uuid; other_zone uuid; unclassified uuid;
  previous_session uuid; current_session uuid; physical_position uuid;
  physical_revision integer; scenario_number integer;
  old_qty numeric; final_qty numeric; expected_total numeric; actual_total numeric;
  source_total numeric; target_total numeric; other_total numeric;
  data jsonb; imported jsonb; result jsonb; payload jsonb; selection jsonb;
  expected jsonb; actual jsonb; history_snapshot jsonb; history_entries jsonb;
  before_positions jsonb; original_other_store jsonb;
  stamp timestamptz; scenario_name text;
begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
  select id,id||'@count-stock-regression.invalid',now(),now(),now()
  from unnest(array[owner_id,staff_id,admin_id]) id;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  data:=public.owner_setup();
  data:=public.owner_setup('business','{"organization_name":"盤點歸區庫存回歸","business_type":"SINGLE_RESTAURANT","store_mode":"MULTI"}',0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','完整盤點已初始化','store_code','SR'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),(data->>'revision')::int);
  data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
  data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);
  first_store:=(data->>'store_id')::uuid; org:=(data->>'organization_id')::uuid;
  insert into public.organization_members(organization_id,user_id,role)
  values(org,staff_id,'STAFF'),(org,admin_id,'LOGISTICS');
  insert into public.staff_identities(organization_id,user_id,display_name,created_by)
  values(org,staff_id,'現場測試',owner_id),(org,admin_id,'行政測試',owner_id);

  for scenario_number in 1..7 loop
    perform set_config('request.jwt.claim.sub',owner_id::text,true);
    scenario_name:=case scenario_number
      when 1 then 'full count, initialized stock, corrected source'
      when 2 then 'full count, uninitialized stock, same corrected source'
      when 3 then 'selected source corrected, unselected same-product area preserved'
      when 4 then 'selected source recounted without correction, other area preserved'
      when 5 then 'physical movement followed by selected count, destination preserved'
      when 6 then 'corrected source explicitly counted zero'
      when 7 then 'selected source corrected before stock initialization' end;
    store_id:=case when scenario_number=1 then first_store
      else (public.app_operation(first_store,'store.create',jsonb_build_object('name',scenario_name),gen_random_uuid())->>'id')::uuid end;
    insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by)
    values(store_id,org,staff_id,'stock-staff-'||scenario_number,'STAFF','STAFF',owner_id),
      (store_id,org,admin_id,'stock-admin-'||scenario_number,'LOGISTICS','LOGISTICS',owner_id);

    -- Each store imports its own evidence; products may be shared in the same
    -- organization, but stock/count/configuration remain strictly store scoped.
    imported:=public.import_pilot_inventory_quick(store_id,jsonb_build_object(
      'file',jsonb_build_object('original_filename','庫存測試.xlsx','file_sha256',repeat(scenario_number::text,64),
        'storage_path',org||'/'||store_id||'/stock.xlsx','sheet_names','["盤點"]'::jsonb),
      'rows','[{"source_id":"ham","name":"庫存測試火腿","product_code":"STOCK-HAM","count_unit":"包","unit_price":100,"opening_quantity":0},
        {"source_id":"milk","name":"庫存測試鮮奶","product_code":"STOCK-MILK","count_unit":"瓶","unit_price":10,"opening_quantity":0}]'::jsonb));
    assert not exists(select 1 from jsonb_array_elements(imported) r where r->>'status'='FAILED'),imported::text;
    product_id:=(imported->0->>'product_id')::uuid; second_product:=(imported->1->>'product_id')::uuid;
    select z.id into unclassified from public.count_zones z where z.store_id=store_id and z.name='未分類';
    source_zone:=public.create_pilot_zone(store_id,'A 原區');
    target_zone:=public.create_pilot_zone(store_id,'B 更正區');
    other_zone:=public.create_pilot_zone(store_id,'C 保留區');
    perform public.assign_pilot_product_to_zone(source_zone,product_id);
    perform public.assign_pilot_product_to_zone(other_zone,second_product);
    if scenario_number in (3,4,7) then perform public.assign_pilot_product_to_zone(other_zone,product_id); end if;
    delete from public.zone_products where zone_id=unclassified;

    previous_session:=public.start_pilot_count(store_id,null);
    perform public.save_pilot_count_draft(previous_session,source_zone,product_id,5,null);
    perform public.save_pilot_count_draft(previous_session,other_zone,second_product,7,null);
    if scenario_number in (3,4,7) then perform public.save_pilot_count_draft(previous_session,other_zone,product_id,7,null); end if;
    perform public.complete_pilot_count_zone(previous_session,source_zone);
    perform public.complete_pilot_count_zone(previous_session,other_zone);
    assert (select status in ('CLOSED','REVIEWING') from public.inventory_count_sessions where id=previous_session),'fixture prior count must finish counting';
    -- now() is stable within this rollback transaction. Give synthetic prior
    -- evidence an earlier completion time so bootstrap ordering is unambiguous.
    update public.inventory_count_sessions set completed_at=now()-interval '1 day' where id=previous_session;
    select snapshot into history_snapshot from public.inventory_count_sessions where id=previous_session;
    select jsonb_agg(to_jsonb(e) order by e.id) into history_entries from public.count_entries e where e.session_id=previous_session;

    perform set_config('request.jwt.claim.sub',admin_id::text,true);
    if scenario_number not in (2,7) then
      perform public.app_operation(store_id,'stock.open',jsonb_build_object('product_id',product_id),gen_random_uuid());
      old_qty:=case when scenario_number in (3,4) then 12 else 5 end;
      assert (private.stock_snapshot(store_id,product_id,'包')->>'total')::numeric=old_qty,'fixture bootstrap total';
    else
      assert not exists(select 1 from private.stock_initialized si where si.store_id=store_id and si.product_id=product_id),'uninitialized control';
    end if;
    perform public.app_operation(store_id,'stock.open',jsonb_build_object('product_id',second_product),gen_random_uuid());

    if scenario_number=5 then
      -- Real stock movement redistributes 5 as A=3,C=2. Its destination is not
      -- selected for the next partial count and must not be inferred to be zero.
      select sp.id,sp.revision into physical_position,physical_revision from private.stock_positions sp
      where sp.store_id=store_id and sp.product_id=product_id and sp.zone_id=source_zone and sp.quantity=5;
      perform set_config('request.jwt.claim.sub',staff_id::text,true);
      perform public.app_operation(store_id,'stock.move',jsonb_build_object('position_id',physical_position,'revision',physical_revision,
        'product_id',product_id,'quantity',2,'zone_id',other_zone,'state','READY'),gen_random_uuid());
      assert (private.stock_snapshot(store_id,product_id,'包')->>'total')::numeric=5,'physical movement preserves total';
    end if;

    perform set_config('request.jwt.claim.sub',owner_id::text,true);
    selection:=case when scenario_number in (3,4,5,7)
      then jsonb_build_array(jsonb_build_object('zone_id',source_zone,'product_id',product_id)) else null end;
    current_session:=public.start_pilot_count(store_id,selection);
    assert current_session<>previous_session,'fixture must start a new count';
    select coalesce(jsonb_agg(to_jsonb(sp) order by sp.id),'[]') into before_positions from private.stock_positions sp where sp.store_id=store_id;
    final_qty:=case scenario_number when 4 then 6 when 5 then 3 when 6 then 0 else 5 end;
    perform set_config('request.jwt.claim.sub',staff_id::text,true);
    stamp:=public.save_pilot_count_draft(current_session,source_zone,product_id,final_qty,null);
    if scenario_number in (1,2,3,6,7) then
      payload:=jsonb_build_object('session_id',current_session,'product_id',product_id,'source_zone_id',source_zone,
        'target_zone_id',target_zone,'expected_updated_at',stamp);
      result:=public.app_operation(store_id,'count.move-zone',payload,gen_random_uuid());
      assert (result->>'quantity')::numeric=final_qty,'card correction preserves actual count including zero';
      assert (select coalesce(jsonb_agg(to_jsonb(sp) order by sp.id),'[]') from private.stock_positions sp where sp.store_id=store_id)=before_positions,
        'card correction must not act as physical stock movement before count completion';
      perform public.complete_pilot_count_zone(current_session,target_zone);
    else
      perform public.complete_pilot_count_zone(current_session,source_zone);
    end if;
    if scenario_number not in (3,4,5,7) then
      perform public.save_pilot_count_draft(current_session,other_zone,second_product,7,null);
      perform public.complete_pilot_count_zone(current_session,other_zone);
    end if;
    assert (select status in ('CLOSED','REVIEWING') from public.inventory_count_sessions where id=current_session),'fixture current count must finish counting';
    assert (select snapshot=history_snapshot from public.inventory_count_sessions where id=previous_session),'historical count scope preserved';
    assert (select jsonb_agg(to_jsonb(e) order by e.id) from public.count_entries e where e.session_id=previous_session)=history_entries,'historical observations preserved';

    perform set_config('request.jwt.claim.sub',admin_id::text,true);
    perform public.app_operation(store_id,'stock.open',jsonb_build_object('product_id',product_id),gen_random_uuid());
    data:=public.app_workspace(store_id,'stock','{}');
    select (p->'stock'->>'total')::numeric into actual_total from jsonb_array_elements(data->'products') p where p->>'id'=product_id::text;
    select coalesce(sum(sp.quantity),0) into source_total from private.stock_positions sp where sp.store_id=store_id and sp.product_id=product_id and sp.unit='包' and sp.zone_id=source_zone;
    select coalesce(sum(sp.quantity),0) into target_total from private.stock_positions sp where sp.store_id=store_id and sp.product_id=product_id and sp.unit='包' and sp.zone_id=target_zone;
    select coalesce(sum(sp.quantity),0) into other_total from private.stock_positions sp where sp.store_id=store_id and sp.product_id=product_id and sp.unit='包' and sp.zone_id=other_zone;
    expected_total:=case scenario_number when 3 then 12 when 4 then 13 when 6 then 0 when 7 then 12 else 5 end;
    expected:=jsonb_build_object('total',expected_total,'A',case scenario_number when 4 then 6 when 5 then 3 else 0 end,
      'B',case when scenario_number in (1,2,3,7) then 5 else 0 end,'C',case when scenario_number in (3,4,7) then 7 when scenario_number=5 then 2 else 0 end);
    actual:=jsonb_build_object('total',actual_total,'A',source_total,'B',target_total,'C',other_total);
    insert into pg_temp.count_move_stock_checks values(scenario_number,scenario_name,expected,actual,expected=actual);
    assert (private.stock_snapshot(store_id,second_product,'瓶')->>'total')::numeric=7,'unrelated product quantity preserved';
    if scenario_number=1 then
      select jsonb_agg(to_jsonb(sp) order by sp.id) into original_other_store from private.stock_positions sp where sp.store_id=first_store;
    else
      assert (select jsonb_agg(to_jsonb(sp) order by sp.id) from private.stock_positions sp where sp.store_id=first_store)=original_other_store,'later scenario does not modify another store';
    end if;
  end loop;

  assert (select bool_and(passed) from pg_temp.count_move_stock_checks),
    'stock reconciliation cases: '||(select jsonb_agg(to_jsonb(t) order by case_number)::text from pg_temp.count_move_stock_checks t);
end $test$;
select 'ok 1 - card correction reconciles only its completed source; partial and physical stock scopes survive';
rollback;
