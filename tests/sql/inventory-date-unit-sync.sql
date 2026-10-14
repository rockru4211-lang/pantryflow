begin;
do $$
declare actor uuid:=gen_random_uuid();viewer uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();org uuid;store_id uuid;data jsonb;z uuid;p uuid;p2 uuid;cs uuid;oldcs uuid;month date:=date_trunc('month',now() at time zone 'Asia/Taipei')::date;stamp timestamptz;oldstamp timestamptz;payload jsonb;result jsonb;req uuid:=gen_random_uuid();denied boolean;before_snapshot jsonb; expected jsonb; saved jsonb; r jsonb; newz uuid;
begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@receipt-detail.invalid',now() from unnest(array[actor,viewer,staff])id;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','進貨隔離測試','business_type','SINGLE_RESTAURANT','store_mode','SINGLE'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code','QAREVIEW'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);
 org:=(data->>'organization_id')::uuid;store_id:=(data->>'store_id')::uuid;


 insert into public.count_zones(organization_id,store_id,name) values(org,store_id,'未分類') returning id into z;
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'測試麵粉','公斤','公斤') returning id into p;
 insert into public.zone_products(zone_id,product_id,count_unit) values(z,p,'公斤');
 before_snapshot:=jsonb_build_object('zones',jsonb_build_array(jsonb_build_object('zone_id',z,'zone_name','未分類','product_id',p,'product_name','測試麵粉','unit','公斤')));
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot,started_at,completed_at)
 values(org,store_id,actor,'REVIEWING',before_snapshot,'2026-09-21 03:00Z','2026-10-13 08:00Z') returning id into cs;
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,entered_at)
 values(org,cs,z,p,2,'公斤',actor,'INITIAL_COUNT','2026-09-30 11:00Z');
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot,started_at)
 values(org,store_id,actor,'IN_PROGRESS',before_snapshot,'2026-10-13 09:00Z') returning id into oldcs;
 set local role authenticated;
 data:=public.baihuayuan_latest_inventory(store_id);
 assert data->>'month'='2026-09-01' and data->>'count_date'='2026-09-30','late completion or empty session changed inventory date';
 data:=public.baihuayuan_inventory_month(store_id,'2026-09-01');
 assert data->>'source_id'=cs::text and data->>'count_date'='2026-09-30','September physical count absent';
 r:=data->'rows'->0;
 expected:=jsonb_build_object('source_signature',r->'source_signature','values',jsonb_build_object('name',r->'name','unit',r->'unit','quantity',r->'current_quantity','price',r->'unit_price','note',r->'review_note'));
 saved:=public.save_baihuayuan_inventory_inline_v3(store_id,'2026-09-01',cs,r->>'row_key',expected,'測試麵粉更名','包',3,120,'一包一公斤');
 data:=public.baihuayuan_inventory_month(store_id,'2026-09-01');
 r:=data->'rows'->0;
 assert r->>'unit'='包' and (r->>'unit_price')::numeric=120 and (r->>'amount')::numeric=360,'unit/price/name correction was not persisted';
 assert r->>'name'='測試麵粉更名' and r->>'source_unit'='公斤','name or original unit absent';
 saved:=public.save_baihuayuan_inventory_inline_v3(store_id,'2026-09-01',cs,r->>'row_key',expected,'測試麵粉更名','包',3,120,'一包一公斤');
 assert (saved->>'replayed')::boolean,'same save not idempotent';
 denied:=false;begin perform public.save_baihuayuan_inventory_inline_v3(store_id,'2026-09-01',cs,r->>'row_key',expected,'測試麵粉','箱',5,150,'stale');exception when serialization_failure then denied:=true;end;assert denied,'stale edit accepted';
 denied:=false;begin perform public.save_baihuayuan_inventory_inline_v3(store_id,'2026-10-01',cs,r->>'row_key',expected,'測試麵粉','箱',5,150,'wrong month');exception when invalid_parameter_value then denied:=true;end;assert denied,'wrong month accepted';
 reset role;
 assert (select unit='公斤' and quantity=2 from public.count_entries where session_id=cs),'original count overwritten';
 assert (select snapshot=before_snapshot from public.inventory_count_sessions where id=oldcs),'other session changed';
 assert (select count(*)=1 from private.inventory_month_reviews where session_id=cs),'duplicate reviews';
 -- Current zone classification comes from the same catalog used by mobile.
 insert into public.count_zones(organization_id,store_id,name) values(org,store_id,'乾貨') returning id into newz;
 update public.zone_products set zone_id=newz where zone_id=z and product_id=p;
 set local role authenticated;
 data:=public.get_pilot_inventory_catalog(store_id);
 assert exists(select 1 from jsonb_array_elements(data)x where x->>'product_id'=p::text and x->>'zone'='乾貨'),'catalog classification stale';
 reset role;
 insert into private.inventory_month_closures(store_id,month,session_id,payload,confirmed_by) values(store_id,'2026-09-01',cs,private.inventory_month_state(store_id,'2026-09-01',cs),actor);
 set local role authenticated;
 denied:=false;begin perform public.save_baihuayuan_inventory_inline_v3(store_id,'2026-09-01',cs,r->>'row_key',expected,'測試麵粉','箱',5,150,'closed');exception when invalid_parameter_value then denied:=true;end;assert denied,'closed month edited';
 reset role;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 set local role authenticated;
 denied:=false;begin perform public.baihuayuan_latest_inventory(store_id);exception when insufficient_privilege then denied:=true;end;assert denied,'unauthorized latest read';
 denied:=false;begin perform public.save_baihuayuan_inventory_inline_v3(store_id,'2026-09-01',cs,r->>'row_key',expected,'測試麵粉更名','包',3,120,'一包一公斤');exception when insufficient_privilege then denied:=true;end;assert denied,'unauthorized retry';
 reset role;
 assert not has_function_privilege('anon','public.save_baihuayuan_inventory_inline_v3(uuid,date,uuid,text,jsonb,text,text,numeric,numeric,text)','EXECUTE'),'anon write grant';
end $$;
rollback;
select 'PASS: actual count date, empty session, editable unit/price, retry, concurrency, store-role denial, closed month, original evidence and other session preservation' result;
