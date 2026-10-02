-- Additive, receipt-level accounting only. No source receipts, PINs, roles or stock are rewritten.
create table private.receipt_reconciliations (
 batch_id uuid primary key references public.receipt_upload_batches(id),
 store_id uuid not null references public.stores(id),
 amount_override jsonb check(amount_override is null or jsonb_typeof(amount_override)='object'),
 note text not null default '' check(length(note)<=2000),
 checked_at timestamptz, checked_by uuid references auth.users(id), checked_source text,
 revision integer not null check(revision>0),
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
alter table private.receipt_reconciliations enable row level security;
revoke all on private.receipt_reconciliations from public,anon,authenticated;

create function private.receipt_account_number(p_value text)
returns numeric language sql immutable set search_path='' as $$
 select case when length(btrim(p_value))<=64 and btrim(p_value) ~ '^-?[0-9]+([.][0-9]+)?$' then btrim(p_value)::numeric end
$$;
revoke all on function private.receipt_account_number(text) from public,anon,authenticated;

create function private.receipt_account_date(p_value text)
returns date language plpgsql immutable set search_path='' as $$
declare parts text[];yr integer;
begin
 parts:=regexp_match(regexp_replace(btrim(p_value),'^民國',''),'^(\d{3,4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$');
 if parts is null then return null;end if;
 yr:=parts[1]::integer+case when length(parts[1])=3 then 1911 else 0 end;
 if yr<1900 then return null;end if;
 return make_date(yr,parts[2]::integer,parts[3]::integer);
 exception when datetime_field_overflow or numeric_value_out_of_range then return null;
end $$;
revoke all on function private.receipt_account_date(text) from public,anon,authenticated;

create function public.get_baihuayuan_receipt_accounting(p_store_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ledger jsonb; result jsonb; org uuid;
begin
 if auth.uid() is null or not private.has_active_store_role(p_store_id,array['LOGISTICS','OWNER']::public.app_role[]) then
  raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';
 end if;
 select organization_id into org from public.stores where id=p_store_id and is_active and name in ('BeApe','Gras');
 if org is null then raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501';end if;
 ledger:=public.get_baihuayuan_receipt_detail_ledger(p_store_id);
 with line_groups as (
  select x->>'batch_id' batch_id,count(*)::integer line_count,
   case when count(*)=count(private.receipt_account_number(x->>'subtotal')) then sum(private.receipt_account_number(x->>'subtotal')) end line_net,
   jsonb_agg(jsonb_build_object('row',x->>'row_key','run',x->>'run_id','name',x->>'product_name','unit',x->>'unit','qty',x->'quantity','price',x->'unit_price','amount',x->'subtotal') order by x->>'row_key') lines,
   string_agg(distinct x->>'product_name',' ') products
  from jsonb_array_elements(ledger) x group by x->>'batch_id'
 ), source as (
  select b.id,b.batch_number,b.work_date,b.uploaded_at,b.group_mode,
   r.id run_id,r.status run_status,g.id receipt_id,
   coalesce(l.line_count,0) line_count,l.line_net,l.products,
   nullif(nullif(coalesce(private.supplier_display_name(org,nullif(f.doc_values->>'supplier_name','')),s.name),''),'未提供') supplier_name,
   private.receipt_account_date(coalesce(nullif(f.doc_values->>'receipt_date',''),g.receipt_date::text))::text receipt_date,
   coalesce(nullif(f.doc_values->>'document_number',''),g.document_number) document_number,
   coalesce(g.subtotal_ex_tax,private.receipt_account_number(f.doc_values->>'subtotal_ex_tax'),l.line_net) source_net,
   coalesce(g.tax,private.receipt_account_number(f.doc_values->>'tax')) source_tax,
   case when b.group_mode='ADMIN_DIRECT' and g.tax is null then null else coalesce(g.total_inc_tax,private.receipt_account_number(f.doc_values->>'total_inc_tax')) end source_total,
   coalesce(flags.state,'LIVE') record_state,
   private.can_review_receipt(b.id) and not exists(select 1 from public.store_memberships sm where sm.store_id=p_store_id and sm.user_id=auth.uid() and sm.is_active and sm.access_mode='VIEW') can_edit,
   (select count(*)::integer from public.receipt_documents rd where rd.batch_id=b.id) pages,
   md5(jsonb_build_object('run',r.id,'document',f.doc_values,'published',jsonb_build_object('supplier',g.supplier_id,'date',g.receipt_date,'number',g.document_number,'net',g.subtotal_ex_tax,'tax',g.tax,'total',g.total_inc_tax),'lines',l.lines)::text) source_fingerprint
  from public.receipt_upload_batches b
  left join lateral(select rr.id,rr.status from public.receipt_ocr_runs rr where rr.batch_id=b.id order by rr.version desc limit 1) r on true
  left join lateral(select jsonb_object_agg(e.field_name,e.value) doc_values from private.receipt_effective_fields(r.id) e where e.row_key='document') f on true
  left join public.goods_receipts g on g.source_batch_id=b.id
  left join public.suppliers s on s.id=g.supplier_id
  left join line_groups l on l.batch_id=b.id::text
  left join private.baihuayuan_record_flags flags on flags.organization_id=org and flags.entity_type='RECEIPT_BATCH' and flags.entity_id=b.id
  where b.store_id=p_store_id and private.can_read_receipt(b.id)
   and not exists(select 1 from private.receipt_duplicate_links dl where dl.batch_id=b.id)
 ), amounts as (
  select a.*,c.amount_override,c.note,c.checked_at,c.checked_by,c.checked_source,coalesce(c.revision,0) revision,
   case when c.amount_override is not null then private.receipt_account_number(c.amount_override->>'net') else a.source_net end net,
   case when c.amount_override is not null then private.receipt_account_number(c.amount_override->>'tax') else a.source_tax end tax,
   case when c.amount_override is not null then private.receipt_account_number(c.amount_override->>'total') else a.source_total end stated_total
  from source a left join private.receipt_reconciliations c on c.batch_id=a.id and c.store_id=p_store_id
 ), ready as (
  select a.*,coalesce(stated_total,case when net is not null and tax is not null then net+tax end) total,
   (line_count=0 or (receipt_id is null and coalesce(run_status,'')<>'SUCCEEDED')) pending,
   (net is not null and tax is not null and stated_total is not null and abs(net+tax-stated_total)>0.01)
    or (amount_override is null and source_net is not null and line_net is not null and abs(source_net-line_net)>1) amount_conflict
  from amounts a
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'batch_id',id,'batch_number',batch_number,'work_date',work_date,'uploaded_at',uploaded_at,
  'supplier_name',coalesce(supplier_name,''),'receipt_date',receipt_date,'document_number',document_number,
  'net',net,'tax',tax,'total',total,'line_net',line_net,'line_count',line_count,'products',products,
  'source_net',source_net,'source_tax',source_tax,'source_total',source_total,'amount_override',amount_override,
  'note',coalesce(note,''),'revision',revision,'source_fingerprint',source_fingerprint,
  'checked_at',checked_at,'pending',pending,'amount_conflict',coalesce(amount_conflict,false),
  'record_state',record_state,'can_edit',can_edit,'pages',pages,
  'status',case when checked_at is not null and checked_source is distinct from source_fingerprint then 'RECHECK'
    when amount_conflict then 'RECHECK' when pending then 'PENDING'
    when net is null or tax is null or total is null or supplier_name is null or receipt_date is null then 'MISSING'
    when checked_at is not null then 'CHECKED' else 'UNCHECKED' end
 ) order by supplier_name nulls last,coalesce(receipt_date,work_date::text) desc,id),'[]') into result from ready;
 return result;
end $$;
revoke all on function public.get_baihuayuan_receipt_accounting(uuid) from public,anon;
grant execute on function public.get_baihuayuan_receipt_accounting(uuid) to authenticated;

create function public.save_baihuayuan_receipt_reconciliation(p_store_id uuid,p_batch_id uuid,p_data jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; row_data jsonb; old_row jsonb; result jsonb; cached private.app_requests;
 amounts jsonb; net numeric; tax numeric; total numeric; checked boolean; next_revision integer; payload jsonb;
begin
 perform private.assert_store_editable(p_store_id);
 select organization_id into org from public.stores where id=p_store_id and is_active and name in ('BeApe','Gras');
 if org is null or not exists(select 1 from public.receipt_upload_batches b where b.id=p_batch_id and b.store_id=p_store_id)
  or not private.can_review_receipt(p_batch_id) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 if p_request_id is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>12000
  or jsonb_typeof(p_data->'checked') is distinct from 'boolean' or length(coalesce(p_data->>'note',''))>2000 then
  raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 if exists(select 1 from private.receipt_duplicate_links where batch_id=p_batch_id)
  or exists(select 1 from private.baihuayuan_record_flags where organization_id=org and entity_type='RECEIPT_BATCH' and entity_id=p_batch_id and state<>'LIVE') then
  raise exception 'RECEIPT_ACCOUNT_NOT_LIVE' using errcode='42501';end if;
 payload:=p_data||jsonb_build_object('batch_id',p_batch_id);
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_request_id::text,0));
 select * into cached from private.app_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'receipt.reconcile' or cached.payload<>payload then
   raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return cached.result;
 end if;
 perform 1 from public.receipt_upload_batches where id=p_batch_id for update;
 select value into row_data from jsonb_array_elements(public.get_baihuayuan_receipt_accounting(p_store_id)) where value->>'batch_id'=p_batch_id::text;
 if row_data is null then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';end if;
 if (p_data->>'revision')::integer is distinct from (row_data->>'revision')::integer
  or p_data->>'source_fingerprint' is distinct from row_data->>'source_fingerprint' then
  raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 amounts:=nullif(p_data->'amount_override','null'::jsonb);
 if amounts is not null then
  if jsonb_typeof(amounts)<>'object' or not (amounts ?& array['net','tax','total']) then raise exception 'INVALID_RECEIPT_AMOUNT' using errcode='22023';end if;
  if exists(select 1 from jsonb_each(amounts) e where e.key not in ('net','tax','total')
    or (e.value<>'null'::jsonb and (jsonb_typeof(e.value)<>'number' or private.receipt_account_number(e.value#>>'{}') is null or scale(private.receipt_account_number(e.value#>>'{}'))>4 or abs(private.receipt_account_number(e.value#>>'{}'))>=1000000000))) then
   raise exception 'INVALID_RECEIPT_AMOUNT' using errcode='22023';end if;
 end if;
 checked:=(p_data->>'checked')::boolean;
 net:=case when amounts is null then private.receipt_account_number(row_data->>'source_net') else private.receipt_account_number(amounts->>'net') end;
 tax:=case when amounts is null then private.receipt_account_number(row_data->>'source_tax') else private.receipt_account_number(amounts->>'tax') end;
 total:=case when amounts is null then private.receipt_account_number(row_data->>'source_total') else private.receipt_account_number(amounts->>'total') end;
 total:=coalesce(total,case when net is not null and tax is not null then net+tax end);
 if checked and ((row_data->>'pending')::boolean or net is null or tax is null or total is null
  or abs(net+tax-total)>0.01 or nullif(row_data->>'supplier_name','') is null or nullif(row_data->>'receipt_date','') is null
  or (amounts is null and private.receipt_account_number(row_data->>'line_net') is not null and abs(net-private.receipt_account_number(row_data->>'line_net'))>1)) then
  raise exception 'RECEIPT_ACCOUNT_INCOMPLETE' using errcode='22023';end if;
 select to_jsonb(c) into old_row from private.receipt_reconciliations c where batch_id=p_batch_id;
 next_revision:=(row_data->>'revision')::integer+1;
 insert into private.receipt_reconciliations(batch_id,store_id,amount_override,note,checked_at,checked_by,checked_source,revision,updated_by,updated_at)
 values(p_batch_id,p_store_id,amounts,coalesce(p_data->>'note',''),case when checked then now() end,case when checked then auth.uid() end,
  case when checked then row_data->>'source_fingerprint' end,next_revision,auth.uid(),now())
 on conflict(batch_id) do update set amount_override=excluded.amount_override,note=excluded.note,checked_at=excluded.checked_at,
  checked_by=excluded.checked_by,checked_source=excluded.checked_source,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 result:=jsonb_build_object('saved',true,'batch_id',p_batch_id,'revision',next_revision,'checked',checked);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result)
 values(p_store_id,p_request_id,auth.uid(),'receipt.reconcile',payload,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id,attempt_id,store_id)
 values(org,'receipt_reconciliation',p_batch_id::text,'receipt.reconcile',old_row,
  (select to_jsonb(c) from private.receipt_reconciliations c where batch_id=p_batch_id),auth.uid(),p_request_id,p_store_id);
 return result;
end $$;
revoke all on function public.save_baihuayuan_receipt_reconciliation(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.save_baihuayuan_receipt_reconciliation(uuid,uuid,jsonb,uuid) to authenticated;
