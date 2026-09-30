-- Additive configuration. Existing identities and PIN credentials are not rewritten.
create table private.person_work_access (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 work_functions text[] not null check (cardinality(work_functions)>0 and work_functions <@ array['FIELD','OFFICE','MANAGE']::text[] and work_functions && array['FIELD','OFFICE']::text[]),
 default_store_id uuid not null references public.stores(id),
 primary key(organization_id,user_id)
);
revoke all on private.person_work_access from public,anon,authenticated;
create function private.person_work_functions(p_org uuid,p_user uuid) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce((select work_functions from private.person_work_access where organization_id=p_org and user_id=p_user),
 array['FIELD']::text[] || case when exists(select 1 from public.store_memberships where organization_id=p_org and user_id=p_user and is_active and coalesce(work_role,role) in ('OWNER','LOGISTICS')) then array['OFFICE']::text[] else '{}'::text[] end
 || case when exists(select 1 from public.store_memberships where organization_id=p_org and user_id=p_user and is_active and can_manage_business and coalesce(work_role,role)<>'STAFF') then array['MANAGE']::text[] else '{}'::text[] end)
$$;
revoke all on function private.person_work_functions(uuid,uuid) from public,anon,authenticated;
create or replace function private.baihuayuan_person_revision(p_org uuid,p_user uuid) returns text
language sql stable security invoker set search_path='' as $$
 select md5(jsonb_build_object(
  'functions',(select to_jsonb(f) from private.person_work_access f where f.organization_id=p_org and f.user_id=p_user),
  'identity',(select to_jsonb(s) from public.staff_identities s where s.organization_id=p_org and s.user_id=p_user),
  'member',(select to_jsonb(m) from public.organization_members m where m.organization_id=p_org and m.user_id=p_user),
  'stores',(select coalesce(jsonb_agg(to_jsonb(m) order by m.store_id),'[]') from public.store_memberships m where m.organization_id=p_org and m.user_id=p_user)
 )::text)
$$;

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
  editable:=coalesce((p->>'can_manage_access')::boolean,false) and private.can_manage_business(p_store)
   and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not private.can_manage_business(m.store_id));
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
  result:=result||jsonb_build_array(p||jsonb_build_object('can_edit_functions',coalesce((p->>'can_manage_access')::boolean,false) and private.can_manage_business(p_store) and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not private.can_manage_business(m.store_id)),'work_functions',private.person_work_functions(org,target),'default_store_id',(select default_store_id from private.person_work_access where organization_id=org and user_id=target),'revision',private.baihuayuan_person_revision(org,target),'can_edit_profile',editable,'allowed_titles',titles,'access_store_ids',access_ids,
   'can_grant_export',editable and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not private.has_app_feature(m.store_id,'DATA_EXPORT'))));
 end loop;
 return data||jsonb_build_object('partners',result);
end $function$
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
 'role',coalesce(private.app_role(s.id),private.store_scope_role(s.id)),'access_mode',coalesce((select sm.access_mode from public.store_memberships sm where sm.store_id=s.id and sm.user_id=auth.uid()),'VIEW'),'work_functions',private.person_work_functions(s.organization_id,auth.uid()),'default_store_id',(select default_store_id from private.person_work_access where organization_id=s.organization_id and user_id=auth.uid()),'company_title',(select si.job_title from public.staff_identities si where si.organization_id=s.organization_id and si.user_id=auth.uid()),'can_manage_business',private.can_manage_business(s.id),'can_manage_stores',private.can_manage_store_scope(s.id),'can_manage_members',private.can_manage_members(s.id),'assignable_roles',private.assignable_member_roles(s.id),'is_business_responsible',o.owner_user_id=auth.uid(),'permissions',jsonb_build_object('reports_view',private.has_app_feature(s.id,'REPORTS_VIEW'),'data_export',private.has_app_feature(s.id,'DATA_EXPORT')),'settings',coalesce(st.settings,'{}'::jsonb),
 'linked_store_count',(select count(*) from public.stores other where other.organization_id=s.organization_id and other.is_active),
 'settings_revision',coalesce(st.revision,0)) order by s.name)
 from public.stores s join public.organizations o on o.id=s.organization_id left join private.app_settings st on st.store_id=s.id
 where private.app_role(s.id) is not null or (not exists(select 1 from public.stores live where private.app_role(live.id) is not null) and private.store_scope_role(s.id) is not null)),'[]'::jsonb))
 into result;return result;end $function$
;

