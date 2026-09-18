-- Backfill production import helper functions so clean local rebuilds match production.

CREATE OR REPLACE FUNCTION public.import_pilot_inventory_quick(p_store_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_rows jsonb;
  v_file jsonb;
  v_fixed_rows jsonb;
  v_payload jsonb;
begin
  if jsonb_typeof(p_rows) = 'object' then
    v_rows := p_rows->'rows';
    v_file := p_rows->'file';
  elsif jsonb_typeof(p_rows) = 'array' then
    v_rows := p_rows;
    v_file := null;
  else
    raise exception using errcode='22023', message='IMPORT_PAYLOAD_INVALID';
  end if;

  if jsonb_typeof(v_rows) <> 'array' then
    raise exception using errcode='22023', message='IMPORT_PAYLOAD_INVALID';
  end if;

  select coalesce(jsonb_agg(
    case
      when coalesce(btrim(r->>'count_unit'),'') = '' then jsonb_set(r,'{count_unit}','"未設定"'::jsonb,true)
      else r
    end
  ), '[]'::jsonb)
  into v_fixed_rows
  from jsonb_array_elements(v_rows) r;

  v_payload := case
    when v_file is null then v_fixed_rows
    else jsonb_build_object('file',v_file,'rows',v_fixed_rows)
  end;

  return public.import_pilot_inventory(p_store_id, v_payload);
end;
$function$

CREATE OR REPLACE FUNCTION public.sync_active_count_after_import(p_store_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_session public.inventory_count_sessions%rowtype;
  v_append jsonb;
begin
  if v_user is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_org is null or not private.can_import_inventory(p_store_id) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;

  select * into v_session
  from public.inventory_count_sessions
  where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS')
  order by started_at desc
  limit 1
  for update;

  if v_session.id is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'zone_id',z.id,'zone_name',z.name,'product_id',p.id,'product_code',p.product_code,
    'product_name',p.name,'unit',zp.count_unit,'supplier',sp.name,'specification',p.specification,
    'file_name',src.original_filename,'sheet_name',src.sheet_name,'source_row',src.source_row,
    'file_order',src.created_at,'sheet_order',src.sheet_order
  ) order by z.sort_order,z.id,zp.sort_order,zp.product_id),'[]'::jsonb)
  into v_append
  from public.count_zones z
  join public.zone_products zp on zp.zone_id=z.id
  join public.products p on p.id=zp.product_id and p.is_active
  left join public.suppliers sp on sp.id=p.current_supplier_id
  left join lateral(
    select f.original_filename,r.sheet_name,r.source_row,f.created_at,
      (select ordinality from jsonb_array_elements_text(f.sheet_names) with ordinality a(name,ordinality)
       where a.name=r.sheet_name limit 1) sheet_order
    from public.inventory_import_rows r
    join public.inventory_import_files f on f.id=r.import_file_id
    where r.store_id=p_store_id and r.product_id=p.id
    order by f.created_at desc,r.created_at desc,r.id desc limit 1
  ) src on true
  where z.store_id=p_store_id and z.is_active
    and not exists(
      select 1 from jsonb_array_elements(coalesce(v_session.snapshot->'zones','[]'::jsonb)) item
      where item->>'zone_id'=z.id::text and item->>'product_id'=p.id::text
    );

  if jsonb_array_length(v_append)=0 then return v_session.id; end if;

  update public.inventory_count_sessions
  set snapshot=jsonb_set(v_session.snapshot,'{zones}',coalesce(v_session.snapshot->'zones','[]'::jsonb)||v_append,true)
  where id=v_session.id;

  insert into public.count_zone_progress(organization_id,session_id,zone_id,status)
  select distinct v_org,v_session.id,(item->>'zone_id')::uuid,'NOT_STARTED'
  from jsonb_array_elements(v_append) item
  where not exists(
    select 1 from public.count_zone_progress p
    where p.session_id=v_session.id and p.zone_id=(item->>'zone_id')::uuid
  );

  insert into private.count_opening_snapshots(session_id,product_id,quantity,confirmed_at)
  select distinct v_session.id,(item->>'product_id')::uuid,b.quantity,b.created_at
  from jsonb_array_elements(v_append) item
  left join public.store_product_opening_balances b
    on b.store_id=p_store_id and b.product_id=(item->>'product_id')::uuid
  where not exists(
    select 1 from private.count_opening_snapshots s
    where s.session_id=v_session.id and s.product_id=(item->>'product_id')::uuid
  );

  return v_session.id;
