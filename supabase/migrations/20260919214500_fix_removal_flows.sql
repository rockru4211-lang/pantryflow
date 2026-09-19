begin;

alter table public.inventory_import_files
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.profiles(id);

create or replace function private.prevent_pilot_history_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_table_schema='public'
     and tg_table_name='store_product_opening_balances'
     and current_setting('app.opening_balance_maintenance',true)='on'
     and auth.uid() is not null
     and private.can_import_inventory(coalesce(old.store_id,new.store_id))
  then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'PILOT_HISTORY_IS_APPEND_ONLY';
end;
$$;

create or replace function public.undo_inventory_import_batch(p_store_id uuid, p_file_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_org uuid;
  v_file_id uuid;
  v_active_session uuid;
  v_removed integer:=0;
  v_protected integer:=0;
begin
  if v_user is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_org is null or not private.can_import_inventory(p_store_id) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  select id into v_file_id
  from public.inventory_import_files
  where store_id=p_store_id and file_sha256=p_file_sha256 and removed_at is null
  order by created_at desc limit 1;
  if v_file_id is null then raise exception using errcode='22023',message='IMPORT_NOT_FOUND'; end if;

  create temporary table tmp_undo_products(product_id uuid primary key, protected boolean default false) on commit drop;
  insert into tmp_undo_products(product_id)
  select distinct product_id from public.inventory_import_rows
  where import_file_id=v_file_id and product_id is not null and status='ADDED';

  update tmp_undo_products t set protected=true
  where exists(select 1 from public.count_entries ce join public.inventory_count_sessions s on s.id=ce.session_id where s.store_id=p_store_id and ce.product_id=t.product_id)
     or exists(select 1 from public.count_drafts cd join public.inventory_count_sessions s on s.id=cd.session_id where s.store_id=p_store_id and cd.product_id=t.product_id and cd.quantity is not null)
     or exists(select 1 from public.inventory_count_discrepancies d join public.inventory_count_sessions s on s.id=d.session_id where s.store_id=p_store_id and d.product_id=t.product_id)
     or exists(select 1 from public.inventory_import_rows r where r.product_id=t.product_id and r.import_file_id<>v_file_id and r.status in ('ADDED','EXISTING'));

  select count(*) into v_protected from tmp_undo_products where protected;

  select id into v_active_session from public.inventory_count_sessions
  where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS') order by started_at desc limit 1;

  if v_active_session is not null then
    update public.inventory_count_sessions s
    set snapshot=jsonb_set(
      s.snapshot,'{zones}',
      coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(s.snapshot->'zones','[]'::jsonb)) item
        where not exists(select 1 from tmp_undo_products t where not t.protected and t.product_id::text=item->>'product_id')),'[]'::jsonb),true)
    where s.id=v_active_session;

    delete from private.count_opening_snapshots os
    using tmp_undo_products t
    where os.session_id=v_active_session and os.product_id=t.product_id and not t.protected;

    delete from public.count_zone_progress zp
    where zp.session_id=v_active_session and not exists(
      select 1 from jsonb_array_elements((select snapshot->'zones' from public.inventory_count_sessions where id=v_active_session)) item
      where item->>'zone_id'=zp.zone_id::text
    );
  end if;

  delete from public.zone_products zp
  using public.count_zones z,tmp_undo_products t
  where zp.zone_id=z.id and z.store_id=p_store_id and zp.product_id=t.product_id and not t.protected;

  perform set_config('app.opening_balance_maintenance','on',true);
  delete from public.store_product_opening_balances b
  using tmp_undo_products t
  where b.store_id=p_store_id and b.product_id=t.product_id and b.source='FILE_IMPORT' and not t.protected;
  perform set_config('app.opening_balance_maintenance','off',true);

  update public.products p set is_active=false,updated_at=now()
  where exists(select 1 from tmp_undo_products t where t.product_id=p.id and not t.protected)
    and not exists(select 1 from public.zone_products zp where zp.product_id=p.id);

  update public.inventory_import_rows r
  set status='SKIPPED',reason=case when exists(select 1 from tmp_undo_products t where t.product_id=r.product_id and t.protected)
    then '本次匯入要求移除，但此品項已有後續紀錄，已保留'
    else '本次匯入已移除' end,updated_at=now()
  where r.import_file_id=v_file_id and r.product_id is not null;

  select count(*) into v_removed from tmp_undo_products where not protected;

  if v_protected=0 then
    update public.inventory_import_files set removed_at=now(),removed_by=v_user where id=v_file_id;
  end if;

  return jsonb_build_object('removed',v_removed,'protected',v_protected,'hidden',v_protected=0);
end;
$$;

