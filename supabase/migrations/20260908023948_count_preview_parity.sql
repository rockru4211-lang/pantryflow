-- PF-COUNT-PREVIEW-PARITY-20260908: shared blind counts; immutable scope and results.
alter type public.app_role add value if not exists 'LOGISTICS';
alter type public.app_role add value if not exists 'OWNER';

create or replace function private.can_read_count_management(p_store uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.has_active_store_role(p_store,null) and exists(select 1 from public.store_memberships
 where store_id=p_store and user_id=(select auth.uid()) and is_active and role::text in ('ADMIN','SUPERVISOR','LOGISTICS','OWNER'));
$$;
revoke all on function private.can_read_count_management(uuid) from public,anon;
grant execute on function private.can_read_count_management(uuid) to authenticated;

alter policy opening_balances_store_select on public.store_product_opening_balances
 using(private.can_read_count_management(store_id));
alter policy inventory_import_files_store_manager_select on public.inventory_import_files using(private.can_read_count_management(store_id));
alter policy inventory_import_rows_store_manager_select on public.inventory_import_rows using(private.can_read_count_management(store_id));
alter policy inventory_import_storage_manager_read on storage.objects
 using(bucket_id='inventory-imports' and private.can_read_count_management(private.inventory_import_storage_store_id(name)));
alter policy discrepancies_store_manager_select on public.inventory_count_discrepancies
 using(exists(select 1 from public.inventory_count_sessions s where s.id=session_id and private.can_read_count_management(s.store_id)));
alter policy count_drafts_store_select on public.count_drafts
 using(exists(select 1 from public.inventory_count_sessions s where s.id=session_id and private.has_active_store_role(s.store_id,null)));
alter policy count_entries_store_select on public.count_entries
 using(exists(select 1 from public.inventory_count_sessions s where s.id=session_id and private.has_active_store_role(s.store_id,null)));
-- All changes to operational records now pass through validated, serialized RPCs.
revoke insert,update,delete on public.count_drafts,public.count_entries,public.count_zone_progress,public.inventory_count_sessions from authenticated;

alter table public.inventory_count_sessions
 add column paper_required boolean not null default false,
 add column paper_completed_at timestamptz,
 add column paper_completed_by uuid references public.profiles(id),
 add column paper_reviewed_at timestamptz,
 add column paper_reviewed_by uuid references public.profiles(id);

create or replace function public.save_pilot_count_draft(p_session_id uuid,p_zone_id uuid,p_product_id uuid,p_quantity numeric,p_expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare s public.inventory_count_sessions%rowtype; d public.count_drafts%rowtype; v_unit text; v_stamp timestamptz;
begin
 select * into s from public.inventory_count_sessions where id=p_session_id for update;
 if not found or not private.has_active_store_role(s.store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[]) then raise exception using errcode='42501',message='STORE_COUNTER_REQUIRED'; end if;
 if s.status<>'IN_PROGRESS' or not exists(select 1 from public.count_zone_progress where session_id=s.id and zone_id=p_zone_id and status<>'COMPLETED') then raise exception 'COUNT_ZONE_NOT_AVAILABLE'; end if;
 select item->>'unit' into v_unit from jsonb_array_elements(s.snapshot->'zones') item where item->>'zone_id'=p_zone_id::text and item->>'product_id'=p_product_id::text;
 if v_unit is null then raise exception using errcode='42501',message='PRODUCT_NOT_IN_COUNT'; end if;
 if p_quantity<0 or p_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_QUANTITY'; end if;
 select * into d from public.count_drafts where session_id=s.id and zone_id=p_zone_id and product_id=p_product_id;
 if d.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='COUNT_DRAFT_CHANGED'; end if;
 v_stamp:=clock_timestamp();
 insert into public.count_drafts(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,updated_at)
 values(s.organization_id,s.id,p_zone_id,p_product_id,p_quantity,v_unit,(select auth.uid()),v_stamp)
 on conflict(session_id,zone_id,product_id) do update set quantity=excluded.quantity,entered_by=excluded.entered_by,unit=excluded.unit,updated_at=excluded.updated_at;
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
 values(s.organization_id,'count_draft',s.id,'COUNT_DRAFT_SAVED',jsonb_build_object('quantity',d.quantity,'entered_by',d.entered_by),jsonb_build_object('zone_id',p_zone_id,'product_id',p_product_id,'quantity',p_quantity),(select auth.uid()));
 return v_stamp;
end; $$;
revoke all on function public.save_pilot_count_draft(uuid,uuid,uuid,numeric,timestamptz) from public,anon;
grant execute on function public.save_pilot_count_draft(uuid,uuid,uuid,numeric,timestamptz) to authenticated;
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

  if v_store is null or not private.has_active_store_role(v_store, array['ADMIN','SUPERVISOR','STAFF']::public.app_role[]) then
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
  from public.inventory_count_sessions s, jsonb_array_elements(s.snapshot->'zones') item
  where s.id=p_session_id and item->>'zone_id'=p_zone_id::text;

  select count(*) into v_actual
  from public.count_drafts
  where session_id = p_session_id
    and zone_id = p_zone_id
    and quantity is not null;

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
  select organization_id, session_id, zone_id, product_id, quantity, unit, entered_by, 'INITIAL_COUNT'
  from public.count_drafts
  where session_id = p_session_id
    and zone_id = p_zone_id
    and quantity is not null;

  delete from public.count_drafts
  where session_id = p_session_id
    and zone_id = p_zone_id
    and quantity is not null;

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

create or replace function public.start_pilot_count(p_store_id uuid,p_selection jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_org uuid; v_type text; v_actor uuid:=(select auth.uid()); v_snapshot jsonb; v_old public.inventory_count_sessions%rowtype;
begin
 select s.organization_id,o.business_type into v_org,v_type from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store_id and s.is_active for update of s;
 if v_org is null or not private.has_active_store_role(p_store_id,null) then raise exception using errcode='42501',message='STORE_MEMBERSHIP_REQUIRED'; end if;
 select * into v_old from public.inventory_count_sessions where store_id=p_store_id order by started_at desc limit 1;
 if v_old.status in ('DRAFT','IN_PROGRESS') then return v_old.id; end if;
 if v_old.status='REVIEWING' or (v_old.paper_required and v_old.paper_reviewed_at is null) then raise exception 'PREVIOUS_COUNT_REVIEW_REQUIRED'; end if;
 if v_type='CHAIN_RESTAURANT' and (v_old.started_at at time zone 'Asia/Taipei')::date=(now() at time zone 'Asia/Taipei')::date then return v_old.id; end if;
 if not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) and not(v_type='CHAIN_RESTAURANT' and private.has_active_store_role(p_store_id,array['STAFF']::public.app_role[]) and p_selection is null) then raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED'; end if;
 if p_selection is not null and (jsonb_typeof(p_selection)<>'array' or jsonb_array_length(p_selection)=0) then raise exception 'COUNT_SCOPE_REQUIRED'; end if;
 if p_selection is not null and exists(select 1 from jsonb_array_elements(p_selection) item where not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id and z.store_id=p_store_id and z.is_active where zp.zone_id::text=item->>'zone_id' and zp.product_id::text=item->>'product_id')) then raise exception using errcode='42501',message='PRODUCT_NOT_IN_STORE'; end if;
 select jsonb_build_object('created_at',now(),'opening_captured',true,'business_type',v_type,'zones',coalesce(jsonb_agg(jsonb_build_object(
 'zone_id',z.id,'zone_name',z.name,'product_id',p.id,'product_code',p.product_code,'product_name',p.name,'unit',zp.count_unit,
 'supplier',sp.name,'specification',p.specification,'file_name',src.original_filename,'sheet_name',src.sheet_name,'source_row',src.source_row,'file_order',src.created_at,'sheet_order',src.sheet_order
 ) order by z.sort_order,z.id,zp.sort_order,zp.product_id),'[]'::jsonb)) into v_snapshot
 from public.count_zones z join public.zone_products zp on zp.zone_id=z.id join public.products p on p.id=zp.product_id and p.is_active
 left join public.suppliers sp on sp.id=p.current_supplier_id
 left join lateral(select f.original_filename,r.sheet_name,r.source_row,f.created_at,
 (select ordinality from jsonb_array_elements_text(f.sheet_names) with ordinality a(name,ordinality) where a.name=r.sheet_name limit 1) sheet_order
 from public.inventory_import_rows r join public.inventory_import_files f on f.id=r.import_file_id where r.store_id=p_store_id and r.product_id=p.id order by f.created_at,r.created_at,r.id limit 1) src on true
 where z.store_id=p_store_id and z.is_active and (p_selection is null or exists(select 1 from jsonb_array_elements(p_selection) item where item->>'zone_id'=z.id::text and item->>'product_id'=p.id::text));
 if jsonb_array_length(v_snapshot->'zones')=0 then raise exception 'ZONE_PRODUCTS_REQUIRED'; end if;
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot,paper_required)
 values(v_org,p_store_id,v_actor,'IN_PROGRESS',v_snapshot,v_type='CHAIN_RESTAURANT') returning id into v_id;
 insert into private.count_opening_snapshots(session_id,product_id,quantity,confirmed_at)
 select v_id,(item->>'product_id')::uuid,b.quantity,b.created_at from jsonb_array_elements(v_snapshot->'zones') item
 left join public.store_product_opening_balances b on b.store_id=p_store_id and b.product_id=(item->>'product_id')::uuid
 group by item->>'product_id',b.quantity,b.created_at;
 insert into public.count_zone_progress(organization_id,session_id,zone_id,status)
 select distinct v_org,v_id,(item->>'zone_id')::uuid,'NOT_STARTED' from jsonb_array_elements(v_snapshot->'zones') item;
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
 values(v_org,'inventory_count_session',v_id,'COUNT_SESSION_CREATED',jsonb_build_object('store_id',p_store_id,'business_type',v_type,'scope_count',jsonb_array_length(v_snapshot->'zones')),v_actor);
 return v_id;
