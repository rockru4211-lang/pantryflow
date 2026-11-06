-- Keep duplicate evidence and accounting separate. Only a saved, unposted copy
-- can be excluded or restored. Exact re-uploads never create another batch.
alter table private.receipt_duplicate_links
  alter column run_id drop not null,
  add column reason text not null default 'MATCHED_OCR'
    check (reason in ('MATCHED_OCR', 'EXACT_PHOTO', 'MANUAL'));

create index receipt_duplicate_original_idx
  on private.receipt_duplicate_links(original_batch_id);
create index receipt_document_hash_idx
  on public.receipt_documents(content_sha256, batch_id) where content_sha256 is not null;

create table private.receipt_duplicate_uploads (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  original_batch_id uuid not null references public.receipt_upload_batches(id),
  actor_id uuid not null references auth.users(id),
  upload_fingerprint text not null,
  occurred_at timestamptz not null default now(),
  unique (store_id, original_batch_id, actor_id, upload_fingerprint)
);
alter table private.receipt_duplicate_uploads enable row level security;
revoke all on private.receipt_duplicate_uploads from public, anon, authenticated;

-- A printed receipt number is evidence for comparison, not a reason to hide
-- a document. Keep previous OCR links available in the duplicate history.
drop trigger receipt_ocr_duplicate_check on public.receipt_ocr_runs;

create function private.receipt_duplicate_posted(p_batch uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from public.receipt_upload_batches b where b.id=p_batch
      and (b.status='COMPLETED' or b.erp_completed_at is not null)
  ) or exists (select 1 from public.goods_receipts where source_batch_id=p_batch)
    or exists (
      select 1 from private.receipt_account_edits where batch_id=p_batch
        and (received_at is not null or finance_sent_at is not null or reviewed_at is not null)
    )
    or exists (
      select 1 from private.receipt_reconciliations where batch_id=p_batch and checked_at is not null
    )
    or exists (select 1 from private.receipt_custody_links where batch_id=p_batch)
    or exists (select 1 from private.custody_reminder_receipts where batch_id=p_batch and active)
$$;

create function private.receipt_duplicate_busy(p_batch uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from public.receipt_ocr_jobs where batch_id=p_batch and status in ('QUEUED','RUNNING')
  ) or exists (
    select 1 from private.receipt_photo_requests where batch_id=p_batch and completed_at is null
  )
$$;

-- The entire stored page set must match. A shared page alone is insufficient.
-- Explicit same-photo entries have their own accounting identity by design.
create function private.receipt_duplicate_hashes(p_batch uuid)
returns text[] language sql stable set search_path='' as $$
  select array_agg(d.content_sha256 order by d.content_sha256)
  from public.receipt_documents d
  where d.batch_id=p_batch
    and not exists (select 1 from private.receipt_same_photo_entries where batch_id=p_batch)
  having count(*)>0 and bool_and(
    d.content_sha256 is not null and exists (
      select 1 from storage.objects o where o.bucket_id='receipt-documents' and o.name=d.storage_path
    )
  )
$$;

