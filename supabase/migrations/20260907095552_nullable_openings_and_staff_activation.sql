
-- These tables stay private so blind-count clients cannot obtain baselines or activation secrets.
create table private.count_opening_snapshots (
  session_id uuid not null references public.inventory_count_sessions(id),
  product_id uuid not null references public.products(id),
  quantity numeric check (quantity >= 0),
  confirmed_at timestamptz,
  primary key(session_id,product_id)
);
alter table private.count_opening_snapshots enable row level security;
revoke all on private.count_opening_snapshots from public,anon,authenticated;

create table private.staff_activation_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null default now()+interval '7 days',
  consumed_at timestamptz,
  failed_attempts integer not null default 0
);
alter table private.staff_activation_tokens enable row level security;
revoke all on private.staff_activation_tokens from public,anon,authenticated;

create or replace function public.issue_staff_activation(p_user_id uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if length(p_code)<32 or not exists(select 1 from public.staff_identities where user_id=p_user_id and is_active)
    or exists(select 1 from private.staff_pin_credentials where user_id=p_user_id) then
    raise exception 'ACTIVATION_NOT_ALLOWED';
  end if;
  insert into private.staff_activation_tokens(user_id,token_hash)
  values(p_user_id,encode(extensions.digest(p_code,'sha256'),'hex'));
end;
$$;
revoke all on function public.issue_staff_activation(uuid,text) from public,anon,authenticated;
grant execute on function public.issue_staff_activation(uuid,text) to service_role;

create or replace function public.activate_staff_pin(p_store_code text,p_identifier text,p_code text,p_pin text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_token private.staff_activation_tokens%rowtype;
begin
  if p_pin !~ '^[0-9]{6}$' or p_pin is null or p_code is null or length(p_code)>128 then return false; end if;
  select m.user_id into v_user from public.store_memberships m
  join public.stores s on s.id=m.store_id and s.is_active
  join public.staff_identities i on i.user_id=m.user_id and i.is_active
  where lower(s.store_code)=lower(btrim(p_store_code)) and lower(m.login_identifier)=lower(btrim(p_identifier)) and m.is_active;
  if v_user is null then return false; end if;
  select * into v_token from private.staff_activation_tokens where user_id=v_user for update;
  if not found or v_token.consumed_at is not null or v_token.expires_at<=now() or v_token.failed_attempts>=10
    or exists(select 1 from private.staff_pin_credentials where user_id=v_user) then return false; end if;
  if v_token.token_hash<>encode(extensions.digest(p_code,'sha256'),'hex') then
    update private.staff_activation_tokens set failed_attempts=failed_attempts+1 where user_id=v_user;
    return false;
  end if;
  perform public.set_staff_pin(v_user,p_pin);
  update private.staff_activation_tokens set consumed_at=now() where user_id=v_user;
  return true;
end;
$$;
revoke all on function public.activate_staff_pin(text,text,text,text) from public,anon,authenticated;
grant execute on function public.activate_staff_pin(text,text,text,text) to service_role;

create or replace function public.fill_pilot_opening(p_store_id uuid,p_product_id uuid,p_quantity numeric)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_unit text;
begin
  select organization_id into v_org from public.stores where id=p_store_id and is_active for update;
  if v_org is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if p_quantity is null or p_quantity<0 or p_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'OPENING_QUANTITY_REQUIRED'; end if;
  select zp.count_unit into v_unit from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
  where z.store_id=p_store_id and z.is_active and zp.product_id=p_product_id limit 1;
  if v_unit is null then raise exception 'STORE_PRODUCT_REQUIRED'; end if;
  insert into public.store_product_opening_balances(organization_id,store_id,product_id,quantity,unit,created_by)
  values(v_org,p_store_id,p_product_id,p_quantity,v_unit,(select auth.uid()));
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'product',p_product_id,'OPENING_QUANTITY_PROVIDED',jsonb_build_object('store_id',p_store_id,'quantity',p_quantity),(select auth.uid()));
end;
$$;
revoke all on function public.fill_pilot_opening(uuid,uuid,numeric) from public,anon;
grant execute on function public.fill_pilot_opening(uuid,uuid,numeric) to authenticated;

create or replace function public.get_pilot_inventory_catalog(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',p.id,'name',p.name,'unit',zp.count_unit,'zone',z.name,'quantity',b.quantity,
    'imported_at',r.created_at,'supplier',r.normalized_values->>'supplier','sheet',r.sheet_name,'source_row',r.source_row
  ) order by z.sort_order,zp.sort_order,p.id),'[]'::jsonb) into v_result
  from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
  join public.products p on p.id=zp.product_id
  left join public.store_product_opening_balances b on b.store_id=p_store_id and b.product_id=p.id
  left join lateral(select ir.* from public.inventory_import_rows ir where ir.store_id=p_store_id and ir.product_id=p.id and ir.status in ('ADDED','EXISTING') order by ir.created_at,ir.id limit 1) r on true
  where z.store_id=p_store_id and z.is_active;
  return v_result;
