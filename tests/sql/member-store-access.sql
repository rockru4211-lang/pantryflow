-- Isolated fixtures only. Existing auth methods and production records are untouched.
begin;
do $test$
declare
  owner_id uuid:=gen_random_uuid(); target_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid();
  limited_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid();
  org uuid; other_org uuid; a uuid; b uuid; foreign_store uuid; zone_id uuid;
  sid uuid:=gen_random_uuid(); device_id uuid:=gen_random_uuid(); staff_sid uuid:=gen_random_uuid(); staff_device uuid:=gen_random_uuid();
  old_sid uuid:=gen_random_uuid(); old_device uuid:=gen_random_uuid(); before_activity jsonb; before_bindings jsonb;
  a_code text:='QASCOPE'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  b_code text:='QASCOPE'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  data jsonb; patch jsonb; before_members jsonb; before_credentials jsonb; before_auth jsonb;
  login_result record; denied boolean; affected integer; n integer;
begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
  select u,u||'@scope-regression.invalid',now(),now(),now()
  from unnest(array[owner_id,target_id,staff_id,limited_id,outsider_id]) u;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  data:=public.owner_setup();
  data:=public.owner_setup('business',jsonb_build_object('organization_name','跨店授權隔離測試','business_type','SINGLE_RESTAURANT','store_mode','MULTI'),0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code',a_code,'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
  data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
  data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);
  org:=(data->>'organization_id')::uuid; a:=(data->>'store_id')::uuid;
  data:=public.app_operation(a,'store.create','{"name":"Gras"}',gen_random_uuid()); b:=(data->>'id')::uuid;
  update public.stores set store_code=b_code where id=b;
  zone_id:=public.create_pilot_zone(b,'二店冷藏庫');

  insert into public.organization_members(organization_id,user_id,role,work_role,can_manage_business)
  values(org,target_id,'SUPERVISOR','SUPERVISOR',false),(org,staff_id,'STAFF','STAFF',false),(org,limited_id,'SUPERVISOR','SUPERVISOR',false);
  insert into public.staff_identities(organization_id,user_id,display_name,created_by)
  values(org,target_id,'跨店小明',owner_id),(org,staff_id,'員工小美',owner_id),(org,limited_id,'有限主管',owner_id);
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
  values(a,org,target_id,'scope-xiaoming','SUPERVISOR','SUPERVISOR',owner_id,true),
        (a,org,staff_id,'scope-xiaomei','STAFF','STAFF',owner_id,false),
        (a,org,limited_id,'scope-limited','SUPERVISOR','SUPERVISOR',owner_id,false);
  insert into private.staff_pin_credentials(user_id,pin_hash)
  values(target_id,extensions.crypt('824913',extensions.gen_salt('bf')));
  select to_jsonb(c) into before_credentials from private.staff_pin_credentials c where user_id=target_id;
  select to_jsonb(u) into before_auth from auth.users u where id=target_id;
  assert (select access_mode from public.store_memberships where store_id=a and user_id=target_id)='EDIT','existing membership default changed';

  -- Same company is mandatory, including a target store that the actor cannot administer.
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_id,'role','authenticated')::text,true);
  data:=public.owner_setup();
  data:=public.owner_setup('business',jsonb_build_object('organization_name','外部公司隔離測試','business_type','SINGLE_RESTAURANT','store_mode','SINGLE'),0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','外部門市','store_code','QAFOR'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
  data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
  data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);
  other_org:=(data->>'organization_id')::uuid; foreign_store:=(data->>'store_id')::uuid;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  denied:=false;
  begin perform public.save_baihuayuan_member_store_access(a,target_id,jsonb_build_array(jsonb_build_object('store_id',foreign_store,'access_mode','EDIT')));
  exception when insufficient_privilege or invalid_parameter_value then denied:=true;end;
  assert denied,'cross-company store assignment accepted';
  assert not exists(select 1 from public.store_memberships where user_id=target_id and store_id=foreign_store),'foreign membership persisted';

  -- A patch adds one store, preserving existing access, role, credentials and identity.
  patch:=jsonb_build_array(jsonb_build_object('store_id',b,'access_mode','VIEW'));
  perform public.save_baihuayuan_member_store_access(a,target_id,patch);
  assert (select is_active and access_mode='EDIT' and can_manage_business from public.store_memberships where user_id=target_id and store_id=a),'patch changed omitted home store';
  assert (select is_active and access_mode='VIEW' and role='SUPERVISOR' and work_role='SUPERVISOR' and not can_manage_business and login_identifier='scope-xiaoming'
          from public.store_memberships where user_id=target_id and store_id=b),'new membership lost identity or gained business administration';
  assert (select to_jsonb(c)=before_credentials from private.staff_pin_credentials c where user_id=target_id),'scope update changed PIN';
  assert (select to_jsonb(u)=before_auth from auth.users u where id=target_id),'scope update changed auth identity';
  data:=public.get_baihuayuan_partners(a);
  assert jsonb_array_length(data->'manageable_stores')=2,'partner contract missing manageable stores';
  assert exists(select 1 from jsonb_array_elements(data->'partners') p where p->>'user_id'=target_id::text and (p->>'can_manage_access')::boolean
    and exists(select 1 from jsonb_array_elements(p->'stores') s where s->>'id'=b::text and s->>'access_mode'='VIEW')),'partner contract missing scope permission/access mode';
  select jsonb_agg(to_jsonb(m) order by store_id) into before_members from public.store_memberships m where user_id=target_id;
  perform public.save_baihuayuan_member_store_access(a,target_id,patch);
  assert (select count(*) from public.store_memberships where user_id=target_id)=2,'scope retry duplicated memberships';
  assert (select jsonb_agg(to_jsonb(m)-'updated_at' order by store_id) from public.store_memberships m where user_id=target_id)
       =(select jsonb_agg(x-'updated_at') from jsonb_array_elements(before_members) x),'scope retry changed membership semantics';
  select * into login_result from public.verify_staff_pin(a_code,'scope-xiaoming','824913');
  assert login_result.outcome='OK' and login_result.user_id=target_id,'original PIN login broken';
  select * into login_result from public.verify_staff_pin(b_code,'scope-xiaoming','824913');
  assert login_result.outcome='OK' and login_result.user_id=target_id,'same PIN identity not usable in assigned store';

  -- Store scope is never self-assigned; owner memberships cannot be altered here.
  denied:=false;begin perform public.save_baihuayuan_member_store_access(a,owner_id,patch);exception when insufficient_privilege then denied:=true;end;
  assert denied,'self/owner scope modification accepted';
  update public.organization_members set role='OWNER',work_role='OWNER' where organization_id=org and user_id=staff_id;
  update public.store_memberships set role='OWNER',work_role='OWNER' where store_id=a and user_id=staff_id;
  denied:=false;begin perform public.save_baihuayuan_member_store_access(a,staff_id,patch);exception when insufficient_privilege then denied:=true;end;
  assert denied,'non-founder OWNER role scope modification accepted';
  update public.organization_members set role='STAFF',work_role='STAFF' where organization_id=org and user_id=staff_id;
  update public.store_memberships set role='STAFF',work_role='STAFF' where store_id=a and user_id=staff_id;
  perform public.save_baihuayuan_member_store_access(a,staff_id,patch);
  perform set_config('request.jwt.claim.sub',staff_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);
  denied:=false;begin perform public.save_baihuayuan_member_store_access(a,target_id,patch);exception when insufficient_privilege then denied:=true;end;
  assert denied,'staff can grant another store';
  perform set_config('request.jwt.claim.sub',limited_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',limited_id,'role','authenticated')::text,true);
  denied:=false;begin perform public.save_baihuayuan_member_store_access(a,staff_id,patch);exception when insufficient_privilege then denied:=true;end;
  assert denied,'single-store manager assigned an unmanaged store';
  denied:=false;begin perform public.save_baihuayuan_member_store_access(a,target_id,jsonb_build_array(jsonb_build_object('store_id',a,'access_mode','VIEW')));exception when insufficient_privilege then denied:=true;end;
  assert denied,'manager without business permission edited supervisor scope';
  -- A valid manager may adjust STAFF access inside an already managed store.
  perform public.save_baihuayuan_member_store_access(a,staff_id,jsonb_build_array(jsonb_build_object('store_id',a,'access_mode','VIEW')));
  assert (select access_mode='VIEW' from public.store_memberships where store_id=a and user_id=staff_id),'in-scope staff grant incorrectly denied';

  -- Read-only STAFF does not acquire manager powers through the device exception.
  perform set_config('request.jwt.claim.sub',staff_id::text,true);
  insert into auth.sessions(id,user_id,created_at,updated_at) values(staff_sid,staff_id,now(),now());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated','session_id',staff_sid)::text,true);
  perform public.register_app_device(b,staff_device);
  denied:=false;begin perform public.app_operation(b,'device.authorize',jsonb_build_object('id',staff_device,'device_type','PERSONAL'),gen_random_uuid());exception when insufficient_privilege then denied:=true;end;
  assert denied,'VIEW STAFF self-authorized personal device';

  -- Read-only access is enforced on the server, while the same account keeps edit access in A.
  perform set_config('request.jwt.claim.sub',target_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',target_id,'role','authenticated')::text,true);
  assert private.can_edit_store(a) and not private.can_edit_store(b),'per-store edit boundary incorrect';
  assert jsonb_array_length(public.get_app_context()->'stores')=2,'switcher not supplied both allowed stores';
  denied:=false;begin perform public.save_baihuayuan_company_partner(a,target_id,'自行升權','行政',array[a,b],array['PERSONNEL_MANAGE']);exception when insufficient_privilege then denied:=true;end;
  assert denied,'legacy company saver permits self elevation';
  denied:=false;begin perform public.save_baihuayuan_company_partner(a,staff_id,'越權改店','行政',array[a,b],array['PERSONNEL_MANAGE']);exception when insufficient_privilege then denied:=true;end;
  assert denied,'legacy company saver changed an unmanageable store';
  denied:=false;begin perform public.save_baihuayuan_company_partner(a,staff_id,'越權撤店','財務',array[a],'{}');exception when insufficient_privilege then denied:=true;end;
  assert denied,'legacy company saver revoked an omitted unmanageable store';
  assert (select is_active and access_mode='VIEW' from public.store_memberships where user_id=staff_id and store_id=b),'legacy denied saver changed VIEW membership';
  perform public.app_workspace(b,'activity');
  perform public.get_pilot_inventory_catalog(b);
  denied:=false;begin perform public.create_pilot_zone(b,'不得新增');exception when insufficient_privilege then denied:=true;end;
  assert denied,'VIEW user can write through count RPC';
  denied:=false;begin perform public.app_operation(b,'record.create','{"kind":"incident","title":"不得新增","category":"收貨"}',gen_random_uuid());exception when insufficient_privilege then denied:=true;end;
  assert denied,'VIEW user can write through app dispatcher';
  -- Exercise RLS itself even if the deployment additionally revokes table DML.
  -- These test-only grants are rolled back with all fixture data.
  grant insert,update on public.count_zones to authenticated;
  execute 'set local role authenticated';
  assert exists(select 1 from public.count_zones where id=zone_id),'VIEW RLS cannot read assigned store';
  denied:=false;
  begin
    update public.count_zones set name='不得修改' where id=zone_id;
    get diagnostics affected=row_count;
    denied:=affected=0;
  exception when insufficient_privilege then denied:=true;end;
  assert denied,'VIEW direct RLS update succeeded';
  denied:=false;begin insert into public.count_zones(organization_id,store_id,name) values(org,b,'不得新增');exception when insufficient_privilege then denied:=true;end;
  assert denied,'VIEW direct RLS insert succeeded';
  execute 'reset role';
  grant insert on public.audit_logs to authenticated;
  execute 'set local role authenticated';
  denied:=false;begin insert into public.audit_logs(organization_id,store_id,user_id,entity_type,entity_id,action)
    values(org,b,target_id,'scope-test',gen_random_uuid()::text,'FORGED_VIEW_AUDIT');exception when insufficient_privilege then denied:=true;end;
  assert denied,'EDIT in A allowed forged audit in VIEW store B';
  execute 'reset role';
  update public.store_memberships set access_mode='VIEW' where user_id=target_id and store_id=a;
  execute 'set local role authenticated';
  denied:=false;begin insert into public.audit_logs(organization_id,store_id,user_id,entity_type,entity_id,action)
    values(org,null,target_id,'scope-test',gen_random_uuid()::text,'FORGED_ORG_AUDIT');exception when insufficient_privilege then denied:=true;end;
  assert denied,'all-VIEW user forged organization-level audit';
  execute 'reset role';
  update public.store_memberships set access_mode='EDIT' where user_id=target_id and store_id=a;
  perform public.create_pilot_zone(a,'一店仍可新增');

  -- Device registration and shared-device choice are login/session operations, not store content edits.
  insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,target_id,now(),now());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',target_id,'role','authenticated','session_id',sid)::text,true);
  perform public.register_app_device(b,device_id);
  perform public.app_operation(b,'device.authorize',jsonb_build_object('id',device_id,'device_type','PERSONAL'),gen_random_uuid());
  assert (select authorized_by=target_id and device_type='PERSONAL' from private.app_devices where store_id=b and id=device_id),'VIEW supervisor cannot authorize own current device';
  denied:=false;begin perform public.app_operation(b,'device.authorize',jsonb_build_object('id',staff_device,'device_type','PERSONAL'),gen_random_uuid());exception when insufficient_privilege then denied:=true;end;
  assert denied,'VIEW supervisor authorized another session device';
  data:=public.choose_app_devices(array[a,b],device_id,false);
  assert data->>'device_type'='SHARED','VIEW device selection broken';
  assert private.app_session_valid(a) and private.app_session_valid(b),'switching stores invalidated login session';

  -- A newly granted store never inherits a different store's personal-device trust.
  insert into auth.sessions(id,user_id,created_at,updated_at) values(old_sid,target_id,now()-interval '8 days',now()-interval '8 days');
  insert into private.app_devices(id,store_id,label,device_type,authorized_by,authorized_at)
  values(old_device,a,'Existing personal device','PERSONAL',owner_id,now()-interval '8 days');
  insert into private.app_device_sessions(session_id,store_id,device_id,device_choice)
  values(old_sid,a,old_device,'PERSONAL');
  insert into private.app_session_access(session_id,store_id,user_id,last_active_at)
  values(old_sid,a,target_id,now()-interval '8 days');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',target_id,'role','authenticated','session_id',old_sid)::text,true);
  assert private.app_session_valid(a) and not private.app_session_valid(b),'fixture must have trusted A and expired unbound B';
  select jsonb_agg(to_jsonb(x) order by store_id) into before_activity from private.app_session_access x where session_id=old_sid;
  select jsonb_agg(to_jsonb(x) order by store_id) into before_bindings from private.app_device_sessions x where session_id=old_sid;
  data:=public.get_app_context();
  assert jsonb_array_length(data->'stores')=1 and data->'stores'->0->>'id'=a::text,'expired newly granted B blocked valid A context';
  assert jsonb_array_length(data->'reauth_stores')=1 and data->'reauth_stores'->0->>'id'=b::text,'expired B missing from reauthentication list';
  assert not exists(select 1 from jsonb_array_elements(coalesce(data->'stores','[]')||coalesce(data->'reauth_stores','[]')) x where x->>'id'=foreign_store::text),'context leaked unauthorized foreign store';
  denied:=false;begin perform public.app_workspace(b,'activity');exception when insufficient_privilege then denied:=true;end;
  assert denied,'context discovery bypassed B session expiration';
  assert (select jsonb_agg(to_jsonb(x) order by store_id) from private.app_session_access x where session_id=old_sid)=before_activity,'context read refreshed session activity';
  assert (select jsonb_agg(to_jsonb(x) order by store_id) from private.app_device_sessions x where session_id=old_sid)=before_bindings,'context read silently created store device trust';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',target_id,'role','authenticated','session_id',sid)::text,true);

  -- Authorization is rechecked using current membership, with the same unrefreshed session.
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  perform public.save_baihuayuan_company_partner(a,staff_id,'已授權財務','財務',array[a,b],array['REPORTS_VIEW']);
  assert (select is_active and access_mode='VIEW' from public.store_memberships where user_id=staff_id and store_id=b),'authorized legacy profile update overwrote VIEW mode';
  perform public.save_baihuayuan_member_store_access(a,target_id,jsonb_build_array(jsonb_build_object('store_id',b,'access_mode','NONE')));
  assert (select not is_active from public.store_memberships where user_id=target_id and store_id=b),'NONE did not revoke membership';
  perform set_config('request.jwt.claim.sub',target_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',target_id,'role','authenticated','session_id',sid)::text,true);
  assert jsonb_array_length(public.get_app_context()->'stores')=1,'revoked store still in switcher';
  denied:=false;begin perform public.app_workspace(b,'activity');exception when insufficient_privilege then denied:=true;end;
  assert denied,'revoked store still readable without login refresh';
  assert private.can_edit_store(a),'revoking B changed A permissions';
  execute 'set local role authenticated';
  assert not exists(select 1 from public.count_zones where id=zone_id),'revoked direct RLS read still available';
  execute 'reset role';
  assert not has_function_privilege('anon','public.save_baihuayuan_member_store_access(uuid,uuid,jsonb)','execute'),'anonymous scope mutation granted';
end $test$;
rollback;
select 'PASS: preserved login/PIN; idempotent cross-store grants; company/manager/owner/self boundaries; VIEW RPC+RLS protection; device continuity; immediate revocation' result;
