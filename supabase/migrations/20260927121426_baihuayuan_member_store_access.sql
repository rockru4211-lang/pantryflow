-- One Auth identity may have explicit access to multiple stores. Existing
-- memberships remain editable; no new store is granted by this migration.
alter table public.store_memberships
  add column access_mode text not null default 'EDIT'
    check (access_mode in ('EDIT','VIEW'));

create function private.store_access_mode(p_store uuid,p_actor uuid default auth.uid())
returns text language sql stable security definer set search_path='' as $$
 select sm.access_mode from public.store_memberships sm
 where sm.store_id=p_store and sm.user_id=p_actor and sm.is_active
 and private.member_active(p_store,p_actor)
 and (p_actor is distinct from auth.uid() or private.app_session_valid(p_store))
$$;
create function private.can_edit_store(p_store uuid,p_actor uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.store_access_mode(p_store,p_actor)='EDIT',false)
$$;
create function private.assert_store_editable(p_store uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or (private.app_role(p_store) is null and private.store_scope_role(p_store) is null) then
  raise exception 'APP_FORBIDDEN' using errcode='42501';
 end if;
 if exists(select 1 from public.store_memberships sm where sm.store_id=p_store
  and sm.user_id=auth.uid() and sm.is_active and sm.access_mode='VIEW') then
  raise exception 'STORE_READ_ONLY' using errcode='42501';
 end if;
end $$;

-- Shared product/supplier master data keeps its original enterprise model.
-- Direct table writes need at least one editable store in that enterprise;
-- store-scoped RPCs additionally require EDIT on the requested store.
create function private.can_edit_organization(p_org uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.store_memberships sm
 where sm.organization_id=p_org and sm.user_id=auth.uid()
 and private.can_edit_store(sm.store_id))
$$;

create or replace function private.can_manage_business(p_store uuid,p_actor uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.can_edit_store(p_store,p_actor) and exists(
 select 1 from public.store_memberships sm join public.stores s on s.id=sm.store_id
 join public.organizations o on o.id=s.organization_id
 where sm.store_id=p_store and sm.user_id=p_actor and coalesce(sm.work_role,sm.role)<>'STAFF'
 and not(o.business_type::text='CHAIN_RESTAURANT' and coalesce(sm.work_role,sm.role) in ('SUPERVISOR','ADMIN'))
 and sm.can_manage_business),false)
$$;
create or replace function private.can_manage_members(p_store uuid,p_actor uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
 select private.can_manage_business(p_store,p_actor) or (private.can_edit_store(p_store,p_actor)
 and exists(select 1 from public.store_memberships sm where sm.store_id=p_store
 and sm.user_id=p_actor and coalesce(sm.work_role,sm.role) in ('SUPERVISOR','ADMIN')))
$$;

create function private.can_manage_member_store_access(p_store uuid,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.uid() is not null and p_user<>auth.uid()
 and private.can_manage_members(p_store) and exists(
  select 1 from public.stores s join public.organizations o on o.id=s.organization_id
  join public.organization_members om on om.organization_id=s.organization_id and om.user_id=p_user and om.is_active
  join public.staff_identities si on si.organization_id=s.organization_id and si.user_id=p_user and si.is_active
  where s.id=p_store and s.is_active and s.name in ('BeApe','Gras')
  and o.owner_user_id<>p_user and not om.is_owner and coalesce(om.work_role,om.role)<>'OWNER'
  and not exists(select 1 from public.store_memberships owner_scope where owner_scope.organization_id=s.organization_id
   and owner_scope.user_id=p_user and owner_scope.is_active and coalesce(owner_scope.work_role,owner_scope.role)='OWNER')
  and exists(select 1 from public.store_memberships source
    where source.organization_id=s.organization_id and source.user_id=p_user and source.is_active
    and private.can_manage_members(source.store_id)
    and (coalesce(source.work_role,source.role)='STAFF' or private.can_manage_business(source.store_id)))
  and (coalesce((select coalesce(sm.work_role,sm.role) from public.store_memberships sm
       where sm.store_id=p_store and sm.user_id=p_user),coalesce(om.work_role,om.role))='STAFF'
       or private.can_manage_business(p_store))
 ),false)
$$;

-- This endpoint grants store scope to an EXISTING work identity. A business
-- administrator can include an existing SUPERVISOR even when the separate
-- new-account role picker only permits STAFF/LOGISTICS. It cannot change that
-- identity's role or confer business-management powers on a new store.
-- PATCH semantics: untouched stores, current identities, credentials, role
-- grants, and historical operations are retained. New memberships copy only
-- the existing work role and login label, never company-management powers.
create function public.save_baihuayuan_member_store_access(p_store_id uuid,p_user_id uuid,p_access jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_org uuid; item jsonb; target uuid; mode text; source public.store_memberships;
 existing public.store_memberships; login text; before_state jsonb; after_state jsonb;
begin
 if not private.can_manage_member_store_access(p_store_id,p_user_id) then
  raise exception 'APP_FORBIDDEN' using errcode='42501';
 end if;
 if p_access is null or jsonb_typeof(p_access)<>'array' or jsonb_array_length(p_access) not between 1 and 50 then
  raise exception 'INVALID_STORE_ACCESS' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(p_access) a where jsonb_typeof(a)<>'object'
  or not(a ? 'store_id') or not(a ? 'access_mode') or coalesce(a->>'access_mode','') not in ('EDIT','VIEW','NONE'))
 or (select count(*) from jsonb_array_elements(p_access))<>(select count(distinct a->>'store_id') from jsonb_array_elements(p_access) a)
 then raise exception 'INVALID_STORE_ACCESS' using errcode='22023';end if;
 select organization_id into v_org from public.stores where id=p_store_id;
 perform pg_advisory_xact_lock(hashtextextended(v_org::text||p_user_id::text,927));
 select * into source from public.store_memberships sm where sm.organization_id=v_org
 and sm.user_id=p_user_id and sm.is_active and private.can_manage_members(sm.store_id)
 and (coalesce(sm.work_role,sm.role)='STAFF' or private.can_manage_business(sm.store_id))
 order by (sm.store_id=p_store_id) desc,sm.created_at,sm.store_id limit 1;
 if source.user_id is null then raise exception 'MEMBER_NOT_FOUND' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(sm) order by sm.store_id),'[]') into before_state
 from public.store_memberships sm where sm.organization_id=v_org and sm.user_id=p_user_id;
 -- Validate the complete patch before mutating any row.
 for item in select value from jsonb_array_elements(p_access) loop
  target:=(item->>'store_id')::uuid;
  if not exists(select 1 from public.stores s where s.id=target and s.organization_id=v_org)
   or not private.can_manage_member_store_access(target,p_user_id)
   or (coalesce(source.work_role,source.role)<>'STAFF' and not private.can_manage_business(target)) then
   raise exception 'STORE_ACCESS_OUT_OF_SCOPE' using errcode='42501';
  end if;
 end loop;
 for item in select value from jsonb_array_elements(p_access) loop
  target:=(item->>'store_id')::uuid;mode:=item->>'access_mode';
  select * into existing from public.store_memberships where store_id=target and user_id=p_user_id for update;
  if mode='NONE' then
   update public.store_memberships set is_active=false,updated_at=now()
   where store_id=target and user_id=p_user_id and is_active;
  elsif existing.user_id is not null then
   update public.store_memberships set is_active=true,access_mode=mode,assigned_by=auth.uid(),updated_at=now()
   where store_id=target and user_id=p_user_id and (not is_active or access_mode<>mode);
  else
   login:=source.login_identifier;
   if exists(select 1 from public.store_memberships sm where sm.store_id=target and lower(sm.login_identifier)=lower(login)) then
    login:='linked-'||replace(p_user_id::text,'-','');
   end if;
   insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,
    is_active,assigned_by,can_manage_business,extra_permissions,display_name,access_mode)
   values(target,v_org,p_user_id,login,source.role,source.work_role,true,auth.uid(),false,
    '{}',source.display_name,mode);
  end if;
 end loop;
 -- Retain at least one active login/store association; use the existing
 -- offboarding flow to disable an employee with pending work.
 if not exists(select 1 from public.store_memberships where organization_id=v_org and user_id=p_user_id and is_active) then
  raise exception 'MEMBER_ACTIVE_STORE_REQUIRED' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(to_jsonb(sm) order by sm.store_id),'[]') into after_state
 from public.store_memberships sm where sm.organization_id=v_org and sm.user_id=p_user_id;
 if before_state is distinct from after_state then
  insert into public.audit_logs(organization_id,store_id,user_id,entity_type,entity_id,action,old_value,new_value)
  values(v_org,p_store_id,auth.uid(),'partner',p_user_id::text,'BAIHUAYUAN_STORE_ACCESS_UPDATED',before_state,after_state);
 end if;
 return jsonb_build_object('saved',true,'user_id',p_user_id,'access',p_access);
