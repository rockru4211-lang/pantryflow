-- New stores must not restore a former owner's revoked management scope.
CREATE OR REPLACE FUNCTION private.app_management(p_store uuid, p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text:=private.app_role(p_store); v_org uuid; v_type text; v_id uuid; v_target uuid; v_old jsonb; v_result jsonb;
 v_product public.products; v_supplier public.suppliers; v_member public.store_memberships; v_settings private.app_settings;
begin
 if p_action='store.create' then
  if not private.can_manage_business(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 160 then raise exception 'INVALID_STORE' using errcode='22023';end if;
  select s.organization_id,o.business_type::text into v_org,v_type from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':store-create',105));
  insert into public.stores(organization_id,name,store_code,created_by) values(v_org,btrim(p_data->>'name'),'S'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),auth.uid()) returning id,to_jsonb(public.stores.*) into v_id,v_result;
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business,display_name)
  select v_id,v_org,sm.user_id,sm.login_identifier,sm.work_role,sm.work_role,auth.uid(),true,sm.display_name from public.store_memberships sm where sm.store_id=p_store and sm.user_id=auth.uid();
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
  select v_id,v_org,om.user_id,'owner-'||om.user_id::text,'OWNER','OWNER',auth.uid(),true from public.organization_members om
  where om.organization_id=v_org and om.is_active and exists(select 1 from public.store_memberships sm where sm.organization_id=v_org and sm.user_id=om.user_id and sm.is_active and sm.can_manage_business and coalesce(sm.work_role,sm.role)='OWNER') on conflict(store_id,user_id) do nothing;
  insert into private.app_settings(store_id,updated_by,settings) values(v_id,auth.uid(),jsonb_build_object('blind_count',true,'count_cadence',case when v_type='CHAIN_RESTAURANT' then 'DAILY' else 'MONTHLY' end,'paper_required',v_type='CHAIN_RESTAURANT','remember_device',true,'reauth_days',7));
  update public.organizations set store_mode='MULTI',updated_at=now() where id=v_org;
  return jsonb_build_object('id',v_id,'store',v_result,'value',v_result);
 end if;
 if p_action='business.transfer' then return private.transfer_business_admin(p_store,p_data);end if;
 if p_action='invite.cancel' then
  if not private.can_manage_business(p_store) then raise exception 'BUSINESS_ADMIN_REQUIRED' using errcode='42501';end if;
  update private.management_invites set status='CANCELLED' where id=(p_data->>'id')::uuid and store_id=p_store and status='PENDING';
  return jsonb_build_object('id',p_data->>'id','status','CANCELLED');
 end if;
 if p_action in ('device.authorize','device.revoke') then return private.app_device_management(p_store,p_action,p_data);end if;
 if v_role is null or (v_role='STAFF' and not private.can_manage_business(p_store)) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
 select s.organization_id,o.business_type::text into v_org,v_type from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store;
 if p_action='mapping.resolve' then return private.app_resolve_receipt_mapping(p_store,p_data);end if;
 if p_action in ('member.save','member.assign','member.offboard') then return private.app_member_operation(p_store,p_action,p_data);
 elsif p_action in ('product.save','supplier.save') then
  if v_role not in ('LOGISTICS','OWNER') or v_type='CHAIN_RESTAURANT' then raise exception 'CATALOG_ROLE_REQUIRED' using errcode='42501'; end if;
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 160 then raise exception 'INVALID_NAME' using errcode='22023'; end if;
  v_id:=nullif(p_data->>'id','')::uuid;
  if p_action='product.save' then
   if length(btrim(coalesce(p_data->>'unit',''))) not between 1 and 30 then raise exception 'INVALID_UNIT' using errcode='22023'; end if;
   v_target:=nullif(p_data->>'supplier_id','')::uuid;
   if v_target is not null and not exists(select 1 from public.suppliers where id=v_target and organization_id=v_org) then raise exception 'INVALID_SUPPLIER' using errcode='22023'; end if;
   if v_id is null then
    insert into public.products(organization_id,product_code,name,category,base_unit,count_unit,current_supplier_id,specification)
    values(v_org,coalesce(nullif(btrim(p_data->>'code'),''),'P-'||gen_random_uuid()::text),btrim(p_data->>'name'),nullif(p_data->>'category',''),btrim(p_data->>'unit'),btrim(p_data->>'unit'),v_target,nullif(p_data->>'specification','')) returning * into v_product;
    v_id:=v_product.id;
   else
    select * into v_product from public.products where id=v_id and organization_id=v_org for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002'; end if;
    v_old:=to_jsonb(v_product);
    if (p_data->>'updated_at')::timestamptz is distinct from v_product.updated_at then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
    update public.products set name=btrim(p_data->>'name'),product_code=coalesce(nullif(btrim(p_data->>'code'),''),product_code),category=nullif(p_data->>'category',''),base_unit=btrim(p_data->>'unit'),count_unit=btrim(p_data->>'unit'),specification=nullif(p_data->>'specification',''),current_supplier_id=v_target,is_active=coalesce((p_data->>'is_active')::boolean,true),updated_at=now() where id=v_id returning * into v_product;
   end if;
   insert into private.product_details(product_id,aliases,safety_quantity,note,updated_by) values(v_id,coalesce((select array_agg(btrim(value)) from jsonb_array_elements_text(p_data->'aliases') where btrim(value)<>''),'{}'),nullif(p_data->>'safety_quantity','')::numeric,coalesce(p_data->>'note',''),auth.uid())
   on conflict(product_id) do update set aliases=excluded.aliases,safety_quantity=excluded.safety_quantity,note=excluded.note,updated_by=excluded.updated_by,updated_at=now();
   if (v_old->>'current_supplier_id')::uuid is distinct from v_target then
 update public.product_supplier_history set is_current=false,effective_to=current_date,valid_to=now() where product_id=v_id and is_current;
 if v_target is not null then insert into public.product_supplier_history(organization_id,product_id,supplier_id,effective_from,is_current,valid_from,created_by) values(v_org,v_id,v_target,current_date,true,now(),auth.uid());end if;