create function private.save_person_function_access(p_store uuid,p_user uuid,p_revision text,p_name text,p_stores jsonb,p_functions text[],p_default uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; person jsonb; before_state jsonb; payload jsonb; cached private.app_requests; result jsonb; changes jsonb:='[]'; item jsonb; sm public.store_memberships; target_role public.app_role; funcs text[];
begin
 if auth.uid() is null or not private.can_manage_business(p_store) or not private.can_manage_member_store_access(p_store,p_user) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into org from public.stores where id=p_store;
 if p_request is null or p_name is null or length(btrim(p_name)) not between 1 and 80 or p_stores is null or jsonb_typeof(p_stores)<>'array' or jsonb_array_length(p_stores)=0
 or p_functions is null or not(p_functions <@ array['FIELD','OFFICE','MANAGE']::text[]) or not(p_functions && array['FIELD','OFFICE']::text[]) or array_position(p_functions,null) is not null then raise exception 'INVALID_FUNCTION_ACCESS' using errcode='22023';end if;
 select array_agg(distinct x order by x) into funcs from unnest(p_functions) x;
 perform pg_advisory_xact_lock(hashtextextended(org::text||p_user::text,927));
 perform 1 from public.organization_members where organization_id=org and user_id=p_user for update;
 perform 1 from public.staff_identities where organization_id=org and user_id=p_user for update;
 perform 1 from public.store_memberships where organization_id=org and user_id=p_user order by store_id for update;
 -- A global person setting may only be changed by a manager of every affected store.
 if exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=p_user and m.is_active and not private.can_manage_business(m.store_id)) then raise exception 'STORE_ACCESS_OUT_OF_SCOPE' using errcode='42501';end if;
 for item in select value from jsonb_array_elements(p_stores) loop
  if coalesce(item->>'access_mode','') not in ('EDIT','VIEW') or not exists(select 1 from public.stores s where s.id=(item->>'store_id')::uuid and s.organization_id=org and s.is_active and s.name in ('BeApe','Gras') and private.can_manage_business(s.id) and private.can_manage_member_store_access(s.id,p_user)) then raise exception 'STORE_ACCESS_OUT_OF_SCOPE' using errcode='42501';end if;
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
end $$;
revoke all on function private.save_person_function_access(uuid,uuid,text,text,jsonb,text[],uuid,uuid) from public,anon;
grant execute on function private.save_person_function_access(uuid,uuid,text,text,jsonb,text[],uuid,uuid) to authenticated;
create function public.save_person_function_access(p_store_id uuid,p_user_id uuid,p_revision text,p_name text,p_stores jsonb,p_functions text[],p_default_store_id uuid,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.save_person_function_access(p_store_id,p_user_id,p_revision,p_name,p_stores,p_functions,p_default_store_id,p_request_id) $$;
revoke all on function public.save_person_function_access(uuid,uuid,text,text,jsonb,text[],uuid,uuid) from public,anon;
grant execute on function public.save_person_function_access(uuid,uuid,text,text,jsonb,text[],uuid,uuid) to authenticated;

-- Resolve one person, then pass their existing login identifier to the unchanged PIN verifier.
-- Ambiguous names fail closed; no public roster or PIN probing across people.
create function public.resolve_staff_login(p_identifier text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare users uuid[]; result jsonb;
begin
 if length(btrim(coalesce(p_identifier,''))) not between 1 and 64 then return null;end if;
 select array_agg(distinct sm.user_id) into users from public.store_memberships sm
 join public.stores s on s.id=sm.store_id and s.is_active and s.name in ('BeApe','Gras')
 join public.organization_members om on om.organization_id=s.organization_id and om.user_id=sm.user_id and om.is_active
 join public.staff_identities si on si.organization_id=s.organization_id and si.user_id=sm.user_id and si.is_active
 where sm.is_active and (lower(btrim(p_identifier))=lower(sm.login_identifier) or lower(btrim(p_identifier))=lower(si.display_name));
 if coalesce(cardinality(users),0)<>1 then return null;end if;
 select jsonb_build_object('storeCode',s.store_code,'loginIdentifier',sm.login_identifier,'displayName',si.display_name) into result
 from public.store_memberships sm join public.stores s on s.id=sm.store_id and s.is_active and s.name in ('BeApe','Gras')
 join public.organization_members om on om.organization_id=s.organization_id and om.user_id=sm.user_id and om.is_active
 join public.staff_identities si on si.organization_id=s.organization_id and si.user_id=sm.user_id and si.is_active
 left join private.person_work_access f on f.organization_id=s.organization_id and f.user_id=sm.user_id
 where sm.user_id=users[1] and sm.is_active order by (s.id=f.default_store_id) desc nulls last,s.created_at,s.id limit 1;
 return result;
end $$;
revoke all on function public.resolve_staff_login(text) from public,anon,authenticated;
grant execute on function public.resolve_staff_login(text) to service_role;
notify pgrst,'reload schema';

-- Combined FIELD + OFFICE access can use the existing field endpoints without gaining supervisor privileges.
create or replace function private.has_active_store_role(p_store_id uuid,p_roles public.app_role[] default null::public.app_role[]) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.app_role(p_store_id) is not null and (p_roles is null or private.app_role(p_store_id)=any(p_roles::text[]) or (private.app_role(p_store_id)='OWNER' and 'ADMIN'=any(p_roles::text[]))
 or ('STAFF'=any(p_roles::text[]) and exists(select 1 from private.person_work_access f join public.stores s on s.organization_id=f.organization_id where s.id=p_store_id and f.user_id=auth.uid() and 'FIELD'=any(f.work_functions)))),false)
$$;