create or replace function public.remove_single_imported_product_safely(p_store_id uuid, p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_active_session uuid;
  v_has_usage boolean;
begin
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_org is null or not private.can_import_inventory(p_store_id) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;

  if not exists(
    select 1 from public.inventory_import_rows r
    where r.store_id=p_store_id and r.product_id=p_product_id and r.status='ADDED'
  ) then
    raise exception using errcode='22023',message='IMPORTED_PRODUCT_ONLY';
  end if;

  select exists(
    select 1 from public.count_entries ce
    join public.inventory_count_sessions s on s.id=ce.session_id
    where s.store_id=p_store_id and ce.product_id=p_product_id
    union all
    select 1 from public.count_drafts cd
    join public.inventory_count_sessions s on s.id=cd.session_id
    where s.store_id=p_store_id and cd.product_id=p_product_id and cd.quantity is not null
  ) into v_has_usage;

  if v_has_usage then
    raise exception using errcode='22023',message='PRODUCT_ALREADY_COUNTED';
  end if;

  select id into v_active_session from public.inventory_count_sessions
  where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS')
  order by started_at desc limit 1;

  if v_active_session is not null then
    delete from public.count_drafts where session_id=v_active_session and product_id=p_product_id;
    delete from private.count_opening_snapshots where session_id=v_active_session and product_id=p_product_id;
    update public.inventory_count_sessions s
    set snapshot=jsonb_set(
      s.snapshot,'{zones}',
      coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(s.snapshot->'zones','[]'::jsonb)) item where item->>'product_id'<>p_product_id::text),'[]'::jsonb),true)
    where s.id=v_active_session;
  end if;

  delete from public.zone_products zp
  using public.count_zones z
  where zp.zone_id=z.id and z.store_id=p_store_id and zp.product_id=p_product_id;

  perform set_config('app.opening_balance_maintenance','on',true);
  delete from public.store_product_opening_balances
  where store_id=p_store_id and product_id=p_product_id and source='FILE_IMPORT';
  perform set_config('app.opening_balance_maintenance','off',true);

  update public.products set is_active=false,updated_at=now()
  where id=p_product_id and organization_id=v_org;

  update public.inventory_import_rows
  set status='SKIPPED',reason='使用者於建檔確認時移除',updated_at=now()
  where store_id=p_store_id and product_id=p_product_id and status='ADDED';

  return jsonb_build_object('removed',true,'product_id',p_product_id);
end;
$$;

create or replace function public.reset_pilot_count_setup(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_org uuid;
  v_active_sessions integer:=0;
  v_products integer:=0;
  v_zones integer:=0;
begin
  if v_actor is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  select organization_id into v_org from public.stores where id=p_store_id and is_active for update;
  if v_org is null or not private.can_import_inventory(p_store_id) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;

  select count(*) into v_active_sessions
  from public.inventory_count_sessions
  where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS');

  create temporary table tmp_reset_sessions(id uuid primary key) on commit drop;
  insert into tmp_reset_sessions(id)
  select id from public.inventory_count_sessions
  where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS');

  delete from public.inventory_count_discrepancies d using tmp_reset_sessions s where d.session_id=s.id;
  delete from public.count_drafts d using tmp_reset_sessions s where d.session_id=s.id;
  delete from public.count_zone_progress p using tmp_reset_sessions s where p.session_id=s.id;
  delete from private.count_opening_snapshots o using tmp_reset_sessions s where o.session_id=s.id;
  delete from public.inventory_count_sessions s where s.id in (select id from tmp_reset_sessions);

  select count(distinct zp.product_id) into v_products
  from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
  where z.store_id=p_store_id and z.is_active;

  delete from public.zone_products zp
  using public.count_zones z
  where zp.zone_id=z.id and z.store_id=p_store_id and z.is_active;

  perform set_config('app.opening_balance_maintenance','on',true);
  delete from public.store_product_opening_balances where store_id=p_store_id;
  perform set_config('app.opening_balance_maintenance','off',true);

  delete from private.count_next_exclusions where store_id=p_store_id;

  select count(*) into v_zones from public.count_zones where store_id=p_store_id and is_active;
  update public.count_zones
  set is_active=false,
      name=name||' · 重建-'||substr(id::text,1,8)
  where store_id=p_store_id and is_active;

  update public.inventory_import_files
  set removed_at=coalesce(removed_at,now()),removed_by=coalesce(removed_by,v_actor)
  where store_id=p_store_id and removed_at is null;

  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,p_store_id,'store',p_store_id,'COUNT_SETUP_RESET',
    jsonb_build_object('products_unlinked',v_products,'zones_archived',v_zones,'active_counts_removed',v_active_sessions),v_actor);

  return jsonb_build_object(
    'products_unlinked',v_products,
    'zones_archived',v_zones,
    'active_counts_removed',v_active_sessions
  );
