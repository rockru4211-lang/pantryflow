
create table if not exists private.receipt_line_decisions (
  batch_id uuid not null references public.receipt_upload_batches(id) on delete cascade,
  run_id uuid not null references public.receipt_ocr_runs(id) on delete cascade,
  row_key text not null,
  decision text not null check (decision in ('INCLUDE','IGNORE')),
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  primary key(batch_id,run_id,row_key)
);

create index if not exists receipt_line_decisions_batch_run
  on private.receipt_line_decisions(batch_id,run_id);

create or replace function private.baihuayuan_receipt_line_included(
  p_batch uuid,
  p_run uuid,
  p_row text
)
returns boolean
language plpgsql
stable security definer
set search_path=''
as $$
declare
  v_store text;
  v_decision text;
  v_quantity text;
  v_subtotal text;
begin
  select s.name into v_store
  from public.receipt_upload_batches b
  join public.stores s on s.id=b.store_id
  where b.id=p_batch;

  if v_store not in ('BeApe','Gras') then
    return true;
  end if;

  select d.decision into v_decision
  from private.receipt_line_decisions d
  where d.batch_id=p_batch and d.run_id=p_run and d.row_key=p_row;

  if v_decision is not null then
    return v_decision='INCLUDE';
  end if;

  select value#>>'{}' into v_quantity
  from private.receipt_effective_fields(p_run)
  where row_key=p_row and field_name='quantity'
  limit 1;

  select value#>>'{}' into v_subtotal
  from private.receipt_effective_fields(p_run)
  where row_key=p_row and field_name='subtotal_ex_tax'
  limit 1;

  return (
    coalesce(v_quantity,'') ~ '^[0-9]+([.][0-9]+)?$'
    and v_quantity::numeric>0
  ) or (
    coalesce(v_subtotal,'') ~ '^[0-9]+([.][0-9]+)?$'
    and v_subtotal::numeric>0
  );
end;
$$;

