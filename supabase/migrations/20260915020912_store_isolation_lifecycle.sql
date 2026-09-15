-- No receipt/count ownership is reassigned. Store scope is always a UUID.
create or replace function private.store_scope_role(s uuid) returns text language sql stable security definer set search_path='' as $$
 select case when coalesce(sm.work_role,sm.role)='ADMIN' then 'SUPERVISOR' else coalesce(sm.work_role,sm.role)::text end
 from public.store_memberships sm join public.stores st on st.id=sm.store_id and st.organization_id=sm.organization_id
 join public.organization_members om on om.organization_id=sm.organization_id and om.user_id=sm.user_id
 join public.staff_identities si on si.organization_id=sm.organization_id and si.user_id=sm.user_id
 where sm.store_id=s and sm.user_id=auth.uid() and sm.is_active and om.is_active and si.is_active and private.app_session_valid(s)
$$;
create or replace function private.can_manage_store_scope(s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(exists(select 1 from public.stores st join public.organizations o on o.id=st.organization_id
 join public.organization_members om on om.organization_id=o.id and om.user_id=auth.uid() and om.is_active
 join public.staff_identities si on si.organization_id=o.id and si.user_id=auth.uid() and si.is_active
 left join public.store_memberships sm on sm.store_id=st.id and sm.user_id=auth.uid()
 where st.id=s and private.app_session_valid(s) and
 ((sm.is_active and sm.can_manage_business and coalesce(sm.work_role,sm.role)::text<>'STAFF' and not(o.business_type::text='CHAIN_RESTAURANT' and coalesce(sm.work_role,sm.role)::text in ('SUPERVISOR','ADMIN')))
 or (sm.user_id is null and om.can_manage_business and (om.is_owner or o.owner_user_id=auth.uid())))),false)
$$;
create or replace function private.store_references(s uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r record;n bigint;result jsonb:='[]';begin
 for r in select distinct ns.nspname,cl.relname,a.attname from pg_constraint fk join pg_class cl on cl.oid=fk.conrelid join pg_namespace ns on ns.oid=cl.relnamespace
 cross join lateral generate_subscripts(fk.conkey,1) idx join pg_attribute a on a.attrelid=cl.oid and a.attnum=fk.conkey[idx]
 join pg_attribute parent on parent.attrelid=fk.confrelid and parent.attnum=fk.confkey[idx]
 where fk.contype='f' and fk.confrelid='public.stores'::regclass and parent.attname='id' and cl.relname<>'app_settings' loop
 execute format('select count(*) from %I.%I where %I=$1',r.nspname,r.relname,r.attname) into n using s;
 if n>0 then result:=result||jsonb_build_array(jsonb_build_object('source',r.relname,'count',n));end if;
 end loop;
 select count(*) into n from public.audit_logs where store_id=s or (entity_type='store' and entity_id=s::text);
 if n>0 then result:=result||jsonb_build_array(jsonb_build_object('source','audit_logs','count',n));end if;
 return result;
end $$;
create table private.store_lifecycle_requests(request_id uuid primary key,actor_id uuid not null,target_id uuid not null,action text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now());
alter table private.store_lifecycle_requests enable row level security;
revoke all on private.store_lifecycle_requests from public,anon,authenticated;
create or replace function private.managed_store_cards() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('can_delete',private.store_references(s.id)='[]'::jsonb) order by s.is_active desc,s.created_at,s.id),'[]') from public.stores s where private.can_manage_store_scope(s.id)
$$;
create or replace function private.store_lifecycle(anchor uuid,action text,d jsonb,request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=(d->>'id')::uuid;s public.stores;cached private.store_lifecycle_requests;refs jsonb;result jsonb;old jsonb;begin
 if request is null or target is null or auth.uid() is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,107));
 select * into cached from private.store_lifecycle_requests where request_id=request;
 select * into s from public.stores where id=target for update;
 if not found then
  if action='store.delete' and cached.actor_id=auth.uid() and cached.target_id=target and cached.action=action and cached.payload=d and private.can_manage_store_scope(anchor) then return cached.result;end if;
  raise exception 'STORE_NOT_FOUND' using errcode='P0002';
 end if;
 if not private.can_manage_store_scope(target) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if cached.request_id is not null then
  if cached.actor_id<>auth.uid() or cached.target_id<>target or cached.action<>action or cached.payload<>d then raise exception 'REQUEST_CONFLICT' using errcode='40001';end if;return cached.result;
 end if;
 if d->>'store_code' is distinct from s.store_code or d->>'name' is distinct from s.name or (d->>'updated_at')::timestamptz is distinct from s.updated_at then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 old:=to_jsonb(s);refs:=private.store_references(target);
 if action='store.delete' then
  if refs<>'[]'::jsonb then raise exception 'STORE_REFERENCED_USE_DEACTIVATE' using errcode='23503';end if;
  delete from private.app_settings where store_id=target;delete from public.stores where id=target;
 elsif action in ('store.deactivate','store.restore') then
  update public.stores set is_active=(action='store.restore'),updated_at=now() where id=target;
 else raise exception 'INVALID_STORE_ACTION' using errcode='22023';end if;
 result:=jsonb_build_object('id',target,'action',action,'is_active',action='store.restore');
 insert into private.store_lifecycle_requests values(request,auth.uid(),target,action,d,result,now());
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id) values(s.organization_id,'store',target::text,action,old,result,auth.uid());
 return result;