end;
$$;

create or replace function private.store_delete_blockers(s uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
declare r record;n bigint;result jsonb:='[]';begin
 for r in
  select distinct ns.nspname,cl.relname,a.attname
  from pg_constraint fk
  join pg_class cl on cl.oid=fk.conrelid
  join pg_namespace ns on ns.oid=cl.relnamespace
  cross join lateral generate_subscripts(fk.conkey,1) idx
  join pg_attribute a on a.attrelid=cl.oid and a.attnum=fk.conkey[idx]
  join pg_attribute parent on parent.attrelid=fk.confrelid and parent.attnum=fk.confkey[idx]
  where fk.contype='f' and fk.confrelid='public.stores'::regclass and parent.attname='id'
    and cl.relname not in ('app_settings','app_attempts','app_devices','app_session_access','owner_setup_progress','staff_activation_tokens','staff_login_attempts','store_memberships','trial_stores')
 loop
  execute format('select count(*) from %I.%I where %I=$1',r.nspname,r.relname,r.attname) into n using s;
  if n>0 then result:=result||jsonb_build_array(jsonb_build_object('source',r.relname,'count',n));end if;
 end loop;
 return result;
end;
$$;

create or replace function private.managed_store_cards()
returns jsonb
language sql
stable security definer
set search_path=''
as $$
 select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('can_delete',private.store_delete_blockers(s.id)='[]'::jsonb) order by s.is_active desc,s.created_at,s.id),'[]')
 from public.stores s where private.can_manage_store_scope(s.id)
$$;

create or replace function private.store_lifecycle(anchor uuid, action text, d jsonb, request uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare target uuid:=(d->>'id')::uuid;s public.stores;cached private.store_lifecycle_requests;refs jsonb;result jsonb;old jsonb;begin
 if request is null or target is null or auth.uid() is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,107));
 select * into cached from private.store_lifecycle_requests where request_id=request;
 select * into s from public.stores where id=target for update;
 if not found then
  if action='store.delete' and cached.actor_id=auth.uid() and cached.target_id=target and cached.action=action and cached.payload=d and private.can_manage_store_scope(anchor) then return cached.result;end if;
  raise exception 'STORE_NOT_FOUND' using errcode='P0002';
 end if;
 if not private.can_manage_store_scope(target) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if cached.request_id is not null then
  if cached.actor_id<>auth.uid() or cached.target_id<>target or cached.action<>action or cached.payload<>d then raise exception 'REQUEST_CONFLICT' using errcode='40001';end if;return cached.result;
 end if;
 if d->>'store_code' is distinct from s.store_code or d->>'name' is distinct from s.name or (d->>'updated_at')::timestamptz is distinct from s.updated_at then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 old:=to_jsonb(s);refs:=private.store_delete_blockers(target);
 if action='store.delete' then
  if s.is_active then raise exception 'STORE_DEACTIVATE_FIRST' using errcode='22023';end if;
  if refs<>'[]'::jsonb then raise exception 'STORE_REFERENCED_USE_DEACTIVATE' using errcode='23503';end if;
  delete from private.app_attempts where store_id=target;
  delete from private.app_devices where store_id=target;
  delete from private.app_session_access where store_id=target;
  delete from private.owner_setup_progress where store_id=target;
  delete from private.staff_activation_tokens where store_id=target;
  delete from private.staff_login_attempts where store_id=target;
  delete from private.trial_stores where store_id=target;
  delete from private.app_settings where store_id=target;
  delete from public.store_memberships where store_id=target;
  delete from public.audit_logs where store_id=target or (entity_type='store' and entity_id=target::text);
  delete from public.stores where id=target;
 elsif action in ('store.deactivate','store.restore') then
  update public.stores set is_active=(action='store.restore'),updated_at=now() where id=target;
 else raise exception 'INVALID_STORE_ACTION' using errcode='22023';end if;
 result:=jsonb_build_object('id',target,'action',action,'is_active',action='store.restore');
 insert into private.store_lifecycle_requests values(request,auth.uid(),target,action,d,result,now());
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
 values(s.organization_id,'store',target::text,action,old,result,auth.uid());
 return result;
end;
$$;

revoke all on function public.undo_inventory_import_batch(uuid,text) from public,anon;
grant execute on function public.undo_inventory_import_batch(uuid,text) to authenticated,service_role;
revoke all on function public.remove_single_imported_product_safely(uuid,uuid) from public,anon;
grant execute on function public.remove_single_imported_product_safely(uuid,uuid) to authenticated,service_role;
revoke all on function public.reset_pilot_count_setup(uuid) from public,anon;
grant execute on function public.reset_pilot_count_setup(uuid) to authenticated,service_role;

commit;
