-- Personnel administration is part of OFFICE; system/store administration stays separate.
create or replace function private.can_administer_people(p_store uuid,p_actor uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $function$
 select private.can_manage_business(p_store,p_actor) or coalesce(exists(
  select 1 from public.stores s join public.organizations o on o.id=s.organization_id
  where s.id=p_store and s.is_active and s.name in ('BeApe','Gras')
  and o.business_type::text='SINGLE_RESTAURANT' and private.can_edit_store(s.id,p_actor)
  and 'OFFICE'=any(private.person_work_functions(s.organization_id,p_actor))
 ),false)
$function$;
revoke all on function private.can_administer_people(uuid,uuid) from public,anon,authenticated;


CREATE OR REPLACE FUNCTION private.can_manage_members(p_store uuid, p_actor uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select private.can_administer_people(p_store,p_actor) or (private.can_edit_store(p_store,p_actor)
 and exists(select 1 from public.store_memberships sm where sm.store_id=p_store
 and sm.user_id=p_actor and coalesce(sm.work_role,sm.role) in ('SUPERVISOR','ADMIN')))
$function$;

CREATE OR REPLACE FUNCTION private.assignable_member_roles(p_store uuid, p_actor uuid DEFAULT auth.uid())
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when not private.can_manage_members(p_store,p_actor) then '{}'::text[]
 when coalesce(sm.work_role,sm.role)='OWNER' then array['STAFF','SUPERVISOR','LOGISTICS','OWNER']
 when not private.can_manage_business(p_store,p_actor) and private.can_administer_people(p_store,p_actor) then array['STAFF','SUPERVISOR','LOGISTICS']
 when not private.can_manage_business(p_store,p_actor) then array['STAFF']
 when coalesce(sm.work_role,sm.role)='LOGISTICS' and o.business_type::text='SINGLE_RESTAURANT' then array['STAFF','LOGISTICS']
 else array['STAFF','SUPERVISOR','LOGISTICS'] end
 from public.store_memberships sm join public.stores s on s.id=sm.store_id join public.organizations o on o.id=s.organization_id where sm.store_id=p_store and sm.user_id=p_actor
$function$;

CREATE OR REPLACE FUNCTION private.can_manage_member_store_access(p_store uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and (coalesce(source.work_role,source.role)='STAFF' or private.can_administer_people(source.store_id)))
  and (coalesce((select coalesce(sm.work_role,sm.role) from public.store_memberships sm
       where sm.store_id=p_store and sm.user_id=p_user),coalesce(om.work_role,om.role))='STAFF'
       or private.can_administer_people(p_store))
 ),false)
$function$;

CREATE OR REPLACE FUNCTION public.save_baihuayuan_member_store_access(p_store_id uuid, p_user_id uuid, p_access jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 and (coalesce(sm.work_role,sm.role)='STAFF' or private.can_administer_people(sm.store_id))
 order by (sm.store_id=p_store_id) desc,sm.created_at,sm.store_id limit 1;
 if source.user_id is null then raise exception 'MEMBER_NOT_FOUND' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(sm) order by sm.store_id),'[]') into before_state
 from public.store_memberships sm where sm.organization_id=v_org and sm.user_id=p_user_id;
 -- Validate the complete patch before mutating any row.
 for item in select value from jsonb_array_elements(p_access) loop
  target:=(item->>'store_id')::uuid;
  if not exists(select 1 from public.stores s where s.id=target and s.organization_id=v_org)
   or not private.can_manage_member_store_access(target,p_user_id)
   or (coalesce(source.work_role,source.role)<>'STAFF' and not private.can_administer_people(target)) then
   raise exception 'STORE_ACCESS_OUT_OF_SCOPE' using errcode='42501';
  end if;
 end loop;
 for item in select value from jsonb_array_elements(p_access) loop
  target:=(item->>'store_id')::uuid;mode:=item->>'access_mode';
  select * into existing from public.store_memberships where store_id=target and user_id=p_user_id for update;
  if mode<>'NONE' and coalesce(existing.can_manage_business,false) and not private.can_manage_business(target) then raise exception 'SYSTEM_PERMISSION_REQUIRED' using errcode='42501';end if;
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
end $function$;

