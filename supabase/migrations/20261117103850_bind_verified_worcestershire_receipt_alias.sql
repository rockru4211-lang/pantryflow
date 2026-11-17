-- Link the verified BeApe 大永 receipt spelling to its existing recipe ingredient.
-- Exact approval, vendor, and package guards leave unrelated stores and variants alone.
with approved as materialized (
  select s.id store_id,s.organization_id,m.id ingredient_id,sp.id supplier_id,
    e.run_id,line.value as receipt_line
  from public.stores s
  join private.ingredient_masters m on m.store_id=s.id
    and m.id='3b6b2e1a-9c63-4033-a9de-504a95b4e528'
    and m.ingredient_code='F000002' and m.name='(大永)烏斯特辣醬1罐'
    and m.canonical_ingredient_id is null
  join public.receipt_upload_batches b on b.store_id=s.id and b.organization_id=s.organization_id
    and b.id='1701d97f-70e4-4c53-a4e6-1694b3f2a42b' and b.status::text='READY_FOR_REVIEW'
  join private.receipt_account_edits e on e.batch_id=b.id and e.store_id=s.id
    and e.revision=2 and e.run_id='51eaf83a-f090-41b0-b56f-16296ef92d5b'
  join private.app_requests r on r.store_id=s.id and r.created_at=e.updated_at
    and r.action='receipt.review-correct'
    and r.result->'saved'='true'::jsonb
    and r.result#>'{account,entry_completed}'='true'::jsonb
    and r.result#>'{account,review_completed}'='true'::jsonb
    and r.result#>>'{account,batch_id}'=b.id::text
    and r.result#>>'{account,edit_revision}'=e.revision::text
    and r.result#>>'{account,raw_fingerprint}'=e.source_fingerprint
    and e.review_completed_source=e.entry_completed_source
    and e.review_completed_source=md5(jsonb_build_array(
      r.result#>>'{account,source_fingerprint}',r.result#>'{account,net}',r.result#>'{account,tax}',
      r.result#>'{account,total}',coalesce(r.result#>>'{account,note}',''))::text)
  join public.suppliers sp on sp.organization_id=s.organization_id and sp.is_active and not sp.is_removed
    and sp.id='5fee8032-4458-460c-9ee9-671f479f8c30'
    and sp.id=private.supplier_identity(s.organization_id,r.result#>>'{account,supplier_name}')
  cross join lateral jsonb_array_elements(r.result#>'{account,lines}') line(value)
  where s.id='7c2e22fa-a5de-4f80-89e9-e75ff2cd9774' and s.is_active and s.name='BeApe'
    and r.result#>>'{account,receipt_date}'='2026-10-14'
    and line.value->>'row_key'='line-0007'
    and line.value->>'product_name'='烏斯特醬油French''s 295ml'
    and line.value->>'unit'='罐' and line.value->>'specification'='295ml*12罐'
    and line.value->'quantity'='1'::jsonb and line.value->'unit_price'='150'::jsonb
    and coalesce(line.value->>'handling','NORMAL')='NORMAL'
    and nullif(line.value->>'ingredient_id','') is null
    and coalesce(e.line_values#>>'{line-0007,handling}','NORMAL')='NORMAL'
    and nullif(e.line_values#>>'{line-0007,ingredient_id}','') is null
    and e.line_values#>'{line-0007,ingredient_match_pending}' is distinct from 'true'::jsonb
    and not (e.entry_metadata ? 'equipment')
    and e.run_id=(select o.id from public.receipt_ocr_runs o where o.batch_id=b.id order by o.version desc limit 1)
    and not exists(select 1 from public.goods_receipts g where g.source_batch_id=b.id)
    and not exists(select 1 from private.receipt_entry_items i where i.batch_id=b.id and i.row_key='line-0007')
    and not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=b.id)
    and not exists(select 1 from private.baihuayuan_record_flags f where f.organization_id=b.organization_id
      and f.entity_type='RECEIPT_BATCH' and f.entity_id=b.id and f.state<>'LIVE')
    and not exists(select 1 from private.ingredient_supply_state st where st.store_id=s.id
      and st.ingredient_id=m.id and st.supplier_key in ('*','id:'||sp.id,'name:'||private.ingredient_match_text(sp.name))
      and st.stopped)
), binding as (
  select a.*,
    private.ingredient_match_text(a.receipt_line->>'product_name') name_key,
    private.ingredient_match_text(a.receipt_line->>'unit') unit_key,
    private.ingredient_match_text(a.receipt_line->>'specification') specification_key
  from approved a
  cross join lateral (
    select jsonb_object_agg(f.field_name,f.value) filter(where f.row_key='document') header,
      jsonb_object_agg(f.field_name,f.value) filter(where f.row_key='line-0007') item
    from private.receipt_effective_fields(a.run_id) f where f.row_key in ('document','line-0007')
  ) pinned
  where private.supplier_identity(a.organization_id,pinned.header->>'supplier_name')=a.supplier_id
    and pinned.header->>'receipt_date'='2026-10-14'
    and pinned.item->>'product'=a.receipt_line->>'product_name'
    and pinned.item->>'unit'=a.receipt_line->>'unit'
    and pinned.item->>'specification'=a.receipt_line->>'specification'
    and private.receipt_account_number(pinned.item->>'quantity')=1
    and private.receipt_account_number(pinned.item->>'unit_price_ex_tax')=150
)
insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,specification,corrected,reference_ids)
select b.store_id,b.ingredient_id,b.receipt_line->>'product_name',
  'supplier-item:'||b.supplier_id||':'||b.name_key,b.unit_key,b.specification_key,true,'{}'::uuid[]
from binding b
where not exists (
  select 1 from private.receipt_ingredient_bindings current_binding
  where current_binding.store_id=b.store_id and current_binding.name=b.name_key
    and current_binding.unit=b.unit_key and current_binding.specification=b.specification_key
    and private.supplier_identity(b.organization_id,current_binding.supplier)=b.supplier_id
    and current_binding.ingredient_id<>b.ingredient_id
)
on conflict (store_id,source_key,source_unit,specification) do nothing;
