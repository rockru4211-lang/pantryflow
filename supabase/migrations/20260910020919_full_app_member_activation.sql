create function public.reset_staff_activation(p_user_id uuid,p_code text,p_actor uuid,p_store_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
 if p_actor=p_user_id or length(p_code)<32 or not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then raise exception 'ACTIVATION_NOT_ALLOWED'; end if;
 select s.organization_id into v_org from public.stores s join public.store_memberships m on m.store_id=s.id and m.user_id=p_actor
 join public.organization_members om on om.organization_id=s.organization_id and om.user_id=p_actor
 where s.id=p_store_id and s.is_active and m.is_active and om.is_active and (m.role in ('ADMIN','OWNER','SUPERVISOR') or exists(select 1 from private.app_delegations d where d.store_id=s.id and d.user_id=p_actor and d.revoked_at is null and now()>=d.starts_at and now()<d.ends_at));
 if v_org is null or not exists(select 1 from public.store_memberships target join public.organization_members om on om.organization_id=target.organization_id and om.user_id=target.user_id where target.store_id=p_store_id and target.user_id=p_user_id and target.is_active and om.is_active and not om.is_owner
  and (target.role='STAFF' or exists(select 1 from public.store_memberships m join public.organization_members own on own.organization_id=m.organization_id and own.user_id=m.user_id where m.store_id=p_store_id and m.user_id=p_actor and m.is_active and own.is_active and (m.role='OWNER' or own.is_owner)))) then raise exception 'ACTIVATION_NOT_ALLOWED'; end if;
 delete from private.staff_pin_credentials where user_id=p_user_id;
 delete from private.staff_activation_tokens where user_id=p_user_id;
 perform public.issue_staff_activation(p_user_id,p_code);
end $$;
revoke all on function public.reset_staff_activation(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reset_staff_activation(uuid,text,uuid,uuid) to service_role;

create table private.management_invites (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
 organization_id uuid not null references public.organizations(id), email text not null,
 display_name text not null, role public.app_role not null check(role in ('SUPERVISOR','LOGISTICS','OWNER')),
 requested_by uuid not null references auth.users(id), user_id uuid references auth.users(id),
 status text not null default 'PENDING' check(status in ('PENDING','JOINED','CANCELLED')),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
 joined_at timestamptz, unique(store_id,email)
);
alter table private.management_invites enable row level security;
revoke all on private.management_invites from public,anon,authenticated;
create index management_invites_email_status on private.management_invites(email,status);

create function private.join_management_invite(p_invite uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare i private.management_invites; u public.profiles;
begin
 select * into strict i from private.management_invites where id=p_invite for update;
 if i.status='JOINED' then return; end if;
 if i.status<>'PENDING' or i.expires_at<=now() or not exists(select 1 from auth.users where id=p_user and lower(email)=i.email) then raise exception 'INVITE_NOT_VALID'; end if;
 if not exists(select 1 from public.store_memberships m join public.organization_members om on om.organization_id=m.organization_id and om.user_id=m.user_id join public.stores s on s.id=m.store_id where m.store_id=i.store_id and m.user_id=i.requested_by and m.is_active and om.is_active and s.is_active and (om.is_owner or m.role='OWNER')) then raise exception 'INVITER_ACCESS_REVOKED'; end if;
 select * into u from public.profiles where id=p_user;
 if u.organization_id is not null and u.organization_id<>i.organization_id then raise exception 'MEMBER_OTHER_ORGANIZATION'; end if;
 update public.profiles set organization_id=i.organization_id,display_name=coalesce(nullif(display_name,''),i.display_name),role=case when organization_id is null then i.role else role end where id=p_user;
 insert into public.organization_members(organization_id,user_id,role) values(i.organization_id,p_user,i.role) on conflict(organization_id,user_id) do nothing;
 if not exists(select 1 from public.organization_members where organization_id=i.organization_id and user_id=p_user and is_active) then raise exception 'MEMBER_DISABLED'; end if;
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(i.organization_id,p_user,i.display_name,i.requested_by) on conflict(organization_id,user_id) do nothing;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,assigned_by) values(i.store_id,i.organization_id,p_user,i.email,i.role,i.requested_by) on conflict(store_id,user_id) do nothing;
 update private.management_invites set status='JOINED',user_id=p_user,joined_at=now() where id=i.id;
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id) values(i.organization_id,'store_membership',p_user::text,'MANAGEMENT_MEMBER_JOINED',jsonb_build_object('store_id',i.store_id,'role',i.role,'invite_id',i.id),i.requested_by);
end $$;

create function public.prepare_management_invite(p_store_id uuid,p_actor uuid,p_email text,p_name text,p_role public.app_role) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_org uuid; i private.management_invites; v_user uuid; v_confirmed boolean;
begin
 if p_role not in ('SUPERVISOR','LOGISTICS','OWNER') or length(btrim(p_name)) not between 1 and 80 or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'INVALID_INVITE'; end if;
 select s.organization_id into v_org from public.stores s join public.store_memberships m on m.store_id=s.id join public.organization_members om on om.organization_id=m.organization_id and om.user_id=m.user_id
 where s.id=p_store_id and m.user_id=p_actor and s.is_active and m.is_active and om.is_active and (om.is_owner or m.role='OWNER');
 if v_org is null then raise exception 'OWNER_REQUIRED'; end if;
 select id,email_confirmed_at is not null into v_user,v_confirmed from auth.users where lower(email)=lower(btrim(p_email));
 if v_user=p_actor then raise exception 'CANNOT_INVITE_SELF'; end if;
 if exists(select 1 from public.profiles where id=v_user and organization_id is not null and organization_id<>v_org) then raise exception 'MEMBER_OTHER_ORGANIZATION'; end if;
 if exists(select 1 from public.store_memberships where store_id=p_store_id and user_id=v_user) then
  return jsonb_build_object('existing',true,'user_id',v_user,'email_verified',v_confirmed);
 end if;
 insert into private.management_invites(store_id,organization_id,email,display_name,role,requested_by)
 values(p_store_id,v_org,lower(btrim(p_email)),btrim(p_name),p_role,p_actor)
 on conflict(store_id,email) do update set display_name=excluded.display_name,role=excluded.role,requested_by=excluded.requested_by,expires_at=now()+interval '7 days'
 returning * into i;
 if v_user is not null then perform private.join_management_invite(i.id,v_user); end if;
 return jsonb_build_object('invite_id',i.id,'existing',v_user is not null,'user_id',v_user,'email_verified',coalesce(v_confirmed,false));
end $$;

create function private.consume_management_invite() returns trigger language plpgsql security definer set search_path='' as $$
declare i record;
begin
 for i in select id from private.management_invites where email=lower(new.email) and status='PENDING' and expires_at>now() loop
  begin
   perform private.join_management_invite(i.id,new.id);
  exception when others then
   if sqlerrm in ('INVITER_ACCESS_REVOKED','INVITE_NOT_VALID','MEMBER_OTHER_ORGANIZATION') then
    update private.management_invites set status='CANCELLED' where id=i.id;
   else raise; end if;
  end;
 end loop;
 return new;
end $$;
-- The existing profile-creation trigger runs first. No organization is created by this trigger.
create trigger zz_management_invite_join after insert on auth.users for each row execute function private.consume_management_invite();
revoke all on function private.join_management_invite(uuid,uuid),private.consume_management_invite(),public.prepare_management_invite(uuid,uuid,text,text,public.app_role) from public,anon,authenticated;
grant execute on function public.prepare_management_invite(uuid,uuid,text,text,public.app_role) to service_role;
