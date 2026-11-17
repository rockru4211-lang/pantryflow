-- The abbreviated name in the imported purchase sheets belongs to the
-- supplier whose legal name has already been confirmed in this organization.
insert into private.supplier_name_links(organization_id,name_key,source_name,supplier_id,evidence)
select distinct s.organization_id,private.history_key('大誼國際'),'大誼國際',canonical.id,'既有請購表供應商簡稱'
from public.stores s
join public.suppliers canonical on canonical.organization_id=s.organization_id
 and canonical.id=private.supplier_identity(s.organization_id,'大誼')
where s.is_active and s.name in ('BeApe','Gras')
 and canonical.id=private.supplier_identity(s.organization_id,'英屬維京群島商大誼國際有限公司')
 and private.supplier_identity(s.organization_id,'大誼國際') is null
 and not exists (
  select 1 from public.suppliers conflicting where conflicting.organization_id=s.organization_id
   and conflicting.id<>canonical.id and private.history_key(conflicting.name)=private.history_key('大誼國際')
 )
on conflict (organization_id,name_key) do nothing;

-- Recover older approved receipt lines that predate the price projection.
-- Use the saved approval for the current edit revision and only exact
-- supplier, name/ingredient, unit and package evidence from this store.
create function private.legacy_receipt_ingredient_prices(s uuid)
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
 ), receipts as materialized (
  select b.id batch_id,b.organization_id,e.run_id,e.updated_at,
   private.receipt_account_date(e.header->>'receipt_date') receipt_date,
   sp.id supplier_id,sp.name supplier_name,e.line_values,a.account
  from private.receipt_account_edits e
  join public.receipt_upload_batches b on b.id=e.batch_id and b.store_id=e.store_id
  join public.stores st on st.id=b.store_id and st.is_active and st.name in ('BeApe','Gras')
  join public.suppliers sp on sp.id=private.supplier_identity(b.organization_id,e.header->>'supplier_name')
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
  select r.batch_id,r.organization_id,r.updated_at,r.receipt_date,r.supplier_id,r.supplier_name,
   item.line->>'row_key' row_key, item.line->>'product_name' display_name,
   coalesce(nullif(btrim(edit.value->>'supplier_item_name'),''),item.line->>'product_name') source_name,
   btrim(item.line->>'unit') purchase_unit, (item.line->>'unit_price')::numeric unit_price,
   coalesce(nullif(btrim(item.line->>'specification'),''),nullif(btrim(edit.value->>'supplier_item_specification'),''),'') explicit_spec,
   case when pg_input_is_valid(edit.value->>'ingredient_id','uuid') then (edit.value->>'ingredient_id')::uuid end selected_ingredient
  from receipts r
  cross join lateral jsonb_array_elements(r.account->'lines') item(line)
  cross join lateral (select r.line_values->(item.line->>'row_key') value) edit
  where r.receipt_date is not null and nullif(btrim(item.line->>'product_name'),'') is not null
   and nullif(btrim(item.line->>'unit'),'') is not null
   and coalesce(item.line->>'handling','NORMAL')='NORMAL' and coalesce(edit.value->>'handling','NORMAL')='NORMAL'
   and edit.value->'ingredient_match_pending' is distinct from 'true'::jsonb
   and item.line->>'product_name'=edit.value->>'product_name'
   and item.line->>'unit'=edit.value->>'unit'
   and item.line->'unit_price'=edit.value->'unit_price' and jsonb_typeof(item.line->'unit_price')='number'
   and private.receipt_account_number(item.line->>'quantity')>0
   and not exists(select 1 from private.receipt_entry_items i where i.batch_id=r.batch_id and i.row_key=item.line->>'row_key')
 ), catalog_aliases as materialized (
  select a.reference_ids,a.specification,private.history_key(a.name) name_key,m.id ingredient,
   coalesce(m.canonical_ingredient_id,m.id) root
  from private.ingredient_aliases a
  join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=a.store_id
  where a.store_id=s
 ), matching_aliases as (
  select l.*,a.root,a.reference_ids,a.specification
  from lines l join catalog_aliases a on a.name_key=private.history_key(l.source_name)
  where l.selected_ingredient is null
  union all
  select l.*,a.root,a.reference_ids,a.specification
  from lines l join catalog_aliases a on l.selected_ingredient=a.ingredient
  where l.selected_ingredient is not null
  union all
  select l.*,a.root,a.reference_ids,a.specification
  from lines l join catalog_aliases a on l.selected_ingredient=a.root and a.root<>a.ingredient
  where l.selected_ingredient is not null
 ), measured as materialized (
  select a.*,coalesce(private.cost_package_measure(a.purchase_unit,a.explicit_spec),
   case when a.explicit_spec='' then private.cost_package_measure(a.purchase_unit,a.source_name) end) measure
  from matching_aliases a where a.unit_price>=0 and a.unit_price<1000000000
 ), matched as (
  select a.batch_id,a.row_key,(array_agg(distinct a.root))[1] root,
   min(coalesce(nullif(a.explicit_spec,''),a.specification,'')) spec
  from measured a
  where exists(
   select 1 from unnest(a.reference_ids) evidence(ref_id)
   join private.recipe_price_entries ref on ref.id=evidence.ref_id
   where ref.store_id=s and ref.review_status='confirmed' and ref.source_kind='purchase'
    and coalesce(ref.source_ref->>'missing_price','false')<>'true'
    and private.recipe_unit(ref.purchase->>'unit')=private.recipe_unit(a.purchase_unit)
    and private.recipe_factor(ref.purchase->>'unit')=private.recipe_factor(a.purchase_unit)
    and private.supplier_identity(a.organization_id,ref.source_ref->>'supplier_name')=a.supplier_id
    and case when a.measure is not null then
     a.measure=coalesce(private.inventory_package_measure(ref.purchase,a.purchase_unit,null),
      private.cost_package_measure(a.purchase_unit,a.specification))
    else private.history_key(a.specification)=private.history_key(a.explicit_spec)
     and private.inventory_package_measure(ref.purchase,a.purchase_unit,null) is null end
  )
  group by a.batch_id,a.row_key
  having count(distinct a.root)=1 and count(distinct coalesce(nullif(a.explicit_spec,''),a.specification,''))=1
 ), candidates as (
  select l.*,m.root,m.spec,coalesce(private.cost_package_measure(l.purchase_unit,l.explicit_spec),
   case when l.explicit_spec='' then private.cost_package_measure(l.purchase_unit,l.source_name) end) measure
  from matched m join lines l using(batch_id,row_key)
 )
 select md5('legacy-receipt:'||c.batch_id||':'||c.row_key)::uuid,s,p.id,c.receipt_date,c.updated_at,
  c.purchase_unit,c.unit_price,c.batch_id,c.row_key,c.supplier_name,c.spec,
  jsonb_strip_nulls(jsonb_build_object('amount',c.unit_price,'quantity',1,'unit',c.purchase_unit,
   'content_quantity',c.measure->'quantity','content_unit',c.measure->'unit')),
  c.root,c.display_name
 from candidates c
 left join lateral (
  select (array_agg(distinct p.id))[1] id
  from private.ingredient_aliases a
  join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=s
  join public.products p on 'p:'||p.id=a.source_key and p.organization_id=c.organization_id and p.is_active
  where a.store_id=s and coalesce(m.canonical_ingredient_id,m.id)=c.root
   and private.recipe_unit(p.base_unit)=private.recipe_unit(c.purchase_unit)
   and private.recipe_factor(p.base_unit)=private.recipe_factor(c.purchase_unit)
   and private.history_key(p.specification)=private.history_key(c.spec)
  having count(distinct p.id)=1
 ) p on true;
