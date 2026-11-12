-- Value open inventory at the latest usable confirmed price. Closed and
-- historical reports and explicitly saved monthly prices keep their snapshots.
create function private.inventory_known_standard(s uuid, product uuid, u text, cutoff date)
returns jsonb language sql stable set search_path='' set jit=off as $$
 with item as (
  select p.name,p.specification,private.recipe_unit(u) unit,
   coalesce(private.cost_package_measure(u,p.specification),private.cost_package_measure(u,p.name)) package
  from public.products p join public.stores st on st.organization_id=p.organization_id
  where st.id=s and st.is_active and p.id=product
 ), linked as materialized (
  select distinct coalesce(m.canonical_ingredient_id,m.id) id
  from private.ingredient_aliases a join private.ingredient_masters m on m.store_id=s and m.id=a.ingredient_id
  where a.store_id=s and a.source_key='p:'||product::text
 ), roots as materialized (
  select id from linked
  union
  select coalesce(m.canonical_ingredient_id,m.id)
  from item i join private.ingredient_masters m on m.store_id=s and private.cost_name_key(m.name)=private.cost_name_key(i.name)
  where not exists(select 1 from linked)
 ), versions as (
  select i.*,v.snapshot,v.effective_date,
   a.cost_mapping
  from item i cross join roots
  join lateral(
   select x.snapshot,x.effective_date from private.ingredient_standard_versions x
   where x.store_id=s and x.ingredient_id=roots.id and x.effective_date<=cutoff
   order by x.effective_date desc,x.created_at desc,x.id desc limit 1
  ) v on true
  left join lateral(
   select a.cost_mapping from private.ingredient_aliases a
   join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=s
   where a.store_id=s and a.corrected and a.source_key='p:'||product::text and a.source_unit=i.unit
    and a.cost_mapping is not null and coalesce(m.canonical_ingredient_id,m.id)=roots.id
    and nullif(v.snapshot->>'selected_reference','')::uuid=any(a.reference_ids)
   group by a.cost_mapping
  ) a on true
  where v.snapshot->>'review_status'='confirmed' and v.snapshot->>'cost_price' is not null
   and not exists(select 1 from private.ingredient_supply_state stop
    where stop.store_id=s and stop.ingredient_id=roots.id and stop.supplier_key='*' and stop.stopped)
 ), priced as (
  select effective_date,snapshot,round(case
   when cost_mapping is not null then private.cost_purchase_price(snapshot->'purchase',cost_mapping->>'unit')
    *(cost_mapping->>'quantity')::numeric*private.recipe_factor(u)/private.recipe_factor(cost_mapping->>'target_unit')
   when package is not null then coalesce(
    private.cost_purchase_price(snapshot->'purchase',package->>'unit'),
    case when snapshot->>'unit'=package->>'unit' then (snapshot->>'cost_price')::numeric end
   )*(package->>'quantity')::numeric
   when snapshot->>'unit'=unit and (
    unit not in ('包','瓶','罐','盒','袋','桶','箱','打','組','塊','條')
    or (select count(*) from roots)=1
   ) then (snapshot->>'cost_price')::numeric*private.recipe_factor(u)
   when unit not in ('包','瓶','罐','盒','袋','桶','箱','打','組','塊','條')
    then private.cost_purchase_price(snapshot->'purchase',u)
  end,6) price
  from versions
 ), usable as (
  select * from priced where price>=0 and price<1000000000
 ), selected as (
  select price,effective_date,snapshot from usable
  where (select count(distinct price) from usable)=1
  order by effective_date desc,snapshot->>'selected_reference' nulls last limit 1
 )
 select jsonb_build_object('price',price,'unit',u,'basis','standard','source','食材價格表 · 確認進價',
  'date',nullif(effective_date,date '0001-01-01'),'reference_id',snapshot->>'selected_reference')
 from selected
$$;
revoke all on function private.inventory_known_standard(uuid,uuid,text,date) from public,anon,authenticated;

