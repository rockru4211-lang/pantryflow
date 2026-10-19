-- Canonical supplier projections; original receipt/OCR/FK identities remain intact.
CREATE OR REPLACE FUNCTION private.supplier_identity(p_org uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result uuid; matches uuid[];
begin
 if coalesce(private.history_key(p_name),'') in ('','未提供') then return null;end if;
 select l.supplier_id into result from private.supplier_name_links l
 join public.suppliers s on s.id=l.supplier_id and s.organization_id=l.organization_id
 where l.organization_id=p_org and l.name_key=private.history_key(p_name) and s.is_active and not s.is_removed;
 if found then return result;end if;
 -- Do not silently fall back to a shadow supplier when its confirmed target is inactive.
 if exists(select 1 from private.supplier_name_links l where l.organization_id=p_org and l.name_key=private.history_key(p_name)) then return null;end if;
 select array_agg(distinct s.id) into matches from public.suppliers s
 left join private.supplier_details d on d.supplier_id=s.id
 where s.organization_id=p_org and s.is_active and not s.is_removed
 and not exists(select 1 from private.supplier_name_links l where l.organization_id=p_org and l.name_key=private.history_key(s.name) and l.supplier_id<>s.id)
 and (private.history_key(s.name)=private.history_key(p_name) or exists(select 1 from unnest(d.aliases) a where private.history_key(a)=private.history_key(p_name)));
 if cardinality(matches)=1 then return matches[1];end if;
 return null;
end $function$
;

create or replace function private.supplier_display_name(p_org uuid,p_name text) returns text
language sql stable set search_path='' as $$
 select coalesce((select s.name from private.supplier_name_links l join public.suppliers s on s.id=l.supplier_id and s.organization_id=l.organization_id where l.organization_id=p_org and l.name_key=private.history_key(p_name)),
 (select name from public.suppliers where id=private.supplier_identity(p_org,p_name)),p_name)
$$;
create or replace function private.supplier_canonical_rows(p_org uuid,p_rows jsonb) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(r||jsonb_build_object('raw_supplier_name',coalesce(r->>'raw_supplier_name',r->>'supplier_name'),
 'supplier_name',private.supplier_display_name(p_org,r->>'supplier_name'),
 'supplier_id',private.supplier_identity(p_org,r->>'supplier_name')) order by n),'[]'::jsonb)
 from jsonb_array_elements(p_rows) with ordinality t(r,n)
$$;