-- Read only receipt headers from the current OCR revision, including corrections
-- and accounting edits. No line-item materialization is needed for comparison.
create function private.receipt_duplicate_headers(p_store uuid,p_batches uuid[] default null)
returns table(
  batch_id uuid, uploaded_at timestamptz, supplier_name text, receipt_date date,
  document_number text, total numeric, posted boolean, busy boolean, live boolean, hashes text[]
)
language sql stable set search_path='' as $$
  select b.id, b.uploaded_at,
    private.supplier_display_name(b.organization_id, case when e.header ? 'supplier_name'
      then nullif(e.header->>'supplier_name','') else coalesce(nullif(f.header->>'supplier_name',''),s.name) end),
    private.receipt_account_date(case when e.header ? 'receipt_date'
      then e.header->>'receipt_date' else coalesce(f.header->>'receipt_date',g.receipt_date::text) end),
    case when e.header ? 'document_number' then nullif(e.header->>'document_number','')
      else coalesce(nullif(f.header->>'document_number',''),g.document_number) end,
    coalesce(
      private.receipt_account_number(c.amount_override->>'total'), g.total_inc_tax,
      private.receipt_account_number(f.header->>'total_inc_tax')
    ),
    private.receipt_duplicate_posted(b.id), private.receipt_duplicate_busy(b.id),
    not exists (
      select 1 from private.baihuayuan_record_flags rf where rf.organization_id=b.organization_id
        and rf.entity_type='RECEIPT_BATCH' and rf.entity_id=b.id and rf.state<>'LIVE'
    ),
    case when not exists (select 1 from private.receipt_photo_requests where batch_id=b.id)
      then private.receipt_duplicate_hashes(b.id) end
  from public.receipt_upload_batches b
  left join lateral (
    select id, status from public.receipt_ocr_runs where batch_id=b.id order by version desc limit 1
  ) r on true
  left join lateral (
    select jsonb_object_agg(x.field_name, case when corrected.id is not null
      then corrected.new_value else x.normalized_value end) as header
    from public.receipt_ocr_fields x
    left join lateral (
      select c.id,c.new_value from public.receipt_review_corrections c
      where c.ocr_field_id=x.id order by c.modified_at desc,c.id desc limit 1
    ) corrected on true
    where r.status='SUCCEEDED' and x.ocr_run_id=r.id and x.row_key='document'
      and x.field_name in ('supplier_name','receipt_date','document_number','total_inc_tax')
  ) f on true
  left join private.receipt_account_edits e on e.batch_id=b.id and e.store_id=b.store_id
    and e.run_id is not distinct from r.id
  left join private.receipt_reconciliations c on c.batch_id=b.id and c.store_id=b.store_id
  left join public.goods_receipts g on g.source_batch_id=b.id
  left join public.suppliers s on s.id=g.supplier_id and s.organization_id=b.organization_id
  where b.store_id=p_store and b.store_name in ('BeApe','Gras') and (p_batches is null or b.id=any(p_batches))
$$;

create function private.receipt_duplicate_candidates(p_store uuid)
returns table(batch_id uuid, original_batch_id uuid, reason text,
  supplier_name text, receipt_date date, document_number text, total numeric,
  uploaded_at timestamptz, posted boolean, busy boolean, has_copies boolean)
language sql stable set search_path='' as $$
  with current_receipts as materialized (
    select h.*,
      (exists (select 1 from private.receipt_duplicate_links d where d.original_batch_id=h.batch_id)
        or exists (select 1 from private.receipt_same_photo_entries x where x.source_batch_id=h.batch_id)) as has_copies,
      private.history_key(h.supplier_name) as supplier_key,
      lower(btrim(h.document_number)) as number_key
    from private.receipt_duplicate_headers(p_store) h
    where h.live
      and not exists (select 1 from private.receipt_duplicate_links d where d.batch_id=h.batch_id)
      and not exists (select 1 from private.receipt_same_photo_entries x where x.batch_id=h.batch_id)
  ), exact as (
    select r.batch_id,
      first_value(r.batch_id) over (
        partition by r.hashes order by r.posted desc, r.has_copies desc, r.busy desc, r.uploaded_at, r.batch_id
      ) as original_batch_id, 'EXACT_PHOTO'::text as reason
    from current_receipts r where r.hashes is not null
  ), numbered as (
    select r.batch_id,
      first_value(r.batch_id) over (
        partition by r.supplier_key, r.receipt_date, r.number_key
        order by r.posted desc, r.has_copies desc, r.busy desc, r.uploaded_at, r.batch_id
      ) as original_batch_id, 'DOCUMENT_NUMBER'::text as reason
    from current_receipts r
    where r.supplier_key not in ('','未提供') and r.receipt_date is not null and r.number_key<>''
  )
  select distinct on (m.batch_id) m.batch_id, m.original_batch_id, m.reason,
    r.supplier_name, r.receipt_date, r.document_number, r.total, r.uploaded_at, r.posted, r.busy, r.has_copies
  from (select * from exact union all select * from numbered) m join current_receipts r using(batch_id)
  where m.batch_id<>m.original_batch_id
  order by m.batch_id, m.reason desc
$$;

revoke all on function private.receipt_duplicate_posted(uuid), private.receipt_duplicate_busy(uuid),
  private.receipt_duplicate_hashes(uuid), private.receipt_duplicate_headers(uuid,uuid[]),
  private.receipt_duplicate_candidates(uuid) from public, anon, authenticated;