end;
$function$

CREATE OR REPLACE FUNCTION public.undo_inventory_import_batch(p_store_id uuid, p_file_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select id into v_file_id from public.inventory_import_files where store_id=p_store_id and file_sha256=p_file_sha256 order by created_at desc limit 1;
  if v_file_id is null then raise exception using errcode='22023',message='IMPORT_NOT_FOUND'; end if;

  create temporary table tmp_undo_products(product_id uuid primary key, protected boolean default false) on commit drop;
  insert into tmp_undo_products(product_id)
  select distinct product_id from public.inventory_import_rows
  where import_file_id=v_file_id and product_id is not null and status='ADDED';

  update tmp_undo_products t set protected=true
  where exists(select 1 from public.count_entries ce join public.inventory_count_sessions s on s.id=ce.session_id where s.store_id=p_store_id and ce.product_id=t.product_id)
     or exists(select 1 from public.count_drafts cd join public.inventory_count_sessions s on s.id=cd.session_id where s.store_id=p_store_id and cd.product_id=t.product_id)
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

  delete from public.store_product_opening_balances b
  using tmp_undo_products t
  where b.store_id=p_store_id and b.product_id=t.product_id and b.source='FILE_IMPORT' and not t.protected;

  update public.products p set is_active=false,updated_at=now()
  where exists(select 1 from tmp_undo_products t where t.product_id=p.id and not t.protected)
    and not exists(select 1 from public.zone_products zp where zp.product_id=p.id);

  update public.inventory_import_rows r
  set status='SKIPPED',reason=case when exists(select 1 from tmp_undo_products t where t.product_id=r.product_id and t.protected)
    then '本次匯入要求移除，但此品項已有後續紀錄，已保留'
    else '本次匯入已移除' end,updated_at=now()
  where r.import_file_id=v_file_id and r.product_id is not null;

  select count(*) into v_removed from tmp_undo_products where not protected;
  return jsonb_build_object('removed',v_removed,'protected',v_protected);
end;
$function$

CREATE OR REPLACE FUNCTION public.remove_single_imported_product_safely(p_store_id uuid, p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  delete from public.store_product_opening_balances
  where store_id=p_store_id and product_id=p_product_id and source='FILE_IMPORT';

  update public.products set is_active=false,updated_at=now()
  where id=p_product_id and organization_id=v_org;

  update public.inventory_import_rows
  set status='SKIPPED',reason='使用者於建檔確認時移除',updated_at=now()
  where store_id=p_store_id and product_id=p_product_id and status='ADDED';

  return jsonb_build_object('removed',true,'product_id',p_product_id);
end;
$function$

revoke all on function public.import_pilot_inventory_quick(uuid,jsonb) from public,anon;
grant execute on function public.import_pilot_inventory_quick(uuid,jsonb) to authenticated,service_role;

revoke all on function public.sync_active_count_after_import(uuid) from public,anon;
grant execute on function public.sync_active_count_after_import(uuid) to authenticated,service_role;

revoke all on function public.undo_inventory_import_batch(uuid,text) from public,anon;
grant execute on function public.undo_inventory_import_batch(uuid,text) to authenticated,service_role;

revoke all on function public.remove_single_imported_product_safely(uuid,uuid) from public,anon;
grant execute on function public.remove_single_imported_product_safely(uuid,uuid) to authenticated,service_role;