end $$;
-- Basic catalog edits have a narrow permission and do not write counts, stock or sort order.
create or replace function private.edit_count_product(s uuid,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.products;result jsonb;begin
 if not private.can_import_inventory(s) then raise exception 'PRODUCT_EDIT_REQUIRED' using errcode='42501';end if;
 if length(btrim(coalesce(d->>'name',''))) not between 1 and 160 or length(btrim(coalesce(d->>'unit',''))) not between 1 and 30 then raise exception 'INVALID_PRODUCT_BASIC' using errcode='22023';end if;
 select pr.* into p from public.products pr join public.stores st on st.organization_id=pr.organization_id where st.id=s and pr.id=(d->>'id')::uuid and exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=s and zp.product_id=pr.id) for update of pr;
 if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002';end if;
 if (d->>'updated_at')::timestamptz is distinct from p.updated_at then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 update public.products set name=btrim(d->>'name'),count_unit=btrim(d->>'unit'),specification=nullif(btrim(d->>'specification'),''),updated_at=now() where id=p.id returning to_jsonb(products.*) into result;
 update public.zone_products zp set count_unit=btrim(d->>'unit') from public.count_zones z where z.id=zp.zone_id and z.store_id=s and zp.product_id=p.id;
 return result;
end $$;
-- Archived operations use a separate, explicit path; normal app_role remains active-store only.
create or replace function private.store_archive(s uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare role text:=private.store_scope_role(s);org public.organizations;begin
 if role is null and not private.can_manage_store_scope(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select o.* into org from public.organizations o join public.stores st on st.organization_id=o.id where st.id=s;
 return jsonb_build_object('role',coalesce(role,'OWNER'),'store',(select to_jsonb(st) from public.stores st where st.id=s),'can_settle',role in ('STAFF','SUPERVISOR'),'counts',
 (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'started_at',c.started_at,'completed_at',c.completed_at,'lines',(select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(item->>'product_name',item->>'name','未提供'),'quantity',e.quantity,'unit',e.unit,'zone',item->>'zone_name')),'[]') from public.count_entries e left join lateral(select item from jsonb_array_elements(coalesce(c.snapshot->'zones','[]')) item where item->>'product_id'=e.product_id::text and item->>'zone_id'=e.zone_id::text limit 1) snap on true where e.session_id=c.id)) order by c.started_at desc),'[]') from public.inventory_count_sessions c where c.store_id=s),
 'receipts',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.batch_number,'status',b.status,'created_at',b.uploaded_at,'lines',(select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(l.human_correction#>>'{effective_fields,product}',l.ai_original->>'raw_product_name','未對應'),'quantity',l.quantity,'unit',l.unit) order by l.created_at,l.source_row_key),'[]') from public.goods_receipts g join public.receipt_lines l on l.receipt_id=g.id where g.source_batch_id=b.id and g.store_id=s),'fields',(select coalesce(jsonb_agg(jsonb_build_object('row_key',f.row_key,'field_name',f.field_name,'value',coalesce((select c.new_value from public.receipt_review_corrections c where c.ocr_field_id=f.id order by c.modified_at desc limit 1),f.normalized_value)) order by f.row_key,f.field_name),'[]') from public.receipt_ocr_fields f where f.batch_id=b.id)) order by b.uploaded_at desc),'[]') from public.receipt_upload_batches b where b.store_id=s and (role<>'STAFF' or b.uploaded_by=auth.uid())),
 'expiry',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'expires_on',e.expires_on,'zone',e.zone_name,'resolved',exists(select 1 from private.expiry_resolutions er where er.expiry_id=e.id)) order by e.expires_on),'[]') from private.expiry_current e where e.store_id=s),
 'waste',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'quantity',w.quantity,'unit',w.unit,'reason',w.reason,'created_at',w.created_at,'actor_name',w.actor_name) order by w.created_at desc),'[]') from private.waste_records w where w.store_id=s),
 'movements',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('from_name',fs.name,'to_name',ts.name,'actor_name',p.display_name,'events',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',ep.display_name) order by e.created_at),'[]') from private.store_movement_events e left join public.profiles ep on ep.id=e.actor_id where e.movement_id=m.id)) order by m.created_at desc),'[]') from private.store_movements m join public.stores fs on fs.id=m.from_store_id join public.stores ts on ts.id=m.to_store_id left join public.profiles p on p.id=m.created_by where s in (m.from_store_id,m.to_store_id)));
end $$;
-- Revoke only trigger-generated extra memberships proven by the original provision audit.
-- Explicit later grants/edits are retained; no names or hard-coded user/store IDs are used.
with origins as (
 select distinct on (a.entity_id) a.entity_id::uuid user_id,(a.new_value->>'store_id')::uuid store_id,a.organization_id
 from public.audit_logs a where a.action='STAFF_PROVISIONED' and a.new_value->>'role'='OWNER' order by a.entity_id,a.created_at
), excess as (
 select sm.* from origins x join public.store_memberships source on source.user_id=x.user_id and source.store_id=x.store_id
 join public.store_memberships sm on sm.user_id=x.user_id and sm.organization_id=x.organization_id and sm.store_id<>x.store_id
 join public.organization_members om on om.user_id=x.user_id and om.organization_id=x.organization_id
 where not om.is_owner and not om.can_manage_business and sm.is_active and sm.created_at=source.created_at and sm.updated_at=sm.created_at and sm.login_identifier=source.login_identifier
 and not exists(select 1 from public.audit_logs a where a.entity_id=sm.user_id::text and a.created_at>sm.created_at and a.new_value->>'store_id'=sm.store_id::text and a.action<>'STAFF_PROVISIONED')
), logged as (
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id,store_id)
 select organization_id,'store_membership',user_id::text,'REPAIR_AUTOMATIC_OWNER_SCOPE',to_jsonb(excess),jsonb_build_object('is_active',false,'reason','No explicit store grant; original provisioning is scoped to another store'),null,store_id from excess returning entity_id,store_id
)
update public.store_memberships sm set is_active=false,can_manage_business=false,updated_at=now() from logged l where sm.user_id::text=l.entity_id and sm.store_id=l.store_id;

