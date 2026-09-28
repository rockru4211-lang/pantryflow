-- One settings form, with the existing role and store authorization boundaries.
create function private.baihuayuan_person_revision(p_org uuid,p_user uuid) returns text
language sql stable security invoker set search_path='' as $$
 select md5(jsonb_build_object(
  'identity',(select to_jsonb(s) from public.staff_identities s where s.organization_id=p_org and s.user_id=p_user),
  'member',(select to_jsonb(m) from public.organization_members m where m.organization_id=p_org and m.user_id=p_user),
  'stores',(select coalesce(jsonb_agg(to_jsonb(m) order by m.store_id),'[]') from public.store_memberships m where m.organization_id=p_org and m.user_id=p_user)
 )::text)
$$;
revoke all on function private.baihuayuan_person_revision(uuid,uuid) from public,anon,authenticated;

create function private.baihuayuan_people(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
  result:=result||jsonb_build_array(p||jsonb_build_object('revision',private.baihuayuan_person_revision(org,target),'can_edit_profile',editable,'allowed_titles',titles,'access_store_ids',access_ids,
   'can_grant_export',editable and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not private.has_app_feature(m.store_id,'DATA_EXPORT'))));
 end loop;
 return data||jsonb_build_object('partners',result);
end $$;
revoke all on function private.baihuayuan_people(uuid) from public,anon;
grant execute on function private.baihuayuan_people(uuid) to authenticated;
create function public.get_baihuayuan_people(p_store_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.baihuayuan_people(p_store_id)$$;
revoke all on function public.get_baihuayuan_people(uuid) from public,anon;
grant execute on function public.get_baihuayuan_people(uuid) to authenticated;

create function private.save_baihuayuan_person(p_store uuid,p_user uuid,p_revision text,p_profile jsonb,p_access jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; person jsonb; before_state jsonb; after_state jsonb; payload jsonb; cached private.app_requests;
 item jsonb; m public.store_memberships; title text; old_title text; next_role text; mode text; store_ids uuid[]; result jsonb;
begin
 if auth.uid() is null or not private.can_manage_member_store_access(p_store,p_user) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_request is null or p_access is null or jsonb_typeof(p_access)<>'array' then raise exception 'INVALID_STORE_ACCESS' using errcode='22023';end if;
 select organization_id into org from public.stores where id=p_store;
 perform pg_advisory_xact_lock(hashtextextended(org::text||p_user::text,927));
 -- Lock the existing source rows too: legacy profile editors use row locks.
 perform 1 from public.organization_members where organization_id=org and user_id=p_user for update;
 perform 1 from public.staff_identities where organization_id=org and user_id=p_user for update;
 perform 1 from public.store_memberships where organization_id=org and user_id=p_user order by store_id for update;
 select value into person from jsonb_array_elements(private.baihuayuan_people(p_store)->'partners') where value->>'user_id'=p_user::text;
 if person is null then raise exception 'MEMBER_NOT_FOUND' using errcode='42501';end if;
 if p_profile is not null and not (person->>'can_edit_profile')::boolean then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 for item in select value from jsonb_array_elements(p_access) loop
  if not coalesce(person->'access_store_ids' ? (item->>'store_id'),false) then raise exception 'STORE_ACCESS_OUT_OF_SCOPE' using errcode='42501';end if;
 end loop;
 payload:=jsonb_build_object('user',p_user,'revision',p_revision,'profile',p_profile,'access',p_access);
 select * into cached from private.app_requests where store_id=p_store and request_id=p_request for update;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'person.settings' or cached.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='40001';end if;
  return cached.result;
 end if;
 if person->>'revision' is distinct from p_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 before_state:=person;
 if p_profile is not null then
  if jsonb_typeof(p_profile)<>'object' or length(btrim(coalesce(p_profile->>'display_name',''))) not between 1 and 80
   or coalesce(p_profile->>'export_mode','') not in ('KEEP','ALLOW','REMOVE') then raise exception 'INVALID_MEMBER' using errcode='22023';end if;
  title:=p_profile->>'title';
  old_title:=case when (person->>'company_member')::boolean then person->>'company_title' else
    case when (select count(distinct x->>'role') from jsonb_array_elements(person->'stores') x)>1 then '依各店設定'
    when coalesce(person->'stores'->0->>'role',person->>'role')='SUPERVISOR' then '主管' else '員工' end end;
  if title is null or (title is distinct from old_title and not(person->'allowed_titles' ? title)) then raise exception 'ROLE_NOT_ALLOWED' using errcode='42501';end if;
  if p_profile->>'export_mode'<>'KEEP' and not (person->>'company_member')::boolean then raise exception 'FEATURE_NOT_ALLOWED' using errcode='42501';end if;
 end if;
 -- All steps share this transaction; any failed role or store validation rolls back everything.
 if jsonb_array_length(p_access)>0 then perform public.save_baihuayuan_member_store_access(p_store,p_user,p_access);end if;
 if p_profile is not null then
  if exists(select 1 from public.store_memberships scope_member where scope_member.organization_id=org and scope_member.user_id=p_user and scope_member.is_active and not private.can_manage_business(scope_member.store_id)) then raise exception 'STORE_ACCESS_OUT_OF_SCOPE' using errcode='42501';end if;
  if title is distinct from old_title then
   if (person->>'company_member')::boolean then
    select array_agg(store_id) into store_ids from public.store_memberships where organization_id=org and user_id=p_user and is_active;
    perform public.save_baihuayuan_company_partner(p_store,p_user,p_profile->>'display_name',title,store_ids,'{}');
    -- Retain each store's existing optional export setting; never spread one store's grant to another.
    for item in select value from jsonb_array_elements(before_state->'stores') loop
     if item->'extra_permissions' ? 'DATA_EXPORT' then update public.store_memberships set extra_permissions=array_append(extra_permissions,'DATA_EXPORT') where store_id=(item->>'id')::uuid and user_id=p_user and is_active and not('DATA_EXPORT'=any(extra_permissions));end if;
    end loop;
   else
    next_role:=case title when '主管' then 'SUPERVISOR' when '員工' then 'STAFF' end;
    for m in select * from public.store_memberships where organization_id=org and user_id=p_user and is_active order by store_id loop
     perform private.app_member_operation(m.store_id,'member.save',jsonb_build_object('user_id',p_user,'updated_at',m.updated_at,'role',next_role,'login_identifier',m.login_identifier,'is_active',true));
    end loop;
    update public.organization_members set role=next_role::public.app_role,work_role=next_role::public.app_role where organization_id=org and user_id=p_user;
   end if;
  end if;
  update public.staff_identities set display_name=btrim(p_profile->>'display_name'),updated_at=now() where organization_id=org and user_id=p_user;
  update public.store_memberships set display_name=btrim(p_profile->>'display_name'),updated_at=now() where organization_id=org and user_id=p_user and is_active;
  mode:=p_profile->>'export_mode';
  if mode<>'KEEP' then
   for m in select * from public.store_memberships where organization_id=org and user_id=p_user and is_active loop
    if mode='ALLOW' and not private.has_app_feature(m.store_id,'DATA_EXPORT') then raise exception 'FEATURE_NOT_ALLOWED' using errcode='42501';end if;
    update public.store_memberships set extra_permissions=case when mode='REMOVE' then array_remove(extra_permissions,'DATA_EXPORT') when 'DATA_EXPORT'=any(extra_permissions) then extra_permissions else array_append(extra_permissions,'DATA_EXPORT') end,updated_at=now() where store_id=m.store_id and user_id=p_user;
   end loop;
  end if;
 end if;
 after_state:=private.baihuayuan_people(p_store);
 select value into person from jsonb_array_elements(after_state->'partners') where value->>'user_id'=p_user::text;
 result:=jsonb_build_object('saved',true,'person',person);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store,p_request,auth.uid(),'person.settings',payload,result);
 insert into public.audit_logs(organization_id,store_id,user_id,entity_type,entity_id,action,old_value,new_value) values(org,p_store,auth.uid(),'partner',p_user::text,'PERSON_SETTINGS_UPDATED',before_state,person);
 return result;
end $$;
revoke all on function private.save_baihuayuan_person(uuid,uuid,text,jsonb,jsonb,uuid) from public,anon;
grant execute on function private.save_baihuayuan_person(uuid,uuid,text,jsonb,jsonb,uuid) to authenticated;
create function public.save_baihuayuan_person(p_store_id uuid,p_user_id uuid,p_revision text,p_profile jsonb,p_access jsonb,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.save_baihuayuan_person(p_store_id,p_user_id,p_revision,p_profile,p_access,p_request_id)$$;
revoke all on function public.save_baihuayuan_person(uuid,uuid,text,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.save_baihuayuan_person(uuid,uuid,text,jsonb,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