$$;

create function private.ingredient_receipt_price_evidence(s uuid)
returns table (id uuid,store_id uuid,product_id uuid,effective_date date,created_at timestamptz,
 unit text,price numeric,batch_id uuid,row_key text,supplier text,specification text,purchase jsonb,
 ingredient_id uuid,product_name text)
language sql stable set search_path='' as $$
 select h.*,null::uuid,p.name from private.live_ingredient_receipt_prices h
 join public.products p on p.id=h.product_id where h.store_id=s
 union all
 select * from private.legacy_receipt_ingredient_prices(s)
$$;

revoke all on function private.ingredient_receipt_price_evidence(uuid),private.legacy_receipt_ingredient_prices(uuid)
from public,anon,authenticated;

-- Use the same receipt history for the sheet and purchase comparisons.
do $migration$
declare src text;
begin
 src:=pg_get_functiondef('private.ingredient_supply_read(uuid)'::regprocedure);
 if strpos(src,'select * from private.live_ingredient_receipt_prices where store_id=s')=0
  or strpos(src,'select a.ingredient_id,l.id,p.name')=0 then raise exception 'RECEIPT_SHEET_SOURCE_ANCHOR'; end if;
 src:=replace(src,'select * from private.live_ingredient_receipt_prices where store_id=s',
  'select * from private.ingredient_receipt_price_evidence(s)');
 src:=replace(src,'select a.ingredient_id,l.id,p.name','select a.ingredient_id,l.id,l.product_name');
 src:=replace(src,$old$ join public.products p on p.id=l.product_id
 join private.ingredient_aliases a on a.store_id=l.store_id and a.source_key='p:'||l.product_id
  and a.source_unit=private.recipe_unit(l.unit) and a.specification=l.specification$old$,
 $new$ join lateral (
  select l.ingredient_id where l.ingredient_id is not null
  union
  select a.ingredient_id from private.ingredient_aliases a
   where l.ingredient_id is null and a.store_id=l.store_id and a.source_key='p:'||l.product_id
    and a.source_unit=private.recipe_unit(l.unit) and a.specification=l.specification
 ) a on true$new$);
 src:=replace(src,$old$   select a.root_id,r.rid
   from alias_scopes a join dated_receipts r on a.source_key='p:'||r.product_id$old$,
 $new$   select a.root_id,r.rid
   from alias_scopes a join dated_receipts r on a.source_key='p:'||r.product_id
   union
   select r.ingredient_id,r.rid from dated_receipts r where r.ingredient_id is not null$new$);
 if strpos(src,'select l.ingredient_id where')=0 or strpos(src,'select r.ingredient_id,r.rid')=0
 then raise exception 'RECEIPT_SHEET_LINK_ANCHOR'; end if;
 execute src;