CREATE OR REPLACE FUNCTION private.complete_owner_store_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.is_active and new.can_manage_business and exists(select 1 from public.organization_members om join public.organizations o on o.id=om.organization_id where om.user_id=new.user_id and om.organization_id=new.organization_id and om.is_active and om.can_manage_business and (om.is_owner or o.owner_user_id=new.user_id)) then
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business,display_name)
  select s.id,new.organization_id,new.user_id,new.login_identifier,'OWNER','OWNER',new.assigned_by,true,new.display_name from public.stores s
  where s.organization_id=new.organization_id and s.is_active and s.id<>new.store_id
  and not exists(select 1 from public.store_memberships sm where sm.store_id=s.id and sm.user_id=new.user_id)
  on conflict(store_id,user_id) do nothing;
 end if;
 return new;
end $function$;

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
  where om.organization_id=v_org and om.is_active and om.can_manage_business and (om.is_owner or exists(select 1 from public.organizations o where o.id=v_org and o.owner_user_id=om.user_id)) and exists(select 1 from public.store_memberships sm where sm.organization_id=v_org and sm.user_id=om.user_id and sm.is_active and sm.can_manage_business and coalesce(sm.work_role,sm.role)='OWNER') on conflict(store_id,user_id) do nothing;
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
  if p_data ? 'is_active' and (p_data->>'is_active')::boolean is distinct from (select is_active from public.stores where id=p_store) then raise exception 'USE_STORE_LIFECYCLE' using errcode='22023';end if;
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