end;
$$;
revoke all on function public.get_pilot_inventory_catalog(uuid) from public,anon;
grant execute on function public.get_pilot_inventory_catalog(uuid) to authenticated;

create or replace function public.get_pilot_count_details(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.inventory_count_sessions%rowtype; v_result jsonb;
begin
  select * into v_session from public.inventory_count_sessions where id=p_session_id;
  if not found or not private.has_active_store_role(v_session.store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if v_session.status not in ('REVIEWING','CLOSED') then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'name',coalesce(s.item->>'product_name',p.name),'unit',e.unit,'zone',coalesce(s.item->>'zone_name',z.name),
    'quantity',e.quantity,'opening_quantity',b.quantity,'entered_at',e.entered_at,'entered_by',coalesce(si.display_name,pr.display_name),
    'product_id',e.product_id
  ) order by s.ordinality,e.entered_at),'[]'::jsonb) into v_result
  from public.count_entries e
  join public.products p on p.id=e.product_id
  join public.count_zones z on z.id=e.zone_id
  left join lateral(select item,ordinality from jsonb_array_elements(v_session.snapshot->'zones') with ordinality a(item,ordinality)
    where item->>'zone_id'=e.zone_id::text and item->>'product_id'=e.product_id::text limit 1) s on true
  left join private.count_opening_snapshots b on b.session_id=e.session_id and b.product_id=e.product_id
  left join public.staff_identities si on si.user_id=e.entered_by
  left join public.profiles pr on pr.id=e.entered_by
  where e.session_id=p_session_id and e.entry_type='INITIAL_COUNT';
  return v_result;