CREATE OR REPLACE FUNCTION private.can_remove_baihuayuan_person(p_store uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(auth.uid() is not null and p_user<>auth.uid() and private.can_administer_people(p_store) and private.can_manage_members(p_store)
 and exists(select 1 from public.stores s join public.organizations o on o.id=s.organization_id
 join public.organization_members om on om.organization_id=o.id and om.user_id=p_user
 where s.id=p_store and s.is_active and s.name in ('BeApe','Gras') and om.is_active and not om.is_owner and o.owner_user_id<>p_user and coalesce(om.work_role,om.role)<>'OWNER'
 and not exists(select 1 from public.store_memberships m where m.organization_id=o.id and m.user_id=p_user and (coalesce(m.work_role,m.role)='OWNER' or (m.is_active and not private.can_administer_people(m.store_id))))),false)
$function$;

CREATE OR REPLACE FUNCTION private.remove_person_access(p_store uuid, p_user uuid, p_revision text, p_handoffs jsonb, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid; person jsonb; cached private.app_requests; payload jsonb; result jsonb; member public.store_memberships; item jsonb; successor uuid; scope_ids uuid[];
begin
 if not private.can_remove_baihuayuan_person(p_store,p_user) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_request is null or p_handoffs is null or jsonb_typeof(p_handoffs)<>'array' then raise exception 'INVALID_HANDOFF' using errcode='22023';end if;
 select organization_id into org from public.stores where id=p_store;
 perform pg_advisory_xact_lock(hashtextextended(org::text||p_user::text,927));
 perform 1 from public.organization_members where organization_id=org and user_id=p_user for update;
 perform 1 from public.staff_identities where organization_id=org and user_id=p_user for update;
 perform 1 from public.store_memberships where organization_id=org and user_id=p_user order by store_id for update;
 -- Recheck after locks, including the original scopes of a repeated removal.
 if not private.can_remove_baihuayuan_person(p_store,p_user) or exists(select 1 from private.person_removals r,unnest(r.store_ids) s where r.organization_id=org and r.user_id=p_user and not private.can_administer_people(s)) then raise exception 'STORE_ACCESS_OUT_OF_SCOPE' using errcode='42501';end if;
 payload:=jsonb_build_object('user',p_user,'revision',p_revision,'handoffs',p_handoffs);
 select * into cached from private.app_requests where store_id=p_store and request_id=p_request for update;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'person.remove' or cached.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='40001';end if;
  return cached.result;
 end if;
 select value into person from jsonb_array_elements(private.baihuayuan_people(p_store)->'partners') where value->>'user_id'=p_user::text;
 if person is null then raise exception 'MEMBER_NOT_FOUND' using errcode='42501';end if;
 if person->>'revision' is distinct from p_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 if coalesce((person->>'is_removed')::boolean,false) then raise exception 'MEMBER_NOT_FOUND' using errcode='42501';end if;
 if (select count(distinct x->>'store_id') from jsonb_array_elements(p_handoffs) x)<>jsonb_array_length(p_handoffs) then raise exception 'INVALID_HANDOFF' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_handoffs) loop
  if not exists(select 1 from public.store_memberships m where m.store_id=(item->>'store_id')::uuid and m.organization_id=org and m.user_id=p_user and m.is_active) then raise exception 'INVALID_HANDOFF' using errcode='22023';end if;
 end loop;
 select coalesce(array_agg(store_id),'{}'::uuid[]) into scope_ids from public.store_memberships where organization_id=org and user_id=p_user and is_active;
 for member in select * from public.store_memberships where organization_id=org and user_id=p_user and is_active order by store_id loop
  select nullif(x->>'user_id','')::uuid into successor from jsonb_array_elements(p_handoffs) x where x->>'store_id'=member.store_id::text;
  if successor is not null and (successor=p_user or not private.member_active(member.store_id,successor) or not private.can_edit_store(member.store_id,successor)) then raise exception 'INVALID_RESPONSIBLE' using errcode='22023';end if;
  if successor is null and exists(select 1 from private.app_records where store_id=member.store_id and responsible_id=p_user and status<>'COMPLETE') then raise exception 'HANDOFF_REQUIRED' using errcode='22023';end if;
  insert into private.app_record_events(record_id,actor_id,action,note,snapshot)
   select id,auth.uid(),'HANDOFF','移除人員交接',jsonb_build_object('previous_responsible',p_user,'responsible_id',successor) from private.app_records where store_id=member.store_id and responsible_id=p_user and status<>'COMPLETE';
  update private.app_records set responsible_id=successor,revision=revision+1,updated_at=now() where store_id=member.store_id and responsible_id=p_user and status<>'COMPLETE';
 end loop;
 update public.store_memberships set is_active=false,updated_at=now() where organization_id=org and user_id=p_user and is_active;
 update private.app_delegations set revoked_at=now() where user_id=p_user and store_id=any(scope_ids) and revoked_at is null;
 update private.management_invites set status='CANCELLED' where organization_id=org and user_id=p_user and status='PENDING';
 insert into private.person_removals(organization_id,user_id,removed_by,store_ids,snapshot) values(org,p_user,auth.uid(),scope_ids,person)
 on conflict(organization_id,user_id) do update set removed_by=excluded.removed_by,removed_at=now(),store_ids=excluded.store_ids,snapshot=excluded.snapshot;
 result:=jsonb_build_object('removed',true,'user_id',p_user);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store,p_request,auth.uid(),'person.remove',payload,result);
 insert into public.audit_logs(organization_id,store_id,user_id,entity_type,entity_id,action,old_value,new_value) values(org,p_store,auth.uid(),'partner',p_user::text,'PERSON_ACCESS_REMOVED',person,result||jsonb_build_object('handoffs',p_handoffs));
 return result;
