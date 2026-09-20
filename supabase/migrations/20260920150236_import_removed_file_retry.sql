-- Re-importing the same removed file must rebuild its store setup exactly once.
-- Receipts describe actual removals; old removals without proof require review.
create table private.import_removal_receipts(
  import_file_id uuid not null references public.inventory_import_files(id),
  product_id uuid not null references public.products(id),
  removed_at timestamptz not null,
  reactivate_product boolean not null,
  opening_retained boolean not null,
  source_ids text[] not null,
  primary key(import_file_id,product_id)
);
alter table private.import_removal_receipts enable row level security;
revoke all on private.import_removal_receipts from public,anon,authenticated;

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
  v_shared integer:=0;
  v_previous_maintenance text:=current_setting('app.opening_balance_maintenance',true);
begin
  if v_user is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_org is null or not private.can_import_inventory(p_store_id) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('import:'||p_store_id::text,0));
  select id into v_file_id
  from public.inventory_import_files
  where store_id=p_store_id and file_sha256=p_file_sha256
  order by created_at desc limit 1;
  if v_file_id is null then raise exception using errcode='22023',message='IMPORT_NOT_FOUND'; end if;
  if exists(select 1 from public.inventory_import_files where id=v_file_id and removed_at is not null) then
    return jsonb_build_object('removed',0,'shared',0,'hidden',true);
  end if;

  create temporary table tmp_remove_products(product_id uuid primary key, shared boolean default false) on commit drop;
  insert into tmp_remove_products(product_id)
  select distinct product_id
  from public.inventory_import_rows
  where import_file_id=v_file_id and product_id is not null;

  update tmp_remove_products t
  set shared=true
  where exists(
    select 1
    from public.inventory_import_rows r
    join public.inventory_import_files f on f.id=r.import_file_id
    where r.product_id=t.product_id
      and r.import_file_id<>v_file_id
      and f.store_id=p_store_id
      and f.removed_at is null
      and r.status in ('ADDED','EXISTING','PENDING')
  );

  -- Capture what this removal actually changes before touching product state.
  insert into private.import_removal_receipts(import_file_id,product_id,removed_at,
    reactivate_product,opening_retained,source_ids)
  select v_file_id,p.id,now(),
    p.is_active and not t.shared and not exists(
      select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
      where zp.product_id=p.id and z.store_id<>p_store_id),
    t.shared or exists(select 1 from public.store_product_opening_balances b
      where b.store_id=p_store_id and b.product_id=p.id and b.source<>'FILE_IMPORT'),
    array(select r.source_id from public.inventory_import_rows r
      where r.import_file_id=v_file_id and r.product_id=p.id and r.status in ('ADDED','EXISTING','PENDING'))
  from tmp_remove_products t join public.products p on p.id=t.product_id
  on conflict(import_file_id,product_id) do update set
    removed_at=excluded.removed_at,reactivate_product=excluded.reactivate_product,
    opening_retained=excluded.opening_retained,source_ids=excluded.source_ids;

  -- If the last source removes an aggregate opening, earlier removed sources no
  -- longer have a retained contribution and must apply theirs when re-imported.
  update private.import_removal_receipts rr set opening_retained=false
  from public.inventory_import_files f,tmp_remove_products t
  where rr.import_file_id=f.id and f.store_id=p_store_id and rr.product_id=t.product_id
    and not t.shared and not exists(select 1 from public.store_product_opening_balances b
      where b.store_id=p_store_id and b.product_id=t.product_id and b.source<>'FILE_IMPORT');

  select count(*) into v_shared from tmp_remove_products where shared;

  select id into v_active_session
  from public.inventory_count_sessions
  where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS')
  order by started_at desc limit 1;

  if v_active_session is not null then
    delete from public.count_drafts d
    using tmp_remove_products t
    where d.session_id=v_active_session and d.product_id=t.product_id and not t.shared;

    delete from private.count_opening_snapshots os
    using tmp_remove_products t
    where os.session_id=v_active_session and os.product_id=t.product_id and not t.shared;

    update public.inventory_count_sessions s
    set snapshot=jsonb_set(
      s.snapshot,'{zones}',
      coalesce(
        (select jsonb_agg(item)
         from jsonb_array_elements(coalesce(s.snapshot->'zones','[]'::jsonb)) item
         where not exists(
           select 1 from tmp_remove_products t
           where not t.shared and t.product_id::text=item->>'product_id'
         )),
        '[]'::jsonb
      ),
      true
    )
    where s.id=v_active_session;

    delete from public.count_zone_progress zp
    where zp.session_id=v_active_session
      and not exists(
        select 1
        from jsonb_array_elements(
          (select snapshot->'zones' from public.inventory_count_sessions where id=v_active_session)
        ) item
        where item->>'zone_id'=zp.zone_id::text
      );
  end if;

  delete from public.zone_products zp
  using public.count_zones z,tmp_remove_products t
  where zp.zone_id=z.id
    and z.store_id=p_store_id
    and zp.product_id=t.product_id
    and not t.shared;

  perform set_config('app.opening_balance_maintenance','on',true);
  delete from public.store_product_opening_balances b
  using tmp_remove_products t
  where b.store_id=p_store_id and b.product_id=t.product_id and b.source='FILE_IMPORT' and not t.shared;
  perform set_config('app.opening_balance_maintenance',coalesce(v_previous_maintenance,''),true);

  update public.products p
  set is_active=false,updated_at=now()
  where exists(select 1 from tmp_remove_products t where t.product_id=p.id and not t.shared)
    and not exists(select 1 from public.zone_products zp where zp.product_id=p.id);

  update public.inventory_import_rows r
  set status='SKIPPED',
      reason=case
        when exists(select 1 from tmp_remove_products t where t.product_id=r.product_id and t.shared)
          then '本次匯入已移除；同品項仍由其他匯入資料使用'
        else '本次匯入已移除'
      end,
      updated_at=now()
  where r.import_file_id=v_file_id and r.product_id is not null;

  select count(*) into v_removed from tmp_remove_products where not shared;

  update public.inventory_import_files
  set removed_at=coalesce(removed_at,now()),removed_by=coalesce(removed_by,v_user)
  where id=v_file_id;

  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'store',p_store_id,'INVENTORY_IMPORT_REMOVED',
    jsonb_build_object('import_file_id',v_file_id,'removed',v_removed,'shared',v_shared),v_user);
  return jsonb_build_object('removed',v_removed,'shared',v_shared,'hidden',true);
