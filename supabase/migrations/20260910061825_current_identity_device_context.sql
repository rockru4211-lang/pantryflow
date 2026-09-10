CREATE OR REPLACE FUNCTION private.app_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare result jsonb;begin
 if exists(select 1 from public.stores s join public.organization_members om on om.organization_id=s.organization_id and om.user_id=auth.uid() and om.is_active where s.is_active and (om.is_owner or exists(select 1 from public.store_memberships sm where sm.store_id=s.id and sm.user_id=auth.uid() and sm.is_active)) and not private.app_session_valid(s.id)) then raise exception 'AUTH_REAUTH_REQUIRED' using errcode='42501';end if;
 
 select jsonb_build_object('user_id',auth.uid(),'stores',coalesce((select jsonb_agg(jsonb_build_object(
 'id',s.id,'organization_id',s.organization_id,'name',s.name,'store_code',s.store_code,'staff_login_mode',s.staff_login_mode,'login_identifier',(select sm.login_identifier from public.store_memberships sm where sm.store_id=s.id and sm.user_id=auth.uid() and sm.is_active),
 'business_type',coalesce(o.business_type::text,'SINGLE_RESTAURANT'),'has_erp',o.has_erp,'store_mode',o.store_mode,
 'role',private.app_role(s.id),'settings',coalesce(st.settings,'{}'::jsonb),
 'linked_store_count',(select count(*) from public.stores other where other.organization_id=s.organization_id and other.is_active),
 'settings_revision',coalesce(st.revision,0)) order by s.name)
 from public.stores s join public.organizations o on o.id=s.organization_id left join private.app_settings st on st.store_id=s.id
 where private.app_role(s.id) is not null),'[]'::jsonb))
 into result;return result;end $function$;

notify pgrst,'reload schema';