end $function$;

CREATE OR REPLACE FUNCTION private.baihuayuan_people(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare data jsonb; result jsonb:='[]'; p jsonb; target uuid; org uuid; editable boolean; titles jsonb; access_ids jsonb;
begin
 data:=public.get_baihuayuan_partners(p_store);
 select organization_id into org from public.stores where id=p_store;
 for p in select value from jsonb_array_elements(data->'partners') loop
  target:=(p->>'user_id')::uuid;
  editable:=coalesce((p->>'can_manage_access')::boolean,false) and private.can_administer_people(p_store)
   and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not private.can_administer_people(m.store_id));
  if not (p->>'company_member')::boolean then
   editable:=editable and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not(coalesce(m.work_role,m.role)::text=any(private.assignable_member_roles(m.store_id))));
  end if;
  titles:='[]';
  if editable then
   if (p->>'company_member')::boolean then titles:='["營運","行政","財務"]';
   else select coalesce(jsonb_agg(t.title order by t.role),'[]') into titles from (values('STAFF','員工'),('SUPERVISOR','主管'))t(role,title)
    where not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not(t.role=any(private.assignable_member_roles(m.store_id))));end if;
  end if;
  select coalesce(jsonb_agg(s.id order by s.name),'[]') into access_ids from public.stores s
   where s.organization_id=org and s.is_active and s.name in ('BeApe','Gras') and private.can_manage_member_store_access(s.id,target);
  result:=result||jsonb_build_array(p||jsonb_build_object('can_remove',private.can_remove_baihuayuan_person(p_store,target),
   'is_removed',exists(select 1 from private.person_removals r where r.organization_id=org and r.user_id=target) and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active),
   'removed_stores',coalesce((select snapshot->'stores' from private.person_removals where organization_id=org and user_id=target),'[]'::jsonb),
   'removal_stores',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'pending_count',(select count(*) from private.app_records ar where ar.store_id=s.id and ar.responsible_id=target and ar.status<>'COMPLETE'),
    'handoff_candidates',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m2.user_id,'display_name',si.display_name) order by si.display_name),'[]') from public.store_memberships m2 join public.staff_identities si on si.organization_id=m2.organization_id and si.user_id=m2.user_id where m2.store_id=s.id and m2.user_id<>target and private.member_active(s.id,m2.user_id) and private.can_edit_store(s.id,m2.user_id))) order by s.name)
    from public.store_memberships m join public.stores s on s.id=m.store_id where m.organization_id=org and m.user_id=target and m.is_active and private.can_administer_people(s.id)),'[]'::jsonb),
   'can_edit_functions',('MANAGE'<>all(private.person_work_functions(org,target)) or (private.can_manage_business(p_store) and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not private.can_manage_business(m.store_id)))) and coalesce((p->>'can_manage_access')::boolean,false) and private.can_administer_people(p_store) and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not private.can_administer_people(m.store_id)),'work_functions',private.person_work_functions(org,target),'default_store_id',(select default_store_id from private.person_work_access where organization_id=org and user_id=target),'revision',private.baihuayuan_person_revision(org,target),'can_edit_profile',editable,'allowed_titles',titles,'access_store_ids',access_ids,
   'can_grant_export',editable and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not private.has_app_feature(m.store_id,'DATA_EXPORT'))));
 end loop;
 return data||jsonb_build_object('partners',result);
