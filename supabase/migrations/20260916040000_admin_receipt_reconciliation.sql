-- Independent-restaurant LOGISTICS reconciliation. No receipt finalization,
-- inventory postings, OCR overwrites, auth changes or access-policy broadening.
-- Apply only after the existing migration chain; deploy UI and migration together.
begin;

create table private.admin_receipt_rows (
  batch_id uuid not null references public.receipt_upload_batches(id),
  run_id uuid not null references public.receipt_ocr_runs(id),
  row_key text not null check (row_key <> 'document' and length(row_key) between 1 and 200),
  overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(overrides)='object'),
  source_token text not null,
  revision integer not null check (revision > 0),
  reviewed boolean not null default false,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (batch_id,run_id,row_key)
);
create table private.admin_receipt_preferences (
  store_id uuid not null references public.stores(id),
  user_id uuid not null references public.profiles(id),
  show_codes boolean not null default false,
  primary key (store_id,user_id)
);
create table private.admin_receipt_changes (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  request_hash text not null,
  batch_id uuid not null references public.receipt_upload_batches(id),
  run_id uuid references public.receipt_ocr_runs(id),
  row_key text,
  action text not null check (action in ('ROW_SAVED','ARRIVAL_CHANGED')),
  old_value jsonb not null,
  new_value jsonb not null,
  user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index admin_receipt_changes_batch on private.admin_receipt_changes(batch_id,id desc);
alter table private.admin_receipt_rows enable row level security;
alter table private.admin_receipt_preferences enable row level security;
alter table private.admin_receipt_changes enable row level security;
revoke all on private.admin_receipt_rows,private.admin_receipt_preferences,private.admin_receipt_changes from public,anon,authenticated;
revoke all on sequence private.admin_receipt_changes_id_seq from public,anon,authenticated;

create function private.admin_receipt_guard(p_store uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
  if auth.uid() is null or private.app_role(p_store) is distinct from 'LOGISTICS' then
    raise exception 'ADMIN_RECEIPT_ACCESS_DENIED' using errcode='42501';
  end if;
  select s.organization_id into org from public.stores s join public.organizations o on o.id=s.organization_id
    where s.id=p_store and s.is_active and o.business_type is not null and o.business_type<>'CHAIN_RESTAURANT';
  if org is null then raise exception 'ADMIN_RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  return org;
end $$;

create function private.admin_receipt_base(p_run uuid,p_row text) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_object_agg(f.field_name,f.value),'{}'::jsonb)
  from private.receipt_effective_fields(p_run) f where f.row_key=p_row;
$$;
create function private.admin_receipt_token(p_run uuid,p_row text) returns text
language sql stable security definer set search_path='' as $$
  select md5(jsonb_build_object('fields',private.admin_receipt_base(p_run,p_row),'arrived_on',d.arrived_on)::text)
  from public.receipt_ocr_runs r left join private.receipt_delivery d on d.batch_id=r.batch_id where r.id=p_run;
$$;

create function public.get_admin_receipt_document(p_batch_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; doc jsonb; run uuid; states jsonb; tokens jsonb;
begin
  select * into b from public.receipt_upload_batches where id=p_batch_id;
  if not found then raise exception 'ADMIN_RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  perform private.admin_receipt_guard(b.store_id);
  if not private.can_read_receipt(b.id) or not private.can_review_receipt(b.id) then
    raise exception 'ADMIN_RECEIPT_ACCESS_DENIED' using errcode='42501';
  end if;
  doc:=public.get_pilot_receipt(b.id); run:=(doc->'run'->>'id')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object('row_key',a.row_key,'revision',a.revision,'values',a.overrides,
    'source_token',a.source_token,'reviewed',a.reviewed,'updated_at',a.updated_at,'actor',p.display_name)
    order by a.row_key),'[]'::jsonb) into states from private.admin_receipt_rows a
    left join public.profiles p on p.id=a.updated_by where a.batch_id=b.id and a.run_id=run;
  select coalesce(jsonb_object_agg(k.row_key,private.admin_receipt_token(run,k.row_key)),'{}'::jsonb) into tokens
    from (select distinct f.row_key from public.receipt_ocr_fields f where f.ocr_run_id=run and f.row_key<>'document') k;
  return doc||jsonb_build_object('admin',jsonb_build_object('rows',states,'tokens',tokens));
