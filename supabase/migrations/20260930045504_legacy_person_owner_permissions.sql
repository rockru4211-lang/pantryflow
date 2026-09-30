-- Current ownership flags and active store roles protect owners. Legacy organization
-- roles and inactive store memberships are history, not current ownership.
-- No personnel, PIN, membership, or historical records are modified.
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
  and o.owner_user_id<>p_user and not om.is_owner
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

CREATE OR REPLACE FUNCTION private.can_remove_baihuayuan_person(p_store uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(auth.uid() is not null and p_user<>auth.uid() and private.can_administer_people(p_store) and private.can_manage_members(p_store)
 and exists(select 1 from public.stores s join public.organizations o on o.id=s.organization_id
 join public.organization_members om on om.organization_id=o.id and om.user_id=p_user
 where s.id=p_store and s.is_active and s.name in ('BeApe','Gras') and om.is_active and not om.is_owner and o.owner_user_id<>p_user
 -- Removing a system manager needs the same authority as editing their functions.
 and ('MANAGE'<>all(private.person_work_functions(o.id,p_user)) or (
  private.can_manage_business(p_store) and not exists(
   select 1 from public.store_memberships managed where managed.organization_id=o.id
   and managed.user_id=p_user and managed.is_active and not private.can_manage_business(managed.store_id))))
 and not exists(select 1 from public.store_memberships m where m.organization_id=o.id and m.user_id=p_user and m.is_active and (coalesce(m.work_role,m.role)='OWNER' or not private.can_administer_people(m.store_id)))),false)
$function$;