create or replace function private.begin_baihuayuan_receipt_upload(
  p_store_id uuid, p_fingerprint text, p_documents jsonb, p_group_mode text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  original_id uuid;
  hashes text[];
begin
  perform private.assert_store_editable(p_store_id);
  if auth.uid() is null
    or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[])
    or not exists (select 1 from public.stores where id=p_store_id and name in ('BeApe','Gras') and is_active)
  then
    raise exception 'STORE_UPLOADER_REQUIRED' using errcode='42501';
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    or p_group_mode is null or p_group_mode not in ('SAME_RECEIPT','SEPARATE_RECEIPTS')
    or jsonb_typeof(p_documents) is distinct from 'array'
  then
    raise exception 'INVALID_UPLOAD_MANIFEST';
  end if;
  if jsonb_array_length(p_documents) not between 1 and 10 then
    raise exception 'INVALID_UPLOAD_MANIFEST';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_documents) d
    where coalesce(d->>'sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(d->>'name','')=''
      or coalesce(d->>'mime_type','') not in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf')
      or case when coalesce(d->>'byte_size','') ~ '^[0-9]{1,8}$'
        then (d->>'byte_size')::integer not between 1 and 10485760 else true end
  ) then
    raise exception 'INVALID_RECEIPT_FILE';
  end if;
  if p_fingerprint<>encode(extensions.digest(convert_to(p_group_mode||':'||(
    select string_agg(value->>'sha256',',' order by ord)
    from jsonb_array_elements(p_documents) with ordinality x(value,ord)
  ),'UTF8'),'sha256'),'hex') then
    raise exception 'UPLOAD_FINGERPRINT_MISMATCH';
  end if;

  select array_agg(d->>'sha256' order by d->>'sha256') into hashes from jsonb_array_elements(p_documents) d;
  perform pg_advisory_xact_lock(hashtextextended('receipt-upload:'||p_store_id::text,0));
  select b.id into original_id
  from public.receipt_upload_batches b
  where b.store_id=p_store_id
    and exists (select 1 from public.receipt_documents d where d.batch_id=b.id and d.content_sha256=hashes[1])
    and hashes=private.receipt_duplicate_hashes(b.id)
    and (b.upload_completed_at is not null
      or exists (select 1 from public.receipt_ocr_jobs where batch_id=b.id)
      or exists (select 1 from private.receipt_manual_handoffs where batch_id=b.id))
    and not exists (select 1 from private.receipt_duplicate_links where batch_id=b.id)
    and not exists (
      select 1 from private.baihuayuan_record_flags f where f.organization_id=b.organization_id
        and f.entity_type='RECEIPT_BATCH' and f.entity_id=b.id and f.state<>'LIVE'
    )
  order by private.receipt_duplicate_posted(b.id) desc, b.uploaded_at, b.id
  limit 1;
  if original_id is not null then
    insert into private.receipt_duplicate_uploads(store_id, original_batch_id, actor_id, upload_fingerprint)
      values(p_store_id, original_id, auth.uid(), p_fingerprint) on conflict do nothing;
    return jsonb_build_object(
      'duplicate',true, 'batch_id',case when private.can_read_receipt(original_id) then original_id end
    );
  end if;
  -- A second group mode or page order cannot start another batch while
  -- the same set is being transferred. The original uploader can resume.
  if exists (
    select 1 from public.receipt_upload_batches b
    where b.store_id=p_store_id and b.upload_completed_at is null
      and (b.uploaded_by<>auth.uid() or b.upload_fingerprint is distinct from p_fingerprint)
      and b.uploaded_at>now()-interval '15 minutes'
      and exists (select 1 from public.receipt_documents d where d.batch_id=b.id and d.content_sha256=hashes[1])
      and hashes=(select array_agg(d.content_sha256 order by d.content_sha256)
        from public.receipt_documents d where d.batch_id=b.id)
      and not exists (select 1 from private.receipt_duplicate_links where batch_id=b.id)
      and not exists (
        select 1 from private.baihuayuan_record_flags f where f.organization_id=b.organization_id
          and f.entity_type='RECEIPT_BATCH' and f.entity_id=b.id and f.state<>'LIVE'
      )
  ) then raise exception 'RECEIPT_DUPLICATE_UPLOAD_PENDING' using errcode='PT409'; end if;
  return public.begin_pilot_receipt_upload(p_store_id,p_fingerprint,p_documents,p_group_mode);