create function private.inventory_latest_price_quote(s uuid,product uuid,nm text,u text,cutoff date)
returns jsonb language plpgsql stable security invoker set search_path='' set jit=off as $$
declare quote jsonb; known jsonb; price_date date;
begin
 if cutoff is null then return private.automatic_cost_quote(s,product,nm,u,cutoff);end if;
 price_date:=(statement_timestamp() at time zone 'Asia/Taipei')::date;
 quote:=private.automatic_cost_quote(s,product,nm,u,price_date);
 if product is null or quote->>'price' is not null or quote->>'reason' not in
  ('缺少已確認進價或單位換算','同名有不同品項或規格，待確認對應','最新進貨缺少已確認的規格或單位換算') then
  return quote;
 end if;
 -- Preserve an explicit per-product count-unit baseline when the catalog
 -- has multiple possible identities. Only equivalent units qualify.
 select b.quote||jsonb_build_object('unit',u,'source','食材價格表 · 已確認基準') into known
 from private.ingredient_standard_baselines b
 where b.store_id=s and b.product_id=product
  and b.quote->>'basis'='confirmed_baseline' and (b.quote->>'price')::numeric>=0
  and (b.quote->>'price')::numeric<1000000000
  and private.recipe_unit(b.unit)=private.recipe_unit(u) and private.recipe_factor(b.unit)=private.recipe_factor(u)
  and coalesce(nullif(b.quote->>'date','')::date,(b.captured_at at time zone 'Asia/Taipei')::date)<=price_date
  and not exists(select 1 from private.ingredient_aliases a
   join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=s
   join private.ingredient_supply_state st on st.store_id=s and st.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)
   where a.store_id=s and a.source_key='p:'||product::text and st.supplier_key='*' and st.stopped)
 order by coalesce(nullif(b.quote->>'date','')::date,(b.captured_at at time zone 'Asia/Taipei')::date) desc,
  (b.unit=u) desc,b.unit
 limit 1;
 -- A verified standard remains usable when a new invoice cannot be converted.
 -- Multiple candidate standards can only fill the price if the usable values agree.
 return coalesce(known,private.inventory_known_standard(s,product,u,price_date),quote);
end
$$;

revoke all on function private.inventory_latest_price_quote(uuid,uuid,text,text,date) from public,anon,authenticated;

-- Use the same live basis in the open report, the explicit price lookup and
-- the guarded automatic-unit save. Other as-of callers retain their cutoff.
do $patch$
declare signature text; source text;
begin
 foreach signature in array array[
  'private.inventory_month_state(uuid,date,uuid)',
  'public.baihuayuan_cost_quotes(uuid,jsonb)',
  'public.save_baihuayuan_inventory_inline_v3(uuid,date,uuid,text,jsonb,text,text,numeric,numeric,text)'
 ] loop
  source:=pg_get_functiondef(signature::regprocedure);
  if strpos(source,'private.inventory_price_quote(')=0 then
   raise exception 'INVENTORY_LATEST_PRICE_ANCHOR: %',signature;
  end if;
  execute replace(source,'private.inventory_price_quote(','private.inventory_latest_price_quote(');
 end loop;
end
$patch$;

