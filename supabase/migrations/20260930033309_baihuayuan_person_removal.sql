-- Removing a person revokes store access; all identities, PINs and historical actors remain intact.
create table private.person_removals(
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 removed_by uuid not null references auth.users(id),
 removed_at timestamptz not null default now(),
 store_ids uuid[] not null,
 snapshot jsonb not null,
 primary key(organization_id,user_id)
);
alter table private.person_removals enable row level security;
revoke all on private.person_removals from public,anon,authenticated;
create function private.can_remove_baihuayuan_person(p_store uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.uid() is not null and p_user<>auth.uid() and private.can_manage_business(p_store) and private.can_manage_members(p_store)
 and exists(select 1 from public.stores s join public.organizations o on o.id=s.organization_id
 join public.organization_members om on om.organization_id=o.id and om.user_id=p_user
 where s.id=p_store and s.is_active and s.name in ('BeApe','Gras') and om.is_active and not om.is_owner and o.owner_user_id<>p_user and coalesce(om.work_role,om.role)<>'OWNER'
 and not exists(select 1 from public.store_memberships m where m.organization_id=o.id and m.user_id=p_user and (coalesce(m.work_role,m.role)='OWNER' or (m.is_active and not private.can_manage_business(m.store_id))))),false)
$$;
revoke all on function private.can_remove_baihuayuan_person(uuid,uuid) from public,anon,authenticated;
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
  result:=result||jsonb_build_array(p||jsonb_build_object('can_remove',private.can_remove_baihuayuan_person(p_store,target),
   'is_removed',exists(select 1 from private.person_removals r where r.organization_id=org and r.user_id=target) and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active),
   'removed_stores',coalesce((select snapshot->'stores' from private.person_removals where organization_id=org and user_id=target),'[]'::jsonb),
   'removal_stores',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'pending_count',(select count(*) from private.app_records ar where ar.store_id=s.id and ar.responsible_id=target and ar.status<>'COMPLETE'),
    'handoff_candidates',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m2.user_id,'display_name',si.display_name) order by si.display_name),'[]') from public.store_memberships m2 join public.staff_identities si on si.organization_id=m2.organization_id and si.user_id=m2.user_id where m2.store_id=s.id and m2.user_id<>target and private.member_active(s.id,m2.user_id) and private.can_edit_store(s.id,m2.user_id))) order by s.name)
    from public.store_memberships m join public.stores s on s.id=m.store_id where m.organization_id=org and m.user_id=target and m.is_active and private.can_manage_business(s.id)),'[]'::jsonb),
   'can_edit_functions',coalesce((p->>'can_manage_access')::boolean,false) and private.can_manage_business(p_store) and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not private.can_manage_business(m.store_id)),'work_functions',private.person_work_functions(org,target),'default_store_id',(select default_store_id from private.person_work_access where organization_id=org and user_id=target),'revision',private.baihuayuan_person_revision(org,target),'can_edit_profile',editable,'allowed_titles',titles,'access_store_ids',access_ids,
   'can_grant_export',editable and not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not private.has_app_feature(m.store_id,'DATA_EXPORT'))));
 end loop;
 return data||jsonb_build_object('partners',result);
end $function$
;

create function private.remove_person_access(p_store uuid,p_user uuid,p_revision text,p_handoffs jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
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
 if not private.can_remove_baihuayuan_person(p_store,p_user) or exists(select 1 from private.person_removals r,unnest(r.store_ids) s where r.organization_id=org and r.user_id=p_user and not private.can_manage_business(s)) then raise exception 'STORE_ACCESS_OUT_OF_SCOPE' using errcode='42501';end if;
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
end $$;
revoke all on function private.remove_person_access(uuid,uuid,text,jsonb,uuid) from public,anon;
grant execute on function private.remove_person_access(uuid,uuid,text,jsonb,uuid) to authenticated;
create function public.remove_person_access(p_store_id uuid,p_user_id uuid,p_revision text,p_handoffs jsonb,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.remove_person_access(p_store_id,p_user_id,p_revision,p_handoffs,p_request_id)$$;
revoke all on function public.remove_person_access(uuid,uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.remove_person_access(uuid,uuid,text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