end $$;

create function private.get_baihuayuan_receipt_duplicates(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare editable boolean;
begin
  if auth.uid() is null
    or not private.has_active_store_role(p_store,array['ADMIN','LOGISTICS','OWNER']::public.app_role[])
    or not exists (select 1 from public.stores where id=p_store and is_active and name in ('BeApe','Gras'))
  then
    raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';
  end if;
  editable:=not exists (
    select 1 from public.store_memberships
    where store_id=p_store and user_id=auth.uid() and is_active and access_mode='VIEW'
  );
  return (
    with history_batches as (
      select d.batch_id as id from private.receipt_duplicate_links d
        join public.receipt_upload_batches b on b.id=d.batch_id where b.store_id=p_store
      union
      select d.original_batch_id from private.receipt_duplicate_links d
        join public.receipt_upload_batches b on b.id=d.batch_id where b.store_id=p_store
      union
      select u.original_batch_id from private.receipt_duplicate_uploads u where u.store_id=p_store
    ), headers as materialized (
      select * from private.receipt_duplicate_headers(p_store,array(select id from history_batches))
    ), records as (
      select h.batch_id as id, h.batch_id, d.original_batch_id,
        case when h.posted then 'POSTED_REVIEW' else 'EXCLUDED' end as status, d.reason,
        h.supplier_name, h.receipt_date, h.document_number, h.total, d.created_at as occurred_at,
        editable and h.live and not h.posted and not h.busy as can_restore, false as can_exclude
      from private.receipt_duplicate_links d
      join headers h on h.batch_id=d.batch_id
      join headers o on o.batch_id=d.original_batch_id
      union all
      select u.id, null::uuid, u.original_batch_id, 'EXCLUDED', 'EXACT_PHOTO',
        h.supplier_name, h.receipt_date, h.document_number, h.total, u.occurred_at, false, false
      from private.receipt_duplicate_uploads u join headers h on h.batch_id=u.original_batch_id
      where u.store_id=p_store
      union all
      select d.batch_id, d.batch_id, d.original_batch_id,
        case when d.posted then 'POSTED_REVIEW' else 'SUSPECTED' end, d.reason,
        d.supplier_name, d.receipt_date, d.document_number, d.total, d.uploaded_at, false,
        editable and not d.posted and not d.busy and not d.has_copies
      from private.receipt_duplicate_candidates(p_store) d
    )
    select coalesce(jsonb_agg(to_jsonb(records) order by occurred_at desc,id),'[]'::jsonb) from records
  );
end $$;

create function private.set_baihuayuan_receipt_duplicate(
  p_store uuid, p_batch uuid, p_original uuid, p_action text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  pair uuid;
  org uuid;
  current_original uuid;
  link_reason text;
begin
  if auth.uid() is null
    or not private.has_active_store_role(p_store,array['ADMIN','LOGISTICS','OWNER']::public.app_role[])
  then
    raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';
  end if;
  perform private.assert_store_editable(p_store);
  select organization_id into org from public.stores where id=p_store and is_active and name in ('BeApe','Gras');
  if org is null or p_batch is null or p_original is null or p_batch=p_original
    or p_action is null or p_action not in ('exclude','restore')
  then
    raise exception 'INVALID_APP_INPUT' using errcode='22023';
  end if;
  for pair in select unnest(array[p_batch,p_original]) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(pair::text,0));
  end loop;
  begin
    perform 1 from public.receipt_upload_batches b
      where b.id in (p_batch,p_original) and b.store_id=p_store and b.organization_id=org
      order by b.id for update nowait;
  exception when lock_not_available then
    raise exception 'RECEIPT_DUPLICATE_BUSY' using errcode='PT409';
  end;
  if 2<>(select count(*) from public.receipt_upload_batches b
    where b.id in (p_batch,p_original) and b.store_id=p_store and b.organization_id=org)
  then
    raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';
  end if;
  if private.receipt_duplicate_posted(p_batch) then
    raise exception 'RECEIPT_DUPLICATE_POSTED' using errcode='PT409';
  end if;
  if private.receipt_duplicate_busy(p_batch) then
    raise exception 'RECEIPT_DUPLICATE_BUSY' using errcode='PT409';
  end if;
  if exists (
    select 1 from private.baihuayuan_record_flags f where f.organization_id=org
      and f.entity_type='RECEIPT_BATCH' and f.state<>'LIVE'
      and (f.entity_id=p_batch or (p_action='exclude' and f.entity_id=p_original))
  ) then
    raise exception 'RECEIPT_DUPLICATE_CHANGED' using errcode='PT409';
  end if;

  select original_batch_id, reason into current_original, link_reason
  from private.receipt_duplicate_links where batch_id=p_batch;
  if p_action='restore' then
    if current_original is null then return jsonb_build_object('saved',true); end if;
    if current_original is distinct from p_original then
      raise exception 'RECEIPT_DUPLICATE_CHANGED' using errcode='PT409';
    end if;
    delete from private.receipt_duplicate_links where batch_id=p_batch;
    insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,user_id)
      values(org,p_store,'receipt_upload_batch',p_batch::text,'RECEIPT_DUPLICATE_RESTORED',
        jsonb_build_object('original_batch_id',p_original,'reason',link_reason),auth.uid());
  else
    if current_original=p_original then return jsonb_build_object('saved',true); end if;
    if current_original is not null or exists (
      select 1 from private.receipt_duplicate_links where original_batch_id=p_batch or batch_id=p_original
    ) or exists (select 1 from private.receipt_same_photo_entries where source_batch_id=p_batch) then
      raise exception 'RECEIPT_DUPLICATE_CHANGED' using errcode='PT409';
    end if;
    select d.reason into link_reason from private.receipt_duplicate_candidates(p_store) d
      where d.batch_id=p_batch and d.original_batch_id=p_original;
    if link_reason is null then
      raise exception 'RECEIPT_DUPLICATE_CHANGED' using errcode='PT409';
    end if;
    insert into private.receipt_duplicate_links(batch_id,original_batch_id,reason)
      values(p_batch,p_original,case when link_reason='EXACT_PHOTO' then link_reason else 'MANUAL' end);
    insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
      values(org,p_store,'receipt_upload_batch',p_batch::text,'RECEIPT_DUPLICATE_EXCLUDED',
        jsonb_build_object('original_batch_id',p_original,'reason',link_reason),auth.uid());
  end if;
  return jsonb_build_object('saved',true);
