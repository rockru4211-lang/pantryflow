-- Read-only PIN status added to the existing authorized personnel response.
-- Credentials, activation tokens and permission writes are unchanged.
CREATE OR REPLACE FUNCTION private.baihuayuan_people(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare data jsonb; result jsonb:='[]'; p jsonb; target uuid; org uuid; editable boolean; titles jsonb; access_ids jsonb;
begin
 if auth.uid() is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
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
  result:=result||jsonb_build_array(p||jsonb_build_object(
   -- Only status is returned. Never expose a PIN hash or activation token.
   'pin_status',case when exists(select 1 from private.staff_pin_credentials c where c.user_id=target) then 'SET'
    when exists(select 1 from private.staff_activation_tokens t where t.user_id=target) then 'UNSET' else 'OTHER' end,
   'pin_reset_store_id',(select m.store_id from public.store_memberships m
    where m.organization_id=org and m.user_id=target and m.is_active and private.member_active(m.store_id,target)
    and target<>auth.uid() and private.can_manage_members(m.store_id)
    and exists(select 1 from public.staff_identities si where si.organization_id=org and si.user_id=target and si.is_active)
    and (exists(select 1 from private.staff_pin_credentials c where c.user_id=target) or exists(select 1 from private.staff_activation_tokens t where t.user_id=target))
    and not exists(select 1 from public.organization_members om where om.user_id=target and om.is_owner)
    and not exists(select 1 from public.store_memberships scope_member where scope_member.user_id=target and scope_member.is_active
     and (not coalesce(coalesce(scope_member.work_role,scope_member.role)::text=any(private.assignable_member_roles(scope_member.store_id)),false)
       or (scope_member.can_manage_business and not private.can_manage_business(scope_member.store_id))))
    order by (m.store_id=p_store) desc,m.store_id limit 1),
   'can_remove',private.can_remove_baihuayuan_person(p_store,target),
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
revoke all on function private.baihuayuan_people(uuid) from public,anon;
grant execute on function private.baihuayuan_people(uuid) to authenticated;
notify pgrst,'reload schema';