end $$;

revoke all on function private.store_access_mode(uuid,uuid),private.can_edit_store(uuid,uuid),
 private.assert_store_editable(uuid),private.can_edit_organization(uuid),private.can_manage_member_store_access(uuid,uuid)
 from public,anon,authenticated;
-- These boolean helpers are required by table/storage RLS; private is not an
-- exposed API schema and the helpers never return other users' data.
grant execute on function private.can_edit_store(uuid,uuid),private.can_edit_organization(uuid),private.assert_store_editable(uuid) to authenticated;
revoke all on function public.save_baihuayuan_member_store_access(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_baihuayuan_member_store_access(uuid,uuid,jsonb) to authenticated;

-- Attach explicit write guards to every current public business-write route,
-- including older RPC versions. Fail closed if an expected implementation is
-- missing instead of silently shipping a partially guarded API.
-- Maintenance: every future business-write RPC (and any new overload) must call
-- assert_store_editable or a guarded implementation before writing/replaying.
do $guards$
declare r record; fn record; src text; patched text; guard text;
begin
 for r in select * from (values
  ('public','begin_pilot_receipt_upload','p_store_id','true'),
  ('public','complete_baihuayuan_receipt','p_store_id','true'),
  ('public','confirm_baihuayuan_receipt_missing_fields','p_store_id','true'),
  ('public','confirm_baihuayuan_waste','p_store_id','true'),
  ('public','confirm_baihuayuan_waste_v2','p_store_id','true'),
  ('public','confirm_pilot_receipt_ledger','p_store_id','true'),
  ('public','create_baihuayuan_direct_receipt','p_store_id','true'),
  ('public','create_baihuayuan_transfer_backfill','p_store_id','true'),
  ('public','create_baihuayuan_waste_backfill','p_store_id','true'),
  ('public','create_pilot_product','p_store_id','true'),
  ('public','create_pilot_zone','p_store_id','true'),
  ('public','ensure_pilot_daily_count','p_store_id','true'),
  ('public','fill_pilot_opening','p_store_id','true'),
  ('public','import_pilot_inventory','p_store_id','true'),
  ('public','import_pilot_inventory_quick','p_store_id','true'),
  ('public','remove_baihuayuan_partner','p_store_id','true'),
  ('public','remove_single_imported_product_safely','p_store_id','true'),
  ('public','reset_pilot_count_setup','p_store_id','true'),
  ('public','save_baihuayuan_company_partner','p_store_id','true'),
  ('public','save_baihuayuan_manual_receipt_line','p_store_id','true'),
  ('private','inventory_import_review','s','true'),
  ('private','context_expiry_save','p_store_id','true'),
  ('private','expiry_waste_command','p_store_id','true'),
  ('public','set_baihuayuan_manual_receipt_line_deleted','p_store_id','true'),
  ('public','set_baihuayuan_receipt_line_decision','p_store_id','true'),
  ('public','set_baihuayuan_record_state','p_store_id','true'),
  ('public','set_pilot_count_next_period','p_store_id','true'),
  ('public','start_pilot_count','p_store_id','true'),
  ('public','sync_active_count_after_import','p_store_id','true'),
  ('public','undo_inventory_import_batch','p_store_id','true'),
  ('public','update_imported_inventory_item','p_store_id','true'),
  ('public','update_pilot_count_item_basic','p_store_id','true'),
  ('public','update_store_login_code','p_store_id','true'),
  ('public','add_pilot_count_item','(select store_id from public.inventory_count_sessions where id=p_session_id)','true'),
  ('public','complete_pilot_count_paper','(select store_id from public.inventory_count_sessions where id=p_session_id)','true'),
  ('public','complete_pilot_count_zone','(select store_id from public.inventory_count_sessions where id=p_session_id)','true'),
  ('public','save_pilot_count_draft','(select store_id from public.inventory_count_sessions where id=p_session_id)','true'),
  ('public','save_pilot_count_drafts','(select store_id from public.inventory_count_sessions where id=p_session_id)','true'),
  ('public','save_pilot_count_drafts_v2','(select store_id from public.inventory_count_sessions where id=p_session_id)','true'),
  ('public','assign_pilot_product_to_zone','(select store_id from public.count_zones where id=p_zone_id)','true'),
  ('public','save_pilot_zone_configuration','(select store_id from public.count_zones where id=p_zone_id)','true'),
  ('public','save_pilot_zone_configuration_v2','(select store_id from public.count_zones where id=p_zone_id)','true'),
  ('public','resolve_pilot_count_discrepancy','(select s.store_id from public.inventory_count_discrepancies d join public.inventory_count_sessions s on s.id=d.session_id where d.id=p_discrepancy_id)','true'),
  ('public','complete_pilot_receipt_erp','(select store_id from public.receipt_upload_batches where id=p_batch_id)','true'),
  ('public','confirm_pilot_receipt_row','(select store_id from public.receipt_upload_batches where id=p_batch_id)','true'),
  ('public','enqueue_receipt_ocr','(select store_id from public.receipt_upload_batches where id=p_batch_id)','true'),
  ('public','map_pilot_receipt_product','(select store_id from public.receipt_upload_batches where id=p_batch_id)','true'),
  ('public','publish_pilot_receipt','(select store_id from public.receipt_upload_batches where id=p_batch_id)','true'),
  ('public','save_pilot_receipt_review','(select store_id from public.receipt_upload_batches where id=p_batch_id)','true'),
  ('public','correct_pilot_receipt_field','(select b.store_id from public.receipt_ocr_fields f join public.receipt_upload_batches b on b.id=f.batch_id where f.id=p_field_id)','true'),
  ('private','begin_baihuayuan_receipt_upload','p_store_id','true'),
  ('private','baihuayuan_custody','p_store_id','p_action is distinct from ''read'''),
  ('private','baihuayuan_inventory_month','p_store_id','coalesce(p_action,'''') not in (''read'',''export'')'),
  ('private','baihuayuan_receipt_photo','p_store','p_action is distinct from ''list'''),
  ('private','app_operation','p_store','p_action is distinct from ''device.authorize'''),
  ('private','app_management','p_store','p_action is distinct from ''device.authorize''')
 ) x(schema_name,function_name,store_expression,condition) loop
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname=r.schema_name and p.proname=r.function_name)>1 then
   raise exception 'AMBIGUOUS_STORE_WRITE_GUARD_TARGET: %.%',r.schema_name,r.function_name;
  end if;
  select p.oid,pg_get_functiondef(p.oid) as definition into fn
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname=r.schema_name and p.proname=r.function_name;
  -- This optional compatibility overload exists on the live test project but
  -- is absent from a fresh historical migration replay; guard it when present.
  if fn.oid is null and r.schema_name='public' and r.function_name in ('confirm_baihuayuan_waste_v2','update_pilot_count_item_basic') then continue;end if;
  if fn.oid is null then raise exception 'MISSING_STORE_WRITE_GUARD_TARGET: %.%',r.schema_name,r.function_name;end if;
  src:=fn.definition;
  guard:=format(E'\n -- Store access is checked before cached results or business writes.\n if %s then perform private.assert_store_editable(%s);end if;\n',r.condition,r.store_expression);
  patched:=regexp_replace(src,'\mbegin\M',E'begin\n'||guard,'i');
  if patched=src then raise exception 'INVALID_STORE_WRITE_GUARD_TARGET: %.%',r.schema_name,r.function_name;end if;
  execute patched;
 end loop;
