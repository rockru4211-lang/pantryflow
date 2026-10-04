-- BeApe receipt corrections are effective views over immutable evidence.
-- No receipt, stock, PIN, membership, trigger or existing role policy is rewritten.
create table private.receipt_account_edits (
 batch_id uuid primary key references public.receipt_upload_batches(id),
 store_id uuid not null references public.stores(id), run_id uuid,
 header jsonb not null default '{}', line_values jsonb not null default '{}',
 adjustment numeric not null default 0, adjustment_note text not null default '',
 source_fingerprint text not null, revision integer not null default 1,
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 check(jsonb_typeof(header)='object' and jsonb_typeof(line_values)='object'),
 check(revision>0 and abs(adjustment)<1000000000 and length(adjustment_note)<=2000)
);
alter table private.receipt_account_edits enable row level security;
revoke all on private.receipt_account_edits from public,anon,authenticated;

-- Header filtering happens before line aggregation. Effective OCR fields are read
-- once per version; inclusion decisions do not re-read an entire OCR run per item.
create function private.receipt_account_rows(p_store uuid,p_from date,p_to date,p_supplier text,p_batch uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid; editable boolean; result jsonb;
begin
 if auth.uid() is null or not private.has_active_store_role(p_store,array['LOGISTICS','OWNER']::public.app_role[]) then
  raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';
 end if;
 select organization_id into org from public.stores where id=p_store and is_active and name in ('BeApe','Gras');
 if org is null then raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501';end if;
 if p_from>p_to then raise exception 'INVALID_DATE_RANGE' using errcode='22023';end if;
 editable:=not exists(select 1 from public.store_memberships sm where sm.store_id=p_store and sm.user_id=auth.uid() and sm.is_active and sm.access_mode='VIEW');
 with batches as materialized (
  select b.*,r.id run_id,r.status run_status,g.id receipt_id,g.supplier_id,
   g.receipt_date goods_date,g.document_number goods_number,g.subtotal_ex_tax goods_net,g.tax goods_tax,g.total_inc_tax goods_total,
   s.name goods_supplier,e.header edit_header,e.line_values,e.adjustment,e.adjustment_note,e.revision edit_revision,
   e.source_fingerprint edited_source,e.run_id edited_run,
   coalesce(flags.state,'LIVE') record_state
  from public.receipt_upload_batches b
  left join lateral(select id,status from public.receipt_ocr_runs where batch_id=b.id order by version desc limit 1) r on true
  left join public.goods_receipts g on g.source_batch_id=b.id
  left join public.suppliers s on s.id=g.supplier_id
  left join private.receipt_account_edits e on e.batch_id=b.id and e.store_id=p_store
  left join private.baihuayuan_record_flags flags on flags.organization_id=org and flags.entity_type='RECEIPT_BATCH' and flags.entity_id=b.id
  where b.store_id=p_store and (p_batch is null or b.id=p_batch)
   and not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=b.id)
 ), effective as materialized (
  select b.id batch_id,f.row_key,jsonb_object_agg(f.field_name,f.value) vals
  from batches b cross join lateral private.receipt_effective_fields(b.run_id) f
  group by b.id,f.row_key
 ), headers as materialized (
  select b.*,coalesce(d.vals,'{}') doc_values,
   jsonb_build_object('supplier_name',coalesce(nullif(private.supplier_display_name(org,nullif(d.vals->>'supplier_name','')),'未提供'),b.goods_supplier,''),
    'receipt_date',private.receipt_account_date(coalesce(d.vals->>'receipt_date',b.goods_date::text)),
    'document_number',coalesce(d.vals->>'document_number',b.goods_number,'')) raw_header
  from batches b left join effective d on d.batch_id=b.id and d.row_key='document'
 ), selected as materialized (
  select h.*,h.raw_header||coalesce(h.edit_header,'{}') header
  from headers h
  where (p_supplier is null or p_supplier='' or (h.raw_header||coalesce(h.edit_header,'{}'))->>'supplier_name'=p_supplier)
   and (private.receipt_account_date((h.raw_header||coalesce(h.edit_header,'{}'))->>'receipt_date') is null
    or ((p_from is null or private.receipt_account_date((h.raw_header||coalesce(h.edit_header,'{}'))->>'receipt_date')>=p_from)
     and (p_to is null or private.receipt_account_date((h.raw_header||coalesce(h.edit_header,'{}'))->>'receipt_date')<=p_to)))
 ), raw_lines as (
  select b.id batch_id,f.row_key,
   jsonb_build_object('row_key',f.row_key,'product_name',coalesce(p.name,f.vals->>'product','未命名品項'),
    'source_product',f.vals->>'product','product_id',p.id,'product_code',p.product_code,
    'specification',coalesce(nullif(f.vals->>'specification',''),p.specification,''),'unit',coalesce(nullif(f.vals->>'unit',''),p.count_unit,p.base_unit,''),
    'quantity',private.receipt_account_number(f.vals->>'quantity'),'unit_price',private.receipt_account_number(f.vals->>'unit_price_ex_tax'),
    'subtotal',private.receipt_account_number(f.vals->>'quantity')*private.receipt_account_number(f.vals->>'unit_price_ex_tax'),
    'category',coalesce(a.category,c.category,private.classify_product(coalesce(p.name,f.vals->>'product'),p.category)),
    'note',coalesce(a.note,'')) line
  from selected b join effective f on f.batch_id=b.id and f.row_key<>'document'
  left join private.receipt_line_decisions d on d.batch_id=b.id and d.run_id=b.run_id and d.row_key=f.row_key
  left join public.receipt_product_mappings m on m.batch_id=b.id and m.row_key=f.row_key
  left join public.products p on p.id=m.product_id
  left join private.product_categories c on c.product_id=p.id
  left join private.receipt_ledger_annotations a on a.batch_id=b.id and a.run_id=b.run_id and a.row_key=f.row_key
  where b.group_mode<>'ADMIN_DIRECT' and coalesce(d.decision='INCLUDE',coalesce(private.receipt_account_number(f.vals->>'quantity')>0,false) or coalesce(private.receipt_account_number(f.vals->>'subtotal_ex_tax')>0,false))
  union all
  select b.id,'manual-'||m.id,jsonb_build_object('row_key','manual-'||m.id,'product_name',m.product_name,'specification',m.specification,'unit',m.unit,'quantity',m.quantity,'unit_price',m.unit_price_ex_tax,'subtotal',m.line_subtotal_ex_tax,'category',coalesce(a.category,private.classify_product(m.product_name,null)),'note',coalesce(a.note,m.note,''))
  from selected b join private.receipt_manual_rows m on m.batch_id=b.id and m.run_id=b.run_id and m.deleted_at is null
  left join private.receipt_ledger_annotations a on a.batch_id=b.id and a.run_id=b.run_id and a.row_key='manual-'||m.id
  where b.group_mode<>'ADMIN_DIRECT'
  union all
  select b.id,coalesce(l.source_row_key,'admin-direct-'||l.id),jsonb_build_object('row_key',coalesce(l.source_row_key,'admin-direct-'||l.id),'product_name',coalesce(p.name,l.human_correction->>'product_name','未命名品項'),'product_id',p.id,'product_code',p.product_code,'specification',coalesce(nullif(l.specification,''),p.specification,''),'unit',coalesce(nullif(l.unit,''),p.count_unit,p.base_unit,''),'quantity',l.quantity,'unit_price',l.unit_price_ex_tax,'subtotal',l.line_subtotal_ex_tax,'category',coalesce(c.category,private.classify_product(p.name,p.category)),'note',coalesce(l.human_correction->>'note',''))
  from selected b join public.receipt_lines l on l.receipt_id=b.receipt_id
  left join public.products p on p.id=l.product_id left join private.product_categories c on c.product_id=p.id
  where b.group_mode='ADMIN_DIRECT'
 ), grouped as (
  select b.id,
   coalesce(jsonb_agg(l.line order by l.row_key) filter(where l.row_key is not null),'[]') raw_lines,
   coalesce(jsonb_agg(l.line||coalesce(b.line_values->l.row_key,'{}') order by l.row_key) filter(where l.row_key is not null),'[]') lines,
   jsonb_agg(jsonb_build_object('row',l.row_key,'run',case when b.group_mode='ADMIN_DIRECT' then null else b.run_id end,'name',l.line->>'product_name','unit',l.line->>'unit','qty',l.line->'quantity','price',l.line->'unit_price','amount',l.line->'subtotal') order by l.row_key) filter(where l.row_key is not null) legacy_lines
  from selected b left join raw_lines l on l.batch_id=b.id group by b.id,b.line_values,b.group_mode,b.run_id
 ), source as (
  select b.*,l.raw_lines,l.lines,
   md5(jsonb_build_object('run',b.run_id,'document',b.doc_values,'published',jsonb_build_object('supplier',b.supplier_id,'date',b.goods_date,'number',b.goods_number,'net',b.goods_net,'tax',b.goods_tax,'total',b.goods_total),'lines',l.legacy_lines)::text) legacy_fingerprint,
   md5(jsonb_build_object('run',b.run_id,'doc',b.doc_values,'goods',jsonb_build_object('supplier',b.supplier_id,'date',b.goods_date,'number',b.goods_number,'net',b.goods_net,'tax',b.goods_tax,'total',b.goods_total),'lines',l.raw_lines)::text) raw_fingerprint,
   (select case when count(*)=count(private.receipt_account_number(x->>'subtotal')) then sum(private.receipt_account_number(x->>'subtotal')) end from jsonb_array_elements(l.lines) x) line_net
  from selected b join grouped l on l.id=b.id
 ), amounts as (
  select b.*,
   case when edit_revision is not null then line_net+adjustment else coalesce(goods_net,private.receipt_account_number(doc_values->>'subtotal_ex_tax'),line_net) end source_net,
   coalesce(goods_tax,private.receipt_account_number(doc_values->>'tax')) source_tax,
   case when group_mode='ADMIN_DIRECT' and goods_tax is null then null else coalesce(goods_total,private.receipt_account_number(doc_values->>'total_inc_tax')) end source_total,
   md5(jsonb_build_object('source',raw_fingerprint,'header',edit_header,'lines',line_values,'adjustment',adjustment,'adjustment_note',adjustment_note,'revision',edit_revision)::text) fingerprint,
   (jsonb_array_length(lines)=0 or (receipt_id is null and coalesce(run_status,'')<>'SUCCEEDED')) pending
  from source b
 ), reconciled as (
  select a.*,c.amount_override,c.note,c.checked_at,c.checked_source,coalesce(c.revision,0) revision,
   case when c.amount_override is not null then private.receipt_account_number(c.amount_override->>'net') else source_net end net,
   case when c.amount_override is not null then private.receipt_account_number(c.amount_override->>'tax') else source_tax end tax,
   case when c.amount_override is not null then private.receipt_account_number(c.amount_override->>'total') else source_total end stated_total
  from amounts a left join private.receipt_reconciliations c on c.batch_id=a.id and c.store_id=p_store
 ), ready as (
  select a.*,coalesce(stated_total,net+tax) total,
   coalesce(net is not null and tax is not null and stated_total is not null and abs(net+tax-stated_total)>0.01,false)
    or ((amount_override is null or edit_revision is not null) and net is not null and line_net is not null and abs(net-line_net-coalesce(adjustment,0))>1) amount_conflict
  from reconciled a
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'batch_id',id,'batch_number',batch_number,'work_date',work_date,'uploaded_at',uploaded_at,'run_id',run_id,
  'supplier_name',header->>'supplier_name','receipt_date',header->>'receipt_date','document_number',header->>'document_number',
  'net',net,'tax',tax,'total',total,'line_net',line_net,'line_count',jsonb_array_length(lines),
  'products',(select string_agg(x->>'product_name',' ') from jsonb_array_elements(lines) x),
  'source_net',source_net,'source_tax',source_tax,'source_total',source_total,'amount_override',amount_override,
  'note',coalesce(note,''),'revision',revision,'source_fingerprint',fingerprint,'checked_at',checked_at,
  'pending',pending,'receipt_status',a.status::text,'amount_conflict',amount_conflict,'record_state',record_state,'can_edit',editable,
  'pages',(select count(*) from public.receipt_documents d where d.batch_id=a.id),
  'lines',lines,'edit_revision',coalesce(edit_revision,0),'adjustment',coalesce(adjustment,net-line_net,0),'adjustment_note',coalesce(adjustment_note,''),
  'source_changed',coalesce(edited_source<>raw_fingerprint,false),
  'status',case when checked_at is not null and checked_source is distinct from fingerprint and (edit_revision is not null or checked_source is distinct from legacy_fingerprint) then 'RECHECK'
   when amount_conflict then 'RECHECK' when pending then 'PENDING'
   when net is null or tax is null or total is null or nullif(header->>'supplier_name','') is null or header->>'receipt_date' is null then 'MISSING'
   when checked_at is not null then 'CHECKED' else 'UNCHECKED' end
 )||case when p_batch is not null then jsonb_build_object('raw_header',raw_header,'raw_lines',raw_lines,'raw_fingerprint',raw_fingerprint,
   'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d->>'id','name',d->>'original_filename','path',d->>'storage_path','mime_type',d->>'mime_type','page_order',d->'page_order')),'[]') from jsonb_array_elements(private.receipt_ocr_sources(a.id)) d)) else '{}' end
 order by header->>'supplier_name',header->>'receipt_date' desc,id),'[]') into result from ready a;
 return result;