end $function$;

CREATE OR REPLACE FUNCTION private.save_person_function_access(p_store uuid, p_user uuid, p_revision text, p_name text, p_stores jsonb, p_functions text[], p_default uuid, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid; person jsonb; before_state jsonb; payload jsonb; cached private.app_requests; result jsonb; changes jsonb:='[]'; item jsonb; sm public.store_memberships; target_role public.app_role; funcs text[];
begin
 if auth.uid() is null or not private.can_administer_people(p_store) or not private.can_manage_member_store_access(p_store,p_user) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into org from public.stores where id=p_store;
 if p_request is null or p_name is null or length(btrim(p_name)) not between 1 and 80 or p_stores is null or jsonb_typeof(p_stores)<>'array' or jsonb_array_length(p_stores)=0
 or p_functions is null or not(p_functions <@ array['FIELD','OFFICE','MANAGE']::text[]) or not(p_functions && array['FIELD','OFFICE']::text[]) or array_position(p_functions,null) is not null then raise exception 'INVALID_FUNCTION_ACCESS' using errcode='22023';end if;
 select array_agg(distinct x order by x) into funcs from unnest(p_functions) x;
 perform pg_advisory_xact_lock(hashtextextended(org::text||p_user::text,927));
 perform 1 from public.organization_members where organization_id=org and user_id=p_user for update;
 perform 1 from public.staff_identities where organization_id=org and user_id=p_user for update;
 perform 1 from public.store_memberships where organization_id=org and user_id=p_user order by store_id for update;
 -- A global person setting may only be changed by a manager of every affected store.
 if exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=p_user and m.is_active and not private.can_administer_people(m.store_id)) then raise exception 'STORE_ACCESS_OUT_OF_SCOPE' using errcode='42501';end if;
 for item in select value from jsonb_array_elements(p_stores) loop
  if coalesce(item->>'access_mode','') not in ('EDIT','VIEW') or not exists(select 1 from public.stores s where s.id=(item->>'store_id')::uuid and s.organization_id=org and s.is_active and s.name in ('BeApe','Gras') and private.can_administer_people(s.id) and private.can_manage_member_store_access(s.id,p_user)) then raise exception 'STORE_ACCESS_OUT_OF_SCOPE' using errcode='42501';end if;
 end loop;
 if (select count(distinct x->>'store_id') from jsonb_array_elements(p_stores) x)<>jsonb_array_length(p_stores) or p_default is null or not exists(select 1 from jsonb_array_elements(p_stores) x where x->>'store_id'=p_default::text) then raise exception 'INVALID_DEFAULT_STORE' using errcode='22023';end if;
 payload:=jsonb_build_object('user',p_user,'revision',p_revision,'name',p_name,'stores',p_stores,'functions',funcs,'default',p_default);
 select * into cached from private.app_requests where store_id=p_store and request_id=p_request for update;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'person.functions' or cached.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='40001';end if;
  return cached.result;
 end if;
 select value into person from jsonb_array_elements(private.baihuayuan_people(p_store)->'partners') where value->>'user_id'=p_user::text;
 if person is null then raise exception 'MEMBER_NOT_FOUND' using errcode='42501';end if;
 if person->>'revision' is distinct from p_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 -- OFFICE cannot grant, remove or redistribute system administration.
 if ('MANAGE'=any(funcs) or 'MANAGE'=any(private.person_work_functions(org,p_user)))
 and (not private.can_manage_business(p_store)
  or exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=p_user and m.is_active and not private.can_manage_business(m.store_id))
  or exists(select 1 from jsonb_array_elements(p_stores) x where not private.can_manage_business((x->>'store_id')::uuid)))
 then raise exception 'SYSTEM_PERMISSION_REQUIRED' using errcode='42501';end if;
 before_state:=person;
 for item in select value from jsonb_array_elements(p_stores) loop
  if not exists(select 1 from public.store_memberships m where m.store_id=(item->>'store_id')::uuid and m.user_id=p_user and m.is_active and m.access_mode=item->>'access_mode') then changes:=changes||jsonb_build_array(item);end if;
 end loop;
 for sm in select * from public.store_memberships where organization_id=org and user_id=p_user and is_active loop
  if not exists(select 1 from jsonb_array_elements(p_stores) x where x->>'store_id'=sm.store_id::text) then changes:=changes||jsonb_build_array(jsonb_build_object('store_id',sm.store_id,'access_mode','NONE'));end if;
 end loop;
 if jsonb_array_length(changes)>0 then perform public.save_baihuayuan_member_store_access(p_store,p_user,changes);end if;
 target_role:=case when 'OFFICE'=any(funcs) then 'LOGISTICS'::public.app_role when 'MANAGE'=any(funcs) then 'SUPERVISOR'::public.app_role else 'STAFF'::public.app_role end;
 update public.organization_members set role=target_role,work_role=target_role,can_manage_business=('MANAGE'=any(funcs)) where organization_id=org and user_id=p_user;
 update public.store_memberships set role=target_role,work_role=target_role,can_manage_business=('MANAGE'=any(funcs)),display_name=btrim(p_name),updated_at=now() where organization_id=org and user_id=p_user and is_active;
 update public.staff_identities set display_name=btrim(p_name),job_title=case when 'OFFICE'=any(funcs) then '行政' else '現場人員' end,updated_at=now() where organization_id=org and user_id=p_user;
 update public.profiles set display_name=btrim(p_name) where id=p_user;
 insert into private.person_work_access values(org,p_user,funcs,p_default) on conflict(organization_id,user_id) do update set work_functions=excluded.work_functions,default_store_id=excluded.default_store_id;
 select value into person from jsonb_array_elements(private.baihuayuan_people(p_store)->'partners') where value->>'user_id'=p_user::text;
 result:=jsonb_build_object('saved',true,'person',person);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store,p_request,auth.uid(),'person.functions',payload,result);
 insert into public.audit_logs(organization_id,store_id,user_id,entity_type,entity_id,action,old_value,new_value) values(org,p_store,auth.uid(),'partner',p_user::text,'PERSON_FUNCTIONS_UPDATED',before_state,person);
 return result;
