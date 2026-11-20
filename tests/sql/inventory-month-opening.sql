begin;
do $test$
declare
 actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 org uuid; store_id uuid; zone_id uuid; product_id uuid; zero_id uuid;
 september uuid; october uuid; active_session uuid;
 data jsonb; snapshot jsonb; raw_row jsonb; item jsonb; original_entries jsonb;
 original_reviews jsonb; result jsonb; denied boolean;
begin
 insert into auth.users(id,email,email_confirmed_at)
 select id,id||'@inventory-opening.invalid',now() from unnest(array[actor,outsider]) id;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','期初隔離測試','business_type','SINGLE_RESTAURANT','store_mode','SINGLE'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code','QAOPEN'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);
 org:=(data->>'organization_id')::uuid; store_id:=(data->>'store_id')::uuid;
 insert into public.count_zones(organization_id,store_id,name) values(org,store_id,'乾貨') returning id into zone_id;
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'期初測試麵粉','包','包') returning id into product_id;
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'期初零數量','包','包') returning id into zero_id;
 insert into public.zone_products(zone_id,product_id,count_unit) values(zone_id,product_id,'包'),(zone_id,zero_id,'包');
 snapshot:=jsonb_build_object('zones',jsonb_build_array(
  jsonb_build_object('zone_id',zone_id,'zone_name','乾貨','product_id',product_id,'product_name','期初測試麵粉','unit','包'),
  jsonb_build_object('zone_id',zone_id,'zone_name','乾貨','product_id',zero_id,'product_name','期初零數量','unit','包')));
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot,started_at,completed_at)
 values(org,store_id,actor,'REVIEWING',snapshot,'2026-09-30 02:00Z','2026-10-13 08:00Z') returning id into september;
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,entered_at)
 values(org,september,zone_id,product_id,1.5,'包',actor,'INITIAL_COUNT','2026-09-30 03:00Z'),
  (org,september,zone_id,zero_id,0,'包',actor,'INITIAL_COUNT','2026-09-30 03:00Z');
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot,started_at,completed_at)
 values(org,store_id,actor,'REVIEWING',snapshot,'2026-10-30 02:00Z','2026-11-01 08:00Z') returning id into october;
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,entered_at)
 values(org,october,zone_id,product_id,2.3,'包',actor,'INITIAL_COUNT','2026-10-30 03:00Z'),
  (org,october,zone_id,zero_id,1,'包',actor,'INITIAL_COUNT','2026-10-30 03:00Z');
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot,started_at)
 values(org,store_id,actor,'IN_PROGRESS',snapshot,'2026-09-30 04:00Z') returning id into active_session;
 select r into raw_row from jsonb_array_elements(private.inventory_month_source(october)) r where r->>'product_id'=product_id::text;
 insert into private.inventory_month_reviews(store_id,month,session_id,row_key,source_signature,price_set,unit_price,reviewed_by)
 values(store_id,'2026-10-01',october,raw_row->>'row_key',md5(jsonb_build_array(raw_row,null::jsonb)::text),true,32,actor);
 insert into private.inventory_month_quantity_adjustments(store_id,month,session_id,row_key,source_quantity,quantity,reason,updated_by)
 values(store_id,'2026-09-01',september,product_id::text||':包',1.5,1.25,'後勤核對',actor);
 select jsonb_agg(to_jsonb(e) order by e.id) into original_entries from public.count_entries e where e.session_id in (september,october);
 select jsonb_agg(to_jsonb(r)) into original_reviews from private.inventory_month_reviews r where r.session_id=october;
 set local role authenticated;
 result:=public.baihuayuan_inventory_month(store_id,'2026-10-01');
 assert result->>'previous_source_id'=september::text,'late completion changed physical month';
 assert (result->>'has_previous')::boolean,'completed count requires financial close';
 select r into item from jsonb_array_elements(result->'rows') r where r->>'product_id'=product_id::text;
 assert (item->>'previous_quantity')::numeric=1.25,'saved September correction was lost';
 assert (item->>'current_quantity')::numeric=2.3,'October quantity changed';
 assert (item->>'unit_price')::numeric=32 and (item->>'amount')::numeric=73.6,'saved October price was lost';
 assert exists(select 1 from jsonb_array_elements(result->'rows')r where r->>'product_id'=zero_id::text and (r->>'previous_quantity')::numeric=0),'zero opening became missing';
 reset role;
 assert (select jsonb_agg(to_jsonb(e) order by e.id) from public.count_entries e where e.session_id in (september,october))=original_entries,'raw counts changed';
 assert (select jsonb_agg(to_jsonb(r)) from private.inventory_month_reviews r where r.session_id=october)=original_reviews,'saved reviews changed';
 assert private.inventory_month_carry_source(gen_random_uuid(),'2026-09-01') is null,'cross-store baseline leaked';
 assert not has_function_privilege('authenticated','private.inventory_month_carry_source(uuid,date)','EXECUTE'),'internal helper exposed';
 assert not has_function_privilege('anon','private.inventory_month_carry_source(uuid,date)','EXECUTE'),'anonymous helper exposed';
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 set local role authenticated;
 denied:=false;
 begin perform public.baihuayuan_inventory_month(store_id,'2026-10-01');
 exception when insufficient_privilege then denied:=true;end;
 assert denied,'unauthorized monthly read accepted';
 reset role;
end $test$;
rollback;
select 'PASS previous physical month, saved quantities and prices, zero, source preservation and role denial' result;
