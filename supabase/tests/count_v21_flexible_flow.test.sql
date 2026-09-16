begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.count_v21_contract() returns setof text language plpgsql as $$
declare
  manager uuid:=gen_random_uuid();
  data jsonb; org uuid; store uuid; zone uuid; product uuid; added uuid; first_session uuid; next_session uuid;
begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
  values(manager,manager||'@count-v21.invalid',now(),now(),now());
  perform set_config('request.jwt.claim.sub',manager::text,true);
  data:=public.owner_setup();
  data:=public.owner_setup('business','{"organization_name":"盤點V21測試","business_type":"SINGLE_RESTAURANT","store_mode":"SINGLE"}',0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','測試門市','store_code','CV21'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),(data->>'revision')::int);
  data:=public.owner_setup('identity',data->'draft'||'{"work_role":"SUPERVISOR"}',(data->>'revision')::int);
  data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);
  store:=(data->>'store_id')::uuid; org:=(data->>'organization_id')::uuid;

  zone:=public.create_pilot_zone(store,'酒水區');
  product:=public.create_pilot_product(store,'CV21-BASE','基礎品項','瓶','瓶',10);
  perform public.assign_pilot_product_to_zone(zone,product);

  first_session:=public.start_pilot_count(store,null);
  added:=public.add_pilot_count_item(first_session,zone,'盤點中新增品項','瓶');
  return next ok((select snapshot->'zones' @> jsonb_build_array(jsonb_build_object('zone_id',zone,'product_id',added)) from public.inventory_count_sessions where id=first_session),'active count can append a new item');

  perform public.save_pilot_count_drafts(first_session,jsonb_build_array(
    jsonb_build_object('zone_id',zone,'product_id',product,'quantity',9,'expected_updated_at',null),
    jsonb_build_object('zone_id',zone,'product_id',added,'quantity',0,'expected_updated_at',null)
  ));
  perform public.complete_pilot_count_zone(first_session,zone);
  return next is((select status::text from public.inventory_count_sessions where id=first_session),'REVIEWING','difference remains follow-up work');
  return next ok(exists(select 1 from public.count_entries where session_id=first_session and product_id=added and quantity=0),'zero quantity remains in immutable count history');

  perform public.set_pilot_count_next_period(store,added,'EXCLUDE');
  next_session:=public.start_pilot_count(store,null);
  return next isnt(next_session,first_session,'pending discrepancy does not block next count');
  return next ok(not (select snapshot->'zones' @> jsonb_build_array(jsonb_build_object('product_id',added)) from public.inventory_count_sessions where id=next_session),'excluded zero-stock item is omitted next period');
  return next ok((select snapshot->'zones' @> jsonb_build_array(jsonb_build_object('product_id',added)) from public.inventory_count_sessions where id=first_session),'next-period exclusion never rewrites old history');

  return next lives_ok(format('select public.set_pilot_count_next_period(%L,%L,%L)',store,added,'KEEP'),'manager can restore item for a future count');
end $$;

select * from pg_temp.count_v21_contract();
select * from finish();
rollback;
