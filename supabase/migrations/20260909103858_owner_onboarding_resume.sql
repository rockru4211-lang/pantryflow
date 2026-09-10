-- Continue the approved account > business > store > manager flow without
-- recreating an existing organization or treating a profile ID as completion.
create table private.owner_setup_progress (
  user_id uuid primary key references auth.users(id),
  organization_id uuid references public.organizations(id),
  store_id uuid references public.stores(id),
  step text not null check (step in ('business','store','manager','complete')),
  draft jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table private.owner_setup_progress enable row level security;
revoke all on private.owner_setup_progress from public, anon, authenticated;
create policy owner_setup_self_read on private.owner_setup_progress for select to authenticated
  using (user_id = (select auth.uid()));

-- Preserve existing accepted workspaces. A specifically reported incomplete
-- account is resumed separately after its canonical IDs have been verified.
insert into private.owner_setup_progress(user_id,organization_id,store_id,step,completed_at)
select distinct on (o.owner_user_id) o.owner_user_id,o.id,s.id,'complete',o.created_at
from public.organizations o
join public.organization_members om on om.organization_id=o.id and om.user_id=o.owner_user_id and om.is_active and om.is_owner
join public.stores s on s.organization_id=o.id and s.is_active
join public.store_memberships sm on sm.store_id=s.id and sm.user_id=o.owner_user_id and sm.is_active
order by o.owner_user_id,o.created_at,s.is_pilot_store desc,s.created_at,s.id;

create or replace function public.owner_setup(
  p_action text default 'get', p_data jsonb default '{}'::jsonb, p_revision integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if p_action not in ('get','business','store','back_business','back_store','complete') then
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
      where m.user_id=actor and m.is_active) then
      raise exception using errcode='42501',message='OWNER_WORKSPACE_UNAVAILABLE';
    end if;
    return jsonb_build_object('required',false,'step','complete');
  end if;
  if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
    raise exception using errcode='28000',message='OWNER_EMAIL_NOT_VERIFIED';
  end if;
  select * into progress from private.owner_setup_progress where user_id=actor;
  if progress.organization_id is not null and progress.organization_id is distinct from org.id then
    raise exception using errcode='42501',message='OWNER_WORKSPACE_UNAVAILABLE';
  end if;
  if org.id is not null then
    select s.* into first_store from public.stores s
    join public.store_memberships m on m.store_id=s.id and m.user_id=actor and m.is_active and m.role='ADMIN'
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
      update public.profiles set store=next_draft->>'store_name',updated_at=now() where id=actor;
      update private.owner_setup_progress set organization_id=org.id,store_id=first_store.id,step='complete',
        completed_at=now(),updated_at=now(),revision=revision+1 where user_id=actor returning * into progress;
      insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
      values(org.id,'organization',org.id,'OWNER_SETUP_COMPLETED',jsonb_build_object('first_store_id',first_store.id),actor);
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
$$;
revoke all on function public.owner_setup(text,jsonb,integer) from public,anon;
grant execute on function public.owner_setup(text,jsonb,integer) to authenticated;
comment on function public.owner_setup(text,jsonb,integer) is 'Verified-owner-only resumable approved registration, with canonical membership checks and idempotent completion.';
notify pgrst,'reload schema';
