-- Explicit receipt confirmation is separate from nullable pricing and financial reconciliation.
-- No historical receipt is changed by this migration.
alter table private.receipt_account_edits add column received_at timestamptz;

do $$declare src text;anchor text;begin
 src:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
 anchor:='''entry_completed'',exists';
 if strpos(src,anchor)=0 then raise exception 'RECEIVE_READ_ANCHOR';end if;
 src:=replace(src,anchor,'''received_at'',(select received_at from private.receipt_account_edits where batch_id=a.id),''entry_completed'',exists');execute src;
 -- Confirmed quantities and identity are immutable through price supplementation.
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='-- Exact row identities';
 if strpos(src,anchor)=0 then raise exception 'RECEIVE_SAVE_ANCHOR';end if;
 src:=replace(src,anchor,$patch$
 if current_row->>'received_at' is not null then
  if header is distinct from jsonb_build_object('supplier_name',current_row->>'supplier_name','receipt_date',current_row->'receipt_date','document_number',coalesce(current_row->>'document_number',''))
   or exists(select 1 from jsonb_array_elements(lines) x join lateral (select v from jsonb_array_elements(current_row->'lines') v where v->>'row_key'=x->>'row_key') old on true
    where (x->>'product_name',coalesce(x->>'specification',''),x->>'unit',private.receipt_account_number(x->>'quantity'),coalesce(x->>'handling','NORMAL'))
     is distinct from (old.v->>'product_name',coalesce(old.v->>'specification',''),old.v->>'unit',private.receipt_account_number(old.v->>'quantity'),coalesce(old.v->>'handling','NORMAL')))
  then raise exception 'RECEIPT_RECEIVED_LOCKED' using errcode='22023';end if;
 end if;
 -- Exact row identities$patch$);
 execute src;
end $$;