end $function$;

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
 'role',coalesce(private.app_role(s.id),private.store_scope_role(s.id)),'access_mode',coalesce((select sm.access_mode from public.store_memberships sm where sm.store_id=s.id and sm.user_id=auth.uid()),'VIEW'),'work_functions',private.person_work_functions(s.organization_id,auth.uid()),'default_store_id',(select default_store_id from private.person_work_access where organization_id=s.organization_id and user_id=auth.uid()),'company_title',(select si.job_title from public.staff_identities si where si.organization_id=s.organization_id and si.user_id=auth.uid()),'can_manage_business',private.can_manage_business(s.id),'can_manage_stores',private.can_manage_store_scope(s.id),'can_manage_members',private.can_manage_members(s.id),'can_administer_people',private.can_administer_people(s.id),'assignable_roles',private.assignable_member_roles(s.id),'is_business_responsible',o.owner_user_id=auth.uid(),'permissions',jsonb_build_object('reports_view',private.has_app_feature(s.id,'REPORTS_VIEW'),'data_export',private.has_app_feature(s.id,'DATA_EXPORT')),'settings',coalesce(st.settings,'{}'::jsonb),
 'linked_store_count',(select count(*) from public.stores other where other.organization_id=s.organization_id and other.is_active),
 'settings_revision',coalesce(st.revision,0)) order by s.name)
 from public.stores s join public.organizations o on o.id=s.organization_id left join private.app_settings st on st.store_id=s.id
 where private.app_role(s.id) is not null or (not exists(select 1 from public.stores live where private.app_role(live.id) is not null) and private.store_scope_role(s.id) is not null)),'[]'::jsonb))
 into result;return result;end $function$;

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
 if not private.can_administer_people(p_store) and (v_member.role<>'STAFF' or p_action='member.assign' or coalesce(p_data->>'role','STAFF')<>'STAFF') then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
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

