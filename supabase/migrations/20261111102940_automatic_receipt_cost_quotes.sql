-- Read-only current prices. Standards, approvals, closed counts and movement
-- snapshots are deliberately never updated by this migration.
-- Entry-complete receipt rows are sufficient; financial reconciliation is not.
create or replace view private.live_ingredient_receipt_prices with (security_invoker=true) as
select r.id,b.store_id,i.product_id,i.receipt_date as effective_date,i.recorded_at as created_at,i.unit,
 case when validity.ok then i.unit_price end price,
 b.id batch_id,i.row_key,coalesce(sp.name,i.supplier_name,'') supplier,
 coalesce(r.source_ref->>'specification','') specification,
 jsonb_strip_nulls(jsonb_build_object('amount',case when validity.ok then i.unit_price end,'quantity',1,'unit',i.unit,
  'content_quantity',measure.value->'quantity','content_unit',measure.value->'unit')) purchase
from private.receipt_entry_items i
join public.receipt_upload_batches b on b.id=i.batch_id
join public.products p on p.id=i.product_id and p.organization_id=b.organization_id
left join private.recipe_price_entries r on r.source_key='receipt:'||i.batch_id||':'||i.row_key and r.store_id=b.store_id
left join public.suppliers sp on sp.id=i.supplier_id and sp.organization_id=b.organization_id
cross join lateral(select private.cost_package_measure(i.unit,r.source_ref->>'specification') value) measure
cross join lateral(select r.source_kind='purchase' and r.review_status='confirmed'
 and i.product_id=r.product_id and i.unit=r.unit and i.unit_price=r.price and i.receipt_date=r.effective_date
 and i.run_id::text is not distinct from nullif(r.source_ref->>'run_id','')
 and i.supplier_id::text is not distinct from nullif(r.source_ref->>'supplier_id','')
 and (i.supplier_id is null or (sp.id is not null and sp.is_active))
 and r.price>=0 and r.price<1000000000 and coalesce(r.source_ref->>'missing_price','false')<>'true' ok) validity
where i.retired_at is null and not exists(select 1 from public.goods_receipts g where g.source_batch_id=b.id)
 and not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=b.id)
 and not exists(select 1 from private.baihuayuan_record_flags f where f.store_id=b.store_id and f.entity_type='RECEIPT_BATCH' and f.entity_id=b.id and f.state<>'LIVE')
union all
select l.id,b.store_id,l.product_id,coalesce(g.receipt_date,b.work_date),coalesce(g.reviewed_at,l.modified_at,l.created_at),
 l.unit,case when coalesce(l.supplier_id,g.supplier_id) is null or sp.is_active then l.unit_price_ex_tax end,b.id,coalesce(nullif(l.source_row_key,''),'line-'||l.id),coalesce(sp.name,''),coalesce(l.specification,''),
 jsonb_strip_nulls(jsonb_build_object('amount',l.unit_price_ex_tax,'quantity',1,'unit',l.unit,
  'content_quantity',measure.value->'quantity','content_unit',measure.value->'unit'))
from public.receipt_lines l join public.goods_receipts g on g.id=l.receipt_id
join public.receipt_upload_batches b on b.id=g.source_batch_id and b.store_id=g.store_id
join public.products p on p.id=l.product_id and p.organization_id=b.organization_id
left join public.suppliers sp on sp.id=coalesce(l.supplier_id,g.supplier_id) and sp.organization_id=b.organization_id
cross join lateral(select private.cost_package_measure(l.unit,l.specification) value) measure
where b.status::text='COMPLETED' and g.reviewed_at is not null
 and l.quantity>0 and l.unit_price_ex_tax>=0 and l.unit_price_ex_tax<1000000000 and nullif(btrim(l.unit),'') is not null
 and coalesce(l.human_correction->>'handling','NORMAL')='NORMAL'
 and coalesce(l.human_correction->>'product_name','') !~ '^(其他)?(運費|運送費|配送費|宅配費)([（(].*[）)])?$'
 and not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=b.id)
 and not exists(select 1 from private.baihuayuan_record_flags f where f.store_id=b.store_id and f.entity_type='RECEIPT_BATCH' and f.entity_id=b.id and f.state<>'LIVE');