end; $$;
revoke all on function public.start_pilot_count(uuid,jsonb) from public,anon;
grant execute on function public.start_pilot_count(uuid,jsonb) to authenticated;
-- Old clients use the same validated creation path.
create or replace function public.create_pilot_count_session(p_store_id uuid) returns uuid language sql security invoker set search_path='' as $$ select public.start_pilot_count(p_store_id,null); $$;

create or replace function public.get_pilot_count_results(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.inventory_count_sessions%rowtype; v_result jsonb;
begin
 select * into s from public.inventory_count_sessions where id=p_session_id;
 if not found or not private.has_active_store_role(s.store_id,null) then raise exception using errcode='42501',message='STORE_MEMBERSHIP_REQUIRED'; end if;
 -- Safe whitelist, including for staff. No baselines, differences, costs or raw import fields.
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'product_id',e.product_id,'zone_id',e.zone_id,'zone',coalesce(a.item->>'zone_name',z.name),
 'name',coalesce(a.item->>'product_name',p.name),'unit',e.unit,'quantity',e.quantity,'supplier',coalesce(a.item->>'supplier',sp.name),'specification',coalesce(a.item->>'specification',p.specification),
 'file_name',a.item->>'file_name','sheet_name',a.item->>'sheet_name','source_row',a.item->'source_row','file_order',a.item->>'file_order','sheet_order',a.item->'sheet_order',
 'entered_at',e.entered_at,'entered_by',coalesce(si.display_name,pr.display_name)) order by a.ordinality,e.entered_at),'[]'::jsonb) into v_result
 from public.count_entries e join public.products p on p.id=e.product_id join public.count_zones z on z.id=e.zone_id
 left join public.suppliers sp on sp.id=p.current_supplier_id
 left join lateral(select item,ordinality from jsonb_array_elements(s.snapshot->'zones') with ordinality a(item,ordinality) where item->>'zone_id'=e.zone_id::text and item->>'product_id'=e.product_id::text limit 1) a on true
 left join public.staff_identities si on si.user_id=e.entered_by left join public.profiles pr on pr.id=e.entered_by
 where e.session_id=s.id and e.entry_type='INITIAL_COUNT';
 return v_result;