-- Save and confirm in one transaction, with actor-scoped idempotency and existing CAS checks.
create function public.receive_baihuayuan_receipt(p_store_id uuid,p_batch_id uuid,p_data jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches;cached private.app_requests;payload jsonb;result jsonb;a jsonb;fresh jsonb;l jsonb;sid uuid;pid uuid;rid uuid;header jsonb;
begin
 if auth.uid() is null or not private.can_review_receipt(p_batch_id) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 perform private.assert_store_editable(p_store_id);
 select * into b from public.receipt_upload_batches where id=p_batch_id and store_id=p_store_id and store_name in ('BeApe','Gras');
 if not found then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';end if;
 if p_request_id is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>250000 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 if exists(select 1 from private.receipt_duplicate_links where batch_id=p_batch_id) or exists(select 1 from private.baihuayuan_record_flags where entity_type='RECEIPT_BATCH' and entity_id=p_batch_id and state<>'LIVE') then raise exception 'RECEIPT_ACCOUNT_NOT_LIVE' using errcode='42501';end if;
 payload:=jsonb_build_object('batch_id',p_batch_id,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_request_id::text,0));
 select * into cached from private.app_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'receipt.receive' or cached.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return cached.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-ocr-dispatch',0));
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 perform 1 from public.receipt_upload_batches where id=p_batch_id for update;
 if p_data ? 'removed_row_keys' then
  result:=public.save_baihuayuan_receipt_entry(p_store_id,p_batch_id,p_data||'{"checked":false,"entry_completed":true}',gen_random_uuid());
 else
  result:=public.save_baihuayuan_receipt_review(p_store_id,p_batch_id,p_data||'{"checked":false,"entry_completed":true}',gen_random_uuid());
 end if;
 a:=result->'account';
 select id into rid from public.goods_receipts where source_batch_id=p_batch_id;
 if rid is null then
  if nullif(btrim(a->>'supplier_name'),'') is null or private.receipt_account_date(a->>'receipt_date') is null or jsonb_array_length(a->'lines')=0 then raise exception 'RECEIPT_RECEIVE_REQUIRED' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(a->'lines') x where nullif(btrim(x->>'product_name'),'') is null or nullif(btrim(x->>'unit'),'') is null or coalesce(private.receipt_account_number(x->>'quantity'),0)<=0) then raise exception 'RECEIPT_RECEIVE_REQUIRED' using errcode='22023';end if;
  if exists(select 1 from private.receipt_photo_requests where batch_id=p_batch_id and completed_at is null) then raise exception 'PHOTO_RETAKE_REQUIRED';end if;
  sid:=private.supplier_identity(b.organization_id,a->>'supplier_name');
  if sid is null then raise exception 'SUPPLIER_NAME_REQUIRED' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(b.store_id::text||sid::text||coalesce(a->>'document_number',''),0));
  if nullif(a->>'document_number','') is not null and exists(select 1 from public.goods_receipts g where g.store_id=p_store_id and g.supplier_id=sid and g.document_number=a->>'document_number' and g.receipt_date=(a->>'receipt_date')::date) then raise exception 'DUPLICATE_RECEIPT_NUMBER';end if;
  header:=jsonb_build_object('supplier_name',a->>'supplier_name','receipt_date',a->>'receipt_date','document_number',a->>'document_number');
  perform private.receipt_link_custody(p_store_id,p_batch_id,(a->>'run_id')::uuid,header,a->'lines',true);
  insert into public.goods_receipts(organization_id,store_id,supplier_id,receipt_date,document_number,subtotal_ex_tax,tax,total_inc_tax,reviewed_by,reviewed_at,source_batch_id)
   values(b.organization_id,p_store_id,sid,(a->>'receipt_date')::date,nullif(a->>'document_number',''),(a->>'net')::numeric,(a->>'tax')::numeric,(a->>'total')::numeric,auth.uid(),now(),p_batch_id) returning id into rid;
  for l in select value from jsonb_array_elements(a->'lines') loop
   -- Freight is financial only; custody uses its existing, exactly-once collection event.
   if coalesce(l->>'handling','NORMAL')<>'NORMAL' then continue;end if;
   select id into pid from public.products where id=nullif(l->>'product_id','')::uuid and organization_id=b.organization_id and is_active;
   if pid is null then
    if exists(select 1 from public.products where organization_id=b.organization_id and not is_active and lower(btrim(name))=lower(btrim(l->>'product_name')) and coalesce(specification,'')=coalesce(l->>'specification','') and base_unit=l->>'unit') then raise exception 'RECEIPT_PRODUCT_INACTIVE' using errcode='22023';end if;
    pid:=private.baihuayuan_resolve_receipt_product(b.organization_id,p_store_id,l->>'product_name',l->>'specification',l->>'unit');
   end if;
   insert into public.receipt_lines(organization_id,receipt_id,product_id,supplier_id,quantity,unit,unit_price_ex_tax,line_subtotal_ex_tax,specification,human_correction,modified_by,modified_at,source_row_key)
    values(b.organization_id,rid,pid,sid,(l->>'quantity')::numeric,l->>'unit',(l->>'unit_price')::numeric,(l->>'subtotal')::numeric,coalesce(l->>'specification',''),l,auth.uid(),now(),l->>'row_key');
  end loop;
  update public.receipt_upload_batches set status='COMPLETED' where id=p_batch_id;
  -- Re-anchor accounting to the published source without losing nullable prices or edits.
  fresh:=private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0;
  result:=public.save_baihuayuan_receipt_review(p_store_id,p_batch_id,(p_data-'removed_row_keys')||jsonb_build_object('source_fingerprint',fresh->>'source_fingerprint','revision',fresh->'revision','lines',a->'lines','checked',false,'entry_completed',true),gen_random_uuid());
  update private.receipt_account_edits set received_at=now() where batch_id=p_batch_id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id,attempt_id,store_id)
   values(b.organization_id,'goods_receipt',rid::text,'receipt.receive',jsonb_build_object('batch_id',p_batch_id,'prices_pending',exists(select 1 from jsonb_array_elements(a->'lines') x where coalesce(x->>'handling','NORMAL')<>'CUSTODY_RELEASE' and x->>'unit_price' is null)),auth.uid(),p_request_id,p_store_id);
 end if;
 perform private.sync_ingredient_prices(p_store_id,p_batch_id);
 result:=jsonb_build_object('saved',true,'account',private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,auth.uid(),'receipt.receive',payload,result);
 return result;
end $$;
revoke all on function public.receive_baihuayuan_receipt(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.receive_baihuayuan_receipt(uuid,uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
