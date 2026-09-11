-- Work identity, merchant administration, store scope and optional features are
-- separate grants. Legacy columns/IDs and operational evidence are retained.
alter table public.organization_members
  add column work_role public.app_role,
  add column can_manage_business boolean not null default false;
alter table public.store_memberships
  add column work_role public.app_role,
  add column extra_permissions text[] not null default '{}',
  add constraint member_extra_permissions_allowed check(extra_permissions <@ array['REPORTS_VIEW','DATA_EXPORT']::text[]),
  add constraint member_work_role_allowed check(work_role in ('STAFF','SUPERVISOR','LOGISTICS','OWNER'));
update public.organization_members om set
  work_role=case when om.is_owner then 'OWNER'::public.app_role when om.role='ADMIN' then 'SUPERVISOR'::public.app_role else om.role end,
  can_manage_business=om.is_owner or exists(select 1 from public.store_memberships sm where sm.organization_id=om.organization_id and sm.user_id=om.user_id and sm.is_active and sm.role='OWNER');
update public.store_memberships sm set work_role=case
  when om.is_owner or o.owner_user_id=sm.user_id or sm.role='OWNER' then 'OWNER'::public.app_role
  when sm.role='ADMIN' then 'SUPERVISOR'::public.app_role else sm.role end
from public.organization_members om,public.organizations o
where om.organization_id=sm.organization_id and om.user_id=sm.user_id and o.id=sm.organization_id;

-- A personal Email account can be invited to another enterprise. Existing
-- composite foreign keys already bind each store membership to its enterprise.
alter table public.staff_identities drop constraint staff_identities_pkey;
alter table public.staff_identities add primary key(user_id,organization_id);

create function private.member_active(p_store uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.store_memberships sm
 join public.stores s on s.id=sm.store_id and s.organization_id=sm.organization_id
 join public.organization_members om on om.organization_id=sm.organization_id and om.user_id=sm.user_id
 join public.staff_identities si on si.organization_id=sm.organization_id and si.user_id=sm.user_id
 join auth.users u on u.id=sm.user_id
 where sm.store_id=p_store and sm.user_id=p_actor and sm.is_active and om.is_active and si.is_active and s.is_active
 and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()))