end if;
v_result:=to_jsonb(v_product);
  else
   if v_id is null then
    insert into public.suppliers(organization_id,supplier_code,name) values(v_org,coalesce(nullif(btrim(p_data->>'code'),''),'S-'||gen_random_uuid()::text),btrim(p_data->>'name')) returning * into v_supplier;
    v_id:=v_supplier.id;
   else
    select * into v_supplier from public.suppliers where id=v_id and organization_id=v_org for update;
    if not found then raise exception 'SUPPLIER_NOT_FOUND' using errcode='P0002'; end if;
    v_old:=to_jsonb(v_supplier);
    if (p_data->>'updated_at')::timestamptz is distinct from v_supplier.updated_at then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
    update public.suppliers set name=btrim(p_data->>'name'),supplier_code=coalesce(nullif(btrim(p_data->>'code'),''),supplier_code),is_active=coalesce((p_data->>'is_active')::boolean,true),updated_at=now() where id=v_id returning * into v_supplier;
   end if;
   insert into private.supplier_details(supplier_id,contact_name,phone,delivery_note,updated_by) values(v_id,coalesce(p_data->>'contact_name',''),coalesce(p_data->>'phone',''),coalesce(p_data->>'delivery_note',''),auth.uid())
   on conflict(supplier_id) do update set contact_name=excluded.contact_name,phone=excluded.phone,delivery_note=excluded.delivery_note,updated_by=excluded.updated_by,updated_at=now();
   v_result:=to_jsonb(v_supplier);
  end if;
 elsif p_action='settings.save' then
  if not private.can_manage_business(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  if jsonb_typeof(p_data->'settings')<>'object' or exists(select 1 from jsonb_object_keys(p_data->'settings') k where k not in ('remember_device','reauth_days','device_type','erp_receiving','erp_waste','erp_time','paper_required','count_cadence','blind_count')) then raise exception 'INVALID_SETTINGS' using errcode='22023'; end if;
  if (p_data->'settings' ? 'reauth_days') and (p_data->'settings'->>'reauth_days') not in ('0','1','7','30') then raise exception 'INVALID_SETTINGS' using errcode='22023'; end if;
  if (p_data->'settings' ? 'device_type') and (p_data->'settings'->>'device_type') not in ('PERSONAL','SHARED') then raise exception 'INVALID_SETTINGS' using errcode='22023'; end if;
  if (p_data->'settings' ? 'erp_time') and (p_data->'settings'->>'erp_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'INVALID_SETTINGS' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(p_data->'settings') e where e.key in ('remember_device','erp_receiving','erp_waste','paper_required','blind_count') and jsonb_typeof(e.value)<>'boolean') then raise exception 'INVALID_SETTINGS' using errcode='22023'; end if;
  if (p_data->'settings' ? 'count_cadence') and p_data->'settings'->>'count_cadence' not in ('DAILY','MONTHLY','MANUAL') then raise exception 'INVALID_SETTINGS' using errcode='22023';end if;
if p_data->'settings'->>'blind_count'='false' or (v_type<>'CHAIN_RESTAURANT' and p_data->'settings'->>'paper_required'='true') then raise exception 'INVALID_SETTINGS' using errcode='22023';end if;
select * into v_settings from private.app_settings where store_id=p_store for update;
  if coalesce(v_settings.revision,0) is distinct from (p_data->>'revision')::int then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  v_old:=to_jsonb(v_settings);
  insert into private.app_settings(store_id,settings,updated_by) values(p_store,p_data->'settings',auth.uid()) on conflict(store_id) do update set settings=private.app_settings.settings||excluded.settings,updated_by=excluded.updated_by,updated_at=now(),revision=private.app_settings.revision+1 returning * into v_settings;
  if v_settings.settings ? 'erp_time' then update public.stores set waste_erp_reminder_time=(v_settings.settings->>'erp_time')::time where id=p_store; end if;
  v_result:=to_jsonb(v_settings);
 elsif p_action='business.save' then
  if v_role<>'OWNER' and not exists(select 1 from public.organizations where id=v_org and owner_user_id=auth.uid()) then raise exception 'BUSINESS_RESPONSIBLE_REQUIRED' using errcode='42501';end if;
  if not private.can_manage_business(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 160 or p_data->>'business_type' not in ('SINGLE_RESTAURANT','CHAIN_RESTAURANT') or p_data->>'store_mode' not in ('SINGLE','MULTI') or jsonb_typeof(p_data->'has_erp')<>'boolean' then raise exception 'INVALID_BUSINESS' using errcode='22023'; end if;
  select to_jsonb(o) into v_old from public.organizations o where o.id=v_org for update;
  if (p_data->>'updated_at')::timestamptz is distinct from (v_old->>'updated_at')::timestamptz then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  update public.organizations o set name=btrim(p_data->>'name'),business_type=(jsonb_populate_record(null::public.organizations,p_data)).business_type,store_mode=p_data->>'store_mode',has_erp=(p_data->>'has_erp')::boolean,updated_at=now() where o.id=v_org returning to_jsonb(o) into v_result;
 elsif p_action='store.save' then
  if not private.can_manage_business(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  v_id:=(p_data->>'id')::uuid;
  if v_id<>p_store or length(btrim(coalesce(p_data->>'name',''))) not between 1 and 160 or p_data->>'staff_login_mode' not in ('NAME_OR_NICKNAME','EMPLOYEE_NUMBER') then raise exception 'INVALID_STORE' using errcode='22023'; end if;
  if not coalesce((p_data->>'is_active')::boolean,true) then
   if not private.can_manage_business(p_store) or (select count(*) from public.stores where organization_id=v_org and is_active)<=1 then raise exception 'ACTIVE_STORE_REQUIRED' using errcode='22023'; end if;
  end if;
  select to_jsonb(s) into v_old from public.stores s where id=v_id for update;
  if (p_data->>'updated_at')::timestamptz is distinct from (v_old->>'updated_at')::timestamptz then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  update public.stores s set name=btrim(p_data->>'name'),staff_login_mode=p_data->>'staff_login_mode',is_active=coalesce((p_data->>'is_active')::boolean,true),updated_at=now() where id=v_id returning to_jsonb(s) into v_result;
 elsif p_action in ('member.save','member.assign','delegation.create','delegation.revoke') then
  if not private.can_manage_business(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  v_target:=(p_data->>'user_id')::uuid;
  if v_target=auth.uid() or exists(select 1 from public.organization_members om join public.organizations o on o.id=om.organization_id where om.organization_id=v_org and om.user_id=v_target and (om.is_owner or o.owner_user_id=v_target)) then raise exception 'CANNOT_CHANGE_OWNER_OR_SELF' using errcode='42501'; end if;
  select * into v_member from public.store_memberships where store_id=p_store and user_id=v_target for update;
  if p_action<>'member.assign' and not found then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002'; end if;
  if not private.can_manage_business(p_store) and (v_member.role<>'STAFF' or p_action<>'member.save' or p_data->>'role'<>'STAFF') then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  if p_action in ('member.save','member.assign') then
   if p_data->>'role' not in ('STAFF','SUPERVISOR','LOGISTICS','OWNER') or length(btrim(coalesce(p_data->>'login_identifier',''))) not between 1 and 64 then raise exception 'INVALID_MEMBER' using errcode='22023'; end if;
   if not exists(select 1 from public.organization_members where organization_id=v_org and user_id=v_target and is_active) then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002'; end if;
   v_old:=to_jsonb(v_member);
   insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,is_active,assigned_by)
   values(p_store,v_org,v_target,btrim(p_data->>'login_identifier'),(p_data->>'role')::public.app_role,coalesce((p_data->>'is_active')::boolean,true),auth.uid())
   on conflict(store_id,user_id) do update set login_identifier=excluded.login_identifier,role=excluded.role,is_active=excluded.is_active,assigned_by=excluded.assigned_by,updated_at=now() returning * into v_member;
   if length(btrim(coalesce(p_data->>'display_name','')))>0 then
    update public.staff_identities set display_name=btrim(p_data->>'display_name'),updated_at=now() where user_id=v_target and organization_id=v_org;
    update public.profiles set display_name=btrim(p_data->>'display_name') where id=v_target;
   end if;
   v_result:=to_jsonb(v_member);
  elsif p_action='delegation.create' then
   if not private.can_manage_business(p_store) or v_member.role<>'STAFF' or not v_member.is_active then raise exception 'INVALID_DELEGATE' using errcode='42501'; end if;
   insert into private.app_delegations(store_id,user_id,starts_at,ends_at,granted_by) values(p_store,v_target,(p_data->>'starts_at')::timestamptz,(p_data->>'ends_at')::timestamptz,auth.uid()) returning to_jsonb(private.app_delegations.*) into v_result;
  else
   if not private.can_manage_business(p_store) then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
   update private.app_delegations d set revoked_at=now() where id=(p_data->>'id')::uuid and store_id=p_store and user_id=v_target returning to_jsonb(d) into v_result;
   if v_result is null then raise exception 'DELEGATION_NOT_FOUND' using errcode='P0002'; end if;
  end if;
 else raise exception 'INVALID_APP_ACTION' using errcode='22023';
 end if;
 return jsonb_build_object('id',coalesce(v_id,p_store),'value',v_result,'previous',v_old);
end $function$;
create or replace function private.complete_owner_store_scope() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.is_active and new.can_manage_business and coalesce(new.work_role,new.role)='OWNER' then
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business,display_name)
  select s.id,new.organization_id,new.user_id,new.login_identifier,'OWNER','OWNER',new.assigned_by,true,new.display_name from public.stores s
  where s.organization_id=new.organization_id and s.is_active and s.id<>new.store_id
  and not exists(select 1 from public.store_memberships sm where sm.store_id=s.id and sm.user_id=new.user_id)
  on conflict(store_id,user_id) do nothing;
 end if;
 return new;
end $$;