end; $$;
revoke all on function public.get_pilot_count_results(uuid) from public,anon;
grant execute on function public.get_pilot_count_results(uuid) to authenticated;

create or replace function public.complete_pilot_count_paper(p_session_id uuid,p_review boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare s public.inventory_count_sessions%rowtype;
begin
 select * into s from public.inventory_count_sessions where id=p_session_id for update;
 if not found or not private.has_active_store_role(s.store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[]) then raise exception using errcode='42501',message='STORE_COUNTER_REQUIRED'; end if;
 if not s.paper_required or s.status not in ('REVIEWING','CLOSED') then raise exception 'COUNT_NOT_READY'; end if;
 if p_review then
  if not private.has_active_store_role(s.store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) or s.paper_completed_at is null then raise exception using errcode='42501',message='PAPER_REVIEW_NOT_ALLOWED'; end if;
  if s.paper_reviewed_at is not null then return; end if;
  update public.inventory_count_sessions set paper_reviewed_at=now(),paper_reviewed_by=(select auth.uid()) where id=s.id;
 else
  if s.paper_completed_at is not null then return; end if;
  update public.inventory_count_sessions set paper_completed_at=now(),paper_completed_by=(select auth.uid()) where id=s.id;
 end if;
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
 values(s.organization_id,'inventory_count_session',s.id,case when p_review then 'COUNT_PAPER_REVIEWED' else 'COUNT_PAPER_COMPLETED' end,'{}',(select auth.uid()));
end; $$;
revoke all on function public.complete_pilot_count_paper(uuid,boolean) from public,anon;
grant execute on function public.complete_pilot_count_paper(uuid,boolean) to authenticated;

-- Read access expands only for the authorized management roles; write RPCs keep their existing role checks.
do $$ declare r record; v_def text; begin
 for r in select oid from pg_proc where pronamespace='public'::regnamespace and proname in ('get_pilot_count_details','get_pilot_inventory_catalog') loop
 v_def:=pg_get_functiondef(r.oid);
 v_def:=replace(v_def,'private.has_active_store_role(v_session.store_id,array[''ADMIN'',''SUPERVISOR'']::public.app_role[])','private.can_read_count_management(v_session.store_id)');
 v_def:=replace(v_def,'private.has_active_store_role(p_store_id,array[''ADMIN'',''SUPERVISOR'']::public.app_role[])','private.can_read_count_management(p_store_id)');
 execute v_def;
 end loop;
end $$;
notify pgrst,'reload schema';

create or replace function public.ensure_pilot_daily_count(p_store_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[]) then raise exception using errcode='42501',message='STORE_COUNTER_REQUIRED'; end if;
 if not exists(select 1 from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store_id and o.business_type='CHAIN_RESTAURANT') then return null; end if;
 if not exists(select 1 from public.count_zones z join public.zone_products p on p.zone_id=z.id where z.store_id=p_store_id and z.is_active) then return null; end if;
 select id into v_id from public.inventory_count_sessions where store_id=p_store_id and (status in ('DRAFT','IN_PROGRESS','REVIEWING') or (paper_required and paper_reviewed_at is null) or (started_at at time zone 'Asia/Taipei')::date=(now() at time zone 'Asia/Taipei')::date) order by started_at desc limit 1;
 if v_id is not null then return v_id; end if;
 return public.start_pilot_count(p_store_id,null);
end; $$;
revoke all on function public.ensure_pilot_daily_count(uuid) from public,anon;
grant execute on function public.ensure_pilot_daily_count(uuid) to authenticated;

create extension if not exists pg_cron;
create or replace function private.create_daily_store_counts()
returns void language plpgsql security definer set search_path='' as $$
declare r record; v_claims text:=current_setting('request.jwt.claims',true);
begin
 for r in select s.id,(select m.user_id from public.store_memberships m join public.organization_members om on om.organization_id=m.organization_id and om.user_id=m.user_id and om.is_active where m.store_id=s.id and m.is_active and m.role::text in ('ADMIN','SUPERVISOR') order by m.created_at limit 1) actor
 from public.stores s join public.organizations o on o.id=s.organization_id where s.is_active and o.business_type='CHAIN_RESTAURANT' loop
  if r.actor is not null then
   perform set_config('request.jwt.claims',jsonb_build_object('sub',r.actor,'role','authenticated')::text,true);
   perform public.ensure_pilot_daily_count(r.id);
  end if;
 end loop;
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
end; $$;
revoke all on function private.create_daily_store_counts() from public,anon,authenticated;
select cron.schedule('pantryflow-daily-counts','0 1 * * *','select private.create_daily_store_counts()');
notify pgrst,'reload schema';

create or replace function public.resolve_pilot_count_discrepancy(
  p_discrepancy_id uuid,p_reason text,p_action text,p_quantity numeric
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_org uuid; v_store uuid; v_session uuid; v_zone uuid;
  v_product uuid; v_initial uuid; v_unit text; v_entry uuid;
begin
  perform 1 from public.inventory_count_sessions where id=(select session_id from public.inventory_count_discrepancies where id=p_discrepancy_id) for update;
  select d.organization_id,s.store_id,d.session_id,d.zone_id,d.product_id,d.initial_entry_id,e.unit
  into v_org,v_store,v_session,v_zone,v_product,v_initial,v_unit
  from public.inventory_count_discrepancies d join public.inventory_count_sessions s on s.id=d.session_id
  join public.count_entries e on e.id=d.initial_entry_id where d.id=p_discrepancy_id and d.status='PENDING';
  if v_store is null or not private.has_active_store_role(v_store,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if p_reason not in('INPUT_ERROR','MISSED_OR_WRONG_ZONE','WASTE_NOT_RECORDED','TRANSFER_NOT_RECORDED','RECEIPT_NOT_RECORDED','OTHER')
    or p_action not in('CORRECTION','RECOUNT') or p_quantity is null or p_quantity<0 then
    raise exception using errcode='22023',message='INVALID_COUNT_RESOLUTION';
  end if;
  insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,parent_entry_id)
  values(v_org,v_session,v_zone,v_product,p_quantity,v_unit,v_user,p_action::public.count_entry_type,v_initial) returning id into v_entry;
  insert into public.inventory_count_resolution_events(
    organization_id,store_id,discrepancy_id,action,reason,original_entry_id,resulting_entry_id,created_by
  ) values(v_org,v_store,p_discrepancy_id,p_action,p_reason,v_initial,v_entry,v_user);
  update public.inventory_count_discrepancies set final_entry_id=v_entry,reason=p_reason,status='RESOLVED',answered_by=v_user,answered_at=now()
  where id=p_discrepancy_id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
  select v_org,'inventory_count_discrepancy',p_discrepancy_id,'COUNT_DISCREPANCY_RESOLVED',
    jsonb_build_object('initial_entry_id',v_initial),jsonb_build_object('resulting_entry_id',v_entry,'reason',p_reason,'action',p_action),v_user;
  if not exists(select 1 from public.inventory_count_discrepancies where session_id=v_session and status='PENDING') then
    update public.inventory_count_sessions set status='CLOSED' where id=v_session;
  end if;
  return v_entry;
end;
$$;