end $$;
revoke all on function private.receipt_account_rows(uuid,date,date,text,uuid) from public,anon,authenticated;

create function public.get_baihuayuan_receipt_accounts(p_store_id uuid,p_from date default null,p_to date default null,p_supplier text default null,p_batch_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$select private.receipt_account_rows(p_store_id,p_from,p_to,p_supplier,p_batch_id)$$;
revoke all on function public.get_baihuayuan_receipt_accounts(uuid,date,date,text,uuid) from public,anon;
grant execute on function public.get_baihuayuan_receipt_accounts(uuid,date,date,text,uuid) to authenticated;
-- Existing clients retain their API contract, now without the expensive full ledger.
create or replace function public.get_baihuayuan_receipt_accounting(p_store_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$select private.receipt_account_rows(p_store_id,null,null,null,null)$$;

-- Apply only the approved per-receipt corrections to shared effective ledgers.
create function private.receipt_apply_account_edits(p_store uuid,p_rows jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(r||coalesce(e.line_values->(r->>'row_key'),'{}')||coalesce(e.header,'{}')||
  case when e.batch_id is null then '{}' else jsonb_build_object('admin_corrected',true) end order by ord),'[]')
 from jsonb_array_elements(p_rows) with ordinality x(r,ord)
 left join private.receipt_account_edits e on e.batch_id=(r->>'batch_id')::uuid and e.store_id=p_store
$$;
revoke all on function private.receipt_apply_account_edits(uuid,jsonb) from public,anon,authenticated;
-- Keep original function OIDs, ACLs, authorization checks and all legacy branches.
do $$declare src text;begin
 src:=pg_get_functiondef('public.get_pilot_receipt_ledger(uuid)'::regprocedure);
 if strpos(src,'return coalesce((')=0 then raise exception 'LEDGER_ANCHOR_MISSING';end if;
 src:=replace(src,E'begin\n',E'declare effective_rows jsonb;\nbegin\n');
 src:=replace(src,'return coalesce((','effective_rows:=coalesce((');
 src:=replace(src,E'end;\n',E'return private.receipt_apply_account_edits(p_store_id,effective_rows);\nend;\n');
 execute src;
 src:=pg_get_functiondef('private.baihuayuan_receipt_detail_ledger(uuid)'::regprocedure);
 if strpos(src,'return coalesce((')=0 then raise exception 'DETAIL_ANCHOR_MISSING';end if;
 src:=replace(src,'declare base jsonb;','declare base jsonb; effective_rows jsonb;');
 src:=replace(src,'return coalesce((','effective_rows:=coalesce((');
 src:=replace(src,'end $function$',E'return private.receipt_apply_account_edits(p_store,effective_rows);\nend $function$');
 execute src;
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_reconciliation(uuid,uuid,jsonb,uuid)'::regprocedure);
 src:=replace(src,'jsonb_array_elements(public.get_baihuayuan_receipt_accounting(p_store_id))','jsonb_array_elements(private.receipt_account_rows(p_store_id,null,null,null,p_batch_id))');
 src:=replace(src,
  'if checked and ((row_data->>''pending'')::boolean',
  'if checked and ((coalesce((row_data->>''edit_revision'')::integer,0)>0 and abs(net-private.receipt_account_number(row_data->>''source_net''))>1) or (row_data->>''pending'')::boolean');
 execute src;
end $$;

create function public.save_baihuayuan_receipt_review(p_store_id uuid,p_batch_id uuid,p_data jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; current_row jsonb; fresh jsonb; previous jsonb; cached private.app_requests;
 header jsonb; lines jsonb; l jsonb; raw jsonb; edits jsonb:='{}'; h_edits jsonb; delta jsonb; adjustment numeric; tax numeric; total numeric; net numeric:=0; incomplete boolean:=false;
 q numeric; price numeric; subtotal numeric; result jsonb; payload jsonb; checked boolean;
begin
 perform private.assert_store_editable(p_store_id);
 select * into b from public.receipt_upload_batches where id=p_batch_id and store_id=p_store_id;
 if b.id is null or not private.can_review_receipt(p_batch_id) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 if p_request_id is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>250000 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 payload:=p_data||jsonb_build_object('batch_id',p_batch_id);
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_request_id::text,0));
 select * into cached from private.app_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'receipt.review-correct' or cached.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return cached.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 perform 1 from public.receipt_upload_batches where id=p_batch_id for update;
 current_row:=private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0;
 if current_row is null or current_row->>'record_state'<>'LIVE' then raise exception 'RECEIPT_ACCOUNT_NOT_LIVE' using errcode='42501';end if;
 if p_data->>'source_fingerprint' is distinct from current_row->>'source_fingerprint' or (p_data->>'revision')::integer is distinct from (current_row->>'revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 header:=p_data->'header';lines:=p_data->'lines';checked:=(p_data->>'checked')::boolean;
 if jsonb_typeof(header) is distinct from 'object' or jsonb_typeof(lines) is distinct from 'array' or checked is null
  or jsonb_array_length(lines)>500 or length(coalesce(header->>'supplier_name',''))>160 or length(coalesce(header->>'document_number',''))>160
  or length(coalesce(p_data->>'note',''))>2000 or length(coalesce(p_data->>'adjustment_note',''))>2000 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 if nullif(header->>'receipt_date','') is not null and private.receipt_account_date(header->>'receipt_date') is null then raise exception 'INVALID_DATE_RANGE' using errcode='22023';end if;
 header:=jsonb_build_object('supplier_name',btrim(coalesce(header->>'supplier_name','')),'receipt_date',private.receipt_account_date(header->>'receipt_date'),'document_number',btrim(coalesce(header->>'document_number','')));
 -- Exact row identities prevent cross-receipt injection, omission or duplication.
 if jsonb_array_length(lines)<>jsonb_array_length(current_row->'raw_lines') or
  (select count(distinct x->>'row_key') from jsonb_array_elements(lines) x)<>jsonb_array_length(lines) then raise exception 'RECEIPT_LINES_CHANGED' using errcode='40001';end if;
 adjustment:=private.receipt_account_number(p_data->>'adjustment');tax:=private.receipt_account_number(p_data->>'tax');total:=private.receipt_account_number(p_data->>'total');
 if adjustment is null or abs(adjustment)>=1e9 or scale(adjustment)>4 or (adjustment<>0 and nullif(btrim(p_data->>'adjustment_note'),'') is null)
  or (p_data->>'tax' is not null and tax is null) or (p_data->>'total' is not null and total is null) or abs(tax)>=1e9 or abs(total)>=1e9 or scale(tax)>4 or scale(total)>4 then raise exception 'INVALID_RECEIPT_AMOUNT' using errcode='22023';end if;
 for l in select value from jsonb_array_elements(lines) loop
  raw:=(select x from jsonb_array_elements(current_row->'raw_lines') x where x->>'row_key'=l->>'row_key');
  if raw is null then raise exception 'RECEIPT_LINES_CHANGED' using errcode='40001';end if;
  q:=private.receipt_account_number(l->>'quantity');price:=private.receipt_account_number(l->>'unit_price');subtotal:=private.receipt_account_number(l->>'subtotal');
  if length(coalesce(l->>'product_name',''))>160 or length(coalesce(l->>'specification',''))>500 or length(coalesce(l->>'unit',''))>30 or length(coalesce(l->>'note',''))>2000
   or coalesce(l->>'category','') not in ('食材','耗材','調料','酒水','待分類') or q<=0 or price<0 or abs(q)>=1e9 or abs(price)>=1e9 or abs(subtotal)>=1e9 or scale(q)>4 or scale(price)>4 or scale(subtotal)>4
   or (l->>'quantity' is not null and q is null) or (l->>'unit_price' is not null and price is null) or (l->>'subtotal' is not null and subtotal is null)
   or (q is not null and price is not null and subtotal is not null and abs(q*price-subtotal)>1 and nullif(btrim(l->>'note'),'') is null) then raise exception 'INVALID_RECEIPT_LINE' using errcode='22023';end if;
  incomplete:=incomplete or q is null or price is null or subtotal is null or nullif(btrim(l->>'product_name'),'') is null or nullif(btrim(l->>'unit'),'') is null;
  net:=net+coalesce(subtotal,0);
  select coalesce(jsonb_object_agg(key,value),'{}') into delta from jsonb_each(l) where key in ('product_name','specification','unit','quantity','unit_price','subtotal','category','note') and value is distinct from raw->key;
  if delta<>'{}' then edits:=edits||jsonb_build_object(l->>'row_key',delta);end if;
 end loop;
 if incomplete then net:=null;else net:=net+adjustment;end if;
 if checked and (incomplete or (current_row->>'pending')::boolean or nullif(header->>'supplier_name','') is null or header->>'receipt_date' is null or net is null or tax is null or total is null or abs(net+tax-total)>0.01) then raise exception 'RECEIPT_ACCOUNT_INCOMPLETE' using errcode='22023';end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into h_edits from jsonb_each(header) where value is distinct from current_row->'raw_header'->key;
 select to_jsonb(e) into previous from private.receipt_account_edits e where batch_id=p_batch_id;
 insert into private.receipt_account_edits(batch_id,store_id,run_id,header,line_values,adjustment,adjustment_note,source_fingerprint,updated_by)
 values(p_batch_id,p_store_id,nullif(current_row->>'run_id','')::uuid,h_edits,edits,adjustment,coalesce(p_data->>'adjustment_note',''),current_row->>'raw_fingerprint',auth.uid())
 on conflict(batch_id) do update set run_id=excluded.run_id,header=excluded.header,line_values=excluded.line_values,adjustment=excluded.adjustment,adjustment_note=excluded.adjustment_note,source_fingerprint=excluded.source_fingerprint,revision=private.receipt_account_edits.revision+1,updated_by=auth.uid(),updated_at=now();
 fresh:=private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0;
 perform public.save_baihuayuan_receipt_reconciliation(p_store_id,p_batch_id,jsonb_build_object('revision',fresh->'revision','source_fingerprint',fresh->>'source_fingerprint','amount_override',jsonb_build_object('net',net,'tax',tax,'total',total),'note',coalesce(p_data->>'note',''),'checked',checked),gen_random_uuid());
 result:=jsonb_build_object('saved',true,'account',private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,auth.uid(),'receipt.review-correct',payload,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id,attempt_id,store_id)
 values(b.organization_id,'receipt_review',p_batch_id::text,'receipt.review-correct',previous,(select to_jsonb(e) from private.receipt_account_edits e where batch_id=p_batch_id),auth.uid(),p_request_id,p_store_id);
 return result;
end $$;
revoke all on function public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
