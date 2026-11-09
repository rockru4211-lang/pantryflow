-- Read verified receipt prices separately from saved standards and recipe costs.
create view private.live_ingredient_receipt_prices with (security_invoker=true) as
select r.id,r.store_id,r.product_id,r.effective_date,r.created_at,r.unit,r.price,
 b.id as batch_id,r.source_ref->>'row_key' as row_key,
 coalesce(sp.name,r.source_ref->>'supplier_name','') as supplier,
 coalesce(nullif(btrim(r.source_ref->>'specification'),''),'') as specification,
 case when measure.value is null then coalesce(r.purchase,jsonb_build_object('amount',r.price,'quantity',1,'unit',r.unit))
 else jsonb_build_object('amount',r.price,'quantity',1,'unit',r.unit,'content_quantity',measure.value->'quantity','content_unit',measure.value->'unit') end as purchase
from private.recipe_price_entries r
join public.receipt_upload_batches b on b.id=(case when pg_input_is_valid(r.source_ref->>'batch_id','uuid') then (r.source_ref->>'batch_id')::uuid end) and b.store_id=r.store_id
left join public.suppliers sp on sp.id=(case when pg_input_is_valid(r.source_ref->>'supplier_id','uuid') then (r.source_ref->>'supplier_id')::uuid end) and sp.organization_id=b.organization_id
left join private.receipt_entry_items i on i.batch_id=b.id and i.row_key=r.source_ref->>'row_key'
cross join lateral (select private.cost_package_measure(r.unit,concat_ws(' ',nullif(r.source_ref->>'specification',''),case when nullif(r.source_ref->>'specification','') is null then r.name end)) value) measure
where r.source_key like 'receipt:%' and r.source_kind='purchase' and r.review_status='confirmed'
 and r.effective_date is not null and r.price>=0 and r.price<1000000000 and coalesce(r.source_ref->>'missing_price','false')<>'true'
 and not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=b.id)
 and not exists(select 1 from private.baihuayuan_record_flags f where f.store_id=b.store_id and f.entity_type='RECEIPT_BATCH' and f.entity_id=b.id and f.state<>'LIVE')
 and case when i.batch_id is not null then i.retired_at is null and i.product_id=r.product_id and i.unit=r.unit
       and i.unit_price=r.price and i.receipt_date=r.effective_date
      when b.status::text='COMPLETED' then true
      else exists(select 1 from private.receipt_review_saves v
        where v.ocr_run_id=(case when pg_input_is_valid(r.source_ref->>'run_id','uuid') then (r.source_ref->>'run_id')::uuid end) and v.row_key=r.source_ref->>'row_key') end;
revoke all on private.live_ingredient_receipt_prices from public,anon,authenticated;

create function private.inventory_package_measure(p jsonb,u text,nm text) returns jsonb
language sql immutable set search_path='' as $$
 select case
 when private.recipe_unit(p->>'unit')=private.recipe_unit(u) and jsonb_typeof(p->'content_quantity')='number'
  and (p->>'content_quantity')::numeric>0 and private.recipe_unit(p->>'content_unit') in ('g','ml','顆')
 then jsonb_build_object('quantity',(p->>'content_quantity')::numeric*private.recipe_factor(p->>'content_unit'),'unit',private.recipe_unit(p->>'content_unit'))
 else private.cost_package_measure(u,nm) end
$$;
revoke all on function private.inventory_package_measure(jsonb,text,text) from public,anon,authenticated;

create function private.inventory_price_quote(s uuid, product uuid, nm text, u text, cutoff date) returns jsonb
language plpgsql stable set search_path='' set jit=off set plan_cache_mode=force_custom_plan as $$
declare org uuid; product_spec text; ids uuid[]; root uuid; local_master private.ingredient_masters;
  selected record; target_package jsonb; version record; quote numeric; ambiguous boolean:=false;
  target_unit text:=private.recipe_unit(u);
begin
 if cutoff is null or nullif(btrim(u),'') is null then return jsonb_build_object('price',null,'reason','待確認盤點日或計價單位');end if;
 select organization_id into org from public.stores where id=s and is_active and name in ('BeApe','Gras');
 if org is null then return jsonb_build_object('price',null,'reason','尚未找到此門市');end if;
 if product is not null then
  select p.name,p.specification into nm,product_spec from public.products p where p.id=product and p.organization_id=org;
 end if;
 if nullif(btrim(nm),'') is null then return jsonb_build_object('price',null,'reason','名稱尚未完成對應');end if;

 select array_agg(distinct coalesce(m.canonical_ingredient_id,m.id)) into ids
 from private.ingredient_aliases a join private.ingredient_masters m on m.id=a.ingredient_id
 where a.store_id=s and a.source_key='p:'||product::text;
 if coalesce(cardinality(ids),0)=0 then
  select array_agg(distinct coalesce(m.canonical_ingredient_id,m.id)) into ids
  from private.ingredient_masters m where m.store_id=s and (
   private.cost_name_key(m.name)=private.cost_name_key(nm) or exists(
    select 1 from private.ingredient_aliases a where a.ingredient_id=m.id and a.store_id=s
     and a.corrected and private.cost_name_key(a.name)=private.cost_name_key(nm)));
 end if;
 ambiguous:=coalesce(cardinality(ids),0)>1;
 if cardinality(ids)=1 then
  root:=ids[1];
  select * into local_master from private.ingredient_masters where id=root;
 end if;
 target_package:=private.inventory_package_measure(local_master.purchase,u,coalesce(nullif(product_spec,''),nm));
 -- A product's explicit packaging takes precedence over the standard's chosen pack.
 target_package:=coalesce(private.cost_package_measure(u,product_spec),target_package);

 with allowed_peers as materialized (
   select id from public.stores where organization_id=org and id<>s and is_active
     and name in ('BeApe','Gras') and private.recipe_allowed(id)
 ), scopes as materialized (
   select m.id,m.store_id from private.ingredient_masters m
   where m.store_id=s and (m.id=root or m.canonical_ingredient_id=root)
   union all
   select m.id,m.store_id
   from private.ingredient_code_links l
   join private.ingredient_masters peer on peer.id=case when l.ingredient_id=root then l.target_id else l.ingredient_id end
   join allowed_peers st on st.id=peer.store_id
   join private.ingredient_masters m on m.store_id=peer.store_id and (m.id=peer.id or m.canonical_ingredient_id=peer.id)
   where l.ingredient_id=root or l.target_id=root
 ), refs as materialized (
   select distinct scoped.store_id,unnest(a.reference_ids) as id
   from scopes scoped join private.ingredient_aliases a on a.ingredient_id=scoped.id and a.store_id=scoped.store_id
   union
   select scoped.store_id,m.selected_reference from scopes scoped join private.ingredient_masters m on m.id=scoped.id
 ), available as (
   select r.* from private.live_ingredient_receipt_prices r where r.product_id=product and r.effective_date<=cutoff
    and (r.store_id=s or r.store_id in (select id from allowed_peers))
   union
   select r.* from refs join private.live_ingredient_receipt_prices r on r.id=refs.id and r.store_id=refs.store_id where r.effective_date<=cutoff
 ), measures as (
   select r.*,private.recipe_unit(r.unit) receipt_unit,private.inventory_package_measure(r.purchase,r.unit,null) package
   from available r
 ), comparable as (
   select m.*,round(case
    when m.receipt_unit=target_unit and (m.store_id<>s or m.product_id is distinct from product or m.package is not null)
      and target_unit in ('包','瓶','罐','盒','袋','桶','箱','打','組','塊','條')
      and (m.package is null or target_package is null or m.package<>target_package)
     then null
    when target_package is not null and m.receipt_unit<>target_unit
     then private.cost_purchase_price(m.purchase,target_package->>'unit')*(target_package->>'quantity')::numeric
    else private.cost_purchase_price(m.purchase,u)
   end,6) as value from measures m
 ), ranked as (
   select *,dense_rank() over(order by (store_id=s) desc,effective_date desc) priority
   from comparable where value>=0 and value<1000000000
 )
 select count(distinct value) price_count,(array_agg(to_jsonb(r) order by created_at desc,id))[1] latest
 into selected from ranked r where priority=1;
 if selected.price_count>1 then return jsonb_build_object('price',null,'reason','同日有不同的已確認進價，待核對');end if;
 if selected.price_count=1 then
  return jsonb_build_object('price',selected.latest->'value','date',selected.latest->'effective_date',
   'source',concat_ws(' · ',case when selected.latest->>'store_id'=s::text then '本店進貨' else '另一店進貨' end,nullif(selected.latest->>'supplier','')),
   'basis','receipt','batch_id',selected.latest->'batch_id','store_id',selected.latest->'store_id','unit',u);
 end if;

 if ambiguous then return jsonb_build_object('price',null,'reason','同名有不同品項或規格，待確認對應');end if;
 if root is null then return jsonb_build_object('price',null,'reason','名稱尚未完成對應');end if;
 select v.snapshot,v.effective_date into version
 from private.ingredient_standard_versions v
 where v.store_id=s and v.ingredient_id=root and v.effective_date<=cutoff
 order by v.effective_date desc,v.created_at desc,v.id desc limit 1;
 if version.snapshot->>'review_status'='confirmed' and version.snapshot->>'cost_price' is not null
  and not exists(select 1 from private.ingredient_supply_state st where st.store_id=s and st.ingredient_id=root and st.supplier_key='*' and st.stopped) then
  quote:=case
   when target_package is not null then coalesce(
    private.cost_purchase_price(version.snapshot->'purchase',target_package->>'unit'),
    case when version.snapshot->>'unit'=target_package->>'unit' then (version.snapshot->>'cost_price')::numeric end
   )*(target_package->>'quantity')::numeric
   when version.snapshot->>'unit'=target_unit then (version.snapshot->>'cost_price')::numeric*private.recipe_factor(u)
   else private.cost_purchase_price(version.snapshot->'purchase',u) end;
  if quote>=0 and quote<1000000000 then
   return jsonb_build_object('price',round(quote,6),'source','食材價格表 · 標準價',
    'date',case when version.effective_date>'0001-01-01'::date then version.effective_date end,'basis','standard','unit',u);
  end if;
 end if;
 return jsonb_build_object('price',null,'reason','缺少已確認進價或單位換算');
end $$;
revoke all on function private.inventory_price_quote(uuid,uuid,text,text,date) from public,anon,authenticated;

-- Use the same valuation in the report, exports and the closure snapshot.
do $patch$
declare src text; anchor text; replacement text;
begin
 src:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
 anchor:=$old$private.cost_quote(p_store,nullif(c->>'product_id','')::uuid,c->>'name',c->>'unit',(p_month+interval '1 month - 1 day')::date)$old$;
 replacement:=$new$case when not historical and c->>'quantity' is not null
   then private.inventory_price_quote(p_store,nullif(c->>'product_id','')::uuid,c->>'name',c->>'unit',valuation_date) end$new$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_VALUATION_ANCHOR';end if;
 src:=replace(src,anchor,replacement);
 anchor:='with paired as (';
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_COUNT_DATE_ANCHOR';end if;
 src:=replace(src,'declare ','declare valuation_date date; ');
 src:=replace(src,anchor,'valuation_date:=private.inventory_count_date(source.id); '||anchor);
 src:=replace(src,$old$coalesce((x.cost_quote->>'price')::numeric,(x.c->>'unit_price')::numeric)$old$,
   $new$case when historical then (x.c->>'unit_price')::numeric else (x.cost_quote->>'price')::numeric end$new$);
 src:=replace(src,$old$'unit_price',v.price,'amount',round(v.qty*v.price,2)$old$,
   $new$'price_is_automatic',not historical and not coalesce(v.price_set,false),
   'price_batch_id',case when not coalesce(v.price_set,false) then v.cost_quote->>'batch_id' end,
   'price_store_id',case when not coalesce(v.price_set,false) then v.cost_quote->>'store_id' end,
   'unit_price',v.price,'amount',case when not historical and v.qty=0 then 0 else round(v.qty*v.price,2) end$new$);
 src:=replace(src,$old$v.qty is not null and v.price is null$old$,$new$v.qty is not null and (historical or v.qty<>0) and v.price is null$new$);
 execute src;

 src:=pg_get_functiondef('public.save_baihuayuan_inventory_inline_v3(uuid,date,uuid,text,jsonb,text,text,numeric,numeric,text)'::regprocedure);
 anchor:='update private.inventory_month_reviews set report_unit=';
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_INLINE_PRICE_ANCHOR';end if;
 src:=replace(src,'declare state','declare preserve_auto boolean; state');
 src:=replace(src,'result:=public.save_baihuayuan_inventory_inline_v2',$new$preserve_auto:=coalesce((r->>'price_is_automatic')::boolean,false)
  and (r->>'unit_price')::numeric is not distinct from p_unit_price and r->>'unit'=btrim(p_unit);
 result:=public.save_baihuayuan_inventory_inline_v2$new$);
 execute replace(src,anchor,$new$update private.inventory_month_reviews set
  price_set=case when preserve_auto then false else price_set end,
  unit_price=case when preserve_auto then null else unit_price end, report_unit=$new$);

 src:=pg_get_functiondef('public.baihuayuan_cost_quotes(uuid,jsonb)'::regprocedure);
 -- pg_get_functiondef retains the PL/pgSQL body spelling from the original migration.
 anchor:=$old$private.resolved_cost_quote(source_store,nullif(item->>'product_id','')::uuid,item->>'name',item->>'unit',nullif(item->>'date','')::date)$old$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_QUOTE_RPC_ANCHOR';end if;
 execute replace(src,anchor,$new$case when item->>'purpose'='inventory' then
   private.inventory_price_quote(source_store,nullif(item->>'product_id','')::uuid,item->>'name',item->>'unit',nullif(item->>'date','')::date)
   else $new$||anchor||' end');

 src:=pg_get_functiondef('private.ingredient_supply_read(uuid)'::regprocedure);
 anchor:=$old$r.source_ref,$old$;
 if strpos(src,anchor)=0 or strpos(src,'where a.store_id=s')=0 then raise exception 'INGREDIENT_RECEIPT_DETAILS_ANCHOR';end if;
 src:=replace(src,anchor,$new$r.source_ref,live.price as receipt_price,live.unit as receipt_unit,live.purchase as receipt_purchase,live.supplier as receipt_supplier,$new$);
 src:=replace(src,'where a.store_id=s','left join private.live_ingredient_receipt_prices live on live.id=r.id and live.store_id=s where a.store_id=s');
 execute src;
