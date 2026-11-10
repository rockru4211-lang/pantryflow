-- Isolated regression only: no production credentials; entire fixture is rolled back.
begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();a_actor uuid:=gen_random_uuid();b_actor uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();foreign_org uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();foreign_b uuid:=gen_random_uuid();
 za uuid:=gen_random_uuid();zb uuid:=gen_random_uuid();pa uuid:=gen_random_uuid();pb uuid:=gen_random_uuid();
 payload jsonb;result jsonb;batch_result jsonb;req uuid;recorder uuid;actor uuid;source uuid;destination uuid;product uuid;
 work_date date:=date_trunc('month',now() at time zone 'Asia/Taipei')::date-1; today date:=(now() at time zone 'Asia/Taipei')::date;
 waste_payload jsonb; waste_result jsonb; waste_id uuid; waste_request uuid;
 before_moves bigint;before_events bigint;before_requests bigint;before_receipts bigint;before_stock jsonb;direction_index integer;
begin
 select count(*) into before_receipts from public.receipt_lines;
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
 select id,id||'@transfer-batch.invalid',now(),now(),now() from unnest(array[owner_id,a_actor,b_actor,outsider]) id;
 insert into public.profiles(id,display_name) select id,'多項調撥回滾測試' from unnest(array[owner_id,a_actor,b_actor,outsider]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type,store_mode)
 values(org,'多項調撥測試','SINGLE_RESTAURANT','MULTI'),(foreign_org,'隔離拒絕測試','SINGLE_RESTAURANT','MULTI');
 insert into public.stores(id,organization_id,name,store_code,created_by)
 values(a,org,'BeApe','TB'||substr(a::text,1,8),owner_id),(b,org,'Gras','TB'||substr(b::text,1,8),owner_id),(foreign_b,foreign_org,'Gras','TB'||substr(foreign_b::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
 values(org,owner_id,'OWNER',true,true),(org,a_actor,'STAFF',false,false),(org,b_actor,'SUPERVISOR',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by)
 select org,id,'多項調撥回滾測試',owner_id from unnest(array[owner_id,a_actor,b_actor]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
 values(a,org,owner_id,'tb-owner','OWNER','OWNER',owner_id,true),(a,org,a_actor,'tb-a','STAFF','STAFF',owner_id,false),(b,org,b_actor,'tb-b','SUPERVISOR','SUPERVISOR',owner_id,false);
 insert into public.count_zones(id,organization_id,store_id,name) values(za,org,a,'食材'),(zb,org,b,'食材');
 insert into public.products(id,organization_id,name,base_unit,count_unit) values(pa,org,'一店火腿','公斤','公斤'),(pb,org,'二店食材','盒','盒');
 insert into public.zone_products(zone_id,product_id,count_unit) values(za,pa,'公斤'),(zb,pb,'盒');
 select coalesce(jsonb_agg(to_jsonb(sp) order by to_jsonb(sp)::text),'[]') into before_stock from private.stock_positions sp where sp.store_id in (a,b);
 foreach recorder in array array[a,b] loop
  actor:=case when recorder=a then a_actor else b_actor end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  assert public.app_workspace(recorder,'transfers','{}')->>'transfer_batch_version'='1','missing batch capability';
  for direction_index in 1..2 loop
   source:=case when direction_index=1 then a else b end;destination:=case when direction_index=1 then b else a end;product:=case when direction_index=1 then pa else pb end;
   payload:=jsonb_build_object('from_store_id',source,'to_store_id',destination,'note','多項回滾測試','items',jsonb_build_array(
    jsonb_build_object('product_id',product,'quantity',2,'unit','包'),
    jsonb_build_object('manual',true,'name','臨時奶油','quantity',1,'unit','盒'),
    jsonb_build_object('manual',true,'name','臨時雞蛋','quantity',20,'unit','顆')));
   if direction_index=1 then payload:=payload||jsonb_build_object('work_date',work_date); end if;
   req:=gen_random_uuid();select count(*) into before_moves from private.store_movements where organization_id=org;
   batch_result:=public.app_operation(recorder,'movement.transfer-create',payload,req);
   assert (batch_result->>'count')::int=3 and jsonb_array_length(batch_result->'items')=3,'not all rows returned';
   assert batch_result->'items'->0->>'unit'='包','unit silently overwritten';
   assert (select count(*) from private.store_movements where organization_id=org)=before_moves+3,'batch count';
   assert public.app_operation(recorder,'movement.transfer-create',payload,req)=batch_result,'retry changed result';
   assert (select count(*) from private.store_movements where organization_id=org)=before_moves+3,'retry duplicated rows';
   assert (select count(*) from private.app_requests where store_id=recorder and request_id=req)=1,'not one retry key';
   begin perform public.app_operation(recorder,'movement.transfer-create',payload||'{"note":"conflict"}',req);raise exception 'conflict accepted';exception when unique_violation then null;end;
   for result in select value from jsonb_array_elements(batch_result->'items') loop
    assert result->>'from_store_id'=source::text and result->>'to_store_id'=destination::text,'direction changed';
    assert result->>'created_by'=actor::text and result->>'review_status'='PENDING','actor or review changed';
    if direction_index=1 then
     assert ((result->>'occurred_at')::timestamptz at time zone 'Asia/Taipei')::date=work_date,'wrong transfer date';
     assert ((result->>'created_at')::timestamptz at time zone 'Asia/Taipei')::date=today,'transfer creation timestamp changed';
    else
     assert result->>'occurred_at' is null,'undated legacy transfer changed';
    end if;
    assert exists(select 1 from private.store_movement_events where movement_id=(result->>'id')::uuid and actor_id=actor and store_id=recorder),'recorder lost';
    assert exists(select 1 from jsonb_array_elements(public.app_workspace(recorder,'transfers','{}')->'records') r where r->>'id'=result->>'id'),'row hidden from admin-compatible workspace';
   end loop;
   select count(*) into before_moves from private.store_movements;select count(*) into before_events from private.store_movement_events;select count(*) into before_requests from private.app_requests;
   begin perform public.app_operation(recorder,'movement.transfer-create',jsonb_set(payload,'{items,2,quantity}','0'),gen_random_uuid());raise exception 'bad batch accepted';exception when invalid_parameter_value then null;end;
   assert (select count(*) from private.store_movements)=before_moves,'failed batch kept movement';
   assert (select count(*) from private.store_movement_events)=before_events,'failed batch kept event';
   assert (select count(*) from private.app_requests)=before_requests,'failed batch cached success';
   begin perform public.app_operation(recorder,'movement.transfer-create',payload||'{"items":[]}',gen_random_uuid());raise exception 'empty batch accepted';exception when invalid_parameter_value then null;end;
   begin perform public.app_operation(recorder,'movement.transfer-create',payload||jsonb_build_object('items',jsonb_build_array(payload->'items'->0,payload->'items'->0)),gen_random_uuid());raise exception 'duplicate product accepted';exception when invalid_parameter_value then null;end;
   begin perform public.app_operation(recorder,'movement.transfer-create',payload||jsonb_build_object('items',(select jsonb_agg(payload->'items'->1) from generate_series(1,51))),gen_random_uuid());raise exception 'oversize batch accepted';exception when invalid_parameter_value then null;end;
   begin perform public.app_operation(recorder,'movement.transfer-create',jsonb_set(payload,'{items,1,from_store_id}',to_jsonb(destination)),gen_random_uuid());raise exception 'row direction override accepted';exception when invalid_parameter_value then null;end;
   begin perform public.app_operation(recorder,'movement.transfer-create',payload||jsonb_build_object('work_date',today+1),gen_random_uuid());raise exception 'future transfer date accepted';exception when invalid_parameter_value then null;end;
   begin perform public.app_operation(recorder,'movement.transfer-create',jsonb_set(payload,'{items,1,work_date}',to_jsonb(work_date)),gen_random_uuid());raise exception 'row date override accepted';exception when invalid_parameter_value then null;end;
   begin perform public.app_operation(recorder,'movement.transfer-create',jsonb_set(payload,'{items,1,items}','[]'),gen_random_uuid());raise exception 'nested batch accepted';exception when invalid_parameter_value then null;end;
   begin perform public.app_operation(recorder,'movement.transfer-create',payload||jsonb_build_object('to_store_id',foreign_b),gen_random_uuid());raise exception 'foreign batch accepted';exception when invalid_parameter_value then null;end;
   begin perform public.app_operation(recorder,'movement.transfer-create',jsonb_set(payload,'{items,0,unit}','""'),gen_random_uuid());raise exception 'blank unit accepted';exception when invalid_parameter_value then null;end;
  end loop;
 end loop;
 perform set_config('request.jwt.claim.sub',a_actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a_actor,'role','authenticated')::text,true);
 waste_payload:=jsonb_build_object('name','回滾廢棄','quantity',1,'unit','盒','reason','其他','work_date',work_date);
 waste_request:=gen_random_uuid();
 waste_result:=public.save_pilot_expiry_waste(a,waste_request,'WASTE',waste_payload);
 waste_id:=(waste_result->>'id')::uuid;
 assert waste_result->>'work_date'=work_date::text,'missing waste receipt date';
 assert public.save_pilot_expiry_waste(a,waste_request,'WASTE',waste_payload)=waste_result,'waste retry changed result';
 assert (select count(*) from private.waste_records where store_id=a and name='回滾廢棄')=1,'waste retry duplicated rows';
 assert exists(select 1 from private.waste_records w where w.id=waste_id and w.work_date=(waste_payload->>'work_date')::date and (w.created_at at time zone 'Asia/Taipei')::date=today and w.requires_review),'wrong waste dates or review';
 assert exists(select 1 from jsonb_array_elements(public.get_pilot_expiry_waste(a,work_date,work_date)->'waste') w where w->>'id'=waste_id::text),'backdated waste missing from its date';
 assert not exists(select 1 from jsonb_array_elements(public.get_pilot_expiry_waste(a,today,today)->'waste') w where w->>'id'=waste_id::text),'backdated waste appears today';
 begin perform public.save_pilot_expiry_waste(a,gen_random_uuid(),'WASTE',waste_payload||jsonb_build_object('work_date',today+1));raise exception 'future waste date accepted';exception when invalid_parameter_value then null;end;
 begin perform public.save_pilot_expiry_waste(a,gen_random_uuid(),'WASTE',waste_payload||'{"work_date":"2026-02-30"}');raise exception 'invalid waste date accepted';exception when invalid_parameter_value then null;end;
 waste_result:=public.save_pilot_expiry_waste(a,gen_random_uuid(),'WASTE',(waste_payload-'work_date')||'{"name":"舊版回滾廢棄"}');
 assert exists(select 1 from private.waste_records w where w.id=(waste_result->>'id')::uuid and w.work_date=today),'undated legacy waste changed';
 assert not exists(select 1 from public.store_memberships where store_id=a and user_id=b_actor),'granted source access';
 assert not exists(select 1 from public.products where organization_id=org and name like '臨時%'),'manual row created catalog';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 result:=batch_result->'items'->0;
 result:=public.app_operation(a,'movement.transfer-confirm',jsonb_build_object('id',result->>'id','revision',1,'quantity',2,'unit','包','unit_price',30),gen_random_uuid());
 assert (result->>'transfer_amount')::numeric=60,'admin could not confirm row';
 assert (select coalesce(jsonb_agg(to_jsonb(sp) order by to_jsonb(sp)::text),'[]') from private.stock_positions sp where sp.store_id in (a,b))=before_stock,'batch changed stock';
 assert (select count(*) from public.receipt_lines)=before_receipts,'batch changed receipts';
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 begin perform public.app_operation(b,'movement.transfer-create',payload,gen_random_uuid());raise exception 'outsider accepted';exception when insufficient_privilege then null;end;
 begin
  perform public.save_pilot_expiry_waste(a,gen_random_uuid(),'WASTE',waste_payload);
  raise exception 'outsider waste accepted';
 exception when others then
  if sqlstate<>'42501' and sqlerrm not like '%FORBIDDEN%' and sqlerrm not like '%ACCESS_DENIED%' and sqlerrm not like '%STORE_READ_ONLY%' then raise; end if;
 end;
end;$test$;
rollback;