revoke all on private.live_ingredient_receipt_prices from public,anon,authenticated;

create function private.automatic_cost_quote(s uuid,product uuid,nm text,u text,cutoff date,ingredient uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' set jit=off as $$
declare org uuid; specs text; ids uuid[]; root uuid; master private.ingredient_masters;
 target_package jsonb; target_unit text:=private.recipe_unit(u); selected record; version record; quote numeric; baseline jsonb; count_baseline jsonb; baseline_package jsonb;
begin
 if cutoff is null or nullif(btrim(u),'') is null then return jsonb_build_object('price',null,'reason','待確認日期或計價單位');end if;
 select organization_id into org from public.stores where id=s and is_active and name in ('BeApe','Gras');
 if org is null then return jsonb_build_object('price',null,'reason','尚未找到此門市');end if;
 if product is not null then
  select p.name,p.specification into nm,specs from public.products p where p.id=product and p.organization_id=org;
  if not found then return jsonb_build_object('price',null,'reason','品項不屬於此門市');end if;
 end if;
 if ingredient is not null then
  select coalesce(m.canonical_ingredient_id,m.id) into root from private.ingredient_masters m where m.id=ingredient and m.store_id=s;
  if root is null then return jsonb_build_object('price',null,'reason','食材不屬於此門市');end if;
 else
  select array_agg(distinct coalesce(m.canonical_ingredient_id,m.id)) into ids
  from private.ingredient_aliases a join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=s
  where a.store_id=s and a.source_key='p:'||product;
  -- A supplied product ID never falls through to another product with the same name.
  if product is null then
   select array_agg(distinct coalesce(m.canonical_ingredient_id,m.id)) into ids from private.ingredient_masters m
   where m.store_id=s and (private.cost_name_key(m.name)=private.cost_name_key(nm) or exists(
    select 1 from private.ingredient_aliases a where a.store_id=s and a.ingredient_id=m.id and a.corrected and private.cost_name_key(a.name)=private.cost_name_key(nm)));
  end if;
  if cardinality(ids)>1 then return jsonb_build_object('price',null,'reason','同名有不同品項或規格，待確認對應');end if;
  root:=ids[1];
 end if;
 select * into master from private.ingredient_masters where id=root and store_id=s;
 if exists(select 1 from private.ingredient_supply_state st where st.store_id=s and st.ingredient_id=root and st.supplier_key='*' and st.stopped) then
  return jsonb_build_object('price',null,'reason','此品項已停止供貨');end if;
 select v.snapshot,v.effective_date into version from private.ingredient_standard_versions v where v.store_id=s and v.ingredient_id=root
  and v.effective_date<=cutoff order by v.effective_date desc,v.created_at desc,v.id desc limit 1;
 select b.quote into count_baseline from private.ingredient_standard_baselines b
 where b.store_id=s and b.product_id=product and b.unit=u and b.quote->>'basis'='confirmed_baseline'
  and coalesce(nullif(b.quote->>'date','')::date,(b.captured_at at time zone 'Asia/Taipei')::date)<=cutoff
  and not exists(select 1 from private.ingredient_standard_versions v where v.store_id=s and v.ingredient_id=root and v.actor_id is not null and v.effective_date<=cutoff);
 baseline_package:=private.inventory_package_measure(count_baseline->'purchase',u,null);
 target_package:=coalesce(baseline_package,private.cost_package_measure(u,specs),private.inventory_package_measure(case when version.snapshot->>'review_status'='confirmed' then version.snapshot->'purchase' end,u,null));
 with refs as materialized (
  select distinct unnest(a.reference_ids) id from private.ingredient_aliases a join private.ingredient_masters m on m.id=a.ingredient_id
  where a.store_id=s and m.store_id=s and (m.id=root or m.canonical_ingredient_id=root)
 ), candidates as materialized (
  select r.* from private.live_ingredient_receipt_prices r where r.store_id=s and r.effective_date<=cutoff
   and (case when product is not null then r.product_id=product else
    r.id in(select id from refs) or exists(select 1 from private.ingredient_aliases a join private.ingredient_masters m on m.id=a.ingredient_id
     where a.store_id=s and m.store_id=s and (m.id=root or m.canonical_ingredient_id=root) and a.source_key='p:'||r.product_id) end)
   and not exists(select 1 from private.ingredient_supply_state st where st.store_id=s and st.ingredient_id=root and st.stopped
    and (st.supplier_key=private.ingredient_supplier_key_for_store(s,jsonb_build_object('supplier_name',r.supplier))
     or st.supplier_key=private.ingredient_supplier_key(jsonb_build_object('supplier_name',r.supplier))))
 ), latest as (
  select * from candidates where effective_date=(select max(effective_date) from candidates)
 ), converted as (
  select r.*,case
   when r.price is null then null
   when count_baseline is not null and baseline_package is null and target_unit in ('包','瓶','罐','盒','袋','桶','箱','打','組','塊','條') then null
   when target_unit in ('包','瓶','罐','盒','袋','桶','箱','打','組','塊','條')
    and (target_package is null or private.inventory_package_measure(r.purchase,r.unit,null) is null) then null
   when target_package is not null then private.cost_purchase_price(r.purchase,target_package->>'unit')*(target_package->>'quantity')::numeric
   else private.cost_purchase_price(r.purchase,u) end value from latest r
 ) select count(*) n,count(*) filter(where value is null or value<0 or value>=1000000000) invalid,
  count(distinct value) distinct_prices,(array_agg(to_jsonb(c) order by created_at desc,id))[1] latest into selected from converted c;
 if selected.n>0 then
  if selected.invalid>0 then return jsonb_build_object('price',null,'reason','最新進貨缺少已確認的規格或單位換算','basis','receipt','date',selected.latest->'effective_date')||
   case when selected.n=1 then jsonb_build_object('unit',u,'purchase',selected.latest->'purchase','specification',selected.latest->'specification',
    'source',concat_ws(' · ','本店進貨',nullif(selected.latest->>'supplier','')),'supplier_name',selected.latest->'supplier',
    'reference_id',selected.latest->'id','batch_id',selected.latest->'batch_id','store_id',s) else '{}'::jsonb end;end if;
  if selected.distinct_prices<>1 then return jsonb_build_object('price',null,'reason','同日有不同的已確認進價，待核對','basis','receipt','date',selected.latest->'effective_date');end if;
  return jsonb_build_object('price',round((selected.latest->>'value')::numeric,6),'unit',u,'source',concat_ws(' · ','本店進貨',nullif(selected.latest->>'supplier','')),
   'date',selected.latest->'effective_date','basis','receipt','reference_id',selected.latest->'id','batch_id',selected.latest->'batch_id','store_id',s,
   'purchase',selected.latest->'purchase','specification',selected.latest->'specification','supplier_name',selected.latest->'supplier');
 end if;
 if product is not null and not exists(select 1 from private.ingredient_standard_versions v where v.store_id=s and v.ingredient_id=root and v.actor_id is not null and v.effective_date<=cutoff) then
  select b.quote||jsonb_build_object('unit',u,'source','食材價格表 · 已確認基準') into baseline from private.ingredient_standard_baselines b
  where b.store_id=s and b.product_id=product and b.unit=u and b.quote->>'basis'='confirmed_baseline'
   and (b.quote->>'price')::numeric>=0 and (b.quote->>'price')::numeric<1000000000
   and coalesce(nullif(b.quote->>'date','')::date,(b.captured_at at time zone 'Asia/Taipei')::date)<=cutoff;
  if baseline is not null then return baseline;end if;
 end if;
 -- Only absent receipt evidence can use an existing dated confirmed standard.
 if version.snapshot->>'review_status'='confirmed' and version.snapshot->>'cost_price' is not null then
  quote:=case when target_package is not null then coalesce(private.cost_purchase_price(version.snapshot->'purchase',target_package->>'unit'),
   case when version.snapshot->>'unit'=target_package->>'unit' then (version.snapshot->>'cost_price')::numeric end)*(target_package->>'quantity')::numeric
   when version.snapshot->>'unit'=target_unit then (version.snapshot->>'cost_price')::numeric*private.recipe_factor(u)
   else private.cost_purchase_price(version.snapshot->'purchase',u) end;
  if quote>=0 and quote<1000000000 then return jsonb_build_object('price',round(quote,6),'unit',u,'source','食材價格表 · 標準價','basis','standard',
   'date',case when version.effective_date>'0001-01-01'::date then version.effective_date end,'purchase',version.snapshot->'purchase');end if;
 end if;
 return jsonb_build_object('price',null,'unit',u,'reason','缺少已確認進價或單位換算');
end $$;
revoke all on function private.automatic_cost_quote(uuid,uuid,text,text,date,uuid) from public,anon,authenticated;

create or replace function private.inventory_price_quote(s uuid,product uuid,nm text,u text,cutoff date) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.automatic_cost_quote(s,product,nm,u,cutoff) $$;
create or replace function private.resolved_cost_quote(s uuid,product uuid,nm text,u text,at_date date) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.automatic_cost_quote(s,product,nm,u,coalesce(at_date,(now() at time zone 'Asia/Taipei')::date)) $$;
revoke all on function private.inventory_price_quote(uuid,uuid,text,text,date),private.resolved_cost_quote(uuid,uuid,text,text,date) from public,anon,authenticated;

-- Existing public gates and snapshot-preservation branches stay intact.
do $patch$
declare name text; src text;
begin
 foreach name in array array['private.waste_review_quote(uuid)','private.confirm_store_transfer(uuid,jsonb)',
  'private.transfers_workspace_v2(uuid,jsonb)','public.save_baihuayuan_sheet_row(uuid,text,uuid,jsonb,jsonb,uuid)',
  'private.ingredient_price_quote(uuid,uuid,text)'] loop
  src:=pg_get_functiondef(name::regprocedure);
  if strpos(src,'private.cost_quote(')=0 then raise exception 'AUTOMATIC_COST_OPERATION_ANCHOR: %',name;end if;
  execute replace(src,'private.cost_quote(','private.resolved_cost_quote(');
 end loop;
 src:=pg_get_functiondef('private.ingredient_supply_read(uuid)'::regprocedure);
 if strpos(src,'''supplier_id'',c.supplier_id')=0 then raise exception 'AUTOMATIC_COST_INGREDIENT_ANCHOR';end if;
 execute replace(src,'''supplier_id'',c.supplier_id',
  '''current_quote'',private.automatic_cost_quote(s,null,x.value->>''name'',x.value->>''unit'',(now() at time zone ''Asia/Taipei'')::date,(x.value->>''id'')::uuid),''supplier_id'',c.supplier_id');
end $patch$;

-- Trial quotes are deliberately separate from recipe_prices(), used by explicit
-- baseline saves and confirmations. Only identities/units actually used by this
-- store's recipes are resolved, including all nested preparation recipes.
create function private.recipe_current_prices(s uuid) returns jsonb
language plpgsql stable security invoker set search_path='' set jit=off as $$
declare result jsonb;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 with identities as materialized (
  select distinct case when nullif(l->>'ingredient_id','') is not null then 'i:'||(l->>'ingredient_id')
   when nullif(l->>'product_id','') is not null then 'p:'||(l->>'product_id') else 'n:'||lower(btrim(l->>'name')) end key,
   nullif(l->>'ingredient_id','')::uuid ingredient, nullif(l->>'product_id','')::uuid product,
   l->>'name' name,requested.unit
  from private.recipe_cards r cross join lateral jsonb_array_elements(r.document->'lines') l
  cross join lateral (select private.recipe_unit(l->>'unit') unit
    union select private.recipe_unit(private.recipe_note_basis(l,coalesce(r.document->>'notes',''))->>'countUnit')) requested
  where r.store_id=s and nullif(l->>'recipe_id','') is null and nullif(requested.unit,'') is not null
 ), quoted as materialized (
  select i.*,private.automatic_cost_quote(s,product,name,unit,(now() at time zone 'Asia/Taipei')::date,ingredient) q from identities i
 ) select coalesce(jsonb_agg(jsonb_build_object('key',key,'name',name,'product_id',product,'unit',unit,
   'price',q->'price','cost_price',q->'price','source',q->'source','source_kind',case when q->>'basis'='receipt' then 'purchase' else 'manual' end,
   'effective_date',q->'date','reference_id',q->'reference_id','reason',q->'reason',
   'source_ref',jsonb_build_object('ingredient_id',ingredient,'supplier_name',q->'supplier_name','batch_id',q->'batch_id','receipt_purchase',q->'purchase','specification',q->'specification'),
   'purchase',jsonb_build_object('amount',q->'price','quantity',1,'unit',unit)||
    case when private.recipe_unit(q#>>'{purchase,content_unit}')=unit and (q#>>'{purchase,content_quantity}')::numeric>0
     then jsonb_build_object('conversion_basis','package','content_unit',unit,'content_quantity',q#>'{purchase,content_quantity}') else '{}'::jsonb end) order by key,unit),'[]') into result from quoted;
 return result;
end $$;
revoke all on function private.recipe_current_prices(uuid) from public,anon,authenticated;

-- Reuse the tested recursive arithmetic and edible-yield semantics without
-- importing a transferred recipe's saved quotes into the latest-price trial.
do $clone$
declare src text;
begin
 src:=pg_get_functiondef('private.recipe_cost_indexed(uuid,jsonb,uuid[],jsonb)'::regprocedure);
 if strpos(src,'private.recipe_effective_prices(line,coalesce(price_index->item_key,''[]''::jsonb))')=0 then raise exception 'RECIPE_CURRENT_COST_ANCHOR';end if;
 src:=replace(src,'private.recipe_cost_indexed','private.recipe_current_cost_indexed');
 src:=replace(src,'piece:=price is not null;','piece:=price is not null and price->>''price'' is not null;');
 src:=replace(src,'private.recipe_effective_prices(line,coalesce(price_index->item_key,''[]''::jsonb))','coalesce(price_index->item_key,''[]''::jsonb)');
 src:=replace(src,'if price is null then reason:=''待補價格或換算'';','if price is null or price->>''price'' is null then reason:=coalesce(price->>''reason'',''待補價格或換算'');');
 execute src;
end $clone$;
revoke all on function private.recipe_current_cost_indexed(uuid,jsonb,uuid[],jsonb) from public,anon,authenticated;

create or replace function private.recipe_workspace_pricing(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare current_prices jsonb; idx jsonb; costs jsonb;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 current_prices:=private.recipe_current_prices(s);idx:=private.recipe_price_index(current_prices);
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'latest_cost',private.recipe_current_cost_indexed(s,r.document,array[r.id],idx),
  'latest_cost_at',(now() at time zone 'Asia/Taipei')::date) order by r.id),'[]') into costs from private.recipe_cards r where r.store_id=s;
 return jsonb_build_object('prices',private.recipe_prices(s),'pricing_loaded',true,'current_prices',current_prices,'latest_costs',costs);
end $$;
revoke all on function private.recipe_workspace_pricing(uuid) from public,anon;
grant execute on function private.recipe_workspace_pricing(uuid) to authenticated;
notify pgrst,'reload schema';