end;
$$;
revoke all on function public.get_pilot_count_details(uuid) from public,anon;
grant execute on function public.get_pilot_count_details(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.create_pilot_count_session(p_store_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := (select auth.uid()); v_org uuid; v_session uuid; v_snapshot jsonb;
begin
  select organization_id into v_org from public.stores where id=p_store_id and is_active for update;
  if v_org is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if not exists(select 1 from public.count_zones where store_id=p_store_id and is_active) then
    raise exception using errcode='22023',message='COUNT_ZONE_REQUIRED';
  end if;
  if exists(select 1 from public.count_zones z where z.store_id=p_store_id and z.is_active
    and not exists(select 1 from public.zone_products zp where zp.zone_id=z.id)) then
    raise exception using errcode='22023',message='ZONE_PRODUCTS_REQUIRED';
  end if;
  if exists(select 1 from public.inventory_count_sessions where store_id=p_store_id and status in('DRAFT','IN_PROGRESS','REVIEWING')) then
    raise exception using errcode='22023',message='ACTIVE_COUNT_SESSION_EXISTS';
  end if;
  select jsonb_build_object('created_at',now(),'opening_captured',true,'zones',coalesce(jsonb_agg(jsonb_build_object(
    'zone_id',z.id,'zone_name',z.name,'product_id',p.id,'product_code',p.product_code,
    'product_name',p.name,'unit',zp.count_unit) order by z.sort_order,zp.sort_order),'[]'::jsonb))
  into v_snapshot
  from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
  join public.products p on p.id=zp.product_id where z.store_id=p_store_id and z.is_active and p.is_active;
  insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot)
  values(v_org,p_store_id,v_user,'IN_PROGRESS',v_snapshot) returning id into v_session;
  insert into private.count_opening_snapshots(session_id,product_id,quantity,confirmed_at)
  select v_session,zp.product_id,b.quantity,b.created_at
  from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
  left join public.store_product_opening_balances b on b.store_id=p_store_id and b.product_id=zp.product_id
  where z.store_id=p_store_id and z.is_active
  group by zp.product_id,b.quantity,b.created_at;
  insert into public.count_zone_progress(organization_id,session_id,zone_id,status)
  select v_org,v_session,id,'NOT_STARTED' from public.count_zones where store_id=p_store_id and is_active;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'inventory_count_session',v_session,'COUNT_SESSION_CREATED',jsonb_build_object('store_id',p_store_id),v_user);
  return v_session;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.complete_pilot_count_zone(p_session_id uuid, p_zone_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_store uuid;
  v_expected integer;
  v_actual integer;
begin
  select organization_id, store_id
  into v_org, v_store
  from public.inventory_count_sessions
  where id = p_session_id
    and status = 'IN_PROGRESS' for update;

  if v_store is null or not private.has_active_store_role(v_store, null) then
    raise exception using errcode = '42501', message = 'ACTIVE_STORE_MEMBERSHIP_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.count_zone_progress
    where session_id = p_session_id
      and zone_id = p_zone_id
      and status <> 'COMPLETED'
  ) then
    raise exception using errcode = '22023', message = 'COUNT_ZONE_NOT_AVAILABLE';
  end if;

  select count(*) into v_expected
  from public.zone_products
  where zone_id = p_zone_id;

  select count(*) into v_actual
  from public.count_drafts
  where session_id = p_session_id
    and zone_id = p_zone_id
    and entered_by = v_user;

  if v_expected = 0 or v_actual <> v_expected then
    raise exception using errcode = '22023', message = 'COUNT_ZONE_INCOMPLETE';
  end if;

  insert into public.count_entries(
    organization_id,
    session_id,
    zone_id,
    product_id,
    quantity,
    unit,
    entered_by,
    entry_type
  )
  select organization_id, session_id, zone_id, product_id, quantity, unit, v_user, 'INITIAL_COUNT'
  from public.count_drafts
  where session_id = p_session_id
    and zone_id = p_zone_id
    and entered_by = v_user;

  delete from public.count_drafts
  where session_id = p_session_id
    and zone_id = p_zone_id
    and entered_by = v_user;

  update public.count_zone_progress
  set status = 'COMPLETED', completed_by = v_user, completed_at = now()
  where session_id = p_session_id
    and zone_id = p_zone_id;

  insert into public.audit_logs(
    organization_id,
    entity_type,
    entity_id,
    action,
    new_value,
    user_id
  )
  values (
    v_org,
    'inventory_count_session',
    p_session_id,
    'COUNT_ZONE_COMPLETED',
    jsonb_build_object('zone_id', p_zone_id),
    v_user
  );

  if not exists (
    select 1
    from public.count_zone_progress
    where session_id = p_session_id
      and status <> 'COMPLETED'
  ) then
    insert into public.inventory_count_discrepancies(
      organization_id,
      session_id,
      zone_id,
      product_id,
      initial_entry_id,
      previous_quantity,
      previous_confirmed_at,
      estimated_quantity,
      difference,
      status
    )
    select
      v_org,
      p_session_id,
      (array_agg(e.zone_id order by e.entered_at))[1],
      e.product_id,
      (array_agg(e.id order by e.entered_at))[1],
      b.quantity,
      b.created_at,
      sum(e.quantity),
      sum(e.quantity) - b.quantity,
      'PENDING'
    from public.count_entries e
    join (
      select product_id,quantity,confirmed_at as created_at from private.count_opening_snapshots where session_id=p_session_id
      union all
      select product_id,quantity,created_at from public.store_product_opening_balances
      where store_id=v_store and not exists(
        select 1 from public.inventory_count_sessions s where s.id=p_session_id and s.snapshot->>'opening_captured'='true'
      )
    ) b on b.product_id=e.product_id and b.quantity is not null
    where e.session_id = p_session_id
      and e.entry_type = 'INITIAL_COUNT'
    group by e.product_id, b.quantity, b.created_at
    having sum(e.quantity) <> b.quantity
    on conflict (session_id, zone_id, product_id) do nothing;

    update public.inventory_count_sessions
    set
      status = case
        when exists (
          select 1
          from public.inventory_count_discrepancies
          where session_id = p_session_id
        ) then 'REVIEWING'::public.count_session_status
        else 'CLOSED'::public.count_session_status
      end,
      completed_at = now()
    where id = p_session_id;
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_pilot_product(p_store_id uuid, p_product_code text, p_name text, p_count_unit text, p_purchase_unit text, p_opening_quantity numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_product uuid;
begin
  select organization_id into v_org from public.stores where id = p_store_id and is_active;
  if v_org is null or not private.has_active_store_role(p_store_id, array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'STORE_MANAGER_REQUIRED';
  end if;
  if btrim(coalesce(p_product_code,'')) = '' or btrim(coalesce(p_name,'')) = ''
    or btrim(coalesce(p_count_unit,'')) = '' or btrim(coalesce(p_purchase_unit,'')) = ''
    or p_opening_quantity < 0 or p_opening_quantity::text in ('NaN','Infinity','-Infinity') then
    raise exception using errcode = '22023', message = 'INVALID_PRODUCT_SETUP';
  end if;

  insert into public.products(
    organization_id, product_code, name, category, base_unit, count_unit
  ) values (
    v_org, upper(btrim(p_product_code)), btrim(p_name), '其他',
    btrim(p_purchase_unit), btrim(p_count_unit)
  ) returning id into v_product;

  if p_opening_quantity is not null then
  insert into public.store_product_opening_balances(
    organization_id, store_id, product_id, quantity, unit, created_by
  ) values (v_org, p_store_id, v_product, p_opening_quantity, btrim(p_count_unit), v_user);
  end if;

  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values (v_org,'product',v_product,'PILOT_PRODUCT_CREATED',jsonb_build_object(
    'store_id',p_store_id,'product_code',upper(btrim(p_product_code)),
    'opening_quantity',p_opening_quantity
  ),v_user);
  return v_product;
end;
$function$
;
