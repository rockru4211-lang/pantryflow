begin;
do $test$
#variable_conflict use_variable
declare actor uuid:=gen_random_uuid();admin_user uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();supervisor uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
org uuid:=gen_random_uuid();store_id uuid:=gen_random_uuid();other_store uuid:=gen_random_uuid();cold uuid:=gen_random_uuid();bar uuid:=gen_random_uuid();wine uuid:=gen_random_uuid();milk uuid:=gen_random_uuid();flour uuid:=gen_random_uuid();
state jsonb;payload jsonb;a jsonb;lot uuid;request uuid;account_id uuid;reserved_id uuid;identity_id uuid;before_stock numeric;counter integer;
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
 select id,id||'@inventory-month-test.invalid',now(),now(),now() from unnest(array[actor,admin_user,staff,supervisor,outsider]) id;
 insert into public.profiles(id,display_name) select id,'月盤測試' from unnest(array[actor,admin_user,staff,supervisor,outsider]) id on conflict(id) do nothing;
 insert into public.organizations(id,name) values(org,'月盤回滾測試');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(store_id,org,'BeApe','IM'||substr(store_id::text,1,8),actor),(other_store,org,'Gras','IM'||substr(other_store::text,1,8),actor);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
 values(org,actor,'OWNER',true,true),(org,admin_user,'LOGISTICS',false,false),(org,staff,'STAFF',false,false),(org,supervisor,'SUPERVISOR',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'月盤測試',actor from unnest(array[actor,admin_user,staff,supervisor]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
 values(store_id,org,actor,'im-owner','OWNER','OWNER',actor,true),(store_id,org,admin_user,'im-admin','LOGISTICS','LOGISTICS',actor,false),(store_id,org,staff,'im-staff','STAFF','STAFF',actor,false),(store_id,org,supervisor,'im-supervisor','SUPERVISOR','SUPERVISOR',actor,false);
 insert into public.count_zones(id,organization_id,store_id,name) values(cold,org,store_id,'冷藏'),(bar,org,store_id,'吧台');
 insert into public.products(id,organization_id,name,category,count_unit,base_unit) values(wine,org,'酒','酒類','瓶','瓶'),(milk,org,'鮮奶','食材','瓶','瓶'),(flour,org,'麵粉','乾貨','包','包');

 insert into public.zone_products(zone_id,product_id,count_unit) values(cold,wine,'瓶'),(cold,milk,'瓶');
 assert not has_function_privilege('anon','public.baihuayuan_custody(uuid,text,text,jsonb)','EXECUTE'),'anonymous denied';
 assert not has_function_privilege('authenticated','private.custody_state(uuid,text)','EXECUTE'),'internal reads denied';
 assert not has_table_privilege('authenticated','private.custody_accounts','SELECT,INSERT,UPDATE,DELETE'),'direct tables denied';
 foreach identity_id in array array[staff,supervisor,outsider] loop
  perform set_config('request.jwt.claim.sub',identity_id::text,true);
  begin perform public.baihuayuan_custody(store_id,'supplier');raise exception 'nonadmin accepted';exception when insufficient_privilege then null;end;
 end loop;
 perform set_config('request.jwt.claim.sub',admin_user::text,true);
 begin perform public.baihuayuan_custody(other_store,'supplier');raise exception 'cross store accepted';exception when insufficient_privilege then null;end;
 request:=gen_random_uuid();
 payload:=jsonb_build_object('request_id',request,'product_id',wine,'party','供應商','unit','瓶','quantity',100,'label','第一批','expires_on',current_date+90,'minimum',90,'warning_days',30,'handler','行政');
 state:=public.baihuayuan_custody(store_id,'supplier','create',payload);a:=state->'accounts'->0;account_id:=(a->>'id')::uuid;lot:=(a#>>'{lots,0,id}')::uuid;
 assert (a->>'remaining')::numeric=100,'initial supplier remainder';
 assert public.baihuayuan_custody(store_id,'supplier','create',payload)=state,'create idempotent';
 assert not exists(select 1 from private.stock_postings where source_id=request),'creation does not add physical stock';
 begin perform public.baihuayuan_custody(store_id,'supplier','create',payload||jsonb_build_object('request_id',gen_random_uuid()));raise exception 'duplicate accepted';exception when sqlstate '22023' then assert sqlerrm='CUSTODY_EXISTS';end;
 payload:=jsonb_build_object('request_id',gen_random_uuid(),'account_id',account_id,'revision',1,'lot_id',lot,'quantity',20,'handler','領貨主管','occurred_on',current_date);
 state:=public.baihuayuan_custody(store_id,'supplier','collect',payload);a:=state->'accounts'->0;
 assert (a->>'remaining')::numeric=80 and (a->>'revision')::int=2,'collect updates amount and revision';
 assert (select sum(quantity) from private.stock_positions where stock_positions.store_id=store_id and product_id=wine)=20,'supplier collect adds exactly once';
 assert public.baihuayuan_custody(store_id,'supplier','collect',payload)=state,'collect retry idempotent';
 assert (select count(*) from private.stock_postings where source_type='CUSTODY' and source_id=(payload->>'request_id')::uuid)=1,'one stock posting';
 begin perform public.baihuayuan_custody(store_id,'supplier','collect',payload||jsonb_build_object('quantity',1));raise exception 'changed retry accepted';exception when sqlstate '22023' then assert sqlerrm='CUSTODY_REQUEST_REUSED';end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin perform public.baihuayuan_custody(store_id,'supplier','collect',payload||jsonb_build_object('request_id',gen_random_uuid()));raise exception 'stale second admin accepted';exception when sqlstate '40001' then null;end;
 payload:=payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',2,'quantity',81);
 begin perform public.baihuayuan_custody(store_id,'supplier','collect',payload);raise exception 'overdraw accepted';exception when sqlstate '22023' then assert sqlerrm='CUSTODY_INSUFFICIENT';end;
 assert (public.baihuayuan_custody(store_id,'supplier')#>>'{accounts,0,remaining}')::numeric=80,'failed withdrawal rolled back';
 state:=public.baihuayuan_custody(store_id,'supplier','settings',jsonb_build_object('request_id',gen_random_uuid(),'account_id',account_id,'revision',2,'minimum',95,'warning_days',14,'followup','ordered','note','已聯絡'));
 assert state#>>'{accounts,0,minimum}'='95' and state#>>'{accounts,0,followup}'='ordered','settings changed correctly';
 state:=public.baihuayuan_custody(store_id,'supplier','batch',jsonb_build_object('request_id',gen_random_uuid(),'account_id',account_id,'revision',3,'quantity',30,'label','第二批','expires_on',current_date+60,'handler','行政'));
 assert (state#>>'{accounts,0,remaining}')::numeric=110,'batches aggregated across dates';
 assert jsonb_array_length(state#>'{accounts,0,lots}')=2,'batch history preserved';
 state:=public.baihuayuan_custody(store_id,'reserved','create',jsonb_build_object('request_id',gen_random_uuid(),'product_id',wine,'party','指定對象 A','unit','瓶','quantity',6,'label','保留一批','handler','行政'));
 a:=state->'accounts'->0;reserved_id:=(a->>'id')::uuid;lot:=(a#>>'{lots,0,id}')::uuid;
 assert (select sum(quantity) from private.stock_positions sp where sp.store_id=store_id and product_id=wine)=20,'reserving existing stock does not add stock';
 state:=public.baihuayuan_custody(store_id,'reserved','collect',jsonb_build_object('request_id',gen_random_uuid(),'account_id',reserved_id,'revision',1,'lot_id',lot,'quantity',3,'handler','A'));
 assert (state#>>'{accounts,0,remaining}')::numeric=3,'reserved remaining';
 assert (select sum(quantity) from private.stock_positions sp where sp.store_id=store_id and product_id=wine)=17,'reserved collection debits physical stock';
 begin perform public.baihuayuan_custody(store_id,'supplier','collect',jsonb_build_object('request_id',gen_random_uuid(),'account_id',reserved_id,'revision',2,'lot_id',lot,'quantity',1));raise exception 'wrong kind accepted';exception when sqlstate '22023' then assert sqlerrm='CUSTODY_NOT_FOUND';end;
 -- Expired batches remain visible but cannot be collected.
 update private.custody_lots set expires_on=current_date-2 where custody_lots.account_id=account_id;
 select id into lot from private.custody_lots cl where cl.account_id=account_id limit 1;
 begin perform public.baihuayuan_custody(store_id,'supplier','collect',jsonb_build_object('request_id',gen_random_uuid(),'account_id',account_id,'revision',4,'lot_id',lot,'quantity',1));raise exception 'expired accepted';exception when sqlstate '22023' then assert sqlerrm='CUSTODY_EXPIRED';end;
 -- Deactivated members cannot use an old session.
 update public.store_memberships set is_active=false where user_id=admin_user and store_memberships.store_id=store_id;
 perform set_config('request.jwt.claim.sub',admin_user::text,true);
 begin perform public.baihuayuan_custody(store_id,'supplier');raise exception 'inactive accepted';exception when insufficient_privilege then null;end;
 assert not exists(select 1 from public.count_entries where product_id in (wine,milk)),'historical counts untouched';
 raise notice 'custody tests passed: authorization, isolation, idempotency, revision conflicts, balances, expiry, settings and history';
end $test$;
rollback;
