-- A confirmed, product-specific count-unit baseline can include a reviewed
-- pack split that the generic ingredient standard does not describe.
do $patch$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.inventory_price_quote(uuid,uuid,text,text,date)'::regprocedure);
 anchor:=' if ambiguous then return';
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_BASELINE_ANCHOR';end if;
 src:=replace(src,'selected record;','selected record; baseline jsonb;');
 src:=replace(src,anchor,$new$
 if product is not null
  and not exists(select 1 from private.ingredient_standard_versions v
   where v.store_id=s and v.ingredient_id=any(ids) and v.actor_id is not null and v.effective_date<=cutoff)
  and not exists(select 1 from private.ingredient_supply_state st
   where st.store_id=s and st.ingredient_id=any(ids) and st.supplier_key='*' and st.stopped) then
  select jsonb_build_object('price',(b.quote->>'price')::numeric,'source','食材價格表 · 已確認基準',
    'date',b.quote->>'date','basis','confirmed_baseline','unit',u) into baseline
  from private.ingredient_standard_baselines b
  where b.store_id=s and b.product_id=product and b.unit=u
   and b.quote->>'basis'='confirmed_baseline' and (b.quote->>'price')::numeric>=0
   and coalesce(nullif(b.quote->>'date','')::date,(b.captured_at at time zone 'Asia/Taipei')::date)<=cutoff;
  if baseline is not null then return baseline;end if;
 end if;

$new$||anchor);
 execute src;
end $patch$;

-- Older posted receipts can predate the price projection. Read those verified
-- line snapshots directly, with the same store and record-state restrictions.
do $patch$
declare base text; read_definition text; anchor text;
begin
 base:=rtrim(pg_get_viewdef('private.live_ingredient_receipt_prices'::regclass), E'; \n');
 execute 'create or replace view private.live_ingredient_receipt_prices with (security_invoker=true) as '||base||$posted$
 union all
 select l.id,b.store_id,l.product_id,coalesce(g.receipt_date,b.work_date),coalesce(g.reviewed_at,l.modified_at,l.created_at),
  l.unit,l.unit_price_ex_tax,b.id,coalesce(nullif(l.source_row_key,''),'line-'||l.id::text),coalesce(sp.name,''),
  coalesce(l.specification,''),jsonb_strip_nulls(jsonb_build_object('amount',l.unit_price_ex_tax,'quantity',1,'unit',l.unit,
   'content_quantity',measure.value->'quantity','content_unit',measure.value->'unit'))
 from public.receipt_lines l
 join public.goods_receipts g on g.id=l.receipt_id
 join public.receipt_upload_batches b on b.id=g.source_batch_id and b.store_id=g.store_id
 left join public.suppliers sp on sp.id=coalesce(l.supplier_id,g.supplier_id) and sp.organization_id=b.organization_id
 cross join lateral (select private.cost_package_measure(l.unit,l.specification) value) measure
 where b.status::text='COMPLETED' and g.reviewed_at is not null and l.product_id is not null
  and l.quantity>0 and l.unit_price_ex_tax>=0 and l.unit_price_ex_tax<1000000000 and nullif(btrim(l.unit),'') is not null
  and coalesce(l.human_correction->>'handling','NORMAL')='NORMAL'
  and coalesce(l.human_correction->>'product_name','') !~ '^(其他)?(運費|運送費|配送費|宅配費)([（(].*[）)])?$'
  and not exists(select 1 from private.recipe_price_entries r where r.store_id=b.store_id and
   r.source_key='receipt:'||b.id||':'||coalesce(nullif(l.source_row_key,''),'line-'||l.id::text))
  and not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=b.id)
  and not exists(select 1 from private.baihuayuan_record_flags f where f.store_id=b.store_id
   and f.entity_type='RECEIPT_BATCH' and f.entity_id=b.id and f.state<>'LIVE')
 $posted$;

 read_definition:=pg_get_functiondef('private.ingredient_supply_read(uuid)'::regprocedure);
 anchor:='where a.store_id=s';
 if strpos(read_definition,anchor)=0 then raise exception 'INGREDIENT_POSTED_HISTORY_ANCHOR';end if;
 execute replace(read_definition,anchor,$new$where a.store_id=s
 union
 select a.ingredient_id,l.id,p.name,private.recipe_unit(l.unit),null::numeric,
  false,l.purchase,'已核對進貨明細','purchase','confirmed',l.effective_date,l.created_at,
  jsonb_build_object('batch_id',l.batch_id,'row_key',l.row_key,'specification',l.specification),
  l.price,l.unit,l.purchase,l.supplier,'',l.supplier
 from private.live_ingredient_receipt_prices l
 join public.products p on p.id=l.product_id
 join private.ingredient_aliases a on a.store_id=l.store_id and a.source_key='p:'||l.product_id
  and a.source_unit=private.recipe_unit(l.unit) and a.specification=l.specification
 where l.store_id=s and not exists(select 1 from private.recipe_price_entries r where r.id=l.id)$new$);
end $patch$;
revoke all on private.live_ingredient_receipt_prices from public,anon,authenticated;
notify pgrst,'reload schema';
