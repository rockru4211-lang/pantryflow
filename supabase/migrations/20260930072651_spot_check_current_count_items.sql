-- Select from the existing store count sheet, including unfinished/blank rows.
-- Snapshot the comparison at plan creation; never write back to original counts.
alter table private.spot_checks alter column source_completed_at drop not null;
alter table private.spot_check_items alter column original_quantity drop not null;
alter table private.spot_check_items alter column original_entered_at drop not null;
alter table private.spot_check_items drop constraint if exists spot_check_items_entry_id_fkey;

create or replace function private.spot_check_source(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with sheet as (
  select * from public.inventory_count_sessions where id=p_id
 ), rows as (
  select distinct (x->>'product_id')::uuid product_id,(x->>'zone_id')::uuid zone_id,x
  from sheet s cross join lateral jsonb_array_elements(coalesce(s.snapshot->'zones','[]'))x
  union all
  select e.product_id,e.zone_id,'{}'::jsonb
  from sheet s join public.count_entries e on e.session_id=s.id and e.entry_type='INITIAL_COUNT'
  where s.status='CLOSED' and not exists(select 1 from jsonb_array_elements(coalesce(s.snapshot->'zones','[]'))x
   where x->>'product_id'=e.product_id::text and x->>'zone_id'=e.zone_id::text)
 ), source_values as (
  select md5(s.id::text||':'||r.zone_id::text||':'||r.product_id::text)::uuid entry_id,r.product_id,r.zone_id,
   coalesce(r.x->>'product_name',p.name) name,coalesce(r.x->>'zone_name',z.name) zone,
   coalesce(e.unit,r.x->>'unit',d.unit,p.count_unit,p.base_unit) unit,
   coalesce(r.x->>'specification',p.specification,'') specification,
   case when e.id is not null then e.quantity else d.quantity end original_quantity,
   case when e.id is not null then e.entered_at else d.entered_at end original_entered_at,
   case when e.id is null and d.quantity is null then '建立抽盤時尚未填寫原盤點數，不列計差異。'
    when exists(select 1 from public.inventory_count_discrepancies q where q.session_id=s.id and q.product_id=r.product_id and q.status='RESOLVED') then '原盤點另有主管更正；此處以分區原始紀錄比對。'
    when s.status in ('DRAFT','IN_PROGRESS') then '比對建立抽盤清單時的盤點數。' else '' end baseline_note
  from sheet s cross join rows r join public.products p on p.id=r.product_id and p.organization_id=s.organization_id
  join public.count_zones z on z.id=r.zone_id and z.store_id=s.store_id
  left join public.count_entries e on e.session_id=s.id and e.product_id=r.product_id and e.zone_id=r.zone_id and e.entry_type='INITIAL_COUNT'
  left join public.count_drafts d on d.session_id=s.id and d.product_id=r.product_id and d.zone_id=r.zone_id and s.status in ('DRAFT','IN_PROGRESS')
  where private.count_product_not_removed(s.store_id,r.product_id)
   and not exists(select 1 from private.count_field_removed f where f.store_id=s.store_id and f.product_id=r.product_id)
   and p.is_active
 ) select coalesce(jsonb_agg(to_jsonb(v) order by v.zone,v.name,v.entry_id),'[]'::jsonb) from source_values v
$$;
revoke all on function private.spot_check_source(uuid) from public,anon,authenticated;

-- Retain the existing administrative permissions, retry handling and review flow.
do $$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.spot_check_command(uuid,text,jsonb)'::regprocedure);
 anchor:=$old$if p_data->>'source_id' is not null then
   select * into source from public.inventory_count_sessions where id=(p_data->>'source_id')::uuid and store_id=p_store and status='CLOSED';
   if not found then raise exception 'SPOT_SOURCE_NOT_CLOSED' using errcode='22023';end if;
   source_rows:=private.spot_check_source(source.id);
  end if;$old$;
 if strpos(src,anchor)=0 then raise exception 'SPOT_CATALOG_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$new$select * into source from public.inventory_count_sessions s
   where s.store_id=p_store and s.status in ('DRAFT','IN_PROGRESS','REVIEWING','CLOSED')
   and (nullif(p_data->>'source_id','') is null or s.id=(p_data->>'source_id')::uuid)
   and coalesce(s.completed_at,s.started_at)>=month_start::timestamp at time zone 'Asia/Taipei'
   and coalesce(s.completed_at,s.started_at)<(month_start+interval '1 month')::timestamp at time zone 'Asia/Taipei'
   order by (s.status in ('DRAFT','IN_PROGRESS')) desc,coalesce(s.completed_at,s.started_at) desc,s.id limit 1;
  if source.id is null and nullif(p_data->>'source_id','') is not null then raise exception 'SPOT_SOURCE_NOT_FOUND' using errcode='22023';end if;
  source_rows:=private.spot_check_source(source.id);$new$);
 src:=replace(src,$old$'caps',caps,'sources'$old$,$new$'caps',caps,'source_id',source.id,'sources'$new$);
 src:=replace(src,$old$'started_at',s.started_at) order by s.completed_at desc)$old$,$new$'started_at',s.started_at,'status',s.status) order by (s.status in ('DRAFT','IN_PROGRESS')) desc,coalesce(s.completed_at,s.started_at) desc,s.id)$new$);
 src:=replace(src,$old$s.store_id=p_store and s.status='CLOSED'$old$,$new$s.store_id=p_store and s.status in ('DRAFT','IN_PROGRESS','REVIEWING','CLOSED')$new$);
 src:=replace(src,'and s.completed_at>=month_start','and coalesce(s.completed_at,s.started_at)>=month_start');
 src:=replace(src,'and s.completed_at<(month_start','and coalesce(s.completed_at,s.started_at)<(month_start');
 anchor:=$old$select * into source from public.inventory_count_sessions where id=coalesce(c.source_id,(p_data->>'source_id')::uuid) and store_id=p_store and status='CLOSED' for share;
  if not found or source.completed_at is null then raise exception 'SPOT_SOURCE_NOT_CLOSED' using errcode='22023';end if;$old$;
 if strpos(src,anchor)=0 then raise exception 'SPOT_CREATE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$new$select * into source from public.inventory_count_sessions where id=coalesce(c.source_id,(p_data->>'source_id')::uuid) and store_id=p_store and status in ('DRAFT','IN_PROGRESS','REVIEWING','CLOSED') for share;
  if not found then raise exception 'SPOT_SOURCE_NOT_FOUND' using errcode='22023';end if;$new$);
 -- Accept legacy entry UUIDs from existing drafts, while new sheet IDs remain
 -- stable when a blank row becomes a draft, submitted entry or completed count.
 anchor:=$old$source_rows:=private.spot_check_source(source.id);
  if exists(select 1 from jsonb_array_elements_text(selected)$old$;
 if strpos(src,anchor)=0 then raise exception 'SPOT_SELECTION_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$new$source_rows:=private.spot_check_source(source.id);
  select jsonb_agg(coalesce((select to_jsonb(md5(source.id::text||':'||e.zone_id::text||':'||e.product_id::text)::uuid) from public.count_entries e where e.id::text=chosen.value and e.session_id=source.id),to_jsonb(chosen.value))) into selected from jsonb_array_elements_text(selected) chosen;
  if jsonb_array_length(selected)<>(select count(distinct value) from jsonb_array_elements_text(selected)) then raise exception 'SPOT_SELECT_ITEMS' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements_text(selected)$new$);
 src:=replace(src,$old$date_trunc('month',source.completed_at at time zone 'Asia/Taipei')$old$,$new$date_trunc('month',coalesce(source.completed_at,source.started_at) at time zone 'Asia/Taipei')$new$);
 execute src;
end $$;
notify pgrst,'reload schema';