end;
$$;


create or replace function private.restore_removed_import_product(
  p_store_id uuid, p_file_id uuid, p_product_id uuid, p_reset_opening boolean
) returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or not private.can_import_inventory(p_store_id) then
    raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501';
  end if;
  update public.products p set is_active=true,updated_at=now()
  where p.id=p_product_id and not p.is_active
    and exists(select 1 from public.inventory_import_files f where f.id=p_file_id and f.store_id=p_store_id and f.organization_id=p.organization_id and f.removed_at is null)
    and case when exists(select 1 from private.import_removal_receipts rr
      where rr.import_file_id=p_file_id and rr.product_id=p.id)
    then exists(select 1 from private.import_removal_receipts rr
      where rr.import_file_id=p_file_id and rr.product_id=p.id and rr.reactivate_product
        and p.updated_at=rr.removed_at)
    else exists(select 1 from public.inventory_import_rows r join public.inventory_import_files f on f.id=r.import_file_id
      where r.product_id=p.id and f.store_id=p_store_id and f.removed_at is not null)
    end
    and not exists(select 1 from public.inventory_import_rows r join public.inventory_import_files f on f.id=r.import_file_id where r.product_id=p.id and f.removed_at is null and f.id<>p_file_id and r.status in ('ADDED','EXISTING','PENDING'))
    and not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where zp.product_id=p.id and z.store_id<>p_store_id);
  if not found then return false; end if;
  if p_reset_opening then
    delete from public.store_product_opening_balances
    where store_id=p_store_id and product_id=p_product_id and source='FILE_IMPORT';
  end if;
  return true;