end $migration$;

-- A new receipt compares against the latest compatible previous receipt.
-- Purchase-sheet baselines are never used for a price-change prompt.
create or replace function public.baihuayuan_receipt_price_changes(p_store_id uuid,p_batch_id uuid,p_data jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare received_on date; org uuid; vendor uuid;
begin
 if auth.uid() is null or not coalesce(private.can_review_receipt(p_batch_id),false) then
  raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 select b.organization_id into org from public.receipt_upload_batches b where b.id=p_batch_id and b.store_id=p_store_id;
 if not found then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 if jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines')>500 then
  raise exception 'INVALID_RECEIPT_LINE' using errcode='22023';end if;
 received_on:=private.receipt_account_date(p_data#>>'{header,receipt_date}');
 vendor:=private.supplier_identity(org,p_data#>>'{header,supplier_name}');
 if received_on is null or vendor is null then return '[]'::jsonb;end if;
 return (
  with lines as materialized (
   select btrim(line->>'product_name') name,btrim(line->>'unit') unit,
    coalesce(nullif(btrim(line->>'specification'),''),'') spec,
    coalesce(nullif(btrim(line->>'supplier_item_name'),''),line->>'product_name') source_name,
    (line->>'unit_price')::numeric next_price,ordinal,
    case when pg_input_is_valid(line->>'ingredient_id','uuid') then (line->>'ingredient_id')::uuid end ingredient_id
   from jsonb_array_elements(p_data->'lines') with ordinality as item(line,ordinal)
   where coalesce(line->>'handling','NORMAL')='NORMAL' and jsonb_typeof(line->'unit_price')='number'
    and nullif(btrim(line->>'product_name'),'') is not null and nullif(btrim(line->>'unit'),'') is not null
  ), history as materialized (
   select h.* from private.ingredient_receipt_price_evidence(p_store_id) h
   where h.batch_id<>p_batch_id and h.effective_date<=received_on and h.price>=0 and h.price<1000000000
    and private.supplier_identity(org,h.supplier)=vendor
  )
  select coalesce(jsonb_agg(jsonb_build_object('name',l.name,'unit',l.unit,'before',p.price,'after',l.next_price)
    order by l.ordinal),'[]'::jsonb)
  from lines l
  left join private.ingredient_masters m on m.id=l.ingredient_id and m.store_id=p_store_id
  cross join lateral (
   select coalesce(private.cost_package_measure(l.unit,l.spec),
    case when l.spec='' then private.cost_package_measure(l.unit,l.source_name) end) measure
  ) package
  cross join lateral (
   select min(compatible.price) price from (
    select h.price,dense_rank() over(order by h.effective_date desc,h.created_at desc nulls last) rank
    from history h
    where private.recipe_unit(h.unit)=private.recipe_unit(l.unit)
     and private.recipe_factor(h.unit)=private.recipe_factor(l.unit)
     and case when package.measure is not null
      then package.measure=coalesce(private.inventory_package_measure(h.purchase,h.unit,null),private.cost_package_measure(h.unit,h.specification))
      else private.history_key(h.specification)=private.history_key(l.spec)
       and private.inventory_package_measure(h.purchase,h.unit,null) is null end
     and case when l.ingredient_id is null then private.history_key(h.product_name)=private.history_key(l.source_name)
     else coalesce(m.canonical_ingredient_id,m.id)=h.ingredient_id or exists(
      select 1 from private.ingredient_aliases a join private.ingredient_masters linked on linked.id=a.ingredient_id and linked.store_id=a.store_id
      where a.store_id=p_store_id and a.source_key='p:'||h.product_id
       and coalesce(linked.canonical_ingredient_id,linked.id)=coalesce(m.canonical_ingredient_id,m.id)
     ) end
   ) compatible where compatible.rank=1 having count(distinct compatible.price)=1
  ) p
  where l.next_price>=0 and l.next_price<1000000000 and round(p.price,4)<>round(l.next_price,4)
 );
end $$;

revoke all on function public.baihuayuan_receipt_price_changes(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.baihuayuan_receipt_price_changes(uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
