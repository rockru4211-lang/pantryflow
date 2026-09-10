
alter table public.organizations
  add column if not exists store_mode text not null default 'SINGLE',
  add column if not exists has_erp boolean not null default false;

alter table public.organizations
  drop constraint if exists organizations_store_mode_check;
alter table public.organizations
  add constraint organizations_store_mode_check check (store_mode in ('SINGLE','MULTI'));

update public.organizations
set store_mode = case when business_type = 'CHAIN_RESTAURANT' then 'MULTI' else 'SINGLE' end
where store_mode = 'SINGLE';

create or replace function public.create_owner_business_v2(
  p_organization_name text,
  p_store_mode text,
  p_has_erp boolean,
  p_store_name text,
  p_store_code text,
  p_staff_login_mode text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_org_id uuid;
  v_effective_store_name text;
begin
  if p_store_mode not in ('SINGLE','MULTI') then
    raise exception using errcode='22023', message='OWNER_STORE_MODE_INVALID';
  end if;

  v_effective_store_name := case
    when p_store_mode = 'SINGLE' then nullif(btrim(p_organization_name),'')
    else nullif(btrim(p_store_name),'')
  end;

  v_result := public.create_owner_business(
    p_organization_name,
    case when p_store_mode = 'MULTI' then 'CHAIN_RESTAURANT' else 'SINGLE_RESTAURANT' end,
    v_effective_store_name,
    p_store_code,
    p_staff_login_mode
  );

  v_org_id := (v_result->>'organization_id')::uuid;
  update public.organizations
  set store_mode = p_store_mode,
      has_erp = coalesce(p_has_erp,false),
      updated_at = now()
  where id = v_org_id
    and owner_user_id = (select auth.uid());

  return v_result || jsonb_build_object('store_mode',p_store_mode,'has_erp',coalesce(p_has_erp,false));
end;
$function$;

revoke all on function public.create_owner_business_v2(text,text,boolean,text,text,text) from public, anon;
grant execute on function public.create_owner_business_v2(text,text,boolean,text,text,text) to authenticated;