end $patch$;

-- Preserve both records while attaching a reviewed duplicate to its main code.
create function private.merge_ingredient_price_duplicate(s uuid, source_id uuid, target_id uuid, target_revision integer)
returns jsonb language plpgsql set search_path='' as $$
declare source private.ingredient_masters; target private.ingredient_masters;
begin
 select * into source from private.ingredient_masters where store_id=s and id=source_id for update;
 select * into target from private.ingredient_masters where store_id=s and id=target_id for update;
 if source.id is null or target.id is null or source.id=target.id then raise exception 'INVALID_INGREDIENT_DUPLICATE' using errcode='22023';end if;
 if target.revision is distinct from target_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 if source.canonical_ingredient_id is not null or target.canonical_ingredient_id is not null
  or exists(select 1 from private.ingredient_masters m where m.canonical_ingredient_id=source.id)
  or exists(select 1 from private.ingredient_code_links l where source.id in (l.ingredient_id,l.target_id))
  or exists(select 1 from private.ingredient_supply_state st where st.store_id=s and st.ingredient_id in(source.id,target.id) and st.supplier_key='*' and st.stopped)
 then raise exception 'INGREDIENT_DUPLICATE_LINK_CONFLICT' using errcode='22023';end if;
 if private.recipe_unit(coalesce(source.purchase->>'unit',source.unit)) is distinct from private.recipe_unit(coalesce(target.purchase->>'unit',target.unit))
  or (source.category is not null and target.category is not null and source.category<>'待分類' and target.category<>'待分類' and source.category<>target.category)
 then raise exception 'INVALID_INGREDIENT_DUPLICATE' using errcode='22023';end if;
 update private.ingredient_masters set canonical_ingredient_id=target.id,revision=revision+1 where id=source.id;
 return jsonb_build_object('id',source.id,'target_id',target.id);
end $$;
revoke all on function private.merge_ingredient_price_duplicate(uuid,uuid,uuid,integer) from public,anon,authenticated;

do $patch$
declare src text; anchor text:='elsif p_action=''supply_note'' then';
begin
 src:=pg_get_functiondef('public.baihuayuan_ingredient_prices(uuid,text,jsonb,uuid)'::regprocedure);
 if strpos(src,anchor)=0 then raise exception 'INGREDIENT_DUPLICATE_ACTION_ANCHOR';end if;
 execute replace(src,anchor,$new$elsif p_action='merge_duplicate' then
 result:=private.merge_ingredient_price_duplicate(p_store_id,m.id,nullif(p_data->>'target_id','')::uuid,(p_data->>'target_revision')::integer);
 $new$||anchor);
end $patch$;
notify pgrst,'reload schema';