CREATE OR REPLACE FUNCTION private.app_operation(p_store uuid, p_action text, p_data jsonb, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text:=private.app_role(p_store); v_org uuid; v_type text; v_mode text; v_old jsonb; v_result jsonb;
 v_cached private.app_requests; v_record private.app_records; v_move private.store_movements;
 v_id uuid; v_other uuid; v_target uuid; v_qty numeric; v_name text; v_unit text; v_kind text;
begin
 if p_action in ('store.delete','store.deactivate','store.restore') then return private.store_lifecycle(p_store,p_action,p_data,p_request);end if;
 if v_role is null and p_action in ('movement.return','movement.exchange') then v_role:=private.store_scope_role(p_store);end if;
 if p_action='product.edit-basic' and not private.can_import_inventory(p_store) then raise exception 'PRODUCT_EDIT_REQUIRED' using errcode='42501';end if;
 if v_role is null or p_request is null then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>64000 then raise exception 'INVALID_APP_INPUT' using errcode='22023'; end if;
 if p_action in ('store.create','store.save','settings.save','business.save','business.transfer','delegation.create','delegation.revoke','invite.cancel') and not private.can_manage_business(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_action in ('member.save','member.assign','member.offboard') and not private.can_manage_members(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_request::text,0));
 select * into v_cached from private.app_requests where store_id=p_store and request_id=p_request;
 if found then
  if v_cached.actor_id<>auth.uid() or v_cached.action<>p_action or v_cached.payload<>p_data then raise exception 'REQUEST_CONFLICT' using errcode='23505'; end if;
  return v_cached.result;
 end if;
 select s.organization_id,o.business_type::text,o.store_mode into v_org,v_type,v_mode from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store;
 if p_action like 'stock.%' then v_result:=private.stock_operation(p_store,p_action,p_data);
 elsif p_action='product.edit-basic' then v_result:=private.edit_count_product(p_store,p_data);
 elsif p_action='product.lifecycle' then v_result:=private.product_lifecycle(p_store,p_data);
 elsif p_action='record.create' then
  v_kind:=p_data->>'kind'; if v_kind='bulletin' and p_data ? 'audience' and (jsonb_typeof(p_data->'audience')<>'array' or jsonb_array_length(p_data->'audience')=0 or exists(select 1 from jsonb_array_elements_text(p_data->'audience') a where a not in ('STAFF','SUPERVISOR','LOGISTICS','OWNER'))) then raise exception 'INVALID_AUDIENCE' using errcode='22023';end if;
  if v_kind not in ('incident','handover','bulletin','company_task') or (v_kind in ('bulletin','company_task') and v_role='STAFF') then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  v_target:=nullif(p_data->>'responsible_id','')::uuid;
  if v_target is not null and not exists(select 1 from public.store_memberships sm join public.organization_members om on om.organization_id=sm.organization_id and om.user_id=sm.user_id where sm.store_id=p_store and sm.user_id=v_target and sm.is_active and om.is_active) then raise exception 'INVALID_RESPONSIBLE' using errcode='22023'; end if;
  if v_kind='company_task' and not exists(select 1 from public.organizations where id=v_org and has_erp) then raise exception 'ERP_NOT_ENABLED' using errcode='22023'; end if;
  insert into private.app_records(store_id,kind,title,body,category,responsible_id,due_at,expires_at,audience,created_by)
  values(p_store,v_kind,btrim(p_data->>'title'),coalesce(p_data->>'body',''),nullif(p_data->>'category',''),v_target,nullif(p_data->>'due_at','')::timestamptz,nullif(p_data->>'expires_at','')::timestamptz,
   coalesce((select array_agg(value) from jsonb_array_elements_text(p_data->'audience') where value in ('STAFF','SUPERVISOR','LOGISTICS','OWNER')),array['STAFF','SUPERVISOR','LOGISTICS','OWNER']),auth.uid()) returning * into v_record;
  v_id:=v_record.id; v_result:=to_jsonb(v_record);
  insert into private.app_record_events(record_id,action,snapshot,actor_id) values(v_id,'CREATE',v_result,auth.uid());
 elsif p_action in ('record.take','record.complete','record.read','record.update') then
  select * into v_record from private.app_records where id=(p_data->>'id')::uuid and store_id=p_store for update;
  if not found then raise exception 'RECORD_NOT_FOUND' using errcode='P0002'; end if;
  if v_record.kind='bulletin' and not (v_role=any(v_record.audience) or v_role in ('SUPERVISOR','OWNER')) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  v_id:=v_record.id; v_old:=to_jsonb(v_record);
  if p_action='record.read' then
   insert into private.app_record_reads(record_id,user_id) values(v_id,auth.uid()) on conflict do nothing;
   v_result:=jsonb_build_object('id',v_id,'read_at',(select read_at from private.app_record_reads where record_id=v_id and user_id=auth.uid()));
  else
   if v_record.kind='bulletin' and v_role='STAFF' then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   if p_action='record.update' and v_role='STAFF' and v_record.created_by<>auth.uid() then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   if p_action='record.complete' and v_record.kind='incident' and v_role='STAFF' and coalesce(v_record.responsible_id,v_record.created_by)<>auth.uid() then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   if v_record.status='COMPLETE' then v_result:=v_old;
   else
    if (p_data->>'revision')::int is distinct from v_record.revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
    if p_action='record.take' then
     update private.app_records set responsible_id=auth.uid(),status='IN_PROGRESS',revision=revision+1,updated_at=now() where id=v_id returning * into v_record;
    elsif p_action='record.complete' then
     update private.app_records set status='COMPLETE',completed_by=auth.uid(),completed_at=now(),revision=revision+1,updated_at=now() where id=v_id returning * into v_record;
    else
     update private.app_records set title=btrim(p_data->>'title'),body=coalesce(p_data->>'body',''),revision=revision+1,updated_at=now() where id=v_id returning * into v_record;
    end if;
    v_result:=to_jsonb(v_record);
    insert into private.app_record_events(record_id,action,note,snapshot,actor_id) values(v_id,p_action,coalesce(p_data->>'note',''),v_result,auth.uid());
   end if;
  end if;
 elsif p_action in ('movement.create','movement.return','movement.exchange') then
  if v_role not in ('STAFF','SUPERVISOR') then raise exception 'FIELD_ROLE_REQUIRED' using errcode='42501'; end if;
  if v_mode<>'MULTI' then raise exception 'MULTI_STORE_REQUIRED' using errcode='42501'; end if;
  v_qty:=(p_data->>'quantity')::numeric;
  if v_qty is null or v_qty<=0 or v_qty>=1000000000 then raise exception 'INVALID_QUANTITY' using errcode='22023'; end if;
  if p_action='movement.create' then
   v_kind:=p_data->>'mode'; v_other:=(p_data->>'other_store_id')::uuid;
   if v_kind not in ('loan','loan_out','move') or v_other=p_store or not exists(select 1 from public.stores where id=v_other and organization_id=v_org and is_active) then raise exception 'INVALID_MOVEMENT' using errcode='22023'; end if;
   v_target:=nullif(p_data->>'product_id','')::uuid;
   if v_target is not null and not exists(select 1 from public.products where id=v_target and organization_id=v_org and is_active) then raise exception 'INVALID_PRODUCT' using errcode='22023'; end if;
   v_name:=btrim(p_data->>'name'); v_unit:=btrim(p_data->>'unit');
   insert into private.store_movements(organization_id,from_store_id,to_store_id,kind,product_id,name,quantity,unit,expected_return_on,status,created_by,closed_at)
   values(v_org,case when v_kind='loan' then v_other else p_store end,case when v_kind='loan' then p_store else v_other end,case when v_kind='move' then 'TRANSFER' else 'LOAN' end,v_target,v_name,v_qty,v_unit,case when v_kind<>'move' then nullif(p_data->>'expected_return_on','')::date end,case when v_kind='move' then 'COMPLETE' else 'OPEN' end,auth.uid(),case when v_kind='move' then now() end) returning * into v_move;
  else
   select * into v_move from private.store_movements where id=(p_data->>'id')::uuid and organization_id=v_org and p_store in (from_store_id,to_store_id) for update;
   if not found then raise exception 'MOVEMENT_NOT_FOUND' using errcode='P0002'; end if;
   if v_move.status<>'OPEN' then raise exception 'MOVEMENT_ALREADY_CLOSED' using errcode='22023'; end if;
   if (p_data->>'revision')::int is distinct from v_move.revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
   v_old:=to_jsonb(v_move);
   if p_action='movement.return' then
    if v_qty>v_move.quantity-v_move.returned_quantity then raise exception 'RETURN_EXCEEDS_REMAINING' using errcode='22023'; end if;
    v_name:=v_move.name; v_unit:=v_move.unit;
    update private.store_movements set returned_quantity=returned_quantity+v_qty,status=case when returned_quantity+v_qty=quantity then 'RETURNED' else 'OPEN' end,closed_at=case when returned_quantity+v_qty=quantity then now() end,revision=revision+1 where id=v_move.id returning * into v_move;
   else
    v_name:=btrim(p_data->>'name'); v_unit:=btrim(p_data->>'unit');
    if length(coalesce(v_name,'')) not between 1 and 160 or length(coalesce(v_unit,'')) not between 1 and 30 then raise exception 'INVALID_EXCHANGE' using errcode='22023'; end if;
    update private.store_movements set status='EXCHANGED',closed_at=now(),revision=revision+1 where id=v_move.id returning * into v_move;
   end if;
  end if;
  v_id:=v_move.id; v_result:=to_jsonb(v_move);
  insert into private.store_units(store_id,unit) values(p_store,v_unit) on conflict do nothing;
  if p_action='movement.create' and v_target is not null then
   if v_kind='loan' then perform private.stock_post(p_store,v_target,v_unit,v_qty,'MOVEMENT',v_id);
   else perform private.stock_post(p_store,v_target,v_unit,-v_qty,'MOVEMENT',v_id);end if;
  elsif p_action='movement.return' and v_move.product_id is not null then
   perform private.stock_post(p_store,v_move.product_id,v_unit,case when p_store=v_move.to_store_id then -v_qty else v_qty end,'RETURN',p_request);
  end if;
  insert into private.store_movement_events(movement_id,store_id,action,name,quantity,unit,actor_id) values(v_id,p_store,case p_action when 'movement.create' then 'CREATE' when 'movement.return' then 'RETURN' else 'EXCHANGE' end,v_name,v_qty,v_unit,auth.uid());
 else
  -- Management operations continue below; the dispatcher does not accept arbitrary table names.
  v_result:=private.app_management(p_store,p_action,p_data);
  v_id:=nullif(v_result->>'id','')::uuid;
 end if;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store,p_request,auth.uid(),p_action,p_data,v_result);
 if p_action<>'record.read' then
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
  values(v_org,'app_operation',coalesce(v_id,p_store)::text,p_action,v_old,v_result||jsonb_build_object('store_id',p_store),auth.uid());
 end if;
 return v_result;