end $$;

create function public.get_admin_receipt_register(p_store_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; base jsonb; results jsonb;
begin
  org:=private.admin_receipt_guard(p_store_id);
  base:=public.get_pilot_receipts(p_store_id);
  select coalesce(jsonb_agg(x.row_data order by x.row_data->>'batch_number'),'[]'::jsonb) into results from (
    select e.value||jsonb_build_object('store_id',p_store_id,'organization_id',org,
      'supplier_id',coalesce(g.supplier_id,exact_match.id),
      'supplier',coalesce(s.name,e.value->>'supplier'),
      'row_count',(select count(distinct f.row_key) from public.receipt_ocr_fields f where f.ocr_run_id=r.id and f.row_key<>'document'),
      'reviewed_count',(select count(*) from private.admin_receipt_rows a where a.batch_id=b.id and a.run_id=r.id and r.status='SUCCEEDED'
        and a.reviewed and a.source_token=private.admin_receipt_token(r.id,a.row_key))) as row_data
    from jsonb_array_elements(base) e(value)
    join public.receipt_upload_batches b on b.id=(e.value->>'id')::uuid and b.store_id=p_store_id
    left join lateral(select id,status from public.receipt_ocr_runs where batch_id=b.id order by version desc limit 1) r on true
    left join public.goods_receipts g on g.source_batch_id=b.id and g.organization_id=org
    -- Exact trimmed name only, and only one match. Ambiguous names remain unresolved.
    left join lateral (select (array_agg(s0.id))[1] as id from public.suppliers s0
      where s0.organization_id=org and s0.is_active and btrim(s0.name)=btrim(e.value->>'supplier')
      having count(*)=1) exact_match on true
    left join public.suppliers s on s.id=coalesce(g.supplier_id,exact_match.id) and s.organization_id=org
  ) x;
  return jsonb_build_object('batches',results,'show_codes',coalesce((select show_codes from private.admin_receipt_preferences
    where store_id=p_store_id and user_id=auth.uid()),false));
end $$;

create function public.set_admin_receipt_codes(p_store_id uuid,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform private.admin_receipt_guard(p_store_id);
  if p_enabled is null then raise exception 'INVALID_PREFERENCE'; end if;
  insert into private.admin_receipt_preferences(store_id,user_id,show_codes) values(p_store_id,auth.uid(),p_enabled)
    on conflict(store_id,user_id) do update set show_codes=excluded.show_codes;
  return p_enabled;
end $$;

create function public.save_admin_receipt_row(p_batch_id uuid,p_run_id uuid,p_row_key text,
  p_revision integer,p_source_token text,p_values jsonb,p_reviewed boolean,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; current_run public.receipt_ocr_runs;
  old private.admin_receipt_rows; request private.admin_receipt_changes;
  payload_hash text; key text; val jsonb; base jsonb; merged jsonb; effective jsonb; token text; cap numeric;
begin
  -- Guard before returning a previous request result; revoked users cannot replay requests.
  select * into b from public.receipt_upload_batches where id=p_batch_id for update;
  if not found then raise exception 'ADMIN_RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  perform private.admin_receipt_guard(b.store_id);
  if not private.can_read_receipt(b.id) or not private.can_review_receipt(b.id) then raise exception 'ADMIN_RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  if p_request_id is null or p_reviewed is null or p_revision is null or p_revision<0 or
     p_row_key is null or p_row_key='document' or length(p_row_key) not between 1 and 200 or
     p_source_token is null or jsonb_typeof(p_values) is distinct from 'object' then raise exception 'INVALID_ROW'; end if;
  payload_hash:=md5(jsonb_build_object('action','row','actor',auth.uid(),'batch',p_batch_id,'run',p_run_id,'row',p_row_key,
    'revision',p_revision,'source',p_source_token,'values',p_values,'reviewed',p_reviewed)::text);
  select * into request from private.admin_receipt_changes where request_id=p_request_id;
  if found then
    if request.user_id<>auth.uid() or request.request_hash<>payload_hash then raise exception 'REQUEST_REUSED'; end if;
    return public.get_admin_receipt_document(b.id);
  end if;
  select * into current_run from public.receipt_ocr_runs where batch_id=b.id order by version desc limit 1;
  if current_run.id is distinct from p_run_id then raise exception 'OCR_VERSION_CHANGED'; end if;
  if current_run.status is distinct from 'SUCCEEDED' then raise exception 'OCR_NOT_READY'; end if;
  if not exists(select 1 from public.receipt_ocr_fields where ocr_run_id=current_run.id and row_key=p_row_key) then raise exception 'INVALID_ROW'; end if;
  token:=private.admin_receipt_token(current_run.id,p_row_key);
  if token is distinct from p_source_token then raise exception 'SOURCE_CHANGED' using errcode='40001'; end if;
  select * into old from private.admin_receipt_rows where batch_id=b.id and run_id=current_run.id and row_key=p_row_key;
  if coalesce(old.revision,0)<>p_revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  for key,val in select * from jsonb_each(p_values) loop
    if key not in ('product','category','specification','unit','quantity','unit_price_ex_tax','subtotal_ex_tax','product_code','note') then raise exception 'INVALID_FIELD'; end if;
    if key in ('quantity','unit_price_ex_tax','subtotal_ex_tax') then
      cap:=case when key='subtotal_ex_tax' then 1000000000000 else 1000000000 end;
      if val<>'null'::jsonb then
        if jsonb_typeof(val)<>'number' then raise exception 'INVALID_NUMBER'; end if;
        if (val#>>'{}')::numeric<0 or (val#>>'{}')::numeric>cap then raise exception 'INVALID_NUMBER'; end if;
      end if;
    else
      if jsonb_typeof(val)<>'string' then raise exception 'INVALID_TEXT'; end if;
      if length(val#>>'{}')>case when key='note' then 1000 when key='product_code' then 80 when key='unit' then 30 else 200 end then raise exception 'INVALID_TEXT'; end if;
    end if;
  end loop;
  base:=private.admin_receipt_base(current_run.id,p_row_key);
  merged:=coalesce(old.overrides,'{}'::jsonb)||p_values;
  effective:=base||merged;
  if p_reviewed then
    if coalesce(length(btrim(effective->>'product')),0)=0 or coalesce(length(btrim(effective->>'unit')),0)=0
      or jsonb_typeof(effective->'quantity') is distinct from 'number'
      or (effective->>'quantity')::numeric<0
      or not exists(select 1 from private.receipt_delivery where batch_id=b.id and arrived_on is not null) then
      raise exception 'REVIEW_REQUIRED_FIELDS';
    end if;
  end if;
  insert into private.admin_receipt_rows(batch_id,run_id,row_key,overrides,source_token,revision,reviewed,updated_by)
    values(b.id,current_run.id,p_row_key,merged,token,coalesce(old.revision,0)+1,p_reviewed,auth.uid())
    on conflict(batch_id,run_id,row_key) do update set overrides=excluded.overrides,source_token=excluded.source_token,
      revision=excluded.revision,reviewed=excluded.reviewed,updated_by=excluded.updated_by,updated_at=now();
  insert into private.admin_receipt_changes(request_id,request_hash,batch_id,run_id,row_key,action,old_value,new_value,user_id)
    values(p_request_id,payload_hash,b.id,current_run.id,p_row_key,'ROW_SAVED',
      jsonb_build_object('effective',base||coalesce(old.overrides,'{}'::jsonb),'overrides',coalesce(old.overrides,'{}'::jsonb),'revision',coalesce(old.revision,0),'reviewed',coalesce(old.reviewed,false),'source_token',old.source_token),
      jsonb_build_object('effective',effective,'overrides',merged,'revision',coalesce(old.revision,0)+1,'reviewed',p_reviewed,'source_token',token),auth.uid());
  return public.get_admin_receipt_document(b.id);
end $$;

create function public.save_admin_receipt_arrival(p_batch_id uuid,p_revision integer,p_arrived_on date,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; d private.receipt_delivery; prior jsonb; payload_hash text; request private.admin_receipt_changes;
begin
  select * into b from public.receipt_upload_batches where id=p_batch_id for update;
  if not found then raise exception 'ADMIN_RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  perform private.admin_receipt_guard(b.store_id);
  if not private.can_read_receipt(b.id) or not private.can_review_receipt(b.id) then raise exception 'ADMIN_RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  if p_request_id is null or p_revision is null or p_revision<0 or
    (p_arrived_on is not null and (p_arrived_on<'1900-01-01'::date or p_arrived_on>'2200-12-31'::date)) then raise exception 'INVALID_ARRIVAL'; end if;
  payload_hash:=md5(jsonb_build_object('action','arrival','actor',auth.uid(),'batch',b.id,'revision',p_revision,'date',p_arrived_on)::text);
  select * into request from private.admin_receipt_changes where request_id=p_request_id;
  if found then
    if request.user_id<>auth.uid() or request.request_hash<>payload_hash then raise exception 'REQUEST_REUSED'; end if;
    return public.get_admin_receipt_document(b.id);
  end if;
  select * into d from private.receipt_delivery where batch_id=b.id;
  if coalesce(d.revision,0)<>p_revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  prior:=private.receipt_delivery_json(b.id);
  insert into private.receipt_delivery(batch_id,arrived_on,arrived_time,issues,revision,updated_by)
    values(b.id,p_arrived_on,case when p_arrived_on is null then null else d.arrived_time end,
      coalesce(d.issues,'[]'::jsonb),coalesce(d.revision,0)+1,auth.uid())
    on conflict(batch_id) do update set arrived_on=excluded.arrived_on,arrived_time=excluded.arrived_time,
      revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now();
  -- Existing issue records and operational stock/ERP states are intentionally untouched.
  insert into private.admin_receipt_changes(request_id,request_hash,batch_id,action,old_value,new_value,user_id)
    values(p_request_id,payload_hash,b.id,'ARRIVAL_CHANGED',prior,private.receipt_delivery_json(b.id),auth.uid());
  return public.get_admin_receipt_document(b.id);
end $$;

create function public.get_admin_receipt_history(p_batch_id uuid,p_before bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; result jsonb;
begin
  select * into b from public.receipt_upload_batches where id=p_batch_id;
  if not found then raise exception 'ADMIN_RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  perform private.admin_receipt_guard(b.store_id);
  if not private.can_read_receipt(b.id) or not private.can_review_receipt(b.id) then raise exception 'ADMIN_RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(x.entry order by x.id desc),'[]'::jsonb) into result from (
    select a.id,jsonb_build_object('id',a.id,'row_key',a.row_key,'action',a.action,'old_value',a.old_value,
      'new_value',a.new_value,'actor',p.display_name,'created_at',a.created_at) entry
    from private.admin_receipt_changes a left join public.profiles p on p.id=a.user_id
    where a.batch_id=b.id and (p_before is null or a.id<p_before) order by a.id desc limit 50
  ) x;
  return result;
end $$;

revoke all on function private.admin_receipt_guard(uuid),private.admin_receipt_base(uuid,text),private.admin_receipt_token(uuid,text) from public,anon,authenticated;
revoke all on function public.get_admin_receipt_register(uuid),public.get_admin_receipt_document(uuid),public.set_admin_receipt_codes(uuid,boolean),
  public.save_admin_receipt_row(uuid,uuid,text,integer,text,jsonb,boolean,uuid),public.save_admin_receipt_arrival(uuid,integer,date,uuid),public.get_admin_receipt_history(uuid,bigint) from public,anon;
grant execute on function public.get_admin_receipt_register(uuid),public.get_admin_receipt_document(uuid),public.set_admin_receipt_codes(uuid,boolean),
  public.save_admin_receipt_row(uuid,uuid,text,integer,text,jsonb,boolean,uuid),public.save_admin_receipt_arrival(uuid,integer,date,uuid),public.get_admin_receipt_history(uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