CREATE OR REPLACE FUNCTION private.receipt_apply_account_edits(p_store uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select private.supplier_canonical_rows((select organization_id from public.stores where id=p_store),coalesce(jsonb_agg(r||coalesce(e.line_values->(r->>'row_key'),'{}')||coalesce(e.header,'{}')||
  case when e.batch_id is null then '{}' else jsonb_build_object('admin_corrected',true) end order by ord),'[]'))
 from jsonb_array_elements(p_rows) with ordinality x(r,ord)
 left join private.receipt_account_edits e on e.batch_id=(r->>'batch_id')::uuid and e.store_id=p_store and e.run_id is not distinct from nullif(r->>'run_id','')::uuid
$function$
;

CREATE OR REPLACE FUNCTION private.receipt_account_rows(p_store uuid, p_from date, p_to date, p_supplier text, p_batch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   s.name goods_supplier,case when e.run_id is not distinct from r.id then e.header end edit_header,case when e.run_id is not distinct from r.id then e.line_values end line_values,case when e.run_id is not distinct from r.id then e.adjustment end adjustment,case when e.run_id is not distinct from r.id then e.adjustment_note end adjustment_note,e.revision edit_revision,
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
  select h.*,(h.raw_header||coalesce(h.edit_header,'{}'))||jsonb_build_object('supplier_name',private.supplier_display_name(org,(h.raw_header||coalesce(h.edit_header,'{}'))->>'supplier_name')) header
  from headers h
  where (p_supplier is null or p_supplier='' or private.supplier_display_name(org,(h.raw_header||coalesce(h.edit_header,'{}'))->>'supplier_name')=private.supplier_display_name(org,p_supplier))
   and (private.receipt_account_date((h.raw_header||coalesce(h.edit_header,'{}'))->>'receipt_date') is null
    or ((p_from is null or private.receipt_account_date((h.raw_header||coalesce(h.edit_header,'{}'))->>'receipt_date')>=p_from)
     and (p_to is null or private.receipt_account_date((h.raw_header||coalesce(h.edit_header,'{}'))->>'receipt_date')<=p_to)))
 ), raw_lines as materialized (
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
  where b.group_mode<>'ADMIN_DIRECT' and coalesce(d.decision='INCLUDE',nullif(btrim(f.vals->>'product'),'') is not null or coalesce(private.receipt_account_number(f.vals->>'quantity')>0,false) or coalesce(private.receipt_account_number(f.vals->>'subtotal_ex_tax')>0,false))
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
 ), grouped as materialized (
  select b.id,
   coalesce(jsonb_agg(l.line order by l.row_key) filter(where l.row_key is not null),'[]') raw_lines,
   coalesce(jsonb_agg(private.receipt_handling_line(p_store,b.id,b.run_id,l.line||coalesce(b.line_values->l.row_key,'{}')) order by l.row_key) filter(where l.row_key is not null),'[]') lines,
   jsonb_agg(jsonb_build_object('row',l.row_key,'run',case when b.group_mode='ADMIN_DIRECT' then null else b.run_id end,'name',l.line->>'product_name','unit',l.line->>'unit','qty',l.line->'quantity','price',l.line->'unit_price','amount',l.line->'subtotal') order by l.row_key) filter(where l.row_key is not null) legacy_lines
  from selected b left join raw_lines l on l.batch_id=b.id group by b.id,b.line_values,b.group_mode,b.run_id
 ), source as materialized (
  select b.*,l.raw_lines,l.lines,
   md5(jsonb_build_object('run',b.run_id,'document',b.doc_values,'published',jsonb_build_object('supplier',b.supplier_id,'date',b.goods_date,'number',b.goods_number,'net',b.goods_net,'tax',b.goods_tax,'total',b.goods_total),'lines',l.legacy_lines)::text) legacy_fingerprint,
   md5(jsonb_build_object('run',b.run_id,'doc',b.doc_values,'goods',jsonb_build_object('supplier',b.supplier_id,'date',b.goods_date,'number',b.goods_number,'net',b.goods_net,'tax',b.goods_tax,'total',b.goods_total),'lines',l.raw_lines)::text) raw_fingerprint,
   (select case when count(*)=count(private.receipt_account_number(x->>'subtotal')) then sum(private.receipt_account_number(x->>'subtotal')) end from jsonb_array_elements(l.lines) x) line_net
  from selected b join grouped l on l.id=b.id
 ), amounts as materialized (
  select b.*,
   case when edit_revision is not null and edited_run is not distinct from run_id then line_net+adjustment else coalesce(goods_net,private.receipt_account_number(doc_values->>'subtotal_ex_tax'),line_net) end source_net,
   coalesce(goods_tax,private.receipt_account_number(doc_values->>'tax')) source_tax,
   case when group_mode='ADMIN_DIRECT' and goods_tax is null then null else coalesce(goods_total,private.receipt_account_number(doc_values->>'total_inc_tax')) end source_total,
   md5(jsonb_build_object('source',raw_fingerprint,'header',edit_header,'lines',line_values,'adjustment',adjustment,'adjustment_note',adjustment_note,'revision',edit_revision)::text) fingerprint,
   (jsonb_array_length(lines)=0 or (receipt_id is null and coalesce(run_status,'')<>'SUCCEEDED')) pending
  from source b
 ), reconciled as materialized (
  select a.*,c.amount_override,c.note,c.checked_at,c.checked_source,coalesce(c.revision,0) revision,
   case when c.amount_override is not null then private.receipt_account_number(c.amount_override->>'net') else source_net end net,
   case when c.amount_override is not null then private.receipt_account_number(c.amount_override->>'tax') else source_tax end tax,
   case when c.amount_override is not null then private.receipt_account_number(c.amount_override->>'total') else source_total end stated_total
  from amounts a left join private.receipt_reconciliations c on c.batch_id=a.id and c.store_id=p_store
 ), ready as materialized (
  select a.*,coalesce(stated_total,net+tax) total,
   coalesce(net is not null and tax is not null and stated_total is not null and (abs(net+tax-stated_total)>0.01 and not (stated_total=trunc(stated_total) and round(round(net+tax,4))=stated_total)),false)
    or ((amount_override is null or edit_revision is not null) and net is not null and line_net is not null and abs(net-line_net-coalesce(adjustment,0))>1) amount_conflict
  from reconciled a
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'batch_id',id,'batch_number',batch_number,'work_date',work_date,'uploaded_at',uploaded_at,'run_id',run_id,
  'supplier_name',header->>'supplier_name','receipt_date',header->>'receipt_date','document_number',header->>'document_number',
  'net',net,'tax',tax,'total',total,'line_net',line_net,'line_count',jsonb_array_length(lines),
  'products',(select string_agg(x->>'product_name',' ') from jsonb_array_elements(lines) x),
  'source_net',source_net,'source_tax',source_tax,'source_total',source_total,'amount_override',amount_override,
  'receipt_categories',coalesce((select to_jsonb(classification.receipt_categories) from private.receipt_account_edits classification where classification.batch_id=a.id),'[]'::jsonb),
 'received_at',(select received_at from private.receipt_account_edits where batch_id=a.id),'finance_sent_at',(select sent.finance_sent_at from private.receipt_account_edits sent where sent.batch_id=a.id),
  'review_completed',exists(select 1 from private.receipt_account_edits completed where completed.batch_id=a.id and completed.review_completed_source=md5(jsonb_build_array(fingerprint,net,tax,total,coalesce(note,''))::text)),
 'entry_completed',exists(select 1 from private.receipt_account_edits entered where entered.batch_id=a.id and entered.entry_completed_source=md5(jsonb_build_array(fingerprint,net,tax,total,coalesce(note,''))::text)),
  'reviewed',exists(select 1 from private.receipt_account_edits verified where verified.batch_id=a.id and verified.reviewed_source=md5(jsonb_build_array(fingerprint,net,tax,total,coalesce(note,''))::text)),
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
end $function$
;

CREATE OR REPLACE FUNCTION private.app_workspace(p_store uuid, p_section text, p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text:=private.app_role(p_store); v_org uuid; v_type text; v_erp boolean; v_mode text; v_data jsonb;
 v_start timestamptz:=coalesce(nullif(p_filter->>'from','')::timestamptz,date_trunc('month',now()));
 v_end timestamptz:=coalesce(nullif(p_filter->>'to','')::timestamptz,now()+interval '1 day');
begin
 if private.feature_scope(p_store) and p_section='suppliers' and not private.has_data_access(p_store,'SUPPLIERS') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_section='store-archive' then return private.store_archive(p_store);end if;
 if p_section='archived-transfers' then v_data:=private.store_archive(p_store);return jsonb_build_object('records',v_data->'movements','stores','[]'::jsonb,'products','[]'::jsonb,'units','[]'::jsonb,'has_erp',true);end if;
 if p_section='archived-stores' then return jsonb_build_object('stores',(select coalesce(jsonb_agg(to_jsonb(s) order by s.name,s.store_code),'[]') from public.stores s where not s.is_active and (private.store_scope_role(s.id) is not null or private.can_manage_store_scope(s.id))));end if;
 if p_section='store-lifecycle' then
  if not private.can_manage_store_scope((p_filter->>'id')::uuid) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  return jsonb_build_object('store',(select to_jsonb(s) from public.stores s where id=(p_filter->>'id')::uuid),'references',private.store_references((p_filter->>'id')::uuid));
 end if;
 if p_section='business' then
  if not private.can_manage_store_scope(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  return jsonb_build_object('stores',private.managed_store_cards(),'organization',(select to_jsonb(o) from public.organizations o join public.stores s on s.organization_id=o.id where s.id=p_store),'settings',coalesce((select settings from private.app_settings where store_id=p_store),'{}'::jsonb),'revision',coalesce((select revision from private.app_settings where store_id=p_store),0));
 end if;
 if p_section='historical-records' then return private.historical_workspace(p_store,p_filter);end if;
 if p_section='historical-prices' then return private.supplier_canonical_rows((select organization_id from public.stores where id=p_store),private.historical_price_sources(p_store,p_filter));end if;
 if v_role is null then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
 select s.organization_id,o.business_type::text,o.has_erp,o.store_mode into v_org,v_type,v_erp,v_mode from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store;
 if p_section='transfers' then return private.transfers_workspace_v2(p_store,p_filter);end if;

 if p_section='product-options' then
   return jsonb_build_object('products',(select coalesce(jsonb_agg(jsonb_build_object(
     'id',p.id,'name',p.name,'base_unit',p.base_unit,'specification',p.specification) order by p.name),'[]'::jsonb)
     from public.products p where p.organization_id=v_org and p.is_active and private.count_product_not_removed(p_store,p.id)));
 end if;
 if p_section='mappings' then return private.app_mapping_workspace(p_store);end if;
 if p_section in ('reports','costs') then return private.app_reports(p_store,p_filter);end if;

 if p_section='stock' then
  return jsonb_build_object('products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit,'thaw_enabled',coalesce(ss.thaw_enabled,false),'thaw_minutes',ss.thaw_minutes,'stock',private.stock_snapshot(p_store,p.id,p.base_unit)) order by p.name),'[]') from public.products p left join private.stock_settings ss on ss.store_id=p_store and ss.product_id=p.id where p.organization_id=v_org and p.is_active and private.count_product_not_removed(p_store,p.id)),
  'zones',(select coalesce(jsonb_agg(jsonb_build_object('id',z.id,'name',z.name) order by z.sort_order),'[]') from public.count_zones z where z.store_id=p_store and z.is_active),
  'positions',(select coalesce(jsonb_agg(to_jsonb(sp)||jsonb_build_object('zone_name',z.name) order by z.sort_order,sp.updated_at),'[]') from private.stock_positions sp join public.count_zones z on z.id=sp.zone_id where sp.store_id=p_store and sp.quantity>0));
 elsif p_section in ('incidents','handover','bulletins','company-tasks','activity','tasks','notifications') then
  select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('actor_name',p.display_name,'responsible_name',rp.display_name,'read_at',rd.read_at,'readers',case when v_role in ('OWNER','SUPERVISOR','LOGISTICS') then (select coalesce(jsonb_agg(jsonb_build_object('display_name',rp.display_name,'read_at',rr.read_at)),'[]'::jsonb) from private.app_record_reads rr left join public.profiles rp on rp.id=rr.user_id where rr.record_id=r.id) else '[]'::jsonb end,
    'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'note',e.note,'actor_name',ep.display_name,'created_at',e.created_at) order by e.created_at),'[]'::jsonb) from private.app_record_events e left join public.profiles ep on ep.id=e.actor_id where e.record_id=r.id)) order by r.created_at desc),'[]'::jsonb) into v_data
  from private.app_records r left join public.profiles p on p.id=r.created_by left join public.profiles rp on rp.id=r.responsible_id
  left join private.app_record_reads rd on rd.record_id=r.id and rd.user_id=auth.uid()
  where r.store_id=p_store and (p_section in ('activity','tasks','notifications') or r.kind=case p_section when 'incidents' then 'incident' when 'handover' then 'handover' when 'bulletins' then 'bulletin' when 'company-tasks' then 'company_task' end)
  and (r.kind<>'bulletin' or v_role=any(r.audience) or v_role in ('OWNER','SUPERVISOR'));
  return jsonb_build_object('records',v_data,'role',v_role);
 elsif p_section='transfers' then
  if v_mode<>'MULTI' then raise exception 'MULTI_STORE_REQUIRED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('from_name',fs.name,'to_name',ts.name,'actor_name',p.display_name,
   'reference_price',case when not v_erp and v_role<>'STAFF' then (select rl.unit_price_ex_tax from public.receipt_lines rl join public.goods_receipts g on g.id=rl.receipt_id join public.receipt_upload_batches b on b.id=g.source_batch_id where g.store_id=p_store and b.status::text='COMPLETED' and rl.product_id=m.product_id and rl.unit=m.unit order by g.receipt_date desc,g.reviewed_at desc limit 1) else null end,
   'events',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',ep.display_name) order by e.created_at),'[]'::jsonb) from private.store_movement_events e left join public.profiles ep on ep.id=e.actor_id where e.movement_id=m.id)) order by m.created_at desc),'[]'::jsonb) into v_data
  from private.store_movements m join public.stores fs on fs.id=m.from_store_id join public.stores ts on ts.id=m.to_store_id left join public.profiles p on p.id=m.created_by
  where m.organization_id=v_org and (m.from_store_id=p_store or m.to_store_id=p_store) and (m.status='OPEN' or (m.created_at>=v_start and m.created_at<v_end));
  return jsonb_build_object('records',v_data,'role',v_role,'has_erp',v_erp,'stores',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name),'[]'::jsonb) from public.stores s where s.organization_id=v_org and s.is_active and s.id<>p_store),
   'units',(select coalesce(jsonb_agg(unit order by unit),'[]') from private.store_units where store_id=p_store),'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit) order by p.name),'[]'::jsonb) from public.products p where p.organization_id=v_org and p.is_active and private.count_product_not_removed(p_store,p.id)));
 elsif p_section='transfer-search' then
  if v_mode<>'MULTI' then raise exception 'MULTI_STORE_REQUIRED' using errcode='42501'; end if;
  if length(btrim(coalesce(p_filter->>'search','')))<1 then return jsonb_build_object('stores','[]'::jsonb); end if;
  -- Only store name and evidence freshness; no physical count, safety or availability quantities.
  select coalesce(jsonb_agg(x order by x.updated_at desc nulls last),'[]'::jsonb) into v_data from (
   select s.id,s.name,max(cs.completed_at) updated_at,
 (select coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'name',pr.name,'unit',pr.base_unit,'stock',private.stock_snapshot(s.id,pr.id,pr.base_unit),'states',(select coalesce(jsonb_agg(jsonb_build_object('state',sp.state,'quantity',sp.quantity,'unit',sp.unit,'ready_at',sp.ready_at)),'[]') from private.stock_positions sp where sp.store_id=s.id and sp.product_id=pr.id and sp.quantity>0))),'[]') from public.products pr where pr.organization_id=v_org and pr.is_active and private.count_product_not_removed(s.id,pr.id) and pr.name ilike '%'||(p_filter->>'search')||'%') products from public.stores s
   join public.count_zones z on z.store_id=s.id and z.is_active join public.zone_products zp on zp.zone_id=z.id
   join public.products p on p.id=zp.product_id and p.is_active and private.count_product_not_removed(s.id,p.id)
   left join public.inventory_count_sessions cs on cs.store_id=s.id and cs.status::text in ('CLOSED','REVIEWING')
   where s.organization_id=v_org and s.is_active and s.id<>p_store and p.name ilike '%'||(p_filter->>'search')||'%' group by s.id,s.name) x;
  return jsonb_build_object('stores',v_data);
 elsif p_section in ('catalog','suppliers','members','business','permissions','settings','audit','reports','costs') then
  if v_role='STAFF' and p_section<>'settings' and not (p_section='suppliers' and v_type<>'CHAIN_RESTAURANT') and not (p_section in ('members','business','permissions','audit') and private.can_manage_business(p_store)) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  if p_section='catalog' then
   return jsonb_build_object('lifecycle_allowed',private.can_import_inventory(p_store),'editable',v_role in ('OWNER','LOGISTICS') and v_type<>'CHAIN_RESTAURANT' and (p_section<>'suppliers' or not private.feature_scope(p_store) or private.has_data_access(p_store,'SUPPLIERS',true)),'products',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('primary_category',coalesce(pc.category,private.classify_product(p.name,p.category)),'category_revision',coalesce(pc.revision,0),'aliases',coalesce(d.aliases,'{}'),'safety_quantity',d.safety_quantity,'note',d.note,'supplier_name',private.supplier_display_name(v_org,s.name),'current_supplier_id',coalesce(private.supplier_identity(v_org,s.name),p.current_supplier_id),'product_is_active',p.is_active,'is_removed',not private.count_product_not_removed(p_store,p.id)) order by p.name),'[]'::jsonb) from public.products p left join private.product_details d on d.product_id=p.id left join private.product_categories pc on pc.product_id=p.id left join public.suppliers s on s.id=p.current_supplier_id where p.organization_id=v_org));
  elsif p_section='suppliers' then
   return jsonb_build_object('lifecycle_allowed',private.can_import_inventory(p_store),'editable',v_role in ('OWNER','LOGISTICS') and v_type<>'CHAIN_RESTAURANT' and (p_section<>'suppliers' or not private.feature_scope(p_store) or private.has_data_access(p_store,'SUPPLIERS',true)),'suppliers',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('supplier_category',coalesce(d.supplier_category,''),'contact_name',d.contact_name,'phone',d.phone,'delivery_note',d.delivery_note,'order_method',d.order_method,'order_url',d.order_url,'cutoff_time',d.cutoff_time,'order_note',d.order_note,'aliases',private.supplier_display_aliases(s.id),
    'cooperation_status',coalesce(d.cooperation_status,'COMMON'),
'primary_supplies',d.primary_supplies,'line_id',d.line_id,'line_group',d.line_group,'minimum_order',d.minimum_order,'supply_note',d.supply_note)
    ||case when v_role in ('OWNER','LOGISTICS') then jsonb_build_object('company_name',d.company_name,'tax_id',d.tax_id,'address',d.address,'bank_name',d.bank_name,'bank_account',d.bank_account,'account_name',d.account_name,'billing_cycle',d.billing_cycle,'payment_terms',d.payment_terms,'cooperation_note',d.cooperation_note) else '{}'::jsonb end order by s.name),'[]'::jsonb) from public.suppliers s left join private.supplier_details d on d.supplier_id=s.id where s.organization_id=v_org and not exists(select 1 from private.supplier_name_links l where l.organization_id=v_org and l.name_key=private.history_key(s.name) and l.supplier_id<>s.id)));
  elsif p_section in ('members','permissions') then
   if not private.can_manage_members(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   return private.app_member_workspace(p_store);
  elsif p_section='business' then
   if not private.can_manage_business(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   return jsonb_build_object('organization',(select to_jsonb(o) from public.organizations o where o.id=v_org),'stores',(select jsonb_agg(to_jsonb(s) order by s.created_at,s.id) from public.stores s where s.organization_id=v_org and private.can_manage_business(s.id)),'settings',coalesce((select settings from private.app_settings where store_id=p_store),'{}'::jsonb),'revision',coalesce((select revision from private.app_settings where store_id=p_store),0));
  elsif p_section='settings' then
   return jsonb_build_object('settings',coalesce((select settings from private.app_settings where store_id=p_store),'{}'::jsonb),'devices',case when v_role='SUPERVISOR' or private.can_manage_business(p_store) then (select coalesce(jsonb_agg(to_jsonb(d) order by d.last_seen_at desc),'[]'::jsonb) from private.app_devices d where d.store_id=p_store) else '[]'::jsonb end,'editable',private.can_manage_business(p_store),'revision',coalesce((select revision from private.app_settings where store_id=p_store),0));
  elsif p_section='audit' then
   if not private.can_manage_business(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   return jsonb_build_object('events',(select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from (select a.* ,p.display_name actor_name from public.audit_logs a left join public.profiles p on p.id=a.user_id where a.organization_id=v_org and (a.new_value->>'store_id'=p_store::text or a.entity_id=p_store::text) and a.created_at>=v_start and a.created_at<v_end order by a.created_at desc limit 500) x));
  elsif p_section in ('reports','costs') then
   return jsonb_build_object('counts',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'started_at',s.started_at,'completed_at',s.completed_at,'status',s.status,'paper_completed_at',s.paper_completed_at) order by s.started_at desc),'[]'::jsonb) from public.inventory_count_sessions s where s.store_id=p_store and s.status::text='CLOSED' and s.completed_at>=v_start and s.completed_at<v_end),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('supplier_name',private.supplier_display_name(v_org,sp.name),'supplier_id',coalesce(private.supplier_identity(v_org,sp.name),sp.id)) order by g.receipt_date desc),'[]'::jsonb) from public.goods_receipts g join public.receipt_upload_batches b on b.id=g.source_batch_id left join public.suppliers sp on sp.id=g.supplier_id where g.store_id=p_store and b.status::text='COMPLETED' and g.reviewed_at>=v_start and g.reviewed_at<v_end),
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'receipt_id',g.id,'product_id',l.product_id,'name',coalesce(p.name,l.human_correction#>>'{effective_fields,product}',l.ai_original->>'raw_product_name','未對應'),'quantity',l.quantity,'unit',l.unit,'unit_price',l.unit_price_ex_tax,'amount',l.line_total_inc_tax,'inventory_status',coalesce((select inventory_status from private.receipt_line_resolutions where receipt_line_id=l.id order by created_at desc limit 1),l.inventory_status),'source_batch_id',g.source_batch_id,'receipt_date',g.receipt_date,'supplier_name',private.supplier_display_name(v_org,sp.name),'supplier_id',coalesce(private.supplier_identity(v_org,sp.name),sp.id))),'[]'::jsonb) from public.receipt_lines l join public.goods_receipts g on g.id=l.receipt_id join public.receipt_upload_batches b on b.id=g.source_batch_id left join public.products p on p.id=l.product_id left join public.suppliers sp on sp.id=g.supplier_id where g.store_id=p_store and b.status::text='COMPLETED' and g.reviewed_at>=v_start and g.reviewed_at<v_end));
  end if;
 end if;
 raise exception 'INVALID_APP_SECTION' using errcode='22023';
end $function$
;

create or replace function private.field_product_options(s uuid,target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
 org:=private.field_product_scope(s,target);
 return jsonb_build_object('store_name',(select name from public.stores where id=target),
 'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',coalesce(nullif(p.count_unit,''),p.base_unit)) order by p.name),'[]') from public.products p where p.organization_id=org and p.is_active and private.count_product_not_removed(target,p.id) and not exists(select 1 from private.count_field_removed where store_id=target and product_id=p.id)),
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'aliases',private.supplier_display_aliases(s.id)) order by s.name),'[]') from public.suppliers s where s.organization_id=org and s.is_active and not s.is_removed and not exists(select 1 from private.supplier_name_links l where l.organization_id=org and l.name_key=private.history_key(s.name) and l.supplier_id<>s.id)),
 'units',(select coalesce(jsonb_agg(unit order by unit),'[]') from private.store_units where store_id=target));
