-- Count-specific valuation and evidence. Keep receipt prices and closed reports intact.
create table private.inventory_unit_conversions (
 store_id uuid not null references public.stores(id),
 product_id uuid not null references public.products(id),
 supplier_key text not null,
 specification_key text not null,
 purchase_unit text not null,
 count_unit text not null,
 effective_date date not null,
 count_per_purchase_unit numeric not null check(count_per_purchase_unit>0 and count_per_purchase_unit<1000000000),
 primary key(store_id,product_id,supplier_key,specification_key,purchase_unit,count_unit,effective_date)
);
alter table private.inventory_unit_conversions enable row level security;
revoke all on private.inventory_unit_conversions from public,anon,authenticated;

alter table private.inventory_month_reviews add column purchase_evidence jsonb;

create function private.inventory_supplier_key(org uuid, supplier text) returns text
language sql stable set search_path='' as $$
 select case when coalesce(private.history_key(supplier),'') not in ('','未提供','供應商待確認')
  then coalesce('id:'||private.supplier_identity(org,supplier),'name:'||private.history_key(supplier)) end
$$;

create function private.inventory_spec_key(spec text) returns text
language sql immutable set search_path='' as $$
 select coalesce(private.history_key(spec),'')
$$;

create function private.inventory_rate_unit(u text) returns text
language sql immutable set search_path='' as $$
 select private.recipe_unit(u)||':'||private.recipe_factor(u)::text
$$;

create function private.inventory_apply_conversion(s uuid, product uuid, u text, cutoff date, q jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare rate numeric; converted numeric; raw jsonb:=q->'purchase';
begin
 if jsonb_typeof(raw) is distinct from 'object' or q->>'price' is not null
  or q->>'batch_id' is null then return q;end if;
 select c.count_per_purchase_unit into rate from private.inventory_unit_conversions c
 join public.stores shop on shop.id=c.store_id
 where c.store_id=s and c.product_id=product
  and c.supplier_key=private.inventory_supplier_key(shop.organization_id,q->>'supplier_name')
  and c.specification_key=private.inventory_spec_key(q->>'specification')
  and c.purchase_unit=private.inventory_rate_unit(raw->>'unit') and c.count_unit=private.inventory_rate_unit(u) and c.effective_date<=cutoff
 order by c.effective_date desc limit 1;
 converted:=private.cost_purchase_price(raw,raw->>'unit')/rate;
 if converted>=0 and converted<1000000000 then
  return (q-'reason')||jsonb_build_object('price',round(converted,10),'conversion_rate',rate);
 end if;
 return q;
end
$$;

-- Reuse the receipt resolver's authorization boundaries, package logic and price
-- evidence in a separate inventory overload. Other cost consumers retain theirs.
do $patch$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.automatic_cost_quote(uuid,uuid,text,text,date,uuid)'::regprocedure);
 anchor:='ingredient uuid DEFAULT NULL::uuid)';
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_SCOPED_SIGNATURE';end if;
 src:=replace(src,'private.automatic_cost_quote(','private.inventory_scoped_cost_quote(');
 src:=replace(src,anchor,'ingredient uuid, wanted_supplier text)');
 anchor:='  return private.locked_ingredient_quote(';
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_SCOPED_LOCK';end if;
 src:=replace(src,$old$if version.reason='鎖定進價' and version.snapshot->$old$,$new$if version.reason='鎖定進價'
  and (private.inventory_supplier_key(org,wanted_supplier) is null or private.inventory_supplier_key(org,version.supplier_name)=private.inventory_supplier_key(org,wanted_supplier))
  and version.snapshot->$new$);
 anchor:=$old$   and not exists(select 1 from private.ingredient_supply_state st where st.store_id=s and st.ingredient_id=root and st.stopped$old$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_SCOPED_RECEIPTS';end if;
 src:=replace(src,anchor,$new$   and (private.inventory_supplier_key(org,wanted_supplier) is null or
    private.inventory_supplier_key(org,r.supplier)=private.inventory_supplier_key(org,wanted_supplier))
   and (private.inventory_spec_key(specs)='' or private.inventory_spec_key(r.specification)=''
    or private.inventory_spec_key(specs)=private.inventory_spec_key(r.specification)
    or private.cost_package_measure(r.unit,specs)=private.cost_package_measure(r.unit,r.specification))
$new$||anchor);
 anchor:=$old$  count(distinct value) distinct_prices,(array_agg(to_jsonb(c) order by created_at desc,id))[1] latest into selected from converted c;$old$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_SCOPED_CONFLICT';end if;
 src:=replace(src,anchor,$new$  count(distinct value) distinct_prices,count(distinct c.purchase) distinct_quotations,
  count(distinct jsonb_build_array(private.inventory_supplier_key(org,c.supplier),private.inventory_spec_key(c.specification))) distinct_offers,
  (array_agg(to_jsonb(c) order by created_at desc,id))[1] latest into selected from converted c;$new$);
 src:=replace(src,' if selected.n>0 then',' if selected.n>0 then'||chr(10)||
  $new$  if selected.distinct_offers<>1 then
   return jsonb_build_object('price',null,'reason','同日有不同供應商或規格，待核對','basis','receipt','date',selected.latest->'effective_date');
  end if;$new$);
 src:=replace(src,'case when selected.n=1 then jsonb_build_object(',
  'case when selected.distinct_quotations=1 and selected.latest->>''price'' is not null then jsonb_build_object(');
 -- A stored untied baseline is usable only when the count has no supplier.
 anchor:=$old$ if product is not null and not exists(select 1 from private.ingredient_standard_versions v where v.store_id=s and v.ingredient_id=root and v.actor_id is not null and v.effective_date<=cutoff) then$old$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_SCOPED_BASELINE';end if;
 src:=replace(src,anchor,replace(anchor,'if product is not null and','if product is not null and private.inventory_supplier_key(org,wanted_supplier) is null and'));
 anchor:=$old$ if version.snapshot->>'review_status'='confirmed' and version.snapshot->>'cost_price' is not null then$old$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_SCOPED_STANDARD';end if;
 src:=replace(src,anchor,$new$ if version.snapshot->>'review_status'='confirmed' and version.snapshot->>'cost_price' is not null
  and (private.inventory_supplier_key(org,wanted_supplier) is null or private.inventory_supplier_key(org,version.supplier_name)=private.inventory_supplier_key(org,wanted_supplier)) then$new$);
 anchor:=$old$'date',case when version.effective_date>'0001-01-01'::date then version.effective_date end,'purchase',version.snapshot->'purchase');end if;$old$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_SCOPED_RAW_STANDARD';end if;
 src:=replace(src,anchor,anchor||$new$
  if private.cost_purchase_price(version.snapshot->'purchase',version.snapshot->'purchase'->>'unit') is not null then
   return jsonb_build_object('price',null,'unit',u,'source','食材價格表 · 標準價','basis','standard',
    'date',version.effective_date,'supplier_name',version.supplier_name,
    'purchase',version.snapshot->'purchase','reason','盤點單位待確認');
  end if;$new$);
 execute src;

 src:=pg_get_functiondef('private.inventory_saved_purchase_quote(uuid,uuid,text,date)'::regprocedure);
 src:=replace(src,'private.inventory_saved_purchase_quote(','private.inventory_scoped_purchase_quote(');
 anchor:='cutoff date)';
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_SCOPED_REQUISITION_SIGNATURE';end if;
 src:=replace(src,anchor,'cutoff date, wanted_supplier text)');
 anchor:=$old$  where r.source_kind='purchase' and r.source like '請購表%' and r.review_status='confirmed'$old$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_SCOPED_REQUISITIONS';end if;
 src:=replace(src,anchor,anchor||$new$
   and exists(select 1 from public.stores shop where shop.id=s
    and (private.inventory_supplier_key(shop.organization_id,wanted_supplier) is null
      or private.inventory_supplier_key(shop.organization_id,coalesce(
       (select sp.name from public.suppliers sp where sp.organization_id=shop.organization_id and sp.id::text=r.source_ref->>'supplier_id'),
       r.source_ref->>'supplier_name'))=private.inventory_supplier_key(shop.organization_id,wanted_supplier)))$new$);
 execute src;
end $patch$;

create function private.inventory_count_quote(s uuid, product uuid, nm text, u text, cutoff date, supplier text) returns jsonb
language plpgsql stable set search_path='' set jit=off as $$
declare q jsonb; known jsonb; org uuid;
begin
 q:=private.inventory_scoped_cost_quote(s,product,nm,u,cutoff,null,supplier);
 if q->>'basis' in ('receipt','locked') or q->>'price' is not null or jsonb_typeof(q->'purchase')='object' then
  return private.inventory_apply_conversion(s,product,u,cutoff,q);
 end if;
 if product is null or q->>'reason'<>'缺少已確認進價或單位換算' then return q;end if;
 select organization_id into org from public.stores where id=s;
 known:=private.inventory_scoped_purchase_quote(s,product,u,cutoff,supplier);
 if private.inventory_supplier_key(org,supplier) is null then
  return coalesce(known,private.inventory_known_standard(s,product,u,cutoff),q);
 end if;
 return coalesce(known,q);
end
$$;
revoke all on function private.inventory_supplier_key(uuid,text),private.inventory_spec_key(text),
 private.inventory_rate_unit(text),private.inventory_apply_conversion(uuid,uuid,text,date,jsonb),
 private.inventory_scoped_cost_quote(uuid,uuid,text,text,date,uuid,text),
 private.inventory_scoped_purchase_quote(uuid,uuid,text,date,text),
 private.inventory_count_quote(uuid,uuid,text,text,date,text) from public,anon,authenticated;

do $patch$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
 anchor:=$old$private.inventory_latest_price_quote(p_store,nullif(c->>'product_id','')::uuid,c->>'name',coalesce(quote_review.report_unit,c->>'unit'),valuation_date)$old$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_COUNT_QUOTE_ANCHOR';end if;
 src:=replace(src,anchor,$new$private.inventory_count_quote(p_store,nullif(c->>'product_id','')::uuid,c->>'name',coalesce(quote_review.report_unit,c->>'unit'),valuation_date,c->>'supplier')$new$);
 anchor:='select x.*,r.report_unit,r.price_set,r.acknowledged,r.note,r.reviewed_by,';
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_COUNT_EVIDENCE_ANCHOR';end if;
 src:=replace(src,anchor,anchor||'r.purchase_evidence,');
 anchor:=$old$'price_purchase',case when not coalesce(v.price_set,false) then v.cost_quote->'purchase' end,$old$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_COUNT_PURCHASE_ANCHOR';end if;
 src:=replace(src,anchor,$new$'price_purchase',case when v.price_set then v.purchase_evidence->'purchase' else v.cost_quote->'purchase' end,
   'inventory_cost_quote',case when not historical and not coalesce(v.price_set,false) then v.cost_quote end,$new$);
 execute src;

 src:=pg_get_functiondef('public.save_baihuayuan_inventory_inline_v3(uuid,date,uuid,text,jsonb,text,text,numeric,numeric,text)'::regprocedure);
 anchor:=$old$private.inventory_latest_price_quote(p_store_id,nullif(r->>'product_id','')::uuid,r->>'name',btrim(p_unit),private.inventory_count_date(p_session_id))$old$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_COUNT_SAVE_ANCHOR';end if;
 src:=replace(src,anchor,$new$private.inventory_count_quote(p_store_id,nullif(r->>'product_id','')::uuid,r->>'name',btrim(p_unit),private.inventory_count_date(p_session_id),r->>'supplier')$new$);
 src:=replace(src,$old$'store_id','ingredient_id','reason'$old$,$new$'store_id','ingredient_id','reason','conversion_rate'$new$);
 anchor:='  price_set=case when preserve_auto then false else price_set end,';
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_CLEAR_PRICE_EVIDENCE_ANCHOR';end if;
 src:=replace(src,anchor,anchor||$new$
  purchase_evidence=case when not preserve_auto and current_values->'unit'=desired->'unit'
   and current_values->'price'=desired->'price' then purchase_evidence end,$new$);
 execute src;

 src:=pg_get_functiondef('public.baihuayuan_cost_quotes(uuid,jsonb)'::regprocedure);
 anchor:=$old$private.inventory_latest_price_quote(source_store,nullif(item->>'product_id','')::uuid,item->>'name',item->>'unit',nullif(item->>'date','')::date)$old$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_COST_RPC_ANCHOR';end if;
 execute replace(src,anchor,$new$private.inventory_count_quote(source_store,nullif(item->>'product_id','')::uuid,item->>'name',item->>'unit',nullif(item->>'date','')::date,item->>'supplier')$new$);
end $patch$;

-- Recheck the selected catalog evidence on save, including live receipts that
-- may have been removed or corrected while the search panel was open.
create function private.inventory_manual_source_exists(s uuid,q jsonb) returns boolean
language sql stable set search_path='' as $$
 select case q->>'basis'
 when 'receipt' then exists(
  select 1 from private.live_ingredient_receipt_prices r
  where r.store_id=s and r.id=(q->>'reference_id')::uuid and r.price is not null
   and r.effective_date::text=q->>'date' and r.purchase=q->'purchase'
 )
 when 'purchase' then exists(
  select 1 from private.recipe_price_entries r
  where r.store_id=s and r.id=(q->>'reference_id')::uuid and r.review_status='confirmed'
   and r.source_kind='purchase' and coalesce(r.source_ref->>'missing_price','false')<>'true'
   and coalesce(r.source_key,'') not like 'receipt:%'
   and r.effective_date::text=q->>'date'
   and coalesce(nullif(r.purchase,'null'::jsonb),jsonb_build_object('amount',r.price,'quantity',1,'unit',r.unit))=q->'purchase'
 )
 when 'standard' then exists(
  select 1 from private.ingredient_standard_versions v
  where v.store_id=s and v.id=(q->>'reference_id')::uuid and v.snapshot->>'review_status'='confirmed'
   and v.effective_date::text=q->>'date'
   and coalesce(nullif(v.snapshot->'purchase','null'::jsonb),jsonb_build_object(
    'amount',v.snapshot->'cost_price','quantity',1,'unit',v.snapshot->'unit'))=q->'purchase'
 )
 else false end
$$;
revoke all on function private.inventory_manual_source_exists(uuid,jsonb) from public,anon,authenticated;

-- The side panel can save a dated conversion or a one-off valuation. Existing
-- inventory edit checks protect the count revision, role, store and closure.
create function public.save_baihuayuan_inventory_valuation(
 p_store_id uuid,p_month date,p_session_id uuid,p_row_key text,p_expected jsonb,p_choice jsonb
) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare
 state jsonb; r jsonb; selected jsonb; raw jsonb; q jsonb; evidence jsonb;
 qty numeric; price numeric; rate numeric; kg numeric; original numeric; cutoff date;
 supplier_key text; product uuid; count_unit text; purchase_unit text; current_values jsonb;
begin
 perform private.assert_store_editable(p_store_id);
 if auth.uid() is null or coalesce(private.app_role(p_store_id),'') not in ('LOGISTICS','OWNER')
  or not private.has_active_store_role(p_store_id,null) or not private.can_import_inventory(p_store_id)
 then raise exception 'INVENTORY_ADMIN_REQUIRED' using errcode='42501';end if;
 if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_choice) is distinct from 'object'
  or octet_length(p_choice::text)>4096 then raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;

 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_month::text,819));
 perform 1 from public.inventory_count_sessions where id=p_session_id and store_id=p_store_id for update;
 if not found then raise exception 'INVENTORY_SOURCE_REQUIRED' using errcode='22023';end if;
 state:=private.inventory_month_state(p_store_id,p_month,p_session_id);
 if (state->>'closed')::boolean then raise exception 'INVENTORY_MONTH_CLOSED' using errcode='22023';end if;
 select value into r from jsonb_array_elements(state->'rows') where value->>'row_key'=p_row_key;
 if r is null or r->>'source_quantity' is null then raise exception 'INVENTORY_ROW_NOT_FOUND' using errcode='P0002';end if;
 cutoff:=(state->>'count_date')::date;
 qty:=(r->>'current_quantity')::numeric;
 count_unit:=r->>'unit';
 product:=(r->>'product_id')::uuid;
 q:=r->'inventory_cost_quote';
 selected:=p_choice->'quote';
 raw:=selected->'purchase';
 purchase_unit:=btrim(raw->>'unit');
 if jsonb_typeof(raw) is distinct from 'object' or not coalesce(qty>0,false)
  or (selected->>'date' is not null and (selected->>'date')::date>cutoff)
 then raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;
 original:=private.cost_purchase_price(raw,purchase_unit);
 if original is null or original<0 or original>=1000000000 then
  raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;

 if p_choice->>'count_per_unit' is not null then
  rate:=(p_choice->>'count_per_unit')::numeric;
  if rate<=0 or rate>=1000000000 or private.recipe_unit(purchase_unit)=private.recipe_unit(count_unit)
   or p_choice->>'weight_kg' is not null then raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;
  price:=original/rate;
 elsif p_choice->>'weight_kg' is not null then
  kg:=(p_choice->>'weight_kg')::numeric;
  if kg<=0 or kg>=1000000000 or private.recipe_unit(purchase_unit)<>'g'
   or private.recipe_unit(count_unit) in ('g','ml') then raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;
  price:=private.cost_purchase_price(raw,'公斤')*kg/qty;
 else
  price:=private.cost_purchase_price(raw,count_unit);
 end if;
 if price is null or price<0 or price>=1000000000 then raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;
 price:=round(price,10);
 evidence:=jsonb_strip_nulls(jsonb_build_object('purchase',raw,'source',left(selected->>'source',200),'date',selected->>'date',
  'supplier_name',left(selected->>'supplier_name',200),'reference_id',selected->>'reference_id','batch_id',selected->>'batch_id','specification',left(selected->>'specification',300),'conversion_rate',rate,'weight_kg',kg));
 current_values:=jsonb_build_object('name',r->'name','unit',r->'unit','quantity',r->'current_quantity','price',r->'unit_price','note',r->'review_note');
 if r->>'source_signature' is distinct from p_expected->>'source_signature' then
  raise exception 'INVENTORY_REVISION_CHANGED' using errcode='40001';end if;
 if r->>'unit_price' is not null then
  if (current_values-'price')=((p_expected->'values')-'price') and (r->>'unit_price')::numeric=price and (
   exists(select 1 from private.inventory_month_reviews v where v.store_id=p_store_id and v.month=p_month and v.session_id=p_session_id
    and v.row_key=p_row_key and v.price_set and v.source_signature=r->>'source_signature' and v.purchase_evidence=evidence)
   or (rate is not null and q->>'batch_id' is not null and (q->>'conversion_rate')::numeric=rate
    and q-'price'-'conversion_rate'=selected-'price'-'reason'-'conversion_rate')
  ) then return jsonb_build_object('saved',true,'replayed',true);end if;
  raise exception 'INVENTORY_REVISION_CHANGED' using errcode='40001';
 end if;
 if current_values is distinct from p_expected->'values' then
  raise exception 'INVENTORY_REVISION_CHANGED' using errcode='40001';end if;
 if coalesce((p_choice->>'automatic')::boolean,false) then
  if q is distinct from selected then raise exception 'COST_QUOTE_CHANGED' using errcode='40001';end if;
 elsif not private.inventory_manual_source_exists(p_store_id,selected) then
  raise exception 'COST_QUOTE_CHANGED' using errcode='40001';
 end if;

 perform public.save_baihuayuan_inventory_inline_v3(p_store_id,p_month,p_session_id,p_row_key,p_expected,
  r->>'name',count_unit,qty,price,r->>'review_note');
 if rate is not null and q=selected and q->>'batch_id' is not null then
  select private.inventory_supplier_key(s.organization_id,q->>'supplier_name') into supplier_key
  from public.stores s where s.id=p_store_id;
  if supplier_key is not null and private.inventory_spec_key(q->>'specification')<>'' then
   insert into private.inventory_unit_conversions(store_id,product_id,supplier_key,specification_key,purchase_unit,count_unit,effective_date,count_per_purchase_unit)
   values(p_store_id,product,supplier_key,private.inventory_spec_key(q->>'specification'),
    private.inventory_rate_unit(purchase_unit),private.inventory_rate_unit(count_unit),cutoff,rate)
   on conflict on constraint inventory_unit_conversions_pkey do nothing;
   if not exists(select 1 from private.inventory_unit_conversions c
    where c.store_id=p_store_id and c.product_id=product
     and c.supplier_key=private.inventory_supplier_key((select organization_id from public.stores where id=p_store_id),q->>'supplier_name')
     and c.specification_key=private.inventory_spec_key(q->>'specification')
     and c.purchase_unit=private.inventory_rate_unit(raw->>'unit')
     and c.count_unit=private.inventory_rate_unit(r->>'unit') and c.effective_date=cutoff and c.count_per_purchase_unit=rate)
    then raise exception 'COST_QUOTE_CHANGED' using errcode='40001';end if;
   update private.inventory_month_reviews set price_set=false,unit_price=null,purchase_evidence=null
   where store_id=p_store_id and month=p_month and session_id=p_session_id and row_key=p_row_key;
  end if;
 end if;
 update private.inventory_month_reviews set purchase_evidence=evidence
 where store_id=p_store_id and month=p_month and session_id=p_session_id and row_key=p_row_key and price_set;
 return jsonb_build_object('saved',true);
end
$$;
revoke all on function public.save_baihuayuan_inventory_valuation(uuid,date,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.save_baihuayuan_inventory_valuation(uuid,date,uuid,text,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
