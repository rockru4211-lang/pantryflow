-- Receipt annotations are scoped to one OCR version and retain the original evidence.
create table private.receipt_ledger_annotations(
 batch_id uuid not null references public.receipt_upload_batches(id),
 run_id uuid not null references public.receipt_ocr_runs(id),
 row_key text not null, category text not null check(category in ('食材','耗材','調料','酒水','待分類')),
 note text not null default '', revision integer not null default 1,
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 primary key(batch_id,run_id,row_key)
);
alter table private.receipt_ledger_annotations enable row level security;
revoke all on private.receipt_ledger_annotations from public,anon,authenticated;

alter function private.baihuayuan_receipt_detail_ledger(uuid) rename to baihuayuan_receipt_detail_ledger_before_table;
revoke all on function private.baihuayuan_receipt_detail_ledger_before_table(uuid) from public,anon,authenticated;
create function private.baihuayuan_receipt_detail_ledger(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb;
begin
 base:=private.baihuayuan_receipt_detail_ledger_before_table(p_store);
 return coalesce((select jsonb_agg(r||jsonb_build_object(
  'category',coalesce(a.category,c.category,private.classify_product(r->>'product_name',p.category)),
  'note',coalesce(a.note,m.note,''),'annotation_revision',coalesce(a.revision,0)) order by ord)
 from jsonb_array_elements(base) with ordinality x(r,ord)
 left join private.receipt_ledger_annotations a on a.batch_id=(r->>'batch_id')::uuid and a.run_id=(r->>'run_id')::uuid and a.row_key=r->>'row_key'
 left join private.receipt_manual_rows m on r->>'row_key'='manual-'||m.id::text and m.batch_id=(r->>'batch_id')::uuid and m.run_id=(r->>'run_id')::uuid
 left join public.products p on p.id=nullif(r->>'product_id','')::uuid
 left join private.product_categories c on c.product_id=p.id),'[]');
end $$;
revoke all on function private.baihuayuan_receipt_detail_ledger(uuid) from public,anon;
grant execute on function private.baihuayuan_receipt_detail_ledger(uuid) to authenticated;
create or replace function public.get_baihuayuan_receipt_detail_ledger(p_store_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.baihuayuan_receipt_detail_ledger(p_store_id)$$;

-- One transaction for document fields, one item and its annotations. Existing
-- operation request IDs provide audit and idempotency, including adding a line.
create function private.receipt_edit_ledger(s uuid,d jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.receipt_upload_batches; state jsonb; result jsonb; row_id text:=d->>'row_key'; run uuid:=(d->>'run_id')::uuid; line jsonb; doc jsonb; supplier text; cat text:=d->>'category'; old_revision integer;
begin
 perform private.assert_store_editable(s);
 select * into b from public.receipt_upload_batches where id=(d->>'batch_id')::uuid and store_id=s;
 if auth.uid() is null or b.id is null or not private.can_review_receipt(b.id) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(b.id::text,0));
 state:=private.baihuayuan_receipt_review_state(b.id);
 if (state->>'published')::boolean then raise exception 'PUBLISHED_RECEIPT_IMMUTABLE';end if;
 if run is distinct from (state->>'run_id')::uuid then raise exception 'OCR_VERSION_CHANGED';end if;
 if d->>'review_revision' is distinct from state->>'revision' then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 if cat is null or cat not in ('食材','耗材','調料','酒水','待分類') or length(coalesce(d->>'note',''))>2000 then raise exception 'INVALID_APP_INPUT';end if;
 select revision into old_revision from private.receipt_ledger_annotations where batch_id=b.id and run_id=run and row_key=row_id;
 if coalesce(old_revision,0) is distinct from coalesce((d->>'annotation_revision')::integer,0) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 doc:=d->'document';
 if doc is not null and doc<>'null'::jsonb then
  if doc->>'row_key'<>'document' or (doc->>'batch_id')::uuid is distinct from b.id or (doc->>'run_id')::uuid is distinct from run then raise exception 'INVALID_APP_INPUT';end if;
  perform private.receipt_edit_card(s,doc);
  select value#>>'{}' into supplier from private.receipt_effective_fields(run) where row_key='document' and field_name='supplier_name';
  if nullif(btrim(supplier),'') is null then raise exception 'SUPPLIER_NAME_REQUIRED';end if;
  -- Resolve the corrected name itself, never remap all receipts with the old OCR alias.
  if private.supplier_identity(b.organization_id,supplier) is null then
   perform private.resolve_supplier_name(s,jsonb_build_object('source_name',supplier,'expected_supplier_id',null,'supplier_id',null,'new_name',supplier));
  end if;
  update private.receipt_manual_rows set supplier_name=supplier,updated_at=now() where batch_id=b.id and run_id=run and deleted_at is null;
 end if;
 if row_id='new' or row_id like 'manual-%' then
  line:=d->'manual';
  select value#>>'{}' into supplier from private.receipt_effective_fields(run) where row_key='document' and field_name='supplier_name';
  result:=public.save_baihuayuan_manual_receipt_line(s,b.id,run,supplier,line->>'product_name',line->>'specification',line->>'unit',(line->>'quantity')::numeric,(line->>'unit_price')::numeric,d->>'note',case when row_id='new' then null else substr(row_id,8)::uuid end);
  row_id:='manual-'||(result->>'id');
 else
  line:=d->'line';
  if line->>'row_key' is distinct from row_id or row_id='document' or (line->>'batch_id')::uuid is distinct from b.id or (line->>'run_id')::uuid is distinct from run then raise exception 'INVALID_APP_INPUT';end if;
  result:=private.receipt_edit_card(s,line);
 end if;
 insert into private.receipt_ledger_annotations(batch_id,run_id,row_key,category,note,updated_by)
 values(b.id,run,row_id,cat,coalesce(d->>'note',''),auth.uid())
 on conflict(batch_id,run_id,row_key) do update set category=excluded.category,note=excluded.note,revision=private.receipt_ledger_annotations.revision+1,updated_by=auth.uid(),updated_at=now();
 return jsonb_build_object('saved',true,'batch_id',b.id,'row_key',row_id);
end $$;
revoke all on function private.receipt_edit_ledger(uuid,jsonb) from public,anon,authenticated;
do $$
declare src text; anchor text;
begin
 select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src;
 anchor:='if p_action=''receipt.edit-card'' and';
 if strpos(src,anchor)=0 then raise exception 'RECEIPT_GUARD_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'if p_action in (''receipt.edit-card'',''receipt.edit-ledger'') and');
 anchor:='elsif p_action=''receipt.edit-card'' then';
 if strpos(src,anchor)=0 then raise exception 'RECEIPT_OPERATION_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'elsif p_action=''receipt.edit-ledger'' then v_result:=private.receipt_edit_ledger(p_store,p_data); '||anchor);
 execute src;
end $$;
notify pgrst,'reload schema';
