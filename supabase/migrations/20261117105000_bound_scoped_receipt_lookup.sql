-- Filter unrelated sparse receipt lines before package parsing and supplier matching.
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
   private.receipt_account_date(e.header->>'receipt_date') edited_date,
   e.header->>'supplier_name' edited_vendor,e.header,e.line_values,a.account
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
 ), scoped_item_names as materialized (
  select b.name from private.receipt_ingredient_bindings b where b.store_id=s
  union
  select substring(a.source_key from '^supplier-item:[^:]+:(.*)$') name
  from private.ingredient_aliases a
  where a.store_id=s and a.corrected and a.source_key like 'supplier-item:%'
 ), lines as (
  select r.batch_id,r.organization_id,r.run_id,r.updated_at,
   case when r.header?'receipt_date' then r.edited_date
    else private.receipt_account_date(r.account->>'receipt_date') end receipt_date,
   case when r.header?'supplier_name' then r.edited_vendor else r.account->>'supplier_name' end supplier_name,
   r.header,r.account->>'supplier_name' approved_vendor,
   private.receipt_account_date(r.account->>'receipt_date') approved_date,
   edit.value edits,
   r.edited_date is not null and r.edited_vendor is not null
    and item.line->>'product_name'=edit.value->>'product_name'
    and item.line->>'unit'=edit.value->>'unit'
    and item.line->'unit_price'=edit.value->'unit_price' legacy_complete,
   item.line->>'row_key' row_key, item.line->>'product_name' display_name,
   coalesce(nullif(btrim(edit.value->>'supplier_item_name'),''),item.line->>'product_name') source_name,
   private.ingredient_match_text(coalesce(edit.value->>'supplier_item_unit',item.line->>'unit')) source_unit,
   private.ingredient_match_text(coalesce(edit.value->>'supplier_item_specification',item.line->>'specification')) source_spec,
   btrim(item.line->>'unit') purchase_unit,
   case when jsonb_typeof(item.line->'unit_price')='number' then (item.line->>'unit_price')::numeric end unit_price,
   private.receipt_account_number(item.line->>'quantity') quantity,
   coalesce(item.line->>'specification','') approved_spec,
   coalesce(nullif(btrim(item.line->>'specification'),''),nullif(btrim(edit.value->>'supplier_item_specification'),''),'') explicit_spec,
   case when pg_input_is_valid(edit.value->>'ingredient_id','uuid') then (edit.value->>'ingredient_id')::uuid end selected_ingredient,
   nullif(item.line->>'ingredient_id','') approved_ingredient
  from approved_receipts r
  cross join lateral jsonb_array_elements(r.account->'lines') item(line)
  cross join lateral (select coalesce(r.line_values->(item.line->>'row_key'),'{}'::jsonb) value) edit
  where nullif(btrim(item.line->>'product_name'),'') is not null
   and nullif(btrim(item.line->>'unit'),'') is not null
   and coalesce(item.line->>'handling','NORMAL')='NORMAL' and coalesce(edit.value->>'handling','NORMAL')='NORMAL'
   and edit.value->'ingredient_match_pending' is distinct from 'true'::jsonb
   and item.line->'ingredient_match_pending' is distinct from 'true'::jsonb
   and jsonb_typeof(item.line->'unit_price')='number'
   and private.receipt_account_number(item.line->>'quantity')>0
   and not exists(select 1 from private.receipt_entry_items i where i.batch_id=r.batch_id and i.row_key=item.line->>'row_key')
 ), measured_lines as materialized (
  select l.*,private.history_key(l.source_name) name_key,private.recipe_unit(l.purchase_unit) normalized_unit,
   private.recipe_factor(l.purchase_unit) purchase_factor,private.history_key(l.explicit_spec) spec_key,
   coalesce(private.cost_package_measure(l.purchase_unit,l.explicit_spec),
    case when l.explicit_spec='' then private.cost_package_measure(l.purchase_unit,l.source_name) end) measure
  from lines l where l.receipt_date is not null and l.supplier_name is not null
   and l.unit_price>=0 and l.unit_price<1000000000
   -- Keep sparse approvals out of package parsing unless their exact item
   -- name occurs in this store's confirmed supplier mappings.
   and (l.legacy_complete or exists(select 1 from scoped_item_names n
    where n.name=private.ingredient_match_text(l.source_name)))
 ), catalog_aliases as materialized (
  select a.source_key,a.reference_ids,a.specification,private.history_key(a.name) name_key,m.id ingredient,
   coalesce(m.canonical_ingredient_id,m.id) root
  from private.ingredient_aliases a
  join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=a.store_id
  where a.store_id=s and a.source_key not like 'supplier-item:%'
 ), matching_aliases as materialized (
  select l.*,a.root,a.reference_ids,a.specification
  from measured_lines l join catalog_aliases a on a.name_key=l.name_key
  where l.legacy_complete and l.selected_ingredient is null
  union all
  select l.*,a.root,a.reference_ids,a.specification
  from measured_lines l join catalog_aliases a on l.selected_ingredient=a.ingredient
  where l.legacy_complete and l.selected_ingredient is not null
  union all
  select l.*,a.root,a.reference_ids,a.specification
  from measured_lines l join catalog_aliases a on l.selected_ingredient=a.root and a.root<>a.ingredient
  where l.legacy_complete and l.selected_ingredient is not null
 ), reference_prices as materialized (
  select ref.id,ref.purchase,ref.source_ref->>'supplier_name' supplier_name,
   private.recipe_unit(ref.purchase->>'unit') purchase_unit,
   private.recipe_factor(ref.purchase->>'unit') purchase_factor
  from (select distinct unnest(reference_ids) id from matching_aliases) candidate
  join private.recipe_price_entries ref on ref.id=candidate.id
  where ref.store_id=s and ref.review_status='confirmed' and ref.source_kind='purchase'
   and coalesce(ref.source_ref->>'missing_price','false')<>'true'
 ), supplier_names as (
  select r.organization_id,r.supplier_name from measured_lines r
  union
  select o.organization_id,ref.supplier_name
  from (select distinct organization_id from matching_aliases) o
  cross join reference_prices ref where ref.supplier_name is not null
 ), supplier_ids as materialized (
  select n.organization_id,n.supplier_name,
   private.supplier_identity(n.organization_id,n.supplier_name) supplier_id
  from supplier_names n
 ), reference_matches as (
  select a.batch_id,a.row_key,(array_agg(distinct a.root))[1] root,
   min(coalesce(nullif(a.explicit_spec,''),a.specification,'')) spec,
   count(distinct a.root) root_count,
   count(distinct coalesce(nullif(a.explicit_spec,''),a.specification,'')) spec_count
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
 ), scoped_names as materialized (
  select distinct l.organization_id,vendor.supplier_id,private.ingredient_match_text(l.source_name) source_name,
   l.source_unit,l.source_spec
  from measured_lines l
  join supplier_ids vendor on vendor.organization_id=l.organization_id and vendor.supplier_name=l.supplier_name
  where vendor.supplier_id is not null
   and exists(select 1 from scoped_item_names n where n.name=private.ingredient_match_text(l.source_name))
 ), scoped_matches as materialized (
  select k.*,private.scoped_receipt_ingredient_matches(s,k.organization_id,k.supplier_id,
   k.source_name,k.source_unit,k.source_spec) roots
  from scoped_names k
 ), verified_scope_candidates as materialized (
  select l.*,scoped.roots[1] root,vendor.supplier_id
  from measured_lines l
  join supplier_ids vendor on vendor.organization_id=l.organization_id and vendor.supplier_name=l.supplier_name
  join scoped_matches scoped on scoped.organization_id=l.organization_id and scoped.supplier_id=vendor.supplier_id
   and scoped.source_name=private.ingredient_match_text(l.source_name)
   and scoped.source_unit=l.source_unit and scoped.source_spec=l.source_spec
  left join private.ingredient_masters selected on selected.store_id=s and selected.id=l.selected_ingredient
  where cardinality(scoped.roots)=1
   and (l.selected_ingredient is null or scoped.roots[1]=coalesce(selected.canonical_ingredient_id,selected.id))
   and (l.approved_ingredient is null or l.approved_ingredient=l.selected_ingredient::text)
 ), verified_scope as materialized (
  -- Older saves only store edited cells. For those, the immutable approval
  -- must agree with the still-pinned OCR run, field by field. Run this only
  -- for an exact scoped identity, never for the full approval history.
  select v.batch_id,v.row_key,v.root,v.explicit_spec spec
  from verified_scope_candidates v
  cross join lateral (
   select
    max(f.value#>>'{}') filter(where f.row_key='document' and f.field_name='supplier_name') vendor,
    max(f.value#>>'{}') filter(where f.row_key='document' and f.field_name='receipt_date') receipt_date,
    max(f.value#>>'{}') filter(where f.row_key=v.row_key and f.field_name='product') name,
    max(f.value#>>'{}') filter(where f.row_key=v.row_key and f.field_name='unit') unit,
    max(f.value#>>'{}') filter(where f.row_key=v.row_key and f.field_name='specification') spec,
    max(f.value#>>'{}') filter(where f.row_key=v.row_key and f.field_name='quantity') quantity,
    max(f.value#>>'{}') filter(where f.row_key=v.row_key and f.field_name='unit_price_ex_tax') unit_price
   from private.receipt_effective_fields(v.run_id) f
   where f.row_key in ('document',v.row_key)
  ) pinned
  where v.receipt_date=v.approved_date
   and v.supplier_id=private.supplier_identity(v.organization_id,v.approved_vendor)
   and (v.header?'supplier_name' or v.supplier_id=private.supplier_identity(v.organization_id,pinned.vendor))
   and (v.header?'receipt_date' or v.approved_date=private.receipt_account_date(pinned.receipt_date))
   and v.display_name=case when v.edits?'product_name' then v.edits->>'product_name' else pinned.name end
   and v.purchase_unit=btrim(case when v.edits?'unit' then v.edits->>'unit' else pinned.unit end)
   and v.approved_spec=case when v.edits?'specification' then coalesce(v.edits->>'specification','') else coalesce(pinned.spec,'') end
   and v.quantity=private.receipt_account_number(case when v.edits?'quantity' then v.edits->>'quantity' else pinned.quantity end)
   and v.unit_price=private.receipt_account_number(case when v.edits?'unit_price' then v.edits->>'unit_price' else pinned.unit_price end)
 ), matched as (
  select distinct l.batch_id,l.row_key,coalesce(r.root,v.root) root,coalesce(r.spec,v.spec) spec
  from measured_lines l
  join supplier_ids vendor on vendor.organization_id=l.organization_id and vendor.supplier_name=l.supplier_name
  left join scoped_matches scoped on scoped.organization_id=l.organization_id and scoped.supplier_id=vendor.supplier_id
   and scoped.source_name=private.ingredient_match_text(l.source_name)
   and scoped.source_unit=l.source_unit and scoped.source_spec=l.source_spec
  left join reference_matches r using(batch_id,row_key)
  left join verified_scope v using(batch_id,row_key)
  where coalesce(cardinality(scoped.roots),0)<=1
   and (r.root_count is null or (r.root_count=1 and r.spec_count=1))
   and (scoped.roots[1] is null or r.root is null or scoped.roots[1]=r.root)
   and coalesce(r.root,v.root) is not null
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
