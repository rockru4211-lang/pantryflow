begin;

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
  where store_id=p_store_id and file_sha256=p_file_sha256
  order by created_at desc limit 1;
  if v_file_id is null then raise exception using errcode='22023',message='IMPORT_NOT_FOUND'; end if;

  create temporary table tmp_undo_products(product_id uuid primary key, protected boolean default false) on commit drop;
  insert into tmp_undo_products(product_id)
  select distinct product_id
  from public.inventory_import_rows
  where import_file_id=v_file_id and product_id is not null;

  update tmp_undo_products t set protected=true
  where exists(
          select 1 from public.count_entries ce
          join public.inventory_count_sessions s on s.id=ce.session_id
          where s.store_id=p_store_id and ce.product_id=t.product_id
        )
     or exists(
          select 1 from public.count_drafts cd
          join public.inventory_count_sessions s on s.id=cd.session_id
          where s.store_id=p_store_id and cd.product_id=t.product_id and cd.quantity is not null
        )
     or exists(
          select 1 from public.inventory_count_discrepancies d
          join public.inventory_count_sessions s on s.id=d.session_id
          where s.store_id=p_store_id and d.product_id=t.product_id
        )
     or exists(
          select 1
          from public.inventory_import_rows r
          join public.inventory_import_files f on f.id=r.import_file_id
          where r.product_id=t.product_id
            and r.import_file_id<>v_file_id
            and f.removed_at is null
            and r.status in ('ADDED','EXISTING')
        );

  select count(*) into v_protected from tmp_undo_products where protected;

  select id into v_active_session
  from public.inventory_count_sessions
  where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS')
  order by started_at desc limit 1;

  if v_active_session is not null then
    delete from public.count_drafts d
    using tmp_undo_products t
    where d.session_id=v_active_session and d.product_id=t.product_id and not t.protected;

    delete from private.count_opening_snapshots os
    using tmp_undo_products t
    where os.session_id=v_active_session and os.product_id=t.product_id and not t.protected;

    update public.inventory_count_sessions s
    set snapshot=jsonb_set(
      s.snapshot,'{zones}',
      coalesce(
        (select jsonb_agg(item)
         from jsonb_array_elements(coalesce(s.snapshot->'zones','[]'::jsonb)) item
         where not exists(
           select 1 from tmp_undo_products t
           where not t.protected and t.product_id::text=item->>'product_id'
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
  using public.count_zones z,tmp_undo_products t
  where zp.zone_id=z.id
    and z.store_id=p_store_id
    and zp.product_id=t.product_id
    and not t.protected
    and not exists(
      select 1
      from public.inventory_import_rows r
      join public.inventory_import_files f on f.id=r.import_file_id
      where r.product_id=t.product_id
        and r.import_file_id<>v_file_id
        and f.removed_at is null
        and r.status in ('ADDED','EXISTING')
    );

  perform set_config('app.opening_balance_maintenance','on',true);
  delete from public.store_product_opening_balances b
  using tmp_undo_products t
  where b.store_id=p_store_id and b.product_id=t.product_id and b.source='FILE_IMPORT' and not t.protected;
  perform set_config('app.opening_balance_maintenance','off',true);

  update public.products p
  set is_active=false,updated_at=now()
  where exists(select 1 from tmp_undo_products t where t.product_id=p.id and not t.protected)
    and not exists(select 1 from public.zone_products zp where zp.product_id=p.id)
    and not exists(
      select 1 from public.inventory_import_rows r
      join public.inventory_import_files f on f.id=r.import_file_id
      where r.product_id=p.id and f.removed_at is null and r.status in ('ADDED','EXISTING')
    );

  update public.inventory_import_rows r
  set status='SKIPPED',
      reason=case
        when exists(select 1 from tmp_undo_products t where t.product_id=r.product_id and t.protected)
          then '本次匯入已移除，但此品項已有後續紀錄，因此保留'
        else '本次匯入已移除'
      end,
      updated_at=now()
  where r.import_file_id=v_file_id and r.product_id is not null;

  select count(*) into v_removed from tmp_undo_products where not protected;

  update public.inventory_import_files
  set removed_at=coalesce(removed_at,now()),removed_by=coalesce(removed_by,v_user)
  where id=v_file_id;

  return jsonb_build_object(
    'removed',v_removed,
    'protected',v_protected,
    'hidden',true
  );
end;
$$;

-- Repair earlier removals that hid import cards but left never-counted items in the active count.
do $repair$
declare rec record;
begin
  for rec in
    select f.store_id,f.file_sha256
    from public.inventory_import_files f
    where f.removed_at is not null
  loop
    perform set_config('request.jwt.claim.sub','',true);
  end loop;
end
$repair$;

commit;