-- Compare raw purchase units and specifications before publishing a changed quote.
create function public.baihuayuan_receipt_price_changes(p_store_id uuid,p_batch_id uuid,p_data jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare received_on date; wanted_supplier text;
begin
 if auth.uid() is null or not coalesce(private.can_review_receipt(p_batch_id),false) or not exists(
  select 1 from public.receipt_upload_batches b where b.id=p_batch_id and b.store_id=p_store_id
 ) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 if jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines')>500 then
  raise exception 'INVALID_RECEIPT_LINE' using errcode='22023';end if;
 if not pg_input_is_valid(p_data#>>'{header,receipt_date}','date') then return '[]'::jsonb;end if;
 received_on:=(p_data#>>'{header,receipt_date}')::date;
 wanted_supplier:=lower(btrim(normalize(p_data#>>'{header,supplier_name}',NFKC)));
 if coalesce(wanted_supplier,'')='' then return '[]'::jsonb;end if;
 return (
  with lines as materialized (
   select line->>'row_key' row_key,btrim(line->>'product_name') name,btrim(line->>'unit') unit,
    lower(btrim(normalize(coalesce(line->>'specification',''),NFKC))) spec,
    (line->>'unit_price')::numeric next_price, ordinal,
    case when pg_input_is_valid(line->>'ingredient_id','uuid') then (line->>'ingredient_id')::uuid end ingredient_id
   from jsonb_array_elements(p_data->'lines') with ordinality as item(line,ordinal)
   where coalesce(line->>'handling','NORMAL')='NORMAL' and jsonb_typeof(line->'unit_price')='number'
    and coalesce(btrim(line->>'product_name'),'')<>'' and coalesce(btrim(line->>'unit'),'')<>''
  ), history as materialized (
   select h.*,p.name,lower(btrim(normalize(coalesce(h.specification,''),NFKC))) spec
   from private.live_ingredient_receipt_prices h join public.products p on p.id=h.product_id
   where h.store_id=p_store_id and h.effective_date<=received_on and h.price>=0 and h.price<1000000000
    and lower(btrim(normalize(h.supplier,NFKC)))=wanted_supplier
  ), compared as (
   select l.*,coalesce(prior.price,standard.price) previous_price
   from lines l
   left join lateral(
    select min(r.price) price
    from (
     select h.price,dense_rank() over(order by (h.batch_id=p_batch_id) desc,h.effective_date desc) rank
     from history h
     where (h.batch_id<>p_batch_id or h.row_key=l.row_key)
      and (case when l.ingredient_id is null then lower(btrim(normalize(h.name,NFKC)))=lower(btrim(normalize(l.name,NFKC))) else exists(
       select 1 from private.ingredient_aliases a join private.ingredient_masters m on m.store_id=p_store_id and m.id=a.ingredient_id
       where a.store_id=p_store_id and a.source_key='p:'||h.product_id::text
        and coalesce(m.canonical_ingredient_id,m.id)=(select coalesce(i.canonical_ingredient_id,i.id) from private.ingredient_masters i where i.id=l.ingredient_id and i.store_id=p_store_id)
      ) end)
      and private.recipe_unit(h.unit)=private.recipe_unit(l.unit)
      and private.recipe_factor(h.unit)=private.recipe_factor(l.unit) and h.spec=l.spec
    ) r where r.rank=1
    having count(distinct r.price)=1
   ) prior on true
   left join lateral(
    select (v.purchase->>'amount')::numeric/(v.purchase->>'quantity')::numeric price
    from (
     select x.snapshot->'purchase' purchase,x.snapshot->>'review_status' status
     from private.ingredient_standard_versions x
     where x.store_id=p_store_id and x.ingredient_id=l.ingredient_id and x.effective_date<=received_on
     order by x.effective_date desc,x.created_at desc,x.id desc limit 1
    ) v
    where v.status='confirmed' and jsonb_typeof(v.purchase->'amount')='number' and (v.purchase->>'amount')::numeric>=0
     and jsonb_typeof(v.purchase->'quantity')='number' and (v.purchase->>'quantity')::numeric>0
     and private.recipe_unit(v.purchase->>'unit')=private.recipe_unit(l.unit)
     and private.recipe_factor(v.purchase->>'unit')=private.recipe_factor(l.unit)
     and (
      (l.spec='' and l.unit not in ('包','瓶','罐','盒','袋','桶','箱','打','組','塊','條')
       and private.inventory_package_measure(v.purchase,l.unit,null) is null)
      or (private.cost_package_measure(l.unit,l.spec) is not null
       and private.cost_package_measure(l.unit,l.spec)=private.inventory_package_measure(v.purchase,l.unit,null))
     )
   ) standard on prior.price is null
   where l.next_price>=0 and l.next_price<1000000000
  )
  select coalesce(jsonb_agg(jsonb_build_object('name',name,'unit',unit,'before',previous_price,'after',next_price) order by ordinal),'[]'::jsonb)
  from compared where round(previous_price,4)<>round(next_price,4)
 );
end
$$;
revoke all on function public.baihuayuan_receipt_price_changes(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.baihuayuan_receipt_price_changes(uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