end $$;


-- Administrative, explicit approved groups only. Keep recovery evidence; never rewrite source FKs.
create table private.supplier_name_cleanup_audits (
 organization_id uuid not null references public.organizations(id), cleanup_key text not null,
 groups jsonb not null, before_state jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(organization_id,cleanup_key)
);
alter table private.supplier_name_cleanup_audits enable row level security;
revoke all on private.supplier_name_cleanup_audits from public,anon,authenticated;

create function private.apply_supplier_name_cleanup(p_org uuid,p_key text,p_groups jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare g jsonb; nm text; names text[]; ids uuid[]; target uuid; existing uuid[]; snapshot jsonb; result jsonb:='[]'; prior private.supplier_name_cleanup_audits; company text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':supplier-names',0));
 select * into prior from private.supplier_name_cleanup_audits where organization_id=p_org and cleanup_key=p_key;
 if found then
  if prior.groups<>p_groups then raise exception 'CLEANUP_REPLAY_CHANGED';end if;
  return prior.result;
 end if;
 if jsonb_typeof(p_groups)<>'array' or jsonb_array_length(p_groups)=0 then raise exception 'INVALID_GROUPS';end if;
 snapshot:=jsonb_build_object(
 'suppliers',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.suppliers s where organization_id=p_org),
 'details',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from private.supplier_details d join public.suppliers s on s.id=d.supplier_id where s.organization_id=p_org),
 'links',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from private.supplier_name_links l where organization_id=p_org));
 for g in select * from jsonb_array_elements(p_groups) loop
  nm:=btrim(g->>'name');
  select array_agg(distinct n) into names from (select nm n union all select jsonb_array_elements_text(g->'aliases')) x;
  if nm is null or length(nm) not between 1 and 160 then raise exception 'INVALID_NAME';end if;
  select array_agg(s.id) into ids from public.suppliers s where s.organization_id=p_org and s.is_active and not s.is_removed and exists(select 1 from unnest(names) n where private.history_key(n)=private.history_key(s.name));
  if coalesce(cardinality(ids),0)=0 then raise exception 'NO_GROUP_MEMBERS: %',nm;end if;
  select array_agg(distinct l.supplier_id) into existing from private.supplier_name_links l where organization_id=p_org and (l.supplier_id=any(ids) or exists(select 1 from unnest(names) n where private.history_key(n)=l.name_key));
  if cardinality(existing)>1 or (cardinality(existing)=1 and not existing[1]=any(ids)) then raise exception 'EXISTING_LINK_CONFLICT: %',nm;end if;
  target:=existing[1];
  if target is null then
   select s.id into target from public.suppliers s left join private.supplier_details d on d.supplier_id=s.id
   where s.id=any(ids)
   order by (select count(*) from jsonb_each_text(coalesce(to_jsonb(d),'{}')) x where x.key not in ('supplier_id','updated_by','updated_at','aliases') and coalesce(x.value,'') not in ('','[]','{}')) desc,
    (select count(*) from public.goods_receipts r where r.supplier_id=s.id) desc,s.created_at,s.id limit 1;
  end if;
  select n into company from unnest(names) n where n like '%有限公司' order by length(n) desc limit 1;
  update private.supplier_details set aliases=(select array_agg(distinct x) from unnest(coalesce(aliases,'{}')||names) x),
   company_name=coalesce(nullif(company_name,''),company,''),updated_at=now() where supplier_id=target;
  insert into private.supplier_name_links(organization_id,name_key,source_name,supplier_id,evidence)
  select p_org,private.history_key(n),min(n),target,'Approved supplier cleanup: '||p_key from unnest(names) n group by private.history_key(n)
  on conflict(organization_id,name_key) do nothing;
  update public.suppliers set name=nm,updated_at=now() where id=target;
  result:=result||jsonb_build_array(jsonb_build_object('name',nm,'supplier_id',target,'original_ids',ids,'aliases',names));
 end loop;
 insert into private.supplier_name_cleanup_audits(organization_id,cleanup_key,groups,before_state,result) values(p_org,p_key,p_groups,snapshot,result);
 return result;
end $$;
revoke all on function private.apply_supplier_name_cleanup(uuid,text,jsonb) from public,anon,authenticated;