end $guards$;

-- VIEW users can register/choose/touch their own session as before. A personal
-- device authorization is also allowed, but managing shared/other devices is
-- still an editable-store management operation.
do $device$
declare src text;needle text;
begin
 select pg_get_functiondef('private.app_device_management(uuid,text,jsonb)'::regprocedure) into src;
 needle:='begin';
 src:=regexp_replace(src,'\mbegin\M',E'begin\n'
  ||' if private.store_access_mode(p_store)=''VIEW'' then'
  ||' if (private.app_role(p_store)=''SUPERVISOR'' or exists(select 1 from public.store_memberships sm where sm.store_id=p_store and sm.user_id=auth.uid() and sm.can_manage_business and coalesce(sm.work_role,sm.role)<>''STAFF''))'
  ||' and p_action=''device.authorize'' and p_data->>''device_type''=''PERSONAL'' and exists('
  ||' select 1 from private.app_device_sessions ds join auth.sessions se on se.id=ds.session_id'
  ||' where ds.device_id=(p_data->>''id'')::uuid and ds.store_id=p_store and se.user_id=auth.uid()'
  ||' and ds.session_id=nullif(auth.jwt()->>''session_id'','''')::uuid) then'
  ||' update private.app_devices set device_type=''PERSONAL'',authorized_by=auth.uid(),authorized_at=now(),revoked_at=null'
  ||' where id=(p_data->>''id'')::uuid and store_id=p_store returning * into result;return to_jsonb(result);'
  ||' end if;raise exception ''STORE_READ_ONLY'' using errcode=''42501'';end if;','i');
 execute src;
end $device$;

-- Old company-profile and removal endpoints may not grant/revoke stores beyond
-- the caller's own management scope or modify the caller's privileges.
do $company$
declare src text;name text;guard text;
begin
 foreach name in array array['save_baihuayuan_company_partner','remove_baihuayuan_partner'] loop
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=name;
  guard:=' if p_user_id=auth.uid() then raise exception ''CANNOT_CHANGE_OWNER_OR_SELF'' using errcode=''42501'';end if;'
  ||' if exists(select 1 from public.store_memberships sm where sm.user_id=p_user_id and sm.is_active'
  ||' and sm.organization_id=(select organization_id from public.stores where id=p_store_id)'
  ||' and not private.can_manage_business(sm.store_id)) then raise exception ''STORE_ACCESS_OUT_OF_SCOPE'' using errcode=''42501'';end if;';
  if name='save_baihuayuan_company_partner' then
   guard:=guard||' if exists(select 1 from unnest(coalesce(p_store_ids,''{}''::uuid[])) s where not private.can_manage_business(s))'
    ||' then raise exception ''STORE_ACCESS_OUT_OF_SCOPE'' using errcode=''42501'';end if;';
  end if;
  execute regexp_replace(src,'\mbegin\M',E'begin\n'||guard||E'\n','i');
 end loop;
end $company$;

-- Context keeps the existing role and adds the independent store access mode.
CREATE OR REPLACE FUNCTION private.can_manage_store_scope(s uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(exists(select 1 from public.stores st join public.organizations o on o.id=st.organization_id
 join public.organization_members om on om.organization_id=o.id and om.user_id=auth.uid() and om.is_active
 join public.staff_identities si on si.organization_id=o.id and si.user_id=auth.uid() and si.is_active
 left join public.store_memberships sm on sm.store_id=st.id and sm.user_id=auth.uid()
 where st.id=s and private.app_session_valid(s) and
 ((sm.is_active and sm.access_mode='EDIT' and sm.can_manage_business and coalesce(sm.work_role,sm.role)::text<>'STAFF' and not(o.business_type::text='CHAIN_RESTAURANT' and coalesce(sm.work_role,sm.role)::text in ('SUPERVISOR','ADMIN')))
 or (sm.user_id is null and om.can_manage_business and (om.is_owner or o.owner_user_id=auth.uid())))),false)
$function$
;
CREATE OR REPLACE FUNCTION private.app_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare result jsonb;begin
 if exists(select 1 from public.stores s where s.is_active and private.member_active(s.id,auth.uid()) and not private.app_session_valid(s.id))
 and not exists(select 1 from public.stores s where private.app_role(s.id) is not null
  or (not s.is_active and private.store_scope_role(s.id) is not null))
 then raise exception 'AUTH_REAUTH_REQUIRED' using errcode='42501';end if;
 
 select jsonb_build_object('user_id',auth.uid(),
 'reauth_stores',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name)
  from public.stores s where s.is_active and private.member_active(s.id,auth.uid()) and not private.app_session_valid(s.id)),'[]'::jsonb),
 'stores',coalesce((select jsonb_agg(jsonb_build_object(
 'id',s.id,'is_active',s.is_active,'organization_id',s.organization_id,'name',s.name,'store_code',s.store_code,'staff_login_mode',s.staff_login_mode,'login_identifier',(select sm.login_identifier from public.store_memberships sm where sm.store_id=s.id and sm.user_id=auth.uid() and sm.is_active),
 'business_type',coalesce(o.business_type::text,'SINGLE_RESTAURANT'),'has_erp',o.has_erp,'store_mode',o.store_mode,
 'role',coalesce(private.app_role(s.id),private.store_scope_role(s.id)),'access_mode',coalesce((select sm.access_mode from public.store_memberships sm where sm.store_id=s.id and sm.user_id=auth.uid()),'VIEW'),'company_title',(select si.job_title from public.staff_identities si where si.organization_id=s.organization_id and si.user_id=auth.uid()),'can_manage_business',private.can_manage_business(s.id),'can_manage_stores',private.can_manage_store_scope(s.id),'can_manage_members',private.can_manage_members(s.id),'assignable_roles',private.assignable_member_roles(s.id),'is_business_responsible',o.owner_user_id=auth.uid(),'permissions',jsonb_build_object('reports_view',private.has_app_feature(s.id,'REPORTS_VIEW'),'data_export',private.has_app_feature(s.id,'DATA_EXPORT')),'settings',coalesce(st.settings,'{}'::jsonb),
 'linked_store_count',(select count(*) from public.stores other where other.organization_id=s.organization_id and other.is_active),
 'settings_revision',coalesce(st.revision,0)) order by s.name)
 from public.stores s join public.organizations o on o.id=s.organization_id left join private.app_settings st on st.store_id=s.id
 where private.app_role(s.id) is not null or (not exists(select 1 from public.stores live where private.app_role(live.id) is not null) and private.store_scope_role(s.id) is not null)),'[]'::jsonb))
 into result;return result;end $function$
;

create or replace function public.get_baihuayuan_partners(p_store_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null or not private.can_manage_members(p_store_id) then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;
  select organization_id into v_org from public.stores where id=p_store_id;

  return jsonb_build_object(
    'manageable_stores',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'store_code',s.store_code) order by s.name),'[]'::jsonb) from public.stores s where s.organization_id=v_org and s.is_active and s.name in ('BeApe','Gras') and private.can_manage_members(s.id)),
    'partners',
    (
      select coalesce(jsonb_agg(partner order by
        case partner->>'company_title'
          when '老闆' then 1
          when '營運' then 2
          when '行政' then 3
          when '財務' then 4
          else 9
        end,
        partner->>'display_name'
      ),'[]'::jsonb)
      from (
        select jsonb_build_object(
          'user_id',om.user_id,
          'can_manage_access',private.can_manage_member_store_access(p_store_id,om.user_id),
          'display_name',coalesce(si.display_name,p.display_name,'未命名夥伴'),
          'company_title',case
            when coalesce(om.is_owner,false) or o.owner_user_id=om.user_id then '老闆'
            when si.job_title in ('營運','行政','財務') then si.job_title
            when coalesce(om.work_role,om.role)::text='LOGISTICS' then '行政'
            else null
          end,
          'role',coalesce(om.work_role,om.role)::text,
          'is_owner',coalesce(om.is_owner,false) or o.owner_user_id=om.user_id,
          'can_manage_business',coalesce(om.can_manage_business,false),
          'email',case when u.email not like '%@auth.pantryflow.invalid' then u.email end,
          'company_member',(
            coalesce(om.is_owner,false) or o.owner_user_id=om.user_id
            or si.job_title in ('營運','行政','財務')
            or coalesce(om.work_role,om.role)::text='LOGISTICS'
          ),
          'stores',(
            select coalesce(jsonb_agg(jsonb_build_object(
              'id',s.id,
              'access_mode',sm.access_mode,
              'name',s.name,
              'store_code',s.store_code,
              'role',coalesce(sm.work_role,sm.role)::text,
              'login_identifier',sm.login_identifier,
              'can_manage_business',sm.can_manage_business,
              'extra_permissions',to_jsonb(sm.extra_permissions),
              'uses_pin',exists(select 1 from private.staff_pin_credentials c where c.user_id=sm.user_id)
                or exists(select 1 from private.staff_activation_tokens t where t.user_id=sm.user_id)
            ) order by case s.name when 'BeApe' then 1 when 'Gras' then 2 else 9 end,s.name),'[]'::jsonb)
            from public.store_memberships sm
            join public.stores s on s.id=sm.store_id
            where sm.organization_id=v_org
              and sm.user_id=om.user_id
              and sm.is_active
              and s.is_active
              and s.name in ('BeApe','Gras')
          )
        ) partner
        from public.organization_members om
        join public.organizations o on o.id=om.organization_id
        left join public.staff_identities si on si.organization_id=om.organization_id and si.user_id=om.user_id
        left join public.profiles p on p.id=om.user_id
        left join auth.users u on u.id=om.user_id
        where om.organization_id=v_org and om.is_active and coalesce(si.is_active,true)
      ) q
    )
  );
end;
$$;

-- Security-definer RPC checks do not protect the Data API. Restrictive write
-- policies are ANDed with the existing role/ownership policies; SELECT remains
-- unchanged, including blind-count and receipt-owner rules.
do $rls$
declare t record;operation text;predicate text;
begin
 for t in select * from (values
  ('count_zones','private.can_edit_store(store_id)'),
  ('inventory_count_sessions','private.can_edit_store(store_id)'),
  ('store_product_opening_balances','private.can_edit_store(store_id)'),
  ('inventory_lots','private.can_edit_store(store_id)'),
  ('count_drafts','exists(select 1 from public.inventory_count_sessions cs where cs.id=count_drafts.session_id and private.can_edit_store(cs.store_id))'),
  ('count_entries','exists(select 1 from public.inventory_count_sessions cs where cs.id=count_entries.session_id and private.can_edit_store(cs.store_id))'),
  ('count_zone_progress','exists(select 1 from public.inventory_count_sessions cs where cs.id=count_zone_progress.session_id and private.can_edit_store(cs.store_id))'),
  ('inventory_count_discrepancies','exists(select 1 from public.inventory_count_sessions cs where cs.id=inventory_count_discrepancies.session_id and private.can_edit_store(cs.store_id))'),
  ('discrepancy_reviews','exists(select 1 from public.inventory_count_sessions cs where cs.id=discrepancy_reviews.session_id and private.can_edit_store(cs.store_id))'),
  ('zone_products','exists(select 1 from public.count_zones cz where cz.id=zone_products.zone_id and private.can_edit_store(cz.store_id))'),
  ('inventory_lot_events','exists(select 1 from public.inventory_lots il where il.id=inventory_lot_events.lot_id and private.can_edit_store(il.store_id))'),
  ('audit_logs','case when store_id is not null then private.can_edit_store(store_id) else private.can_edit_organization(organization_id) end'),
  ('products','private.can_edit_organization(organization_id)'),
  ('suppliers','private.can_edit_organization(organization_id)'),
  ('product_supplier_history','private.can_edit_organization(organization_id)')
 ) x(table_name,expression) loop
  foreach operation in array array['insert','update','delete'] loop
   predicate:=case when operation='insert' then format('with check (%s)',t.expression)
    when operation='delete' then format('using (%s)',t.expression)
    else format('using (%s) with check (%s)',t.expression,t.expression) end;
   execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',
    'store_access_'||operation,t.table_name,operation,predicate);
  end loop;
 end loop;
end $rls$;

create function private.can_write_store_storage(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select case when p_bucket='inventory-imports' then private.can_edit_store(private.inventory_import_storage_store_id(p_path))
 when p_bucket='receipt-documents' then exists(
  select 1 from public.receipt_documents d join public.receipt_upload_batches b on b.id=d.batch_id
  where d.storage_path=p_path and private.can_edit_store(b.store_id)
 ) or exists(
  select 1 from private.receipt_photo_requests r join public.receipt_upload_batches b on b.id=r.batch_id
  where r.replacement_path=p_path and private.can_edit_store(b.store_id)
 ) else true end
$$;
revoke all on function private.can_write_store_storage(text,text) from public,anon,authenticated;
grant execute on function private.can_write_store_storage(text,text) to authenticated;
create policy store_access_insert on storage.objects as restrictive for insert to authenticated
 with check(private.can_write_store_storage(bucket_id,name));
create policy store_access_update on storage.objects as restrictive for update to authenticated
 using(private.can_write_store_storage(bucket_id,name)) with check(private.can_write_store_storage(bucket_id,name));
create policy store_access_delete on storage.objects as restrictive for delete to authenticated
 using(private.can_write_store_storage(bucket_id,name));

notify pgrst,'reload schema';