end $$;
revoke all on function private.restore_removed_import_product(uuid,uuid,uuid,boolean) from public,anon,authenticated;


-- Patch the current importer so previous validation, price handling and source
-- preservation remain the single implementation. Fail if an expected anchor moved.
do $migration$
declare src text; needle text;
begin
  select pg_get_functiondef('public.import_pilot_inventory(uuid,jsonb)'::regprocedure) into src;
  needle:='  if v_file is not null then';
  if strpos(src,needle)=0 then raise exception 'Missing import metadata anchor'; end if;
  src:=replace(src,needle,$patch$
  perform pg_advisory_xact_lock(hashtextextended('import:'||p_store_id::text,0));
  if v_file is not null then$patch$);
  needle:='    insert into public.inventory_import_files(';
  if strpos(src,needle)=0 then raise exception 'Missing import file insert anchor'; end if;
  src:=replace(src,needle,$patch$
    select id into v_import_file_id from public.inventory_import_files
    where store_id=p_store_id and file_sha256=v_file->>'file_sha256' for update;
    if exists(select 1 from public.inventory_import_files where id=v_import_file_id and removed_at is not null) then
      if exists(select 1 from public.inventory_import_rows r
        where r.import_file_id=v_import_file_id and r.product_id is not null
          and not exists(select 1 from private.import_removal_receipts rr
            where rr.import_file_id=r.import_file_id and rr.product_id=r.product_id)) then
        raise exception 'IMPORT_REMOVED_REVIEW_REQUIRED' using errcode='22023';
      end if;
      insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
      select v_org,'store',p_store_id,'INVENTORY_IMPORT_REOPENED',
        jsonb_build_object('import_file_id',id,'removed_at',removed_at,'removed_by',removed_by),v_user
      from public.inventory_import_files where id=v_import_file_id;
      update public.inventory_import_files set removed_at=null,removed_by=null where id=v_import_file_id;
    end if;
    insert into public.inventory_import_files($patch$);
  needle:='where import_file_id=v_import_file_id and source_id=v_source_id and product_id is not null;';
  if strpos(src,needle)=0 then raise exception 'Missing successful source replay anchor'; end if;
  src:=replace(src,needle,$patch$where import_file_id=v_import_file_id and source_id=v_source_id and product_id is not null and status in ('ADDED','EXISTING','PENDING');$patch$);
  needle:='      if v_name is null then';
  if strpos(src,needle)=0 then raise exception 'Missing removed source validation anchor'; end if;
  src:=replace(src,needle,$patch$
      if v_import_file_id is not null and exists(select 1 from public.inventory_import_rows r
        where r.import_file_id=v_import_file_id and r.source_id=v_source_id and r.product_id is not null
          and r.status in ('SKIPPED','FAILED') and not exists(
            select 1 from private.import_removal_receipts rr where rr.import_file_id=r.import_file_id
              and rr.product_id=r.product_id and r.source_id=any(rr.source_ids))) then
        raise exception 'IMPORT_ROW_REMOVED_REVIEW_REQUIRED' using errcode='22023';
      end if;
      if v_name is null then$patch$);
  needle:='      if v_opening_quantity is not null then';
  if strpos(src,needle)=0 then raise exception 'Missing opening replay anchor'; end if;
  src:=replace(src,needle,$patch$
      if v_opening_quantity is not null and not exists(
        select 1 from private.import_removal_receipts rr where rr.import_file_id=v_import_file_id
          and rr.product_id=v_product_id and rr.opening_retained and v_source_id=any(rr.source_ids)
      ) then$patch$);
  execute src;
end $migration$;
