
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
  v_role public.app_role := 'LOGISTICS';
  v_manage boolean;
  v_store uuid;
  v_login text;
  v_extra text[];
begin
  if auth.uid() is null or not private.can_manage_business(p_store_id) then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;

  select s.organization_id,o.owner_user_id into v_org,v_owner
  from public.stores s
  join public.organizations o on o.id=s.organization_id
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

  if exists(
    select 1
    from unnest(coalesce(p_store_ids,'{}'::uuid[])) x
    where not exists(
      select 1 from public.stores s
      where s.id=x and s.organization_id=v_org and s.is_active and s.name in ('BeApe','Gras')
    )
  ) then
    raise exception 'INVALID_STORE_SCOPE' using errcode='22023';
  end if;

  if exists(
    select 1 from unnest(coalesce(p_permissions,'{}'::text[])) x
    where x not in ('REPORTS_VIEW','DATA_EXPORT')
  ) then
    raise exception 'INVALID_FEATURE_PERMISSION' using errcode='22023';
  end if;

  -- 百花猿：職稱決定基本管理權限。
  -- 營運／行政可管理人員與門市；財務預設為查看資料。
  v_manage:=p_company_title in ('營運','行政');

  -- 公司管理層預設可查看報表；資料匯出屬少量例外權限。
  v_extra:=array['REPORTS_VIEW']::text[];
  if 'DATA_EXPORT'=any(coalesce(p_permissions,'{}'::text[])) then
    v_extra:=array_append(v_extra,'DATA_EXPORT');
  end if;

  update public.staff_identities
  set display_name=btrim(p_display_name),job_title=p_company_title,updated_at=now()
  where organization_id=v_org and user_id=p_user_id;

  if not found then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002'; end if;

  update public.organization_members
  set role=v_role,work_role=v_role,can_manage_business=v_manage
  where organization_id=v_org and user_id=p_user_id and is_active;

  for v_store in
    select s.id from public.stores s
    where s.organization_id=v_org and s.is_active and s.name in ('BeApe','Gras')
  loop
    if v_store=any(coalesce(p_store_ids,'{}'::uuid[])) then
      select sm.login_identifier into v_login
      from public.store_memberships sm
      where sm.store_id=v_store and sm.user_id=p_user_id;

      if v_login is null then
        v_login:='company-'||substr(replace(p_user_id::text,'-',''),1,12);
      end if;

      insert into public.store_memberships(
        store_id,organization_id,user_id,login_identifier,role,work_role,is_active,
        assigned_by,can_manage_business,extra_permissions,display_name
      )
      values(
        v_store,v_org,p_user_id,v_login,v_role,v_role,true,auth.uid(),v_manage,v_extra,btrim(p_display_name)
      )
      on conflict(store_id,user_id) do update set
        role=excluded.role,
        work_role=excluded.work_role,
        is_active=true,
        assigned_by=auth.uid(),
        can_manage_business=excluded.can_manage_business,
        extra_permissions=excluded.extra_permissions,
        display_name=excluded.display_name,
        updated_at=now();
    else
      update public.store_memberships
      set is_active=false,updated_at=now()
      where store_id=v_store and user_id=p_user_id;
    end if;
  end loop;

  insert into public.audit_logs(
    organization_id,user_id,entity_type,entity_id,action,new_value
  )
  values(
    v_org,auth.uid(),'partner',p_user_id::text,'BAIHUAYUAN_PARTNER_UPDATED',
    jsonb_build_object(
      'company_title',p_company_title,
      'store_ids',to_jsonb(p_store_ids),
      'permissions',to_jsonb(v_extra),
      'can_manage_business',v_manage
    )
  );

  return jsonb_build_object(
    'saved',true,
    'user_id',p_user_id,
    'company_title',p_company_title,
    'permissions',to_jsonb(v_extra),
    'can_manage_business',v_manage
  );
end;
$$;

-- 金額／庫存確認權限跟著公司職稱走：
-- Owner、營運、行政可確認；財務維持查看已確認資料。
create or replace function private.baihuayuan_can_confirm_backoffice(p_store uuid)
returns boolean
language sql
stable security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.stores s
    join public.organizations o on o.id=s.organization_id
    left join public.organization_members om
      on om.organization_id=s.organization_id and om.user_id=auth.uid() and om.is_active
    left join public.staff_identities si
      on si.organization_id=s.organization_id and si.user_id=auth.uid() and si.is_active
    where s.id=p_store
      and s.is_active
      and (
        o.owner_user_id=auth.uid()
        or coalesce(om.is_owner,false)
        or si.job_title in ('營運','行政')
      )
  );
$$;

revoke all on function private.baihuayuan_can_confirm_backoffice(uuid) from public,anon,authenticated;

do $patch$
declare
  src text;
  original text;
begin
  select pg_get_functiondef('private.confirm_store_transfer(uuid,jsonb)'::regprocedure) into src;
  original:=src;
  src:=replace(
    src,
    'if not ('||chr(10)||'    private.app_role(p_store) in (''LOGISTICS'',''OWNER'')'||chr(10)||'    or private.can_manage_business(p_store)'||chr(10)||'  ) then',
    'if not private.baihuayuan_can_confirm_backoffice(p_store) then'
  );
  if src<>original then execute src; end if;

  select pg_get_functiondef('public.confirm_baihuayuan_waste(uuid,uuid,numeric,numeric)'::regprocedure) into src;
  original:=src;
  src:=replace(
    src,
    'if not ('||chr(10)||'    private.app_role(p_store_id) in (''LOGISTICS'',''OWNER'')'||chr(10)||'    or private.can_manage_business(p_store_id)'||chr(10)||'  ) then',
    'if not private.baihuayuan_can_confirm_backoffice(p_store_id) then'
  );
  if src<>original then execute src; end if;
end
$patch$;