end $function$;

CREATE OR REPLACE FUNCTION private.app_workspace(p_store uuid, p_section text, p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text:=private.app_role(p_store); v_org uuid; v_type text; v_erp boolean; v_mode text; v_data jsonb;
 v_start timestamptz:=coalesce(nullif(p_filter->>'from','')::timestamptz,date_trunc('month',now()));
 v_end timestamptz:=coalesce(nullif(p_filter->>'to','')::timestamptz,now()+interval '1 day');
begin
 if p_section='store-archive' then return private.store_archive(p_store);end if;
 if p_section='archived-transfers' then v_data:=private.store_archive(p_store);return jsonb_build_object('records',v_data->'movements','stores','[]'::jsonb,'products','[]'::jsonb,'units','[]'::jsonb,'has_erp',true);end if;
 if p_section='archived-stores' then return jsonb_build_object('stores',(select coalesce(jsonb_agg(to_jsonb(s) order by s.name,s.store_code),'[]') from public.stores s where not s.is_active and (private.store_scope_role(s.id) is not null or private.can_manage_store_scope(s.id))));end if;
 if p_section='store-lifecycle' then
  if not private.can_manage_store_scope((p_filter->>'id')::uuid) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  return jsonb_build_object('store',(select to_jsonb(s) from public.stores s where id=(p_filter->>'id')::uuid),'references',private.store_references((p_filter->>'id')::uuid));
 end if;
 if p_section='business' then
  if not private.can_manage_store_scope(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  return jsonb_build_object('stores',private.managed_store_cards(),'organization',(select to_jsonb(o) from public.organizations o join public.stores s on s.organization_id=o.id where s.id=p_store),'settings',coalesce((select settings from private.app_settings where store_id=p_store),'{}'::jsonb),'revision',coalesce((select revision from private.app_settings where store_id=p_store),0));
 end if;
 if v_role is null then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
 select s.organization_id,o.business_type::text,o.has_erp,o.store_mode into v_org,v_type,v_erp,v_mode from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store;
 if p_section='mappings' then return private.app_mapping_workspace(p_store);end if;
 if p_section in ('reports','costs') then return private.app_reports(p_store,p_filter);end if;

 if p_section='stock' then
  return jsonb_build_object('products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit,'thaw_enabled',coalesce(ss.thaw_enabled,false),'thaw_minutes',ss.thaw_minutes,'stock',private.stock_snapshot(p_store,p.id,p.base_unit)) order by p.name),'[]') from public.products p left join private.stock_settings ss on ss.store_id=p_store and ss.product_id=p.id where p.organization_id=v_org and p.is_active),
  'zones',(select coalesce(jsonb_agg(jsonb_build_object('id',z.id,'name',z.name) order by z.sort_order),'[]') from public.count_zones z where z.store_id=p_store and z.is_active),
  'positions',(select coalesce(jsonb_agg(to_jsonb(sp)||jsonb_build_object('zone_name',z.name) order by z.sort_order,sp.updated_at),'[]') from private.stock_positions sp join public.count_zones z on z.id=sp.zone_id where sp.store_id=p_store and sp.quantity>0));
 elsif p_section in ('incidents','handover','bulletins','company-tasks','activity','tasks','notifications') then
  select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('actor_name',p.display_name,'responsible_name',rp.display_name,'read_at',rd.read_at,'readers',case when v_role in ('OWNER','SUPERVISOR','LOGISTICS') then (select coalesce(jsonb_agg(jsonb_build_object('display_name',rp.display_name,'read_at',rr.read_at)),'[]'::jsonb) from private.app_record_reads rr left join public.profiles rp on rp.id=rr.user_id where rr.record_id=r.id) else '[]'::jsonb end,
    'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'note',e.note,'actor_name',ep.display_name,'created_at',e.created_at) order by e.created_at),'[]'::jsonb) from private.app_record_events e left join public.profiles ep on ep.id=e.actor_id where e.record_id=r.id)) order by r.created_at desc),'[]'::jsonb) into v_data
  from private.app_records r left join public.profiles p on p.id=r.created_by left join public.profiles rp on rp.id=r.responsible_id
  left join private.app_record_reads rd on rd.record_id=r.id and rd.user_id=auth.uid()
  where r.store_id=p_store and (p_section in ('activity','tasks','notifications') or r.kind=case p_section when 'incidents' then 'incident' when 'handover' then 'handover' when 'bulletins' then 'bulletin' when 'company-tasks' then 'company_task' end)
  and (r.kind<>'bulletin' or v_role=any(r.audience) or v_role in ('OWNER','SUPERVISOR'));
  return jsonb_build_object('records',v_data,'role',v_role);
 elsif p_section='transfers' then
  if v_mode<>'MULTI' then raise exception 'MULTI_STORE_REQUIRED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('from_name',fs.name,'to_name',ts.name,'actor_name',p.display_name,
   'reference_price',case when not v_erp and v_role<>'STAFF' then (select rl.unit_price_ex_tax from public.receipt_lines rl join public.goods_receipts g on g.id=rl.receipt_id join public.receipt_upload_batches b on b.id=g.source_batch_id where g.store_id=p_store and b.status::text='COMPLETED' and rl.product_id=m.product_id and rl.unit=m.unit order by g.receipt_date desc,g.reviewed_at desc limit 1) else null end,
   'events',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',ep.display_name) order by e.created_at),'[]'::jsonb) from private.store_movement_events e left join public.profiles ep on ep.id=e.actor_id where e.movement_id=m.id)) order by m.created_at desc),'[]'::jsonb) into v_data
  from private.store_movements m join public.stores fs on fs.id=m.from_store_id join public.stores ts on ts.id=m.to_store_id left join public.profiles p on p.id=m.created_by
  where m.organization_id=v_org and (m.from_store_id=p_store or m.to_store_id=p_store) and (m.status='OPEN' or (m.created_at>=v_start and m.created_at<v_end));
  return jsonb_build_object('records',v_data,'role',v_role,'has_erp',v_erp,'stores',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name),'[]'::jsonb) from public.stores s where s.organization_id=v_org and s.is_active and s.id<>p_store),
   'units',(select coalesce(jsonb_agg(unit order by unit),'[]') from private.store_units where store_id=p_store),'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit) order by p.name),'[]'::jsonb) from public.products p where p.organization_id=v_org and p.is_active));
 elsif p_section='transfer-search' then
  if v_mode<>'MULTI' then raise exception 'MULTI_STORE_REQUIRED' using errcode='42501'; end if;
  if length(btrim(coalesce(p_filter->>'search','')))<1 then return jsonb_build_object('stores','[]'::jsonb); end if;
  -- Only store name and evidence freshness; no physical count, safety or availability quantities.
  select coalesce(jsonb_agg(x order by x.updated_at desc nulls last),'[]'::jsonb) into v_data from (
   select s.id,s.name,max(cs.completed_at) updated_at,
 (select coalesce(jsonb_agg(jsonb_build_object('name',pr.name,'unit',pr.base_unit,'stock',private.stock_snapshot(s.id,pr.id,pr.base_unit),'states',(select coalesce(jsonb_agg(jsonb_build_object('state',sp.state,'quantity',sp.quantity,'unit',sp.unit,'ready_at',sp.ready_at)),'[]') from private.stock_positions sp where sp.store_id=s.id and sp.product_id=pr.id and sp.quantity>0))),'[]') from public.products pr where pr.organization_id=v_org and pr.is_active and pr.name ilike '%'||(p_filter->>'search')||'%') products from public.stores s
   join public.count_zones z on z.store_id=s.id and z.is_active join public.zone_products zp on zp.zone_id=z.id
   join public.products p on p.id=zp.product_id and p.is_active
   left join public.inventory_count_sessions cs on cs.store_id=s.id and cs.status::text in ('CLOSED','REVIEWING')
   where s.organization_id=v_org and s.is_active and s.id<>p_store and p.name ilike '%'||(p_filter->>'search')||'%' group by s.id,s.name) x;
  return jsonb_build_object('stores',v_data);
 elsif p_section in ('catalog','suppliers','members','business','permissions','settings','audit','reports','costs') then
  if v_role='STAFF' and p_section<>'settings' and not (p_section in ('members','business','permissions','audit') and private.can_manage_business(p_store)) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  if p_section='catalog' then
   return jsonb_build_object('lifecycle_allowed',private.can_import_inventory(p_store),'editable',v_role in ('OWNER','LOGISTICS') and v_type<>'CHAIN_RESTAURANT','products',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('aliases',coalesce(d.aliases,'{}'),'safety_quantity',d.safety_quantity,'note',d.note,'supplier_name',s.name) order by p.name),'[]'::jsonb) from public.products p left join private.product_details d on d.product_id=p.id left join public.suppliers s on s.id=p.current_supplier_id where p.organization_id=v_org));
  elsif p_section='suppliers' then
   return jsonb_build_object('lifecycle_allowed',private.can_import_inventory(p_store),'editable',v_role in ('OWNER','LOGISTICS') and v_type<>'CHAIN_RESTAURANT','suppliers',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('contact_name',d.contact_name,'phone',d.phone,'delivery_note',d.delivery_note) order by s.name),'[]'::jsonb) from public.suppliers s left join private.supplier_details d on d.supplier_id=s.id where s.organization_id=v_org));
  elsif p_section in ('members','permissions') then
   if not private.can_manage_members(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   return private.app_member_workspace(p_store);
  elsif p_section='business' then
   if not private.can_manage_business(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   return jsonb_build_object('organization',(select to_jsonb(o) from public.organizations o where o.id=v_org),'stores',(select jsonb_agg(to_jsonb(s) order by s.created_at,s.id) from public.stores s where s.organization_id=v_org and private.can_manage_business(s.id)),'settings',coalesce((select settings from private.app_settings where store_id=p_store),'{}'::jsonb),'revision',coalesce((select revision from private.app_settings where store_id=p_store),0));
  elsif p_section='settings' then
   return jsonb_build_object('settings',coalesce((select settings from private.app_settings where store_id=p_store),'{}'::jsonb),'devices',case when v_role='SUPERVISOR' or private.can_manage_business(p_store) then (select coalesce(jsonb_agg(to_jsonb(d) order by d.last_seen_at desc),'[]'::jsonb) from private.app_devices d where d.store_id=p_store) else '[]'::jsonb end,'editable',private.can_manage_business(p_store),'revision',coalesce((select revision from private.app_settings where store_id=p_store),0));
  elsif p_section='audit' then
   if not private.can_manage_business(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   return jsonb_build_object('events',(select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from (select a.* ,p.display_name actor_name from public.audit_logs a left join public.profiles p on p.id=a.user_id where a.organization_id=v_org and (a.new_value->>'store_id'=p_store::text or a.entity_id=p_store::text) and a.created_at>=v_start and a.created_at<v_end order by a.created_at desc limit 500) x));
  elsif p_section in ('reports','costs') then
   return jsonb_build_object('counts',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'started_at',s.started_at,'completed_at',s.completed_at,'status',s.status,'paper_completed_at',s.paper_completed_at) order by s.started_at desc),'[]'::jsonb) from public.inventory_count_sessions s where s.store_id=p_store and s.status::text='CLOSED' and s.completed_at>=v_start and s.completed_at<v_end),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('supplier_name',sp.name) order by g.receipt_date desc),'[]'::jsonb) from public.goods_receipts g join public.receipt_upload_batches b on b.id=g.source_batch_id left join public.suppliers sp on sp.id=g.supplier_id where g.store_id=p_store and b.status::text='COMPLETED' and g.reviewed_at>=v_start and g.reviewed_at<v_end),
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'receipt_id',g.id,'product_id',l.product_id,'name',coalesce(p.name,l.human_correction#>>'{effective_fields,product}',l.ai_original->>'raw_product_name','未對應'),'quantity',l.quantity,'unit',l.unit,'unit_price',l.unit_price_ex_tax,'amount',l.line_total_inc_tax,'inventory_status',coalesce((select inventory_status from private.receipt_line_resolutions where receipt_line_id=l.id order by created_at desc limit 1),l.inventory_status),'source_batch_id',g.source_batch_id,'receipt_date',g.receipt_date,'supplier_name',sp.name)),'[]'::jsonb) from public.receipt_lines l join public.goods_receipts g on g.id=l.receipt_id join public.receipt_upload_batches b on b.id=g.source_batch_id left join public.products p on p.id=l.product_id left join public.suppliers sp on sp.id=g.supplier_id where g.store_id=p_store and b.status::text='COMPLETED' and g.reviewed_at>=v_start and g.reviewed_at<v_end));
  end if;
 end if;
 raise exception 'INVALID_APP_SECTION' using errcode='22023';
end $function$;

CREATE OR REPLACE FUNCTION private.app_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare result jsonb;begin
 if exists(select 1 from public.stores s join public.organization_members om on om.organization_id=s.organization_id and om.user_id=auth.uid() and om.is_active where s.is_active and exists(select 1 from public.store_memberships sm where sm.store_id=s.id and sm.user_id=auth.uid() and sm.is_active) and not private.app_session_valid(s.id)) then raise exception 'AUTH_REAUTH_REQUIRED' using errcode='42501';end if;
 
 select jsonb_build_object('user_id',auth.uid(),'stores',coalesce((select jsonb_agg(jsonb_build_object(
 'id',s.id,'is_active',s.is_active,'organization_id',s.organization_id,'name',s.name,'store_code',s.store_code,'staff_login_mode',s.staff_login_mode,'login_identifier',(select sm.login_identifier from public.store_memberships sm where sm.store_id=s.id and sm.user_id=auth.uid() and sm.is_active),
 'business_type',coalesce(o.business_type::text,'SINGLE_RESTAURANT'),'has_erp',o.has_erp,'store_mode',o.store_mode,
 'role',coalesce(private.app_role(s.id),private.store_scope_role(s.id)),'can_manage_business',private.can_manage_business(s.id),'can_manage_stores',private.can_manage_store_scope(s.id),'can_manage_members',private.can_manage_members(s.id),'assignable_roles',private.assignable_member_roles(s.id),'is_business_responsible',o.owner_user_id=auth.uid(),'permissions',jsonb_build_object('reports_view',private.has_app_feature(s.id,'REPORTS_VIEW'),'data_export',private.has_app_feature(s.id,'DATA_EXPORT')),'settings',coalesce(st.settings,'{}'::jsonb),
 'linked_store_count',(select count(*) from public.stores other where other.organization_id=s.organization_id and other.is_active),
 'settings_revision',coalesce(st.revision,0)) order by s.name)
 from public.stores s join public.organizations o on o.id=s.organization_id left join private.app_settings st on st.store_id=s.id
 where private.app_role(s.id) is not null or (not exists(select 1 from public.stores live where private.app_role(live.id) is not null) and private.store_scope_role(s.id) is not null)),'[]'::jsonb))
 into result;return result;end $function$;

CREATE OR REPLACE FUNCTION private.app_member_workspace(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text:=private.app_role(p_store);v_org uuid;result jsonb;
begin
 if not private.can_manage_members(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into v_org from public.stores where id=p_store;
 result:=jsonb_build_object('invitations',case when private.can_manage_business(p_store) then (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'display_name',i.display_name,'role',i.role,'status',i.status,'mail_state',i.mail_state,'mail_error',i.mail_error,'expires_at',i.expires_at) order by i.created_at desc),'[]'::jsonb) from private.management_invites i where i.store_id=p_store and i.status='PENDING') else '[]'::jsonb end,'zones',(select coalesce(jsonb_agg(jsonb_build_object('id',z.id,'name',z.name) order by z.sort_order,z.id),'[]'::jsonb) from public.count_zones z where z.store_id=p_store and z.is_active),'members',(select coalesce(jsonb_agg(jsonb_build_object(
 'zone_ids',(select coalesce(jsonb_agg(mz.zone_id),'[]'::jsonb) from private.member_zone_responsibilities mz where mz.store_id=p_store and mz.user_id=sm.user_id),'user_id',sm.user_id,'role',coalesce(sm.work_role,sm.role),'extra_permissions',sm.extra_permissions,'can_manage_business',sm.can_manage_business,'login_identifier',sm.login_identifier,'is_active',sm.is_active and om.is_active and si.is_active,'is_enterprise_admin',om.can_manage_business and (om.is_owner or o.owner_user_id=sm.user_id),
 'display_name',coalesce(sm.display_name,si.display_name),'is_owner',om.is_owner or o.owner_user_id=sm.user_id,'updated_at',sm.updated_at,
 'email',case when u.email not like '%@auth.pantryflow.invalid' then u.email end,
 'uses_pin',exists(select 1 from private.staff_pin_credentials c where c.user_id=sm.user_id) or exists(select 1 from private.staff_activation_tokens t where t.user_id=sm.user_id),
 'pending_count',(select count(*) from private.app_records r where r.store_id=p_store and r.responsible_id=sm.user_id and r.status<>'COMPLETE')
 ) order by si.display_name),'[]'::jsonb) from public.store_memberships sm join public.staff_identities si on si.user_id=sm.user_id and si.organization_id=sm.organization_id join public.organization_members om on om.user_id=sm.user_id and om.organization_id=sm.organization_id join public.organizations o on o.id=sm.organization_id join auth.users u on u.id=sm.user_id where sm.store_id=p_store),
 'candidates',case when private.can_manage_business(p_store) then (select coalesce(jsonb_agg(jsonb_build_object('user_id',si.user_id,'display_name',si.display_name,'role',coalesce(om.work_role,om.role),'login_identifier',(select sm.login_identifier from public.store_memberships sm where sm.organization_id=si.organization_id and sm.user_id=si.user_id and sm.is_active order by sm.created_at limit 1)) order by si.display_name),'[]'::jsonb) from public.staff_identities si join public.organization_members om on om.user_id=si.user_id and om.organization_id=si.organization_id where si.organization_id=v_org and si.is_active and om.is_active and not exists(select 1 from public.store_memberships sm where sm.store_id=p_store and sm.user_id=si.user_id)) else '[]'::jsonb end,
 'delegations',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('display_name',p.display_name)),'[]'::jsonb) from private.app_delegations d left join public.profiles p on p.id=d.user_id where d.store_id=p_store));
return result||jsonb_build_object('members',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(result->'members') x where (x->>'is_active')::boolean),'inactive_members',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(result->'members') x where not (x->>'is_active')::boolean));
end $function$;

revoke all on function private.store_scope_role(uuid),private.can_manage_store_scope(uuid),private.store_references(uuid),private.managed_store_cards(),private.store_lifecycle(uuid,text,jsonb,uuid),private.edit_count_product(uuid,jsonb),private.store_archive(uuid) from public,anon,authenticated;