$$;
create or replace function private.app_role(p_store uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when coalesce(sm.work_role,sm.role)='ADMIN' then 'SUPERVISOR'
 when coalesce(sm.work_role,sm.role)='STAFF' and exists(select 1 from private.app_delegations d where d.store_id=sm.store_id and d.user_id=sm.user_id and d.revoked_at is null and now()>=d.starts_at and now()<d.ends_at) then 'SUPERVISOR'
 else coalesce(sm.work_role,sm.role)::text end
 from public.store_memberships sm where sm.store_id=p_store and sm.user_id=auth.uid()
 and private.member_active(p_store,auth.uid()) and private.app_session_valid(p_store)
$$;
create function private.can_manage_business(p_store uuid,p_actor uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(private.member_active(p_store,p_actor) and (p_actor is distinct from auth.uid() or private.app_session_valid(p_store))
 and exists(select 1 from public.organization_members om join public.stores s on s.organization_id=om.organization_id
 where s.id=p_store and om.user_id=p_actor and om.can_manage_business and om.is_active),false)
$$;
create function private.has_app_feature(p_store uuid,p_feature text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(private.app_role(p_store) is not null and p_feature in ('REPORTS_VIEW','DATA_EXPORT')
 and (private.app_role(p_store)<>'STAFF' or exists(select 1 from public.store_memberships sm where sm.store_id=p_store and sm.user_id=auth.uid() and p_feature=any(sm.extra_permissions))),false)
$$;
revoke all on function private.member_active(uuid,uuid),private.can_manage_business(uuid,uuid),private.has_app_feature(uuid,text) from public,anon,authenticated;

-- The existing API and three setup panels remain. Choosing a role saves the
-- draft immediately; only completion creates the merchant, inside one lock.

CREATE OR REPLACE FUNCTION public.create_owner_business(p_organization_name text, p_business_type text, p_store_name text, p_store_code text, p_staff_login_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_org_name text := nullif(btrim(p_organization_name), '');
  v_store_name text := nullif(btrim(p_store_name), '');
  v_store_code text := upper(btrim(coalesce(p_store_code, '')));
  v_org_id uuid;
  v_store_id uuid;
  v_existing_org_id uuid;
  v_existing_store_id uuid;
  v_display_name text;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'OWNER_AUTH_REQUIRED';
  end if;

  -- The authorization boundary is the verified Auth identity plus canonical
  -- profile/membership rows. Auth metadata is intentionally never consulted.
  if not exists (
    select 1
    from auth.users u
    where u.id = v_user_id
      and u.email_confirmed_at is not null
  ) then
    raise exception using errcode = '28000', message = 'OWNER_EMAIL_NOT_VERIFIED';
  end if;

  select p.*
  into v_profile
  from public.profiles p
  where p.id = v_user_id
  for update;

  if v_profile.id is null then
    raise exception using errcode = '23503', message = 'OWNER_PROFILE_MISSING';
  end if;

  -- A transaction-scoped, user-specific lock makes double clicks and retries
  -- serialize before any merchant data is created.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 20260824)
  );

  -- Idempotent replay: if this user already owns an active organization and
  -- its first store, return those canonical identifiers without inserting.
  select o.id
  into v_existing_org_id
  from public.organizations o
  join public.organization_members om
    on om.organization_id = o.id
   and om.user_id = v_user_id
   and om.is_active
   and om.is_owner
  where o.owner_user_id = v_user_id
  order by o.created_at
  limit 1;

  if v_existing_org_id is not null then
    select s.id
    into v_existing_store_id
    from public.stores s
    where s.organization_id = v_existing_org_id
      and s.is_active
    order by s.is_pilot_store desc, s.created_at, s.id
    limit 1;

    if v_existing_store_id is not null then
      return jsonb_build_object(
        'organization_id', v_existing_org_id,
        'store_id', v_existing_store_id,
        'reused', true
      );
    end if;
  end if;

  if exists (
    select 1
    from public.organization_members om
    where om.user_id = v_user_id
      and om.is_active
  ) then
    raise exception using errcode = '23505', message = 'OWNER_ALREADY_ONBOARDED';
  end if;

  if v_org_name is null or v_store_name is null then
    raise exception using errcode = '22023', message = 'OWNER_BUSINESS_NAME_REQUIRED';
  end if;
  if p_business_type not in ('SINGLE_RESTAURANT', 'CHAIN_RESTAURANT') then
    raise exception using errcode = '22023', message = 'OWNER_BUSINESS_TYPE_INVALID';
  end if;
  if v_store_code !~ '^[A-Z0-9][A-Z0-9_-]{1,31}$' then
    raise exception using errcode = '22023', message = 'OWNER_STORE_CODE_INVALID';
  end if;
  if p_staff_login_mode not in ('NAME_OR_NICKNAME', 'EMPLOYEE_NUMBER') then
    raise exception using errcode = '22023', message = 'OWNER_LOGIN_MODE_INVALID';
  end if;

  if exists(select 1 from private.management_invites i join auth.users u on lower(u.email)=i.email where u.id=v_user_id and i.status='PENDING' and i.expires_at>now()) then raise exception 'INVITE_ACCEPT_REQUIRED' using errcode='42501';end if;
  v_display_name := coalesce(nullif(btrim(v_profile.display_name), ''), '管理者');

  insert into public.organizations(name, business_type, owner_user_id)
  values (v_org_name, p_business_type, v_user_id)
  returning id into v_org_id;

  update public.profiles
  set organization_id = v_org_id,
      display_name = v_display_name,
      role = 'ADMIN',
      store = v_store_name,
      updated_at = now()
  where id = v_user_id;

  insert into public.organization_members(
    organization_id, user_id, role, is_active, is_owner, work_role, can_manage_business
  ) values (
    v_org_id, v_user_id, 'ADMIN', true, true, 'OWNER', true
  );

  insert into public.staff_identities(
    user_id, organization_id, display_name, job_title, created_by
  ) values (
    v_user_id, v_org_id, v_display_name, 'Owner', v_user_id
  );

  insert into public.stores(
    organization_id, store_code, name, staff_login_mode,
    is_pilot_store, created_by
  ) values (
    v_org_id, v_store_code, v_store_name, p_staff_login_mode,
    true, v_user_id
  ) returning id into v_store_id;

  insert into public.store_memberships(
    store_id, organization_id, user_id, login_identifier, role, assigned_by, work_role
  ) values (
    v_store_id, v_org_id, v_user_id, 'owner-' || v_user_id::text,
    'ADMIN', v_user_id, 'OWNER'
  );

  insert into public.audit_logs(
    organization_id, entity_type, entity_id, action, new_value, user_id
  ) values (
    v_org_id, 'organization', v_org_id, 'OWNER_BUSINESS_CREATED',
    jsonb_build_object(
      'business_type', p_business_type,
      'first_store_id', v_store_id,
      'staff_login_mode', p_staff_login_mode
    ),
    v_user_id
  );

  return jsonb_build_object(
    'organization_id', v_org_id,
    'store_id', v_store_id,
    'reused', false
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.owner_setup(p_action text DEFAULT 'get'::text, p_data jsonb DEFAULT '{}'::jsonb, p_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  profile public.profiles%rowtype;
  org public.organizations%rowtype;
  first_store public.stores%rowtype;
  progress private.owner_setup_progress%rowtype;
  draft jsonb;
  next_draft jsonb;
  next_step text;
  result jsonb;
begin
  if actor is null then raise exception using errcode='28000',message='OWNER_AUTH_REQUIRED'; end if;
  if p_action not in ('get','business','store','back_business','back_store','identity','complete') then
    raise exception using errcode='22023',message='OWNER_SETUP_ACTION_INVALID';
  end if;
  -- Match the existing create_owner_business lock order, including retries.
  select * into profile from public.profiles where id=actor for update;
  if profile.id is null then raise exception using errcode='23503',message='OWNER_PROFILE_MISSING'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20260824));

  select o.* into org from public.organizations o
  join public.organization_members m on m.organization_id=o.id and m.user_id=actor and m.is_active and m.is_owner
  where o.owner_user_id=actor order by o.created_at limit 1;

  if org.id is null and (profile.organization_id is not null or exists (
    select 1 from public.organization_members m where m.user_id=actor and m.is_active
  )) then
    if p_action <> 'get' then raise exception using errcode='42501',message='OWNER_SETUP_NOT_OWNER'; end if;
    if not exists(select 1 from public.store_memberships m join public.stores s on s.id=m.store_id and s.is_active
      where m.user_id=actor and private.member_active(s.id,actor)) then
      raise exception using errcode='42501',message='OWNER_WORKSPACE_UNAVAILABLE';
    end if;
    return jsonb_build_object('required',false,'step','complete');
  end if;
  if exists(select 1 from private.management_invites i join auth.users u on lower(u.email)=i.email where u.id=actor and i.status='PENDING' and i.expires_at>now()) then raise exception 'INVITE_ACCEPT_REQUIRED' using errcode='42501';end if;
  if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
    raise exception using errcode='28000',message='OWNER_EMAIL_NOT_VERIFIED';
  end if;
  select * into progress from private.owner_setup_progress where user_id=actor;
  if progress.organization_id is not null and progress.organization_id is distinct from org.id then
    raise exception using errcode='42501',message='OWNER_WORKSPACE_UNAVAILABLE';
  end if;
  if org.id is not null then
    select s.* into first_store from public.stores s
    join public.store_memberships m on m.store_id=s.id and m.user_id=actor and m.is_active
    where s.organization_id=org.id and s.is_active
      and (progress.store_id is null or s.id=progress.store_id)
    order by s.is_pilot_store desc,s.created_at,s.id limit 1;
    if first_store.id is null then raise exception using errcode='42501',message='OWNER_WORKSPACE_UNAVAILABLE'; end if;
  end if;
  if progress.step='complete' then
    if org.id is null then raise exception using errcode='42501',message='OWNER_WORKSPACE_UNAVAILABLE'; end if;
    return jsonb_build_object('required',false,'step','complete','organization_id',org.id,'store_id',first_store.id,'revision',progress.revision);
  end if;
  draft := case when progress.user_id is not null then progress.draft else jsonb_build_object(
    'organization_name',coalesce(org.name,''),'business_type',org.business_type,'store_mode',org.store_mode,
    'store_name',coalesce(first_store.name,''),'store_code',coalesce(first_store.store_code,''),
    'staff_login_mode',coalesce(first_store.staff_login_mode,'NAME_OR_NICKNAME')) end;
  next_step := coalesce(progress.step,'business');
  next_draft := draft;
  if p_action in ('identity','complete') then
    if progress.step is distinct from 'manager' or coalesce(p_data->>'work_role',draft->>'work_role','OWNER') not in ('SUPERVISOR','LOGISTICS','OWNER') then
      raise exception 'OWNER_WORK_ROLE_REQUIRED' using errcode='22023';
    end if;
    next_draft:=draft||jsonb_build_object('work_role',coalesce(p_data->>'work_role',draft->>'work_role','OWNER'));
  end if;
  if p_action in ('business','back_store') then
    if p_action='business' then
      next_draft := draft || jsonb_build_object('organization_name',btrim(coalesce(p_data->>'organization_name','')),
        'business_type',p_data->>'business_type','store_mode',p_data->>'store_mode');
    end if;
    next_step := 'store';
  elsif p_action in ('store','back_business') then
    if p_action='store' or p_data ? 'store_name' then
      next_draft := draft || jsonb_build_object('store_name',btrim(coalesce(p_data->>'store_name','')),
        'store_code',upper(btrim(coalesce(p_data->>'store_code',''))),'staff_login_mode',p_data->>'staff_login_mode');
    end if;
    next_step := case when p_action='store' then 'manager' else 'business' end;
  end if;
  if length(coalesce(next_draft->>'organization_name',''))>160 or length(coalesce(next_draft->>'store_name',''))>160
    or length(coalesce(next_draft->>'store_code',''))>32 then
    raise exception using errcode='22023',message='OWNER_SETUP_VALUE_TOO_LONG';
  end if;
  if p_action <> 'get' and next_step <> 'business' then
    if nullif(next_draft->>'organization_name','') is null then
      raise exception using errcode='22023',message='OWNER_BUSINESS_NAME_REQUIRED';
    end if;
    if coalesce(next_draft->>'business_type','') not in ('SINGLE_RESTAURANT','CHAIN_RESTAURANT')
      or coalesce(next_draft->>'store_mode','') not in ('SINGLE','MULTI') then
      raise exception using errcode='22023',message='OWNER_SETUP_BUSINESS_REQUIRED';
    end if;
  end if;
  if p_action in ('store','complete') then
    if nullif(next_draft->>'store_name','') is null or coalesce(next_draft->>'store_code','') !~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'
      or coalesce(next_draft->>'staff_login_mode','') not in ('NAME_OR_NICKNAME','EMPLOYEE_NUMBER') then
      raise exception using errcode='22023',message='OWNER_SETUP_STORE_REQUIRED';
    end if;
    if exists(select 1 from public.stores s where s.store_code=next_draft->>'store_code' and s.id is distinct from first_store.id) then
      raise exception using errcode='23505',message='OWNER_STORE_CODE_TAKEN';
    end if;
  end if;
  if p_action <> 'get' then
    -- An identical successful step replay returns its saved state. A stale,
    -- different edit cannot overwrite another tab's newer progress.
    if p_revision is distinct from coalesce(progress.revision,0) then
      if p_action='complete' or next_step is distinct from progress.step or next_draft is distinct from draft then
        raise exception using errcode='40001',message='OWNER_SETUP_CHANGED';
      end if;
    elsif p_action='complete' then
      if progress.step is distinct from 'manager' then
        raise exception using errcode='22023',message='OWNER_SETUP_NOT_READY';
      end if;
      if org.id is null then
        result := public.create_owner_business(next_draft->>'organization_name',next_draft->>'business_type',
          next_draft->>'store_name',next_draft->>'store_code',next_draft->>'staff_login_mode');
        select * into org from public.organizations where id=(result->>'organization_id')::uuid;
        select * into first_store from public.stores where id=(result->>'store_id')::uuid;
      end if;
      -- Update in place; historical count/receipt rows and original IDs remain.
      update public.organizations set name=next_draft->>'organization_name',business_type=next_draft->>'business_type',
        store_mode=next_draft->>'store_mode',updated_at=now() where id=org.id and owner_user_id=actor;
      update public.stores set name=next_draft->>'store_name',store_code=next_draft->>'store_code',
        staff_login_mode=next_draft->>'staff_login_mode',updated_at=now() where id=first_store.id and organization_id=org.id;
      update public.profiles set store=next_draft->>'store_name',role=(next_draft->>'work_role')::public.app_role,updated_at=now() where id=actor;
      update public.organization_members set work_role=(next_draft->>'work_role')::public.app_role,role=(next_draft->>'work_role')::public.app_role,can_manage_business=true where organization_id=org.id and user_id=actor;
      update public.store_memberships set work_role=(next_draft->>'work_role')::public.app_role,role=(next_draft->>'work_role')::public.app_role,updated_at=now() where store_id=first_store.id and user_id=actor;
      update private.owner_setup_progress set organization_id=org.id,store_id=first_store.id,step='complete',
        draft=next_draft,completed_at=now(),updated_at=now(),revision=revision+1 where user_id=actor returning * into progress;
      insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
      values(org.id,'organization',org.id,'OWNER_SETUP_COMPLETED',jsonb_build_object('first_store_id',first_store.id,'work_role',next_draft->>'work_role','can_manage_business',true),actor);
      return jsonb_build_object('required',false,'step','complete','organization_id',org.id,'store_id',first_store.id,'revision',progress.revision);
    elsif next_step is distinct from progress.step or next_draft is distinct from draft or progress.user_id is null then
      insert into private.owner_setup_progress(user_id,organization_id,store_id,step,draft,revision)
      values(actor,org.id,first_store.id,next_step,next_draft,coalesce(progress.revision,0)+1)
      on conflict(user_id) do update set step=excluded.step,draft=excluded.draft,revision=excluded.revision,updated_at=now()
      returning * into progress;
    end if;
  end if;
  return jsonb_build_object('required',true,'step',coalesce(progress.step,next_step),'draft',coalesce(progress.draft,next_draft),
    'organization_id',org.id,'store_id',first_store.id,'revision',coalesce(progress.revision,0));
end;
$function$
;

-- Invitations are inert until the verified recipient explicitly accepts them.
-- Historical JOINED invitations and memberships are not replayed or replaced.
alter table private.management_invites
 add column mail_state text not null default 'NOT_SENT' check(mail_state in ('NOT_SENT','SENDING','SENT','FAILED')),
 add column mail_attempt_id uuid,
 add column mail_attempt_at timestamptz,
 add column mail_sent_at timestamptz,
 add column mail_error text;
create or replace function private.consume_management_invite() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update private.management_invites set user_id=new.id where email=lower(new.email) and status='PENDING' and expires_at>now();
 return new;
end $$;

create or replace function public.prepare_management_invite(p_store_id uuid,p_actor uuid,p_email text,p_name text,p_role public.app_role) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; i private.management_invites; v_user uuid; v_confirmed boolean; send_mail boolean;
begin
 if not private.can_manage_business(p_store_id,p_actor) then raise exception 'BUSINESS_ADMIN_REQUIRED' using errcode='42501';end if;
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
end $$;
create function public.finish_management_invite_delivery(p_invite_id uuid,p_attempt_id uuid,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 update private.management_invites set mail_state=case when p_error is null then 'SENT' else 'FAILED' end,mail_sent_at=case when p_error is null then now() else mail_sent_at end,mail_error=left(regexp_replace(coalesce(p_error,''),'[^A-Za-z0-9_-]','','g'),80)
 where id=p_invite_id and mail_attempt_id=p_attempt_id and status='PENDING';
end $$;
revoke all on function public.prepare_management_invite(uuid,uuid,text,text,public.app_role),public.finish_management_invite_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_management_invite(uuid,uuid,text,text,public.app_role),public.finish_management_invite_delivery(uuid,uuid,text) to service_role;

create or replace function private.join_management_invite(p_invite uuid,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare i private.management_invites; u public.profiles; existing_role public.app_role;
begin
 select * into strict i from private.management_invites where id=p_invite for update;
 if not exists(select 1 from auth.users where id=p_user and lower(email)=i.email and email_confirmed_at is not null and (banned_until is null or banned_until<=now())) then raise exception 'INVITE_EMAIL_MISMATCH' using errcode='42501';end if;
 if i.status='JOINED' and i.user_id=p_user then
  if not private.member_active(i.store_id,p_user) then raise exception 'MEMBER_DISABLED' using errcode='42501';end if;
  return;
 end if;
 if i.status<>'PENDING' or i.expires_at<=now() then raise exception 'INVITE_NOT_VALID' using errcode='42501';end if;
 if not private.can_manage_business(i.store_id,i.requested_by) then raise exception 'INVITER_ACCESS_REVOKED' using errcode='42501';end if;
 -- Serialize acceptance with registration: a pending invite cannot accidentally
 -- create another merchant in a concurrent tab.
 select * into strict u from public.profiles where id=p_user for update;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,20260824));
 if exists(select 1 from public.organization_members where organization_id=i.organization_id and user_id=p_user and not is_active)
 or exists(select 1 from public.staff_identities where organization_id=i.organization_id and user_id=p_user and not is_active)
 or exists(select 1 from public.store_memberships where store_id=i.store_id and user_id=p_user and not is_active) then raise exception 'MEMBER_DISABLED' using errcode='42501';end if;
 select coalesce(work_role,case when role='ADMIN' then 'SUPERVISOR'::public.app_role else role end) into existing_role from public.organization_members where organization_id=i.organization_id and user_id=p_user;
 existing_role:=coalesce(existing_role,i.role);
 update public.profiles set organization_id=coalesce(organization_id,i.organization_id),display_name=coalesce(nullif(display_name,''),i.display_name),role=case when organization_id is null then existing_role::text else role end where id=p_user;
 insert into public.organization_members(organization_id,user_id,role,work_role,can_manage_business) values(i.organization_id,p_user,existing_role,existing_role,false) on conflict(organization_id,user_id) do nothing;
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(i.organization_id,p_user,coalesce(nullif(u.display_name,''),i.display_name),i.requested_by) on conflict(organization_id,user_id) do nothing;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by) values(i.store_id,i.organization_id,p_user,i.email,existing_role,existing_role,i.requested_by) on conflict(store_id,user_id) do nothing;
 update private.management_invites set status='JOINED',user_id=p_user,joined_at=now() where id=i.id;
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id) values(i.organization_id,'store_membership',p_user::text,'MANAGEMENT_MEMBER_JOINED',jsonb_build_object('store_id',i.store_id,'role',existing_role,'invite_id',i.id,'invited_by',i.requested_by,'can_manage_business',false),p_user);
end $$;
create function private.management_invitation(p_action text,p_invite uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); email_address text; i private.management_invites;
begin
 select lower(email) into email_address from auth.users where id=actor and email_confirmed_at is not null and (banned_until is null or banned_until<=now());
 if email_address is null then raise exception 'VERIFIED_EMAIL_REQUIRED' using errcode='42501';end if;
 if p_action='list' then
  return jsonb_build_object('invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',mi.id,'organization_name',o.name,'store_name',s.name,'store_id',s.id,'business_type',o.business_type,'role',mi.role,'email',mi.email,'expires_at',mi.expires_at,'valid',mi.expires_at>now() and private.can_manage_business(mi.store_id,mi.requested_by)) order by mi.created_at),'[]'::jsonb)
  from private.management_invites mi join public.organizations o on o.id=mi.organization_id join public.stores s on s.id=mi.store_id where mi.email=email_address and mi.status='PENDING'));
 end if;
 select * into i from private.management_invites where id=p_invite and email=email_address for update;
 if not found then raise exception 'INVITE_EMAIL_MISMATCH' using errcode='42501';end if;
 if p_action='accept' then perform private.join_management_invite(i.id,actor);
 elsif p_action='decline' then
  if i.status='JOINED' then raise exception 'INVITE_ALREADY_JOINED' using errcode='22023';end if;
  update private.management_invites set status='CANCELLED' where id=i.id;
 else raise exception 'INVALID_INVITE_ACTION' using errcode='22023';end if;
 return jsonb_build_object('accepted',p_action='accept','store_id',i.store_id,'organization_id',i.organization_id);
end $$;
create function public.management_invitation(p_action text default 'list',p_invite_id uuid default null) returns jsonb
language sql set search_path='' as $$ select private.management_invitation(p_action,p_invite_id) $$;
revoke all on function private.management_invitation(text,uuid),public.management_invitation(text,uuid) from public,anon;
grant execute on function private.management_invitation(text,uuid),public.management_invitation(text,uuid) to authenticated;

create function private.transfer_business_admin(p_store uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org public.organizations; target uuid:=(p_data->>'user_id')::uuid; actor uuid:=auth.uid(); target_role public.app_role; old jsonb; keep_admin boolean:=coalesce((p_data->>'keep_admin')::boolean,false);
begin
 if not private.can_manage_business(p_store) then raise exception 'BUSINESS_ADMIN_REQUIRED' using errcode='42501';end if;
 select o.* into strict org from public.organizations o join public.stores s on s.organization_id=o.id where s.id=p_store for update of o;
 if org.owner_user_id<>actor or target=actor then raise exception 'BUSINESS_RESPONSIBLE_REQUIRED' using errcode='42501';end if;
 if not private.member_active(p_store,target) then raise exception 'ACTIVE_MANAGER_REQUIRED' using errcode='42501';end if;
 select coalesce(work_role,role) into target_role from public.organization_members where organization_id=org.id and user_id=target;
 if target_role='ADMIN' then target_role:='SUPERVISOR';end if;
 if target_role not in ('SUPERVISOR','LOGISTICS','OWNER') then raise exception 'ACTIVE_MANAGER_REQUIRED' using errcode='42501';end if;
 old:=jsonb_build_object('responsible_user_id',org.owner_user_id,'store_id',p_store);
 -- One transaction grants the new responsible manager access before releasing
 -- the previous responsibility. Identity and historical authorship stay intact.
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by)
 select s.id,org.id,target,u.email,target_role,target_role,actor from public.stores s,auth.users u where s.organization_id=org.id and s.is_active and u.id=target
 on conflict(store_id,user_id) do update set is_active=true,updated_at=now(),assigned_by=actor;
 update public.organization_members set can_manage_business=true,is_owner=true where organization_id=org.id and user_id=target;
 update public.organizations set owner_user_id=target,updated_at=now() where id=org.id;
 update public.organization_members set can_manage_business=keep_admin,is_owner=false where organization_id=org.id and user_id=actor;
 return jsonb_build_object('id',org.id,'previous',old,'value',jsonb_build_object('responsible_user_id',target,'previous_manager_retained',keep_admin,'work_role',target_role,'store_id',p_store));
end $$;
revoke all on function private.transfer_business_admin(uuid,jsonb) from public,anon,authenticated;

-- Update existing dispatchers in place; abort if the deployed contract differs.
do $migration$
declare source text; updated text;
begin
 select pg_get_functiondef('private.app_context()'::regprocedure) into source;
 if strpos(source,$old$'role',private.app_role(s.id)$old$)=0 then raise exception 'Work identity source mismatch: private.app_context';end if;
 updated:=replace(source,$old$'role',private.app_role(s.id)$old$,$new$'role',private.app_role(s.id),'can_manage_business',private.can_manage_business(s.id),'is_business_responsible',o.owner_user_id=auth.uid(),'permissions',jsonb_build_object('reports_view',private.has_app_feature(s.id,'REPORTS_VIEW'),'data_export',private.has_app_feature(s.id,'DATA_EXPORT'))$new$);execute updated;
 select pg_get_functiondef('private.app_context()'::regprocedure) into source;
 if strpos(source,$old$(om.is_owner or exists(select 1 from public.store_memberships sm where sm.store_id=s.id and sm.user_id=auth.uid() and sm.is_active))$old$)=0 then raise exception 'Work identity source mismatch: private.app_context';end if;
 updated:=replace(source,$old$(om.is_owner or exists(select 1 from public.store_memberships sm where sm.store_id=s.id and sm.user_id=auth.uid() and sm.is_active))$old$,$new$exists(select 1 from public.store_memberships sm where sm.store_id=s.id and sm.user_id=auth.uid() and sm.is_active)$new$);execute updated;
 select pg_get_functiondef('private.app_member_workspace(uuid)'::regprocedure) into source;
 if strpos(source,$old$if v_role not in ('OWNER','SUPERVISOR') or v_role is null$old$)=0 then raise exception 'Work identity source mismatch: private.app_member_workspace';end if;
 updated:=replace(source,$old$if v_role not in ('OWNER','SUPERVISOR') or v_role is null$old$,$new$if v_role is null or (v_role<>'SUPERVISOR' and not private.can_manage_business(p_store))$new$);execute updated;
 select pg_get_functiondef('private.app_member_workspace(uuid)'::regprocedure) into source;
 if strpos(source,$old$'role',sm.role$old$)=0 then raise exception 'Work identity source mismatch: private.app_member_workspace';end if;
 updated:=replace(source,$old$'role',sm.role$old$,$new$'role',coalesce(sm.work_role,sm.role),'extra_permissions',sm.extra_permissions,'can_manage_business',om.can_manage_business$new$);execute updated;
 select pg_get_functiondef('private.app_member_workspace(uuid)'::regprocedure) into source;
 if strpos(source,$old$case when v_role='OWNER' then$old$)=0 then raise exception 'Work identity source mismatch: private.app_member_workspace';end if;
 updated:=replace(source,$old$case when v_role='OWNER' then$old$,$new$case when private.can_manage_business(p_store) then$new$);execute updated;
 select pg_get_functiondef('private.app_member_workspace(uuid)'::regprocedure) into source;
 if strpos(source,$old$'user_id',si.user_id,'display_name',si.display_name$old$)=0 then raise exception 'Work identity source mismatch: private.app_member_workspace';end if;
 updated:=replace(source,$old$'user_id',si.user_id,'display_name',si.display_name$old$,$new$'user_id',si.user_id,'display_name',si.display_name,'role',coalesce(om.work_role,om.role),'login_identifier',(select sm.login_identifier from public.store_memberships sm where sm.organization_id=si.organization_id and sm.user_id=si.user_id and sm.is_active order by sm.created_at limit 1)$new$);execute updated;
 select pg_get_functiondef('private.app_member_workspace(uuid)'::regprocedure) into source;
 if strpos(source,$old$return jsonb_build_object('zones'$old$)=0 then raise exception 'Work identity source mismatch: private.app_member_workspace';end if;
 updated:=replace(source,$old$return jsonb_build_object('zones'$old$,$new$return jsonb_build_object('invitations',case when private.can_manage_business(p_store) then (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'display_name',i.display_name,'role',i.role,'status',i.status,'mail_state',i.mail_state,'mail_error',i.mail_error,'expires_at',i.expires_at) order by i.created_at desc),'[]'::jsonb) from private.management_invites i where i.store_id=p_store and i.status='PENDING') else '[]'::jsonb end,'zones'$new$);execute updated;
 select pg_get_functiondef('private.app_member_operation(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if v_role not in ('OWNER','SUPERVISOR') or v_role is null$old$)=0 then raise exception 'Work identity source mismatch: private.app_member_operation';end if;
 updated:=replace(source,$old$if v_role not in ('OWNER','SUPERVISOR') or v_role is null$old$,$new$if v_role is null or (v_role<>'SUPERVISOR' and not private.can_manage_business(p_store))$new$);execute updated;
 select pg_get_functiondef('private.app_member_operation(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if v_role='SUPERVISOR' and$old$)=0 then raise exception 'Work identity source mismatch: private.app_member_operation';end if;
 updated:=replace(source,$old$if v_role='SUPERVISOR' and$old$,$new$if not private.can_manage_business(p_store) and$new$);execute updated;
 select pg_get_functiondef('private.app_member_operation(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$v_old:=to_jsonb(v_member);$old$)=0 then raise exception 'Work identity source mismatch: private.app_member_operation';end if;
 updated:=replace(source,$old$v_old:=to_jsonb(v_member);$old$,$new$v_old:=to_jsonb(v_member);
 if p_data ? 'extra_permissions' then
  if jsonb_typeof(p_data->'extra_permissions')<>'array' or exists(select 1 from jsonb_array_elements(p_data->'extra_permissions') x where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('REPORTS_VIEW','DATA_EXPORT')) then raise exception 'INVALID_FEATURE_PERMISSION' using errcode='22023';end if;
  if not private.can_manage_business(p_store) and p_data->'extra_permissions'<>to_jsonb(v_member.extra_permissions) then raise exception 'BUSINESS_ADMIN_REQUIRED' using errcode='42501';end if;
 end if;
 if p_data ? 'can_manage_business' and (p_data->>'can_manage_business')::boolean is distinct from (select can_manage_business from public.organization_members where organization_id=v_org and user_id=v_target) and not private.can_manage_business(p_store) then raise exception 'BUSINESS_ADMIN_REQUIRED' using errcode='42501';end if;
 if p_action='member.assign' then
  -- Scope changes never change the member's existing work identity.
  p_data:=p_data||jsonb_build_object('role',(select coalesce(work_role,case when role='ADMIN' then 'SUPERVISOR'::public.app_role else role end) from public.organization_members where organization_id=v_org and user_id=v_target));
 end if;$new$);execute updated;
 select pg_get_functiondef('private.app_member_operation(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$login_identifier,role,is_active,assigned_by)$old$)=0 then raise exception 'Work identity source mismatch: private.app_member_operation';end if;
 updated:=replace(source,$old$login_identifier,role,is_active,assigned_by)$old$,$new$login_identifier,role,is_active,assigned_by,work_role)$new$);execute updated;
 select pg_get_functiondef('private.app_member_operation(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$coalesce((p_data->>'is_active')::boolean,true),auth.uid())$old$)=0 then raise exception 'Work identity source mismatch: private.app_member_operation';end if;
 updated:=replace(source,$old$coalesce((p_data->>'is_active')::boolean,true),auth.uid())$old$,$new$coalesce((p_data->>'is_active')::boolean,true),auth.uid(),(p_data->>'role')::public.app_role)$new$);execute updated;
 select pg_get_functiondef('private.app_member_operation(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$role=excluded.role,is_active$old$)=0 then raise exception 'Work identity source mismatch: private.app_member_operation';end if;
 updated:=replace(source,$old$role=excluded.role,is_active$old$,$new$role=excluded.role,work_role=excluded.work_role,is_active$new$);execute updated;
 select pg_get_functiondef('private.app_member_operation(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$  if length(btrim(coalesce(p_data->>'display_name','')))>0 then$old$)=0 then raise exception 'Work identity source mismatch: private.app_member_operation';end if;
 updated:=replace(source,$old$  if length(btrim(coalesce(p_data->>'display_name','')))>0 then$old$,$new$  if p_data ? 'extra_permissions' then
   update public.store_memberships set extra_permissions=array(select distinct x from jsonb_array_elements_text(p_data->'extra_permissions') x) where store_id=p_store and user_id=v_target;
  end if;
  if private.can_manage_business(p_store) and p_action='member.save' then
   update public.organization_members set work_role=(p_data->>'role')::public.app_role,can_manage_business=coalesce((p_data->>'can_manage_business')::boolean,can_manage_business) where organization_id=v_org and user_id=v_target;
  end if;
  if length(btrim(coalesce(p_data->>'display_name','')))>0 then$new$);execute updated;
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$begin
 if p_action$old$)=0 then raise exception 'Work identity source mismatch: private.app_management';end if;
 updated:=replace(source,$old$begin
 if p_action$old$,$new$begin
 if p_action='business.transfer' then return private.transfer_business_admin(p_store,p_data);end if;
 if p_action='invite.cancel' then
  if not private.can_manage_business(p_store) then raise exception 'BUSINESS_ADMIN_REQUIRED' using errcode='42501';end if;
  update private.management_invites set status='CANCELLED' where id=(p_data->>'id')::uuid and store_id=p_store and status='PENDING';
  return jsonb_build_object('id',p_data->>'id','status','CANCELLED');
 end if;
 if p_action$new$);execute updated;
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if v_role is null or v_role='STAFF'$old$)=0 then raise exception 'Work identity source mismatch: private.app_management';end if;
 updated:=replace(source,$old$if v_role is null or v_role='STAFF'$old$,$new$if v_role is null or (v_role='STAFF' and not private.can_manage_business(p_store))$new$);execute updated;
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if v_role<>'OWNER' then raise exception 'APP_FORBIDDEN'$old$)=0 then raise exception 'Work identity source mismatch: private.app_management';end if;
 updated:=replace(source,$old$if v_role<>'OWNER' then raise exception 'APP_FORBIDDEN'$old$,$new$if not private.can_manage_business(p_store) then raise exception 'APP_FORBIDDEN'$new$);execute updated;
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if v_role not in ('OWNER','SUPERVISOR') then$old$)=0 then raise exception 'Work identity source mismatch: private.app_management';end if;
 updated:=replace(source,$old$if v_role not in ('OWNER','SUPERVISOR') then$old$,$new$if v_role<>'SUPERVISOR' and not private.can_manage_business(p_store) then$new$);execute updated;
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if v_role<>'OWNER' or (select count(*)$old$)=0 then raise exception 'Work identity source mismatch: private.app_management';end if;
 updated:=replace(source,$old$if v_role<>'OWNER' or (select count(*)$old$,$new$if not private.can_manage_business(p_store) or (select count(*)$new$);execute updated;
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if v_role='SUPERVISOR' and$old$)=0 then raise exception 'Work identity source mismatch: private.app_management';end if;
 updated:=replace(source,$old$if v_role='SUPERVISOR' and$old$,$new$if not private.can_manage_business(p_store) and$new$);execute updated;
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if v_role<>'OWNER' or v_member.role$old$)=0 then raise exception 'Work identity source mismatch: private.app_management';end if;
 updated:=replace(source,$old$if v_role<>'OWNER' or v_member.role$old$,$new$if not private.can_manage_business(p_store) or v_member.role$new$);execute updated;
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if v_role<>'OWNER' then raise exception 'OWNER_REQUIRED'$old$)=0 then raise exception 'Work identity source mismatch: private.app_management';end if;
 updated:=replace(source,$old$if v_role<>'OWNER' then raise exception 'OWNER_REQUIRED'$old$,$new$if not private.can_manage_business(p_store) then raise exception 'OWNER_REQUIRED'$new$);execute updated;
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if v_role='STAFF' and p_section<>'settings'$old$)=0 then raise exception 'Work identity source mismatch: private.app_workspace';end if;
 updated:=replace(source,$old$if v_role='STAFF' and p_section<>'settings'$old$,$new$if v_role='STAFF' and p_section<>'settings' and not (p_section in ('members','business','permissions','audit') and private.can_manage_business(p_store))$new$);execute updated;
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if v_role not in ('SUPERVISOR','OWNER') then$old$)=0 then raise exception 'Work identity source mismatch: private.app_workspace';end if;
 updated:=replace(source,$old$if v_role not in ('SUPERVISOR','OWNER') then$old$,$new$if v_role<>'SUPERVISOR' and not private.can_manage_business(p_store) then$new$);execute updated;
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if v_role<>'OWNER' then$old$)=0 then raise exception 'Work identity source mismatch: private.app_workspace';end if;
 updated:=replace(source,$old$if v_role<>'OWNER' then$old$,$new$if not private.can_manage_business(p_store) then$new$);execute updated;
 select pg_get_functiondef('private.app_reports(uuid,jsonb)'::regprocedure) into source;
 if strpos(source,$old$if role_name is null or role_name='STAFF' then$old$)=0 then raise exception 'Work identity source mismatch: private.app_reports';end if;
 updated:=replace(source,$old$if role_name is null or role_name='STAFF' then$old$,$new$if not private.has_app_feature(p_store,'REPORTS_VIEW') and not private.has_app_feature(p_store,'DATA_EXPORT') then$new$);execute updated;
