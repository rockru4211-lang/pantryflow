
create or replace function public.get_baihuayuan_partners(p_store_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null or not private.can_manage_members(p_store_id) then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;
  select organization_id into v_org from public.stores where id=p_store_id;

  return jsonb_build_object(
    'partners',
    (
      select coalesce(jsonb_agg(partner order by
        case partner->>'company_title'
          when '老闆' then 1
          when '營運' then 2
          when '行政' then 3
          when '財務' then 4
          else 9
        end,
        partner->>'display_name'
      ),'[]'::jsonb)
      from (
        select jsonb_build_object(
          'user_id',om.user_id,
          'display_name',coalesce(si.display_name,p.display_name,'未命名夥伴'),
          'company_title',case
            when coalesce(om.is_owner,false) or o.owner_user_id=om.user_id then '老闆'
            when si.job_title in ('營運','行政','財務') then si.job_title
            when coalesce(om.can_manage_business,false) and coalesce(om.work_role,om.role)::text='LOGISTICS' then '行政'
            else null
          end,
          'role',coalesce(om.work_role,om.role)::text,
          'is_owner',coalesce(om.is_owner,false) or o.owner_user_id=om.user_id,
          'can_manage_business',coalesce(om.can_manage_business,false),
          'email',case when u.email not like '%@auth.pantryflow.invalid' then u.email end,
          'company_member',(
            coalesce(om.is_owner,false) or o.owner_user_id=om.user_id
            or si.job_title in ('營運','行政','財務')
            or coalesce(om.can_manage_business,false)
            or coalesce(om.work_role,om.role)::text='LOGISTICS'
          ),
          'stores',(
            select coalesce(jsonb_agg(jsonb_build_object(
              'id',s.id,
              'name',s.name,
              'store_code',s.store_code,
              'role',coalesce(sm.work_role,sm.role)::text,
              'login_identifier',sm.login_identifier,
              'can_manage_business',sm.can_manage_business,
              'extra_permissions',to_jsonb(sm.extra_permissions),
              'uses_pin',exists(select 1 from private.staff_pin_credentials c where c.user_id=sm.user_id)
                or exists(select 1 from private.staff_activation_tokens t where t.user_id=sm.user_id)
            ) order by case s.name when 'BeApe' then 1 when 'Gras' then 2 else 9 end,s.name),'[]'::jsonb)
            from public.store_memberships sm
            join public.stores s on s.id=sm.store_id
            where sm.organization_id=v_org
              and sm.user_id=om.user_id
              and sm.is_active
              and s.is_active
              and s.name in ('BeApe','Gras')
          )
        ) partner
        from public.organization_members om
        join public.organizations o on o.id=om.organization_id
        left join public.staff_identities si on si.organization_id=om.organization_id and si.user_id=om.user_id
        left join public.profiles p on p.id=om.user_id
        left join auth.users u on u.id=om.user_id
        where om.organization_id=v_org and om.is_active and coalesce(si.is_active,true)
      ) q
    )
  );
end;
$$;

create or replace function public.save_baihuayuan_company_partner(
  p_store_id uuid,
  p_user_id uuid,
  p_display_name text,
  p_company_title text,
  p_store_ids uuid[],
  p_permissions text[]
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_owner uuid;
  v_role public.app_role;
  v_manage boolean;
  v_store uuid;
  v_login text;
begin
  if auth.uid() is null or not private.can_manage_business(p_store_id) then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;
  select s.organization_id,o.owner_user_id into v_org,v_owner
  from public.stores s join public.organizations o on o.id=s.organization_id
  where s.id=p_store_id;

  if p_user_id=v_owner or exists(
    select 1 from public.organization_members
    where organization_id=v_org and user_id=p_user_id and is_owner
  ) then
    raise exception 'OWNER_PROFILE_LOCKED' using errcode='42501';
  end if;

  if btrim(coalesce(p_display_name,''))='' or p_company_title not in ('營運','行政','財務') then
    raise exception 'INVALID_COMPANY_PARTNER' using errcode='22023';
  end if;

  if exists(select 1 from unnest(coalesce(p_store_ids,'{}'::uuid[])) x
    where not exists(select 1 from public.stores s where s.id=x and s.organization_id=v_org and s.is_active and s.name in ('BeApe','Gras')))
  then raise exception 'INVALID_STORE_SCOPE' using errcode='22023'; end if;

  if exists(select 1 from unnest(coalesce(p_permissions,'{}'::text[])) x
    where x not in ('PERSONNEL_MANAGE','RECEIPT_REVIEW','REPORTS_VIEW','DATA_EXPORT'))
  then raise exception 'INVALID_FEATURE_PERMISSION' using errcode='22023'; end if;

  v_role:='LOGISTICS';
  v_manage:=p_company_title in ('營運','行政') and 'PERSONNEL_MANAGE'=any(coalesce(p_permissions,'{}'::text[]));

  update public.staff_identities
  set display_name=btrim(p_display_name),job_title=p_company_title,updated_at=now()
  where organization_id=v_org and user_id=p_user_id;

  if not found then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002'; end if;

  update public.organization_members
  set role=v_role,work_role=v_role,can_manage_business=v_manage
  where organization_id=v_org and user_id=p_user_id and is_active;

  for v_store in select s.id from public.stores s
    where s.organization_id=v_org and s.is_active and s.name in ('BeApe','Gras')
  loop
    if v_store=any(coalesce(p_store_ids,'{}'::uuid[])) then
      select sm.login_identifier into v_login from public.store_memberships sm
      where sm.store_id=v_store and sm.user_id=p_user_id;
      if v_login is null then v_login:='company-'||substr(replace(p_user_id::text,'-',''),1,12); end if;
      insert into public.store_memberships(
        store_id,organization_id,user_id,login_identifier,role,work_role,is_active,assigned_by,can_manage_business,extra_permissions,display_name
      ) values(
        v_store,v_org,p_user_id,v_login,v_role,v_role,true,auth.uid(),v_manage,
        array(select x from unnest(coalesce(p_permissions,'{}'::text[])) x where x in ('REPORTS_VIEW','DATA_EXPORT')),
        btrim(p_display_name)
      )
      on conflict(store_id,user_id) do update set
        role=excluded.role,work_role=excluded.work_role,is_active=true,assigned_by=auth.uid(),
        can_manage_business=excluded.can_manage_business,extra_permissions=excluded.extra_permissions,
        display_name=excluded.display_name,updated_at=now();
    else
      update public.store_memberships set is_active=false,updated_at=now()
      where store_id=v_store and user_id=p_user_id;
    end if;
  end loop;

  insert into public.audit_logs(organization_id,user_id,entity_type,entity_id,action,new_value)
  values(v_org,auth.uid(),'partner',p_user_id::text,'BAIHUAYUAN_PARTNER_UPDATED',
    jsonb_build_object('company_title',p_company_title,'store_ids',to_jsonb(p_store_ids),'permissions',to_jsonb(p_permissions)));

  return jsonb_build_object('saved',true,'user_id',p_user_id);
end;
$$;

create or replace function public.remove_baihuayuan_partner(
  p_store_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_owner uuid;
  v_refs integer:=0;
begin
  if auth.uid() is null or not private.can_manage_business(p_store_id) then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;
  select s.organization_id,o.owner_user_id into v_org,v_owner
  from public.stores s join public.organizations o on o.id=s.organization_id
  where s.id=p_store_id;

  if p_user_id=auth.uid() or p_user_id=v_owner or exists(
    select 1 from public.organization_members where organization_id=v_org and user_id=p_user_id and is_owner
  ) then raise exception 'CANNOT_REMOVE_OWNER_OR_SELF' using errcode='42501'; end if;

  select
    (select count(*) from public.count_entries where entered_by=p_user_id)
    +(select count(*) from public.inventory_count_sessions where started_by=p_user_id)
    +(select count(*) from public.receipt_upload_batches where uploaded_by=p_user_id)
    +(select count(*) from public.goods_receipts where reviewed_by=p_user_id)
    +(select count(*) from private.store_movements where created_by=p_user_id)
    +(select count(*) from private.store_movement_events where actor_id=p_user_id)
    +(select count(*) from private.waste_records where created_by=p_user_id)
    +(select count(*) from private.app_records where created_by=p_user_id or completed_by=p_user_id or responsible_id=p_user_id)
  into v_refs;

  if v_refs>0 then
    raise exception 'PARTNER_HAS_HISTORY' using errcode='23503';
  end if;

  delete from private.member_zone_responsibilities where user_id=p_user_id
    and store_id in (select id from public.stores where organization_id=v_org);
  delete from private.app_delegations where user_id=p_user_id
    and store_id in (select id from public.stores where organization_id=v_org);
  delete from private.app_session_access where user_id=p_user_id
    and store_id in (select id from public.stores where organization_id=v_org);
  delete from private.app_devices where user_id=p_user_id
    and store_id in (select id from public.stores where organization_id=v_org);
  delete from private.staff_activation_tokens where user_id=p_user_id;
  delete from private.staff_pin_credentials where user_id=p_user_id;
  delete from private.staff_login_attempts where user_id=p_user_id;
  delete from private.management_invites where user_id=p_user_id and organization_id=v_org;
  delete from public.store_memberships where organization_id=v_org and user_id=p_user_id;
  delete from public.staff_identities where organization_id=v_org and user_id=p_user_id;
  delete from public.organization_members where organization_id=v_org and user_id=p_user_id;

  update public.profiles
  set organization_id=null,role=null,store=''
  where id=p_user_id and organization_id=v_org;

  insert into public.audit_logs(organization_id,user_id,entity_type,entity_id,action,new_value)
  values(v_org,auth.uid(),'partner',p_user_id::text,'BAIHUAYUAN_PARTNER_REMOVED',jsonb_build_object('removed',true));

  return jsonb_build_object('removed',true,'user_id',p_user_id);
end;
$$;

revoke all on function public.save_baihuayuan_company_partner(uuid,uuid,text,text,uuid[],text[]) from public;
revoke all on function public.remove_baihuayuan_partner(uuid,uuid) from public;
grant execute on function public.save_baihuayuan_company_partner(uuid,uuid,text,text,uuid[],text[]) to authenticated;
grant execute on function public.remove_baihuayuan_partner(uuid,uuid) to authenticated;
