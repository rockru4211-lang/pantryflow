begin;
do $$
declare owner_id uuid; person uuid; org uuid; sid uuid; foreign_store uuid; supplier_id uuid; req uuid;
 data jsonb; payload jsonb; result jsonb; saved jsonb; before_data text; mode text; r text; denied boolean;
begin
 select md5(coalesce(string_agg(to_jsonb(d)::text,'' order by d.id),'')) into before_data from public.receipt_documents d;
 assert not has_function_privilege('anon','public.app_operation(uuid,text,jsonb,uuid)','execute'),'anon write exposed';
 assert not has_table_privilege('authenticated','private.supplier_details','select,insert,update,delete'),'private supplier details exposed';
 assert (select relrowsecurity from pg_class where oid='private.supplier_details'::regclass),'supplier RLS missing';
 foreach mode in array array['SINGLE_RESTAURANT','CHAIN_RESTAURANT'] loop
  owner_id:=gen_random_uuid();insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values(owner_id,owner_id||'@supplier-fixture.invalid',now(),now(),now());
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  data:=public.owner_setup();
  data:=public.owner_setup('business',jsonb_build_object('organization_name','Supplier QA','business_type',mode,'store_mode','SINGLE'),0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','Supplier QA','store_code','QA'||substr(replace(gen_random_uuid()::text,'-',''),1,14),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
  data:=public.owner_setup('complete','{}',(data->>'revision')::int);org:=(data->>'organization_id')::uuid;sid:=(data->>'store_id')::uuid;
  foreach r in array array['OWNER','LOGISTICS','SUPERVISOR','STAFF'] loop
   if r='OWNER' then person:=owner_id;else
    person:=gen_random_uuid();insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values(person,person||'@supplier-fixture.invalid',now(),now(),now());
    update public.profiles set organization_id=org,role=r::public.app_role where id=person;
    insert into public.organization_members(organization_id,user_id,role) values(org,person,r::public.app_role);
    insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,person,'Supplier QA '||r,owner_id);
    insert into public.store_memberships(store_id,organization_id,user_id,role,work_role,login_identifier,assigned_by) values(sid,org,person,r::public.app_role,r::public.app_role,lower(r),owner_id);
   end if;
   perform set_config('request.jwt.claim.sub',person::text,true);req:=gen_random_uuid();
   payload:=jsonb_build_object('name','Supplier '||r,'contact_name','QA','phone','02-00000000','delivery_note','每週一、四','order_method','LINE','order_url','https://example.com/order','cutoff_time','前日15:00','order_note','缺貨先確認','aliases',jsonb_build_array('OCR '||r),'cooperation_status','BACKUP','line_group','QA 訂貨群','line_id','qa','primary_supplies','蔬菜','supply_note','香菜缺貨先確認','billing_cycle','每月25日','payment_terms','次月10日','bank_account','00001234','cooperation_note','fixture-private');
   if mode='CHAIN_RESTAURANT' or r in ('STAFF','SUPERVISOR') then
    denied:=false;begin perform public.app_operation(sid,'supplier.save',payload,req);exception when insufficient_privilege then denied:=true;end;assert denied,'unauthorized supplier write';
    if mode='SINGLE_RESTAURANT' then
     data:=public.app_workspace(sid,'suppliers');assert data->>'editable'='false','field role can edit';
     assert jsonb_array_length(data->'suppliers')>0,'field supplier read empty';
     for saved in select value from jsonb_array_elements(data->'suppliers') loop
      if saved->>'name' like 'Renamed %' then assert saved->>'line_group'='QA 訂貨群','field ordering details lost';end if;
      assert not (saved ?| array['billing_cycle','payment_terms','bank_account','bank_name','account_name','cooperation_note']),'field finance leak';
     end loop;
    elsif r='STAFF' then
     denied:=false;begin perform public.app_workspace(sid,'suppliers');exception when insufficient_privilege then denied:=true;end;assert denied,'chain field read unexpectedly expanded';
    end if;
    continue;
   end if;
   result:=public.app_operation(sid,'supplier.save',payload,req);supplier_id:=(result->>'id')::uuid;
   assert public.app_operation(sid,'supplier.save',payload,req)=result,'retry changed result';
   assert (select count(*) from private.app_requests where store_id=sid and request_id=req)=1,'retry duplicated';
   select x into saved from jsonb_array_elements(public.app_workspace(sid,'suppliers')->'suppliers') x where x->>'id'=supplier_id::text;
   assert saved->>'line_group'='QA 訂貨群' and saved->>'bank_account'='00001234' and saved->>'cooperation_status'='BACKUP','directory roundtrip failed';
   assert saved->>'order_note'='缺貨先確認' and saved->>'cutoff_time'='前日15:00','contact roundtrip failed';
   payload:=payload||jsonb_build_object('id',supplier_id,'updated_at',saved->>'updated_at','name','Renamed '||r,'order_note','更新備註');
   result:=public.app_operation(sid,'supplier.save',payload,gen_random_uuid());
   assert result->'previous'->>'order_note'='缺貨先確認','old contact history lost';
   assert (result->'value'->'aliases') ? ('Supplier '||r),'rename lost old invoice spelling';
   assert (select new_value->'value'->>'order_note' from public.audit_logs where entity_id=supplier_id::text and action='supplier.save' order by created_at desc,id desc limit 1) is not null,'audit missing';
   denied:=false;begin perform public.app_operation(sid,'supplier.save',payload||'{"updated_at":"2000-01-01T00:00:00Z","order_note":"bad"}',gen_random_uuid());exception when serialization_failure then denied:=true;end;assert denied,'stale overwrite accepted';
   denied:=false;begin perform public.app_operation(sid,'supplier.save',payload||jsonb_build_object('updated_at',result->'value'->>'updated_at','order_url','javascript:alert(1)'),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'unsafe URL accepted';
   result:=public.app_operation(sid,'supplier.save',jsonb_build_object('id',supplier_id,'name','Renamed '||r,'updated_at',result->'value'->>'updated_at'),gen_random_uuid());
   assert result->'value'->>'order_note'='更新備註','legacy save erased new metadata';
   assert result->'value'->>'line_group'='QA 訂貨群' and result->'value'->>'bank_account'='00001234','legacy save erased directory';
   result:=public.app_operation(sid,'supplier.save',jsonb_build_object('id',supplier_id,'name','Renamed '||r,'updated_at',result->'value'->>'updated_at','is_active',false),gen_random_uuid());
   assert result->'value'->>'is_active'='false' and result->'value'->>'cooperation_status'='BACKUP','pause changed backup state';
   result:=public.app_operation(sid,'supplier.save',jsonb_build_object('id',supplier_id,'name','Renamed '||r,'updated_at',result->'value'->>'updated_at','primary_supplies','季節蔬菜'),gen_random_uuid());
   assert result->'value'->>'is_active'='false','partial update reactivated paused supplier';
   result:=public.app_operation(sid,'supplier.save',jsonb_build_object('id',supplier_id,'name','Renamed '||r,'updated_at',result->'value'->>'updated_at','is_active',true),gen_random_uuid());
   assert result->'value'->>'is_active'='true' and result->'value'->>'bank_account'='00001234','reactivation lost directory';
   denied:=false;begin perform public.app_operation(sid,'supplier.save',jsonb_build_object('id',supplier_id,'name','Renamed '||r,'updated_at',result->'value'->>'updated_at','cooperation_status','BAD'),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'invalid status accepted';
   data:=public.app_operation(sid,'supplier.save',jsonb_build_object('name','Paused new '||r,'is_active',false),gen_random_uuid());
   assert data->'value'->>'is_active'='false','new paused supplier activated';
   -- Supplier categories are independent of item categories and preserve the supplier identity.
   for data in select jsonb_build_object('source',src,'expected',dest) from (values ('食材','食材'),('酒水','酒水'),('耗材','耗材'),('調料','食材'),('酒類','酒水'),('待分類',''),('','')) mapping(src,dest) loop
    result:=public.app_operation(sid,'supplier.save',jsonb_build_object('id',supplier_id,'name','Renamed '||r,'updated_at',result->'value'->>'updated_at','supplier_category',data->>'source'),gen_random_uuid());
    assert result->'value'->>'supplier_category'=data->>'expected','supplier category conversion failed';
    assert result->>'id'=supplier_id::text and result->'value'->>'bank_account'='00001234','category edit changed supplier identity or metadata';
   end loop;
   denied:=false;begin perform public.app_operation(sid,'supplier.save',jsonb_build_object('id',supplier_id,'name','Renamed '||r,'updated_at',result->'value'->>'updated_at','supplier_category','器材'),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'unknown category accepted';
   if r='LOGISTICS' then
    update public.store_memberships set role='STAFF',work_role='STAFF' where store_id=sid and user_id=person;
    denied:=false;begin perform public.app_operation(sid,'supplier.save',payload,req);exception when insufficient_privilege then denied:=true;end;assert denied,'downgraded role replay allowed';
   end if;
  end loop;
  if foreign_store is not null then
   perform set_config('request.jwt.claim.sub',owner_id::text,true);
   denied:=false;begin perform public.app_workspace(foreign_store,'suppliers');exception when insufficient_privilege then denied:=true;end;assert denied,'foreign supplier read exposed';
  end if;
  foreign_store:=sid;
 end loop;
 assert before_data=(select md5(coalesce(string_agg(to_jsonb(d)::text,'' order by d.id),'')) from public.receipt_documents d),'original receipts changed';
end $$;
rollback;
