-- Preserve explicit store grant revocation independently of work identity.
create or replace function private.can_manage_business(p_store uuid,p_actor uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.member_active(p_store,p_actor) and (p_actor is distinct from auth.uid() or private.app_session_valid(p_store)) and exists(
 select 1 from public.store_memberships sm join public.stores s on s.id=sm.store_id join public.organizations o on o.id=s.organization_id
 where sm.store_id=p_store and sm.user_id=p_actor and coalesce(sm.work_role,sm.role)<>'STAFF'
 and not (o.business_type::text='CHAIN_RESTAURANT' and coalesce(sm.work_role,sm.role) in ('SUPERVISOR','ADMIN'))
 and sm.can_manage_business),false)
$$;

CREATE OR REPLACE FUNCTION private.initialize_member_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if tg_table_name='organization_members' then
  new.work_role:=coalesce(new.work_role,case when new.is_owner then 'OWNER'::public.app_role when new.role='ADMIN' then 'SUPERVISOR'::public.app_role else new.role end);
  if new.is_owner and exists(select 1 from public.organizations where id=new.organization_id and owner_user_id=new.user_id) then new.can_manage_business:=true;end if;
 else
  new.work_role:=coalesce(new.work_role,case when new.role='ADMIN' and exists(select 1 from public.organization_members where organization_id=new.organization_id and user_id=new.user_id and is_owner) then 'OWNER'::public.app_role when new.role='ADMIN' then 'SUPERVISOR'::public.app_role else new.role end);
  new.can_manage_business:=coalesce(new.can_manage_business,new.work_role='OWNER' or (select om.can_manage_business from public.organization_members om where om.organization_id=new.organization_id and om.user_id=new.user_id),false);
  new.display_name:=coalesce(new.display_name,(select si.display_name from public.staff_identities si where si.organization_id=new.organization_id and si.user_id=new.user_id));
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION private.app_member_operation(p_store uuid, p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text:=private.app_role(p_store);v_org uuid;v_target uuid:=(p_data->>'user_id')::uuid;
 v_member public.store_memberships;v_next uuid:=nullif(p_data->>'handoff_to','')::uuid;v_old jsonb;v_result jsonb;
begin
 if not private.can_manage_members(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into v_org from public.stores where id=p_store;
 if v_target=auth.uid() or exists(select 1 from public.organization_members om join public.organizations o on o.id=om.organization_id where om.organization_id=v_org and om.user_id=v_target and (om.is_owner or o.owner_user_id=v_target)) then raise exception 'CANNOT_CHANGE_OWNER_OR_SELF' using errcode='42501';end if;
 if not private.can_manage_business(p_store) and exists(select 1 from public.store_memberships where store_id=p_store and user_id=v_target and can_manage_business) then raise exception 'BUSINESS_ADMIN_REQUIRED' using errcode='42501';end if;
 select * into v_member from public.store_memberships where store_id=p_store and user_id=v_target for update;
 if p_action<>'member.assign' and not found then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002';end if;
 if not private.can_manage_business(p_store) and (v_member.role<>'STAFF' or p_action='member.assign' or coalesce(p_data->>'role','STAFF')<>'STAFF') then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if v_member.user_id is not null and (p_data->>'updated_at')::timestamptz is distinct from v_member.updated_at then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 v_old:=to_jsonb(v_member)||jsonb_build_object('can_manage_business',(select can_manage_business from public.store_memberships where store_id=p_store and user_id=v_target));
 if p_data ? 'extra_permissions' then
  if jsonb_typeof(p_data->'extra_permissions')<>'array' or exists(select 1 from jsonb_array_elements(p_data->'extra_permissions') x where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('REPORTS_VIEW','DATA_EXPORT')) then raise exception 'INVALID_FEATURE_PERMISSION' using errcode='22023';end if;
  if not private.can_manage_business(p_store) and p_data->'extra_permissions'<>to_jsonb(v_member.extra_permissions) then raise exception 'BUSINESS_ADMIN_REQUIRED' using errcode='42501';end if;
 end if;
 if p_data ? 'can_manage_business' and (p_data->>'can_manage_business')::boolean is distinct from (select can_manage_business from public.store_memberships where store_id=p_store and user_id=v_target) and not private.can_manage_business(p_store) then raise exception 'BUSINESS_ADMIN_REQUIRED' using errcode='42501';end if;
 if v_member.user_id is not null and not (coalesce(v_member.work_role,v_member.role)::text=any(private.assignable_member_roles(p_store))) then raise exception 'ROLE_NOT_ALLOWED' using errcode='42501';end if;
 if p_action<>'member.offboard' and not coalesce((p_data->>'role')=any(private.assignable_member_roles(p_store)),false) then raise exception 'ROLE_NOT_ALLOWED' using errcode='42501';end if;
 if p_data ? 'extra_permissions' and exists(select 1 from jsonb_array_elements_text(p_data->'extra_permissions') p where not private.has_app_feature(p_store,p)) then raise exception 'FEATURE_NOT_ALLOWED' using errcode='42501';end if;
 if p_action='member.offboard' then
  if not v_member.is_active then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002';end if;
  if v_next is not null and (v_next=v_target or not exists(select 1 from public.store_memberships sm join public.organization_members om on om.user_id=sm.user_id and om.organization_id=sm.organization_id where sm.store_id=p_store and sm.user_id=v_next and sm.is_active and om.is_active)) then raise exception 'INVALID_RESPONSIBLE' using errcode='22023';end if;
  if v_next is null and exists(select 1 from private.app_records where store_id=p_store and responsible_id=v_target and status<>'COMPLETE') then raise exception 'HANDOFF_REQUIRED' using errcode='22023';end if;
  insert into private.app_record_events(record_id,actor_id,action,note,snapshot) select id,auth.uid(),'HANDOFF','離職交接',jsonb_build_object('previous_responsible',v_target,'responsible_id',v_next) from private.app_records where store_id=p_store and responsible_id=v_target and status<>'COMPLETE';
  update private.app_records set responsible_id=v_next,revision=revision+1,updated_at=now() where store_id=p_store and responsible_id=v_target and status<>'COMPLETE';
  update public.store_memberships set is_active=false,updated_at=now() where store_id=p_store and user_id=v_target returning to_jsonb(public.store_memberships.*) into v_result;
  update private.app_delegations set revoked_at=now() where store_id=p_store and user_id=v_target and revoked_at is null;
 else
  if p_data->>'role' not in ('STAFF','SUPERVISOR','LOGISTICS','OWNER') or length(btrim(coalesce(p_data->>'login_identifier',''))) not between 1 and 64 then raise exception 'INVALID_MEMBER' using errcode='22023';end if;
  if not exists(select 1 from public.organization_members where organization_id=v_org and user_id=v_target and is_active) then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002';end if;
  if coalesce((p_data->>'is_active')::boolean,true)=false and exists(select 1 from private.app_records where store_id=p_store and responsible_id=v_target and status<>'COMPLETE') then raise exception 'HANDOFF_REQUIRED' using errcode='22023';end if;
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,is_active,assigned_by,work_role,can_manage_business)
  values(p_store,v_org,v_target,btrim(p_data->>'login_identifier'),(p_data->>'role')::public.app_role,coalesce((p_data->>'is_active')::boolean,true),auth.uid(),(p_data->>'role')::public.app_role,p_data->>'role'='OWNER')
  on conflict(store_id,user_id) do update set login_identifier=excluded.login_identifier,role=excluded.role,work_role=excluded.work_role,is_active=excluded.is_active,assigned_by=excluded.assigned_by,updated_at=now() returning to_jsonb(public.store_memberships.*) into v_result;
  if p_data ? 'extra_permissions' then
   update public.store_memberships set extra_permissions=array(select distinct x from jsonb_array_elements_text(p_data->'extra_permissions') x) where store_id=p_store and user_id=v_target;
  end if;
  if private.can_manage_business(p_store) and p_action='member.save' then
   update public.store_memberships set can_manage_business=coalesce((p_data->>'can_manage_business')::boolean,can_manage_business) where store_id=p_store and user_id=v_target;
  end if;
  if length(btrim(coalesce(p_data->>'display_name','')))>0 then
   update public.store_memberships set display_name=btrim(p_data->>'display_name') where store_id=p_store and user_id=v_target;
  end if;
 end if;
 if p_action in ('member.save','member.assign') and p_data ? 'zone_ids' then
 if jsonb_typeof(p_data->'zone_ids')<>'array' or exists(select 1 from jsonb_array_elements_text(p_data->'zone_ids') x where not exists(select 1 from public.count_zones z where z.id::text=x and z.store_id=p_store and z.is_active)) then raise exception 'INVALID_ZONE' using errcode='22023';end if;
 delete from private.member_zone_responsibilities where store_id=p_store and user_id=v_target;
 insert into private.member_zone_responsibilities(store_id,user_id,zone_id,assigned_by) select distinct p_store,v_target,x::uuid,auth.uid() from jsonb_array_elements_text(p_data->'zone_ids') x;
 v_result:=v_result||jsonb_build_object('zone_ids',p_data->'zone_ids');end if;
v_result:=v_result||(select to_jsonb(sm) from public.store_memberships sm where sm.store_id=p_store and sm.user_id=v_target)||jsonb_build_object('can_manage_business',(select can_manage_business from public.store_memberships where store_id=p_store and user_id=v_target));
 return jsonb_build_object('id',v_target,'value',v_result,'previous',v_old);
end $function$;

CREATE OR REPLACE FUNCTION private.transfer_business_admin(p_store uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org public.organizations; target uuid:=(p_data->>'user_id')::uuid; actor uuid:=auth.uid(); target_role public.app_role; old jsonb; keep_admin boolean:=coalesce((p_data->>'keep_admin')::boolean,false);
begin
 if not private.can_manage_business(p_store) then raise exception 'BUSINESS_ADMIN_REQUIRED' using errcode='42501';end if;
 select o.* into strict org from public.organizations o join public.stores s on s.organization_id=o.id where s.id=p_store for update of o;
 if org.owner_user_id<>actor or target=actor then raise exception 'BUSINESS_RESPONSIBLE_REQUIRED' using errcode='42501';end if;
 if not private.member_active(p_store,target) then raise exception 'ACTIVE_MANAGER_REQUIRED' using errcode='42501';end if;
 select coalesce(work_role,role) into target_role from public.store_memberships where store_id=p_store and user_id=target;
 if target_role='ADMIN' then target_role:='SUPERVISOR';end if;
 if (org.business_type::text='CHAIN_RESTAURANT' and target_role='SUPERVISOR') or exists(select 1 from public.store_memberships sm join public.stores s on s.id=sm.store_id where sm.organization_id=org.id and sm.user_id=target and s.is_active and (coalesce(sm.work_role,sm.role)='STAFF' or (org.business_type::text='CHAIN_RESTAURANT' and coalesce(sm.work_role,sm.role) in ('SUPERVISOR','ADMIN')))) then raise exception 'ACTIVE_MANAGER_REQUIRED' using errcode='42501';end if;
 if target_role not in ('SUPERVISOR','LOGISTICS','OWNER') then raise exception 'ACTIVE_MANAGER_REQUIRED' using errcode='42501';end if;
 old:=jsonb_build_object('responsible_user_id',org.owner_user_id,'store_id',p_store);
 -- One transaction grants the new responsible manager access before releasing
 -- the previous responsibility. Identity and historical authorship stay intact.
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by)
 select s.id,org.id,target,u.email,target_role,target_role,actor from public.stores s,auth.users u where s.organization_id=org.id and s.is_active and u.id=target
 on conflict(store_id,user_id) do update set is_active=true,updated_at=now(),assigned_by=actor;
 update public.organization_members set can_manage_business=true,is_owner=true where organization_id=org.id and user_id=target;
 update public.store_memberships set can_manage_business=true where organization_id=org.id and user_id=target;
 update public.store_memberships set can_manage_business=keep_admin where organization_id=org.id and user_id=actor;
 update public.organizations set owner_user_id=target,updated_at=now() where id=org.id;
 update public.organization_members set can_manage_business=keep_admin,is_owner=false where organization_id=org.id and user_id=actor;
 return jsonb_build_object('id',org.id,'previous',old,'value',jsonb_build_object('responsible_user_id',target,'previous_manager_retained',keep_admin,'work_role',target_role,'store_id',p_store));
end $function$;
