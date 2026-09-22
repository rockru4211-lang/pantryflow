
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
            when coalesce(om.work_role,om.role)::text='LOGISTICS' then '行政'
            else null
          end,
          'role',coalesce(om.work_role,om.role)::text,
          'is_owner',coalesce(om.is_owner,false) or o.owner_user_id=om.user_id,
          'can_manage_business',coalesce(om.can_manage_business,false),
          'email',case when u.email not like '%@auth.pantryflow.invalid' then u.email end,
          'company_member',(
            coalesce(om.is_owner,false) or o.owner_user_id=om.user_id
            or si.job_title in ('營運','行政','財務')
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