CREATE OR REPLACE FUNCTION public.prepare_management_invite(p_store_id uuid, p_actor uuid, p_email text, p_name text, p_role app_role)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_org uuid; i private.management_invites; v_user uuid; v_confirmed boolean; send_mail boolean;
begin
 if not private.can_administer_people(p_store_id,p_actor) then raise exception 'BUSINESS_ADMIN_REQUIRED' using errcode='42501';end if;
 if not coalesce(p_role::text=any(private.assignable_member_roles(p_store_id,p_actor)),false) then raise exception 'ROLE_NOT_ALLOWED' using errcode='42501';end if;
 if p_role not in ('SUPERVISOR','LOGISTICS','OWNER') or p_role is null or length(btrim(coalesce(p_name,''))) not between 1 and 80 or length(coalesce(p_email,'')) not between 3 and 254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'INVALID_INVITE';end if;
 select organization_id into v_org from public.stores where id=p_store_id;
 p_email:=lower(btrim(p_email));
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_email,103));
 select id,email_confirmed_at is not null into v_user,v_confirmed from auth.users where lower(email)=p_email;
 if v_user=p_actor then raise exception 'CANNOT_INVITE_SELF';end if;
 if exists(select 1 from public.store_memberships where store_id=p_store_id and user_id=v_user) then
   raise exception 'MEMBER_ALREADY_ASSIGNED_USE_PERMISSIONS' using errcode='22023';
 end if;
 if exists(select 1 from public.organization_members where organization_id=v_org and user_id=v_user and not is_active)
 or exists(select 1 from public.staff_identities where organization_id=v_org and user_id=v_user and not is_active) then raise exception 'MEMBER_DISABLED' using errcode='42501';end if;
 select * into i from private.management_invites where store_id=p_store_id and email=p_email for update;
 if i.id is not null and i.status='PENDING' and i.expires_at>now() and i.role is distinct from p_role then raise exception 'INVITE_ROLE_CHANGED_CANCEL_FIRST' using errcode='22023';end if;
 if i.id is null then
  insert into private.management_invites(store_id,organization_id,email,display_name,role,requested_by,user_id)
  values(p_store_id,v_org,p_email,btrim(p_name),p_role,p_actor,v_user) returning * into i;
 elsif i.status<>'PENDING' or i.expires_at<=now() then
  update private.management_invites set status='PENDING',display_name=btrim(p_name),role=p_role,requested_by=p_actor,user_id=v_user,expires_at=now()+interval '7 days',joined_at=null,mail_state='NOT_SENT',mail_attempt_at=null,mail_error=null where id=i.id returning * into i;
 end if;
 send_mail:=i.mail_attempt_at is null or i.mail_attempt_at<now()-interval '60 seconds';
 if send_mail then
  update private.management_invites set mail_state='SENDING',mail_attempt_id=gen_random_uuid(),mail_attempt_at=now(),mail_error=null where id=i.id returning * into i;
 end if;
 return jsonb_build_object('invite_id',i.id,'user_id',v_user,'email_verified',coalesce(v_confirmed,false),'existing',v_user is not null,'send_mail',send_mail,'mail_state',i.mail_state,'mail_attempt_id',i.mail_attempt_id);
end $function$;