end $$;

create function public.get_baihuayuan_receipt_duplicates(p_store_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.get_baihuayuan_receipt_duplicates(p_store_id)
$$;
create function public.set_baihuayuan_receipt_duplicate(
  p_store_id uuid, p_batch_id uuid, p_original_batch_id uuid, p_action text
) returns jsonb language sql security invoker set search_path='' as $$
  select private.set_baihuayuan_receipt_duplicate(p_store_id,p_batch_id,p_original_batch_id,p_action)
$$;
revoke all on function private.get_baihuayuan_receipt_duplicates(uuid),
  public.get_baihuayuan_receipt_duplicates(uuid),
  private.set_baihuayuan_receipt_duplicate(uuid,uuid,uuid,text),
  public.set_baihuayuan_receipt_duplicate(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function private.get_baihuayuan_receipt_duplicates(uuid),
  public.get_baihuayuan_receipt_duplicates(uuid),
  private.set_baihuayuan_receipt_duplicate(uuid,uuid,uuid,text),
  public.set_baihuayuan_receipt_duplicate(uuid,uuid,uuid,text) to authenticated;

-- Existing exact, unposted copies stay recoverable. Skip work in progress and
-- batches that are themselves the retained original for another copy.
do $backfill$
declare copy record;
begin
  for copy in
    select s.id as store_id, s.organization_id, d.batch_id, d.original_batch_id
    from public.stores s cross join lateral private.receipt_duplicate_candidates(s.id) d
    where s.is_active and s.name in ('BeApe','Gras') and d.reason='EXACT_PHOTO' and not d.has_copies
  loop
    if not pg_try_advisory_xact_lock(hashtextextended(copy.batch_id::text,0))
      or not pg_try_advisory_xact_lock(hashtextextended(copy.original_batch_id::text,0))
    then continue; end if;
    begin
      perform 1 from public.receipt_upload_batches b
        where b.id in (copy.batch_id,copy.original_batch_id) and b.store_id=copy.store_id
        order by b.id for update nowait;
    exception when lock_not_available then continue;
    end;
    if private.receipt_duplicate_posted(copy.batch_id) or private.receipt_duplicate_busy(copy.batch_id)
      or exists (select 1 from private.receipt_duplicate_links d where d.original_batch_id=copy.batch_id or d.batch_id=copy.original_batch_id)
      or not exists (
        select 1 from private.receipt_duplicate_candidates(copy.store_id) d
          where d.batch_id=copy.batch_id and d.original_batch_id=copy.original_batch_id and d.reason='EXACT_PHOTO' and not d.has_copies
      )
    then continue; end if;
    insert into private.receipt_duplicate_links(batch_id,original_batch_id,reason)
      values(copy.batch_id,copy.original_batch_id,'EXACT_PHOTO') on conflict do nothing;
    if found then
      insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value)
        values(copy.organization_id,copy.store_id,'receipt_upload_batch',copy.batch_id::text,'RECEIPT_DUPLICATE_EXCLUDED',
          jsonb_build_object('original_batch_id',copy.original_batch_id,'reason','EXACT_PHOTO'));
    end if;
  end loop;
end $backfill$;

-- Old upload/retry routes must not queue a copy already removed from the inbox.
do $guard$
declare
  definition text;
  target record;
  anchor text;
begin
  for target in select * from (values
    ('public.enqueue_receipt_ocr(uuid)','p_batch_id'),
    ('public.begin_baihuayuan_receipt_manual_review(uuid,uuid)','p_batch_id'),
    ('public.save_pilot_receipt_review(uuid,text,uuid)','p_batch_id'),
    ('private.baihuayuan_receipt_photo(text,uuid,jsonb)','b.id')
  ) as guarded(signature,batch_expression)
  loop
    definition:=pg_get_functiondef(target.signature::regprocedure);
    anchor:=format('perform pg_advisory_xact_lock(hashtextextended(%s::text,0));',target.batch_expression);
    if strpos(definition,anchor)=0 then raise exception 'DUPLICATE_GUARD_ANCHOR_MISSING: %',target.signature; end if;
    execute replace(definition,anchor,anchor||format($body$
      if exists (select 1 from private.receipt_duplicate_links where batch_id=%s) then
        raise exception 'RECEIPT_ACCOUNT_NOT_LIVE' using errcode='42501';
      end if;
    $body$,target.batch_expression));
  end loop;

  definition:=pg_get_functiondef('private.create_receipt_same_photo(uuid,uuid,jsonb,uuid)'::regprocedure);
  anchor:='sources:=private.receipt_ocr_sources(p_batch);';
  if strpos(definition,anchor)=0 then raise exception 'DUPLICATE_SAME_PHOTO_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,$body$
    perform pg_advisory_xact_lock(hashtextextended('receipt-ocr-dispatch',0));
    perform pg_advisory_xact_lock(hashtextextended(p_batch::text,0));
    if exists (select 1 from private.receipt_duplicate_links where batch_id=p_batch) then
      raise exception 'RECEIPT_ACCOUNT_NOT_LIVE' using errcode='42501';
    end if;
  $body$||anchor);

  -- Moving either side would strand an excluded copy in the previous store.
  definition:=pg_get_functiondef('private.correct_receipt_store(uuid,uuid,uuid,jsonb,uuid)'::regprocedure);
  anchor:='-- Do not move a physical stock/custody event by relabelling its receipt.';
  if strpos(definition,anchor)=0 then raise exception 'DUPLICATE_STORE_MOVE_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,$body$
    if exists (select 1 from private.receipt_duplicate_links where batch_id=p_batch or original_batch_id=p_batch) then
      raise exception 'RECEIPT_DUPLICATE_LINKED' using errcode='PT409';
    end if;
  $body$||anchor);
end $guard$;

notify pgrst,'reload schema';