revoke all on function private.baihuayuan_receipt_line_included(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.set_baihuayuan_receipt_line_decision(
  p_store_id uuid,
  p_batch_id uuid,
  p_run_id uuid,
  p_row_key text,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_batch public.receipt_upload_batches;
  v_current_run uuid;
begin
  if auth.uid() is null or not private.can_review_receipt(p_batch_id) then
    raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';
  end if;

  select * into v_batch
  from public.receipt_upload_batches
  where id=p_batch_id and store_id=p_store_id;

  if not found or v_batch.store_name not in ('BeApe','Gras') then
    raise exception 'BAIHUAYUAN_RECEIPT_REQUIRED' using errcode='42501';
  end if;

  select id into v_current_run
  from public.receipt_ocr_runs
  where batch_id=p_batch_id
  order by version desc
  limit 1;

  if v_current_run is null or v_current_run is distinct from p_run_id then
    raise exception 'OCR_VERSION_CHANGED';
  end if;

  if p_decision not in ('INCLUDE','IGNORE') then
    raise exception 'INVALID_LINE_DECISION' using errcode='22023';
  end if;

  if not exists(
    select 1 from public.receipt_ocr_fields
    where ocr_run_id=p_run_id and row_key=p_row_key and row_key<>'document'
  ) then
    raise exception 'OCR_LINE_NOT_FOUND' using errcode='P0002';
  end if;

  insert into private.receipt_line_decisions(
    batch_id,run_id,row_key,decision,decided_by,decided_at
  )
  values(p_batch_id,p_run_id,p_row_key,p_decision,auth.uid(),now())
  on conflict(batch_id,run_id,row_key) do update set
    decision=excluded.decision,
    decided_by=excluded.decided_by,
    decided_at=excluded.decided_at;

  insert into public.audit_logs(
    organization_id,entity_type,entity_id,action,new_value,user_id,store_id
  )
  values(
    v_batch.organization_id,'receipt_upload_batch',p_batch_id::text,
    'RECEIPT_LINE_DECISION',
    jsonb_build_object('run_id',p_run_id,'row_key',p_row_key,'decision',p_decision),
    auth.uid(),p_store_id
  );

  return jsonb_build_object(
    'row_key',p_row_key,
    'decision',p_decision,
    'included',p_decision='INCLUDE'
  );
end;
$$;

revoke all on function public.set_baihuayuan_receipt_line_decision(uuid,uuid,uuid,text,text) from public;
grant execute on function public.set_baihuayuan_receipt_line_decision(uuid,uuid,uuid,text,text) to authenticated;

do $patch$
declare
  src text;
  original text;
begin
  select pg_get_functiondef('private.receipt_review_progress(uuid)'::regprocedure) into src;
  original:=src;
  src:=replace(
    src,
    'where ocr_run_id=p_run and row_key<>''document''',
    'where ocr_run_id=p_run and row_key<>''document'' and private.baihuayuan_receipt_line_included((select batch_id from public.receipt_ocr_runs where id=p_run),p_run,row_key)'
  );
  if src=original then raise exception 'REVIEW_PROGRESS_PATCH_MISSING'; end if;
  execute src;

  select pg_get_functiondef('private.publish_receipt(uuid,uuid,boolean)'::regprocedure) into src;
  original:=src;
  src:=replace(
    src,
    'where not f.corrected and f.review_status<>''TRUSTED''',
    'where not f.corrected and f.review_status<>''TRUSTED'' and (f.row_key=''document'' or private.baihuayuan_receipt_line_included(b.id,run_id,f.row_key))'
  );
  src:=replace(
    src,
    'where row_key<>''document'' group by row_key order by row_key loop',
    'where row_key<>''document'' and private.baihuayuan_receipt_line_included(b.id,run_id,row_key) group by row_key order by row_key loop'
  );
  if src=original then raise exception 'PUBLISH_RECEIPT_PATCH_MISSING'; end if;
  execute src;

  select pg_get_functiondef('private.confirm_receipt_details(uuid,uuid,text)'::regprocedure) into src;
  original:=src;
  src:=replace(
    src,
    'where row_key<>''document'' group by row_key order by row_key loop',
    'where row_key<>''document'' and private.baihuayuan_receipt_line_included(b.id,run_id,row_key) group by row_key order by row_key loop'
  );
  if src=original then raise exception 'CONFIRM_DETAILS_PATCH_MISSING'; end if;
  execute src;

  select pg_get_functiondef('public.get_pilot_receipt(uuid)'::regprocedure) into src;
  original:=src;
  src:=replace(
    src,
    '''mappings'',(select coalesce(jsonb_agg(jsonb_build_object(''row_key'',m.row_key',
    '''line_states'',(select coalesce(jsonb_agg(jsonb_build_object(''row_key'',r.row_key,''included'',private.baihuayuan_receipt_line_included(b.id,r.id,r.row_key),''source'',case when exists(select 1 from private.receipt_line_decisions d where d.batch_id=b.id and d.run_id=r.id and d.row_key=r.row_key) then ''MANUAL'' else ''AUTO'' end,''decision'',(select d.decision from private.receipt_line_decisions d where d.batch_id=b.id and d.run_id=r.id and d.row_key=r.row_key)) order by r.row_key),''[]''::jsonb) from (select distinct f.row_key from public.receipt_ocr_fields f where f.ocr_run_id=r.id and f.row_key<>''document'') r),'||
    chr(10)||
    ' ''mappings'',(select coalesce(jsonb_agg(jsonb_build_object(''row_key'',m.row_key'
  );
  if src=original then raise exception 'GET_RECEIPT_LINE_STATE_PATCH_MISSING'; end if;
  execute src;

  select pg_get_functiondef('public.get_pilot_receipt_ledger(uuid)'::regprocedure) into src;
  original:=src;
  src:=replace(
    src,
    'where f.row_key<>''document''',
    'where f.row_key<>''document'' and private.baihuayuan_receipt_line_included(b.id,b.run_id,f.row_key)'
  );
  if src=original then raise exception 'LEDGER_FILTER_PATCH_MISSING'; end if;
  execute src;
end
$patch$;
