-- Reuse canonical supplier lookups and package matching within each store read.
-- Recovered receipt IDs, evidence requirements and posted-receipt exclusions are unchanged.
create or replace function private.legacy_receipt_ingredient_prices(s uuid)
returns table (id uuid,store_id uuid,product_id uuid,effective_date date,created_at timestamptz,
 unit text,price numeric,batch_id uuid,row_key text,supplier text,specification text,purchase jsonb,
 ingredient_id uuid,product_name text)
language sql stable set search_path='' as $$
 with approvals as materialized (
  select r.created_at,r.result->'account' account,r.result#>>'{account,batch_id}' batch_key,
   r.result#>>'{account,edit_revision}' edit_revision,r.result#>>'{account,raw_fingerprint}' raw_fingerprint,
   md5(jsonb_build_array(r.result#>>'{account,source_fingerprint}',r.result#>'{account,net}',
    r.result#>'{account,tax}',r.result#>'{account,total}',coalesce(r.result#>>'{account,note}',''))::text) approval
  from private.app_requests r
  where r.store_id=s and r.action='receipt.review-correct' and r.result->'saved'='true'::jsonb
   and r.result#>'{account,entry_completed}'='true'::jsonb
   and r.result#>'{account,review_completed}'='true'::jsonb
   and r.created_at in (select e.updated_at from private.receipt_account_edits e where e.store_id=s)
 ), approved_receipts as materialized (
  select b.id batch_id,b.organization_id,e.run_id,e.updated_at,
   private.receipt_account_date(e.header->>'receipt_date') receipt_date,
   e.header->>'supplier_name' supplier_name,e.line_values,a.account
  from private.receipt_account_edits e
  join public.receipt_upload_batches b on b.id=e.batch_id and b.store_id=e.store_id
  join public.stores st on st.id=b.store_id and st.is_active and st.name in ('BeApe','Gras')
  join approvals a on a.batch_key=b.id::text and a.edit_revision=e.revision::text
   and a.created_at=e.updated_at and a.raw_fingerprint=e.source_fingerprint
   and e.review_completed_source=e.entry_completed_source and e.review_completed_source=a.approval
  where e.store_id=s and b.status::text='READY_FOR_REVIEW'
   and not (e.entry_metadata ? 'equipment')
   and e.run_id is not distinct from (select r.id from public.receipt_ocr_runs r where r.batch_id=b.id order by r.version desc limit 1)
   and not exists(select 1 from public.goods_receipts g where g.source_batch_id=b.id)
   and not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=b.id)
   and not exists(select 1 from private.baihuayuan_record_flags f where f.organization_id=b.organization_id
    and f.entity_type='RECEIPT_BATCH' and f.entity_id=b.id and f.state<>'LIVE')
 ), lines as materialized (
  select r.batch_id,r.organization_id,r.updated_at,r.receipt_date,r.supplier_name,
   item.line->>'row_key' row_key, item.line->>'product_name' display_name,
   coalesce(nullif(btrim(edit.value->>'supplier_item_name'),''),item.line->>'product_name') source_name,
   btrim(item.line->>'unit') purchase_unit, (item.line->>'unit_price')::numeric unit_price,
   coalesce(nullif(btrim(item.line->>'specification'),''),nullif(btrim(edit.value->>'supplier_item_specification'),''),'') explicit_spec,
   case when pg_input_is_valid(edit.value->>'ingredient_id','uuid') then (edit.value->>'ingredient_id')::uuid end selected_ingredient
  from approved_receipts r
  cross join lateral jsonb_array_elements(r.account->'lines') item(line)
  cross join lateral (select r.line_values->(item.line->>'row_key') value) edit
  where r.receipt_date is not null and r.supplier_name is not null and nullif(btrim(item.line->>'product_name'),'') is not null
   and nullif(btrim(item.line->>'unit'),'') is not null
   and coalesce(item.line->>'handling','NORMAL')='NORMAL' and coalesce(edit.value->>'handling','NORMAL')='NORMAL'
   and edit.value->'ingredient_match_pending' is distinct from 'true'::jsonb
   and item.line->>'product_name'=edit.value->>'product_name'
   and item.line->>'unit'=edit.value->>'unit'
   and item.line->'unit_price'=edit.value->'unit_price' and jsonb_typeof(item.line->'unit_price')='number'
   and private.receipt_account_number(item.line->>'quantity')>0
   and not exists(select 1 from private.receipt_entry_items i where i.batch_id=r.batch_id and i.row_key=item.line->>'row_key')
 ), measured_lines as materialized (
  select l.*,private.history_key(l.source_name) name_key,private.recipe_unit(l.purchase_unit) normalized_unit,
   private.recipe_factor(l.purchase_unit) purchase_factor,private.history_key(l.explicit_spec) spec_key,
   coalesce(private.cost_package_measure(l.purchase_unit,l.explicit_spec),
    case when l.explicit_spec='' then private.cost_package_measure(l.purchase_unit,l.source_name) end) measure
  from lines l where l.unit_price>=0 and l.unit_price<1000000000
 ), catalog_aliases as materialized (
  select a.source_key,a.reference_ids,a.specification,private.history_key(a.name) name_key,m.id ingredient,
   coalesce(m.canonical_ingredient_id,m.id) root
  from private.ingredient_aliases a
  join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=a.store_id
  where a.store_id=s
 ), matching_aliases as materialized (
  select l.*,a.root,a.reference_ids,a.specification
  from measured_lines l join catalog_aliases a on a.name_key=l.name_key
  where l.selected_ingredient is null
  union all
  select l.*,a.root,a.reference_ids,a.specification
  from measured_lines l join catalog_aliases a on l.selected_ingredient=a.ingredient
  where l.selected_ingredient is not null
  union all
  select l.*,a.root,a.reference_ids,a.specification
  from measured_lines l join catalog_aliases a on l.selected_ingredient=a.root and a.root<>a.ingredient
  where l.selected_ingredient is not null
 ), reference_prices as materialized (
  select ref.id,ref.purchase,ref.source_ref->>'supplier_name' supplier_name,
   private.recipe_unit(ref.purchase->>'unit') purchase_unit,
   private.recipe_factor(ref.purchase->>'unit') purchase_factor
  from (select distinct unnest(reference_ids) id from matching_aliases) candidate
  join private.recipe_price_entries ref on ref.id=candidate.id
  where ref.store_id=s and ref.review_status='confirmed' and ref.source_kind='purchase'
   and coalesce(ref.source_ref->>'missing_price','false')<>'true'
 ), supplier_names as (
  select r.organization_id,r.supplier_name from matching_aliases r
  union
  select o.organization_id,ref.supplier_name
  from (select distinct organization_id from matching_aliases) o
  cross join reference_prices ref where ref.supplier_name is not null
 ), supplier_ids as materialized (
  select n.organization_id,n.supplier_name,
   private.supplier_identity(n.organization_id,n.supplier_name) supplier_id
  from supplier_names n
 ), matched as (
  select a.batch_id,a.row_key,(array_agg(distinct a.root))[1] root,
   min(coalesce(nullif(a.explicit_spec,''),a.specification,'')) spec
  from matching_aliases a
  join supplier_ids vendor on vendor.organization_id=a.organization_id and vendor.supplier_name=a.supplier_name
  where exists(
   select 1 from unnest(a.reference_ids) evidence(ref_id)
   join reference_prices ref on ref.id=evidence.ref_id
   join supplier_ids names on names.organization_id=a.organization_id and names.supplier_name=ref.supplier_name
   where ref.purchase_unit=a.normalized_unit and ref.purchase_factor=a.purchase_factor
    and names.supplier_id=vendor.supplier_id
    and case when a.measure is not null then
     a.measure=coalesce(private.inventory_package_measure(ref.purchase,a.purchase_unit,null),
      private.cost_package_measure(a.purchase_unit,a.specification))
    else private.history_key(a.specification)=a.spec_key
     and private.inventory_package_measure(ref.purchase,a.purchase_unit,null) is null end
  )
  group by a.batch_id,a.row_key
  having count(distinct a.root)=1 and count(distinct coalesce(nullif(a.explicit_spec,''),a.specification,''))=1
 ), catalog_products as (
  select a.root,p.organization_id,private.recipe_unit(p.base_unit) purchase_unit,
   private.recipe_factor(p.base_unit) purchase_factor,private.history_key(p.specification) spec_key,
   (array_agg(distinct p.id))[1] id
  from catalog_aliases a join public.products p on 'p:'||p.id=a.source_key and p.is_active
  group by a.root,p.organization_id,private.recipe_unit(p.base_unit),private.recipe_factor(p.base_unit),private.history_key(p.specification)
  having count(distinct p.id)=1
 )
 select md5('legacy-receipt:'||l.batch_id||':'||l.row_key)::uuid,s,p.id,l.receipt_date,l.updated_at,
  l.purchase_unit,l.unit_price,l.batch_id,l.row_key,sp.name,m.spec,
  jsonb_strip_nulls(jsonb_build_object('amount',l.unit_price,'quantity',1,'unit',l.purchase_unit,
   'content_quantity',l.measure->'quantity','content_unit',l.measure->'unit')),
  m.root,l.display_name
 from matched m join measured_lines l using(batch_id,row_key)
 join supplier_ids vendor on vendor.organization_id=l.organization_id and vendor.supplier_name=l.supplier_name
 join public.suppliers sp on sp.id=vendor.supplier_id
 left join catalog_products p on p.root=m.root and p.organization_id=l.organization_id
  and p.purchase_unit=l.normalized_unit and p.purchase_factor=l.purchase_factor
  and p.spec_key=private.history_key(m.spec);
$$;
