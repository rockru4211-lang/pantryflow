-- Inventory only needs a short list of dated offers from the price register.
-- Historical prices remain available for review even when supply has stopped.
create function public.baihuayuan_inventory_price_lookup(
 p_store_id uuid,p_query text,p_count_date date,p_preferred_code text default '',p_supplier text default ''
) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare org uuid; term text; result jsonb; supplier_key text;
begin
 if auth.uid() is null or coalesce(private.app_role(p_store_id),'') not in ('LOGISTICS','OWNER')
  or not private.has_active_store_role(p_store_id,null) or not private.recipe_allowed(p_store_id) then
  raise exception 'INVENTORY_ADMIN_REQUIRED' using errcode='42501';
 end if;
 if p_count_date is null or length(coalesce(p_query,''))>180 or length(coalesce(p_preferred_code,''))>80
  or length(coalesce(p_supplier,''))>180 then raise exception 'INVALID_INVENTORY_PRICE_SEARCH' using errcode='22023';end if;
 term:=regexp_replace(private.known_cost_name(p_query),'[[:space:]]+','','g');
 if coalesce(term,'')='' then return '[]'::jsonb;end if;
 select s.organization_id into org from public.stores s where s.id=p_store_id and s.is_active;
 if org is null then raise exception 'INVENTORY_ADMIN_REQUIRED' using errcode='42501';end if;
 supplier_key:=private.inventory_supplier_key(org,p_supplier);

 with masters as materialized (
  select m.id,m.name,private.managed_ingredient_code(m.id) code, m.ingredient_code, m.canonical_ingredient_id,
   m.selected_reference
  from private.ingredient_masters m where m.store_id=p_store_id
 ), candidates as materialized (
  select m.* from masters m
  where strpos(lower(m.code),term)>0 or strpos(lower(m.ingredient_code),term)>0
   or strpos(regexp_replace(private.known_cost_name(m.name),'[[:space:]]+','','g'),term)>0
   or exists(select 1 from private.ingredient_aliases a where a.store_id=p_store_id and a.ingredient_id=m.id
    and strpos(regexp_replace(private.known_cost_name(a.name),'[[:space:]]+','','g'),term)>0)
   or exists(select 1 from private.ingredient_usage_names n where n.store_id=p_store_id
    and n.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)
    and strpos(regexp_replace(private.known_cost_name(concat_ws(' ',n.formal_name,n.count_name,n.recipe_aliases::text)),'[[:space:]]+','','g'),term)>0)
  order by (m.code=p_preferred_code) desc,
   (regexp_replace(private.known_cost_name(m.name),'[[:space:]]+','','g')=term) desc,m.id
  limit 100
 ), refs as materialized (
  select c.id,c.name,c.code,c.canonical_ingredient_id,c.selected_reference ref from candidates c where c.selected_reference is not null
  union
  select c.id,c.name,c.code,c.canonical_ingredient_id,unnest(a.reference_ids)
  from candidates c join private.ingredient_aliases a on a.ingredient_id=c.id and a.store_id=p_store_id
 ), purchase_matches as materialized (
  select r.id,r.name,r.code,r.canonical_ingredient_id,e.id reference_id,e.effective_date,e.source,
   coalesce(sp.name,e.source_ref->>'supplier_name') supplier,e.source_ref->>'specification' specification,
   coalesce(nullif(e.purchase,'null'::jsonb),jsonb_build_object('amount',e.price,'quantity',1,'unit',e.unit)) purchase,
   'purchase' basis
  from refs r join private.recipe_price_entries e on e.id=r.ref and e.store_id=p_store_id
  left join public.suppliers sp on sp.organization_id=org and sp.id::text=e.source_ref->>'supplier_id'
  where e.source_kind='purchase' and e.review_status='confirmed' and coalesce(e.source_key,'') not like 'receipt:%'
   and coalesce(e.source_ref->>'missing_price','false')<>'true' and e.effective_date<=p_count_date
 ), direct_matches as materialized (
  select null::uuid id,e.name,'' code,null::uuid canonical_ingredient_id,e.id reference_id,e.effective_date,e.source,
   coalesce(sp.name,e.source_ref->>'supplier_name') supplier,e.source_ref->>'specification' specification,
   coalesce(nullif(e.purchase,'null'::jsonb),jsonb_build_object('amount',e.price,'quantity',1,'unit',e.unit)) purchase,
   'purchase' basis
  from private.recipe_price_entries e
  left join public.suppliers sp on sp.organization_id=org and sp.id::text=e.source_ref->>'supplier_id'
  where e.store_id=p_store_id and e.source_kind='purchase' and e.review_status='confirmed'
   and coalesce(e.source_key,'') not like 'receipt:%' and coalesce(e.source_ref->>'missing_price','false')<>'true'
   and e.effective_date<=p_count_date
   and (strpos(regexp_replace(private.known_cost_name(e.name),'[[:space:]]+','','g'),term)>0
    or strpos(regexp_replace(private.known_cost_name(coalesce(sp.name,e.source_ref->>'supplier_name')),'[[:space:]]+','','g'),term)>0)
   and not exists(select 1 from purchase_matches m where m.reference_id=e.id)
  order by e.effective_date desc,e.id limit 100
 ), products as materialized (
  select distinct c.id,c.name,c.code,c.canonical_ingredient_id,
   case when pg_input_is_valid(substr(a.source_key,3),'uuid') then substr(a.source_key,3)::uuid end product_id
  from candidates c join private.ingredient_aliases a on a.ingredient_id=c.id and a.store_id=p_store_id
  where a.source_key like 'p:%' and pg_input_is_valid(substr(a.source_key,3),'uuid')
 ), receipt_matches as (
  select p.id,p.name,p.code,p.canonical_ingredient_id,r.id,r.effective_date,'已確認建檔進貨',r.supplier,r.specification,r.purchase,'receipt'
  from products p join private.live_ingredient_receipt_prices r on r.store_id=p_store_id and r.product_id=p.product_id
  where r.effective_date<=p_count_date and r.price is not null
 ), direct_receipts as (
  select null::uuid,p.name,'' code,null::uuid,r.id,r.effective_date,'已確認建檔進貨',r.supplier,r.specification,r.purchase,'receipt'
  from private.live_ingredient_receipt_prices r join public.products p on p.id=r.product_id and p.organization_id=org
  where r.store_id=p_store_id and r.effective_date<=p_count_date and r.price is not null
   and (strpos(regexp_replace(private.known_cost_name(p.name),'[[:space:]]+','','g'),term)>0
    or strpos(regexp_replace(private.known_cost_name(coalesce(private.supplier_display_name(org,r.supplier),r.supplier)),'[[:space:]]+','','g'),term)>0)
   and not exists(select 1 from products matched where matched.product_id=r.product_id)
  order by r.effective_date desc,r.id limit 100
 ), standard_matches as (
  select c.id,c.name,c.code,c.canonical_ingredient_id,v.id,v.effective_date,'食材價格表 · 標準價',v.supplier_name,null::text,
   coalesce(nullif(v.snapshot->'purchase','null'::jsonb),jsonb_build_object('amount',v.snapshot->'cost_price','quantity',1,'unit',v.snapshot->'unit')),
   'standard'
  from candidates c join private.ingredient_standard_versions v on v.store_id=p_store_id and v.ingredient_id=c.id
  where v.effective_date between date '0001-01-02' and p_count_date and v.snapshot->>'review_status'='confirmed'
 ), offers as (
  select * from purchase_matches union all select * from direct_matches
  union all select * from receipt_matches union all select * from direct_receipts union all select * from standard_matches
 ), priced as (
  select o.*,private.inventory_supplier_key(org,o.supplier) offer_supplier,
   private.cost_purchase_price(o.purchase,o.purchase->>'unit') value
  from offers o
 ), ranked as (
  select p.*,coalesce(private.supplier_display_name(org,p.supplier),p.supplier) supplier_name,
   exists(select 1 from private.ingredient_supply_state st where st.store_id=p_store_id and st.stopped
    and st.ingredient_id in (p.id,p.canonical_ingredient_id)
    and (st.supplier_key in ('*',p.offer_supplier) or private.inventory_supplier_key(org,st.supplier_name)=p.offer_supplier)) stopped,
   row_number() over(partition by p.reference_id order by (p.code=p_preferred_code) desc,p.code,p.name,p.id) ref_rank
  from priced p where p.value>=0 and p.value<1000000000
 ), top_offers as (
  select * from ranked where ref_rank=1
  order by (code=p_preferred_code and code<>'') desc,(offer_supplier is not distinct from supplier_key) desc,
   effective_date desc, (basis='receipt') desc, name,reference_id limit 30
 )
 select coalesce(jsonb_agg(jsonb_build_object('name',name,'code',code,'stopped',stopped,'quote',
  jsonb_build_object('price',null,'basis',basis,'date',effective_date,'purchase',purchase,'reference_id',reference_id,
   'supplier_name',supplier_name,'source',source,'specification',specification))
  order by (code=p_preferred_code and code<>'') desc,(offer_supplier is not distinct from supplier_key) desc,
   effective_date desc,(basis='receipt') desc,name,reference_id),'[]'::jsonb) into result from top_offers;
 return result;
end
$$;
revoke all on function public.baihuayuan_inventory_price_lookup(uuid,text,date,text,text) from public,anon;
grant execute on function public.baihuayuan_inventory_price_lookup(uuid,text,date,text,text) to authenticated;
notify pgrst,'reload schema';