end $migration$;
notify pgrst,'reload schema';

create function private.authorize_app_feature(p_store uuid,p_feature text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_app_feature(p_store,p_feature) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 return true;
end $$;
create function public.authorize_app_feature(p_store_id uuid,p_feature text) returns boolean
language sql stable set search_path='' as $$ select private.authorize_app_feature(p_store_id,p_feature) $$;
revoke all on function private.authorize_app_feature(uuid,text),public.authorize_app_feature(uuid,text) from public,anon;
grant execute on function private.authorize_app_feature(uuid,text),public.authorize_app_feature(uuid,text) to authenticated;

do $migration$
declare source text;updated text;
begin
 select pg_get_functiondef('private.app_member_operation(uuid,text,jsonb)'::regprocedure) into source;
 updated:=replace(source,'v_old:=to_jsonb(v_member);','v_old:=to_jsonb(v_member)||jsonb_build_object(''can_manage_business'',(select can_manage_business from public.organization_members where organization_id=v_org and user_id=v_target));');
 updated:=replace(updated,'return jsonb_build_object(''id'',v_target','v_result:=v_result||(select to_jsonb(sm) from public.store_memberships sm where sm.store_id=p_store and sm.user_id=v_target)||jsonb_build_object(''can_manage_business'',(select can_manage_business from public.organization_members where organization_id=v_org and user_id=v_target));'||chr(10)||' return jsonb_build_object(''id'',v_target');
 if updated=source then raise exception 'Member access audit source mismatch';end if;execute updated;
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into source;
 updated:=replace(source,'case when v_role in (''OWNER'',''SUPERVISOR'') then','case when v_role=''SUPERVISOR'' or private.can_manage_business(p_store) then');
 updated:=replace(updated,'''editable'',v_role in (''OWNER'',''SUPERVISOR'')','''editable'',v_role=''SUPERVISOR'' or private.can_manage_business(p_store)');
 if updated=source then raise exception 'Settings capability source mismatch';end if;execute updated;
 select pg_get_functiondef('private.app_device_management(uuid,text,jsonb)'::regprocedure) into source;
 updated:=replace(source,'coalesce(private.app_role(p_store),'''') not in (''OWNER'',''SUPERVISOR'')','coalesce(private.app_role(p_store),'''')<>''SUPERVISOR'' and not private.can_manage_business(p_store)');
 if updated=source then raise exception 'Device capability source mismatch';end if;execute updated;
end $migration$;
notify pgrst,'reload schema';

-- Populate explicit fields for compatible service-side provisioning calls.
-- Browser writes to both membership tables remain revoked.
create function private.initialize_member_access() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='organization_members' then
  new.work_role:=coalesce(new.work_role,case when new.is_owner then 'OWNER'::public.app_role when new.role='ADMIN' then 'SUPERVISOR'::public.app_role else new.role end);
  if new.is_owner and exists(select 1 from public.organizations where id=new.organization_id and owner_user_id=new.user_id) then new.can_manage_business:=true;end if;
 else
  new.work_role:=coalesce(new.work_role,case when new.role='ADMIN' and exists(select 1 from public.organization_members where organization_id=new.organization_id and user_id=new.user_id and is_owner) then 'OWNER'::public.app_role when new.role='ADMIN' then 'SUPERVISOR'::public.app_role else new.role end);
 end if;
 return new;
end $$;
revoke all on function private.initialize_member_access() from public,anon,authenticated;
create trigger initialize_org_member_access before insert on public.organization_members for each row execute function private.initialize_member_access();
create trigger initialize_store_member_access before insert on public.store_memberships for each row execute function private.initialize_member_access();

-- New invitation acceptances require a current Auth session as well as verified
-- Email. SQL fixtures without JWT session IDs retain the existing test contract.
do $migration$
declare source text;updated text;
begin
 select pg_get_functiondef('private.management_invitation(text,uuid)'::regprocedure) into source;
 updated:=replace(source,'if email_address is null then','if email_address is null or not private.app_session_valid(null) then');
 if updated=source then raise exception 'Invitation session source mismatch';end if;execute updated;
end $migration$;

-- A supervisor cannot take over a staff identity that has separately been
-- entrusted with merchant administration by resetting its PIN or disabling it.
do $migration$
declare source text;updated text;
begin
 select pg_get_functiondef('private.app_member_operation(uuid,text,jsonb)'::regprocedure) into source;
 updated:=replace(source,'select * into v_member from public.store_memberships where store_id=p_store and user_id=v_target for update;',
 'if not private.can_manage_business(p_store) and exists(select 1 from public.organization_members where organization_id=v_org and user_id=v_target and can_manage_business) then raise exception ''BUSINESS_ADMIN_REQUIRED'' using errcode=''42501'';end if;'||chr(10)||' select * into v_member from public.store_memberships where store_id=p_store and user_id=v_target for update;');
 if updated=source then raise exception 'Protected member source mismatch';end if;execute updated;
end $migration$;
create or replace function public.reset_staff_activation(p_user_id uuid,p_code text,p_actor uuid,p_store_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare org uuid; actor_role public.app_role; target_role public.app_role; admin_allowed boolean;
begin
 if p_actor=p_user_id or length(p_code)<32 or not private.member_active(p_store_id,p_actor) or not private.member_active(p_store_id,p_user_id) then raise exception 'ACTIVATION_NOT_ALLOWED';end if;
 select organization_id,coalesce(work_role,role) into org,actor_role from public.store_memberships where store_id=p_store_id and user_id=p_actor;
 select coalesce(work_role,role) into target_role from public.store_memberships where store_id=p_store_id and user_id=p_user_id;
 admin_allowed:=private.can_manage_business(p_store_id,p_actor);
 if not admin_allowed and not (actor_role in ('SUPERVISOR','ADMIN') or exists(select 1 from private.app_delegations d where d.store_id=p_store_id and d.user_id=p_actor and d.revoked_at is null and now()>=d.starts_at and now()<d.ends_at)) then raise exception 'ACTIVATION_NOT_ALLOWED';end if;
 if exists(select 1 from public.organization_members where organization_id=org and user_id=p_user_id and (is_owner or (can_manage_business and not admin_allowed))) or (target_role<>'STAFF' and not admin_allowed) then raise exception 'ACTIVATION_NOT_ALLOWED';end if;
 delete from private.staff_pin_credentials where user_id=p_user_id;
 delete from private.staff_activation_tokens where user_id=p_user_id;
 perform public.issue_staff_activation(p_user_id,p_code);
end $$;
revoke all on function public.reset_staff_activation(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reset_staff_activation(uuid,text,uuid,uuid) to service_role;

-- Accepting an invitation or taking responsibility does not restart onboarding.
-- Preserve an explicitly saved, incomplete canonical merchant setup only.
do $migration$
declare source text;updated text;
begin
 select pg_get_functiondef('public.owner_setup(text,jsonb,integer)'::regprocedure) into source;
 updated:=replace(source,'  select o.* into org from public.organizations o',
 '  select * into progress from private.owner_setup_progress where user_id=actor;'||chr(10)||
 '  if progress.step=''complete'' or (progress.organization_id is null and profile.organization_id is not null) then'||chr(10)||
 '    select s.* into first_store from public.stores s where private.member_active(s.id,actor) order by (s.id=progress.store_id) desc nulls last,s.created_at,s.id limit 1;'||chr(10)||
 '    if first_store.id is null then raise exception ''OWNER_WORKSPACE_UNAVAILABLE'' using errcode=''42501'';end if;'||chr(10)||
 '    if p_action not in (''get'',''complete'') then raise exception ''OWNER_SETUP_ALREADY_COMPLETE'' using errcode=''42501'';end if;'||chr(10)||
 '    return jsonb_build_object(''required'',false,''step'',''complete'',''organization_id'',first_store.organization_id,''store_id'',first_store.id,''revision'',coalesce(progress.revision,0));'||chr(10)||
 '  end if;'||chr(10)||'  select o.* into org from public.organizations o');
 if updated=source then raise exception 'Completed member routing source mismatch';end if;execute updated;
 -- Multi-enterprise identity joins must not duplicate historical count rows or
 -- apply another enterprise''s disabled/name state to the selected store.
 select pg_get_functiondef('public.get_pilot_staff_login_context(text,text)'::regprocedure) into source;
 updated:=replace(source,'join public.staff_identities i on i.user_id=m.user_id','join public.staff_identities i on i.user_id=m.user_id and i.organization_id=m.organization_id');
 updated:=replace(updated,'''role'',m.role','''role'',coalesce(m.work_role,m.role)');
 if updated=source then raise exception 'PIN identity scope mismatch';end if;execute updated;
 select pg_get_functiondef('public.activate_staff_pin(text,text,text,text)'::regprocedure) into source;
 updated:=replace(source,'join public.staff_identities i on i.user_id=m.user_id and i.is_active','join public.staff_identities i on i.user_id=m.user_id and i.organization_id=m.organization_id and i.is_active');
 if updated=source then raise exception 'PIN activation scope mismatch';end if;execute updated;
 select pg_get_functiondef('public.get_pilot_count_details(uuid)'::regprocedure) into source;
 updated:=replace(source,'left join public.staff_identities si on si.user_id=e.entered_by','left join public.staff_identities si on si.user_id=e.entered_by and si.organization_id=v_session.organization_id');
 if updated=source then raise exception 'Count detail identity scope mismatch';end if;execute updated;
 select pg_get_functiondef('public.get_pilot_count_results(uuid)'::regprocedure) into source;
 updated:=replace(source,'left join public.staff_identities si on si.user_id=e.entered_by','left join public.staff_identities si on si.user_id=e.entered_by and si.organization_id=s.organization_id');
 if updated=source then raise exception 'Count result identity scope mismatch';end if;execute updated;
 select pg_get_functiondef('public.get_pilot_count_completion(uuid)'::regprocedure) into source;
 updated:=replace(source,'left join public.staff_identities i on i.user_id=z.completed_by','left join public.staff_identities i on i.user_id=z.completed_by and i.organization_id=s.organization_id');
 updated:=replace(updated,'left join public.staff_identities i on i.user_id=p.id','left join public.staff_identities i on i.user_id=p.id and i.organization_id=s.organization_id');
 if updated=source then raise exception 'Count completion identity scope mismatch';end if;execute updated;
end $migration$;
notify pgrst,'reload schema';
