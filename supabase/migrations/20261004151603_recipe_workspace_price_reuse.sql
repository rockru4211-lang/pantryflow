-- Reuse a request-local price index across recipes and nested components.
-- No user data, cost snapshots, price selection or authorization rules change.
create or replace function private.recipe_price_index(prices jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(key,quotes),'{}'::jsonb) from (
 select value->>'key' key,jsonb_agg(value order by ord) quotes
 from jsonb_array_elements(prices) with ordinality as p(value,ord)
 group by value->>'key') grouped
$$;
revoke all on function private.recipe_price_index(jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.recipe_cost_indexed(s uuid, doc jsonb, visited uuid[], price_index jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare line jsonb; price jsonb; direct jsonb; child jsonb; result jsonb; lines jsonb:='[]'; total numeric:=0; amount numeric; qty numeric; child_id uuid; missing integer:=0; reason text; basis jsonb; each_price numeric; item_key text; piece boolean; prices jsonb; all_prices jsonb; explicit_package boolean;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;

 if cardinality(visited)>20 then raise exception 'INVALID_RECIPE_CYCLE' using errcode='22023';end if;
 for line in select value from jsonb_array_elements(coalesce(doc->'lines','[]')) loop
  amount:=null;reason:=null;price:=null;direct:=null;qty:=nullif(line->>'quantity','')::numeric;
  if qty is null or qty<=0 or nullif(btrim(line->>'unit'),'') is null then reason:='待填用量';
  elsif nullif(line->>'recipe_id','') is not null then
   child_id:=(line->>'recipe_id')::uuid;
   if child_id=any(visited) then raise exception 'INVALID_RECIPE_CYCLE' using errcode='22023';end if;
   select document into child from private.recipe_cards where id=child_id and store_id=s;
   if child is null then raise exception 'INVALID_RECIPE_REFERENCE' using errcode='22023';end if;
   result:=private.recipe_cost_indexed(s,child,array_append(visited,child_id),price_index);
   if result->>'total' is null then reason:='備料成本未完整';
   elsif nullif(child->>'yield','')::numeric is null or (child->>'yield')::numeric<=0 then reason:='待填製成量';
   elsif private.recipe_unit(child->>'unit')<>private.recipe_unit(line->>'unit') then reason:='待確認單位換算';
   else amount:=(result->>'total')::numeric*qty*private.recipe_factor(line->>'unit')/((child->>'yield')::numeric*private.recipe_factor(child->>'unit'));end if;
  else
   item_key:=case when nullif(line->>'product_id','') is not null then 'p:'||(line->>'product_id') else 'n:'||lower(btrim(line->>'name')) end;
   prices:=private.recipe_effective_prices(line,coalesce(price_index->item_key,'[]'::jsonb));
   select value into direct from jsonb_array_elements(prices) where value->>'key'=item_key and value->>'unit'=private.recipe_unit(line->>'unit') limit 1;
   explicit_package:=coalesce(direct->'purchase'->>'conversion_basis'='package' and (direct->'purchase'->>'content_quantity')::numeric>0 and private.recipe_unit(direct->'purchase'->>'content_unit')=private.recipe_unit(line->>'unit'),false);
   basis:=private.recipe_note_basis(line,coalesce(doc->>'notes',''));piece:=false;
   if not explicit_package and basis is not null and private.recipe_unit(basis->>'unit')=private.recipe_unit(line->>'unit') and basis->>'countUnit'<>private.recipe_unit(line->>'unit') then
    select value into price from jsonb_array_elements(prices) where value->>'key'=item_key and value->>'unit'=basis->>'countUnit' limit 1;
    if price is null then select value into price from jsonb_array_elements(prices) where value->>'key'=item_key and value->>'unit'=private.recipe_unit(line->>'unit') and private.recipe_unit(value->'purchase'->>'unit')=basis->>'countUnit' limit 1;end if;
    piece:=price is not null;
   end if;
   if piece then
    if price->>'unit'=basis->>'countUnit' then each_price:=coalesce((price->>'cost_price')::numeric,(price->>'price')::numeric);
    else each_price:=coalesce((price->'purchase'->>'cost_unit_price')::numeric,case when (price->'purchase'->>'quantity')::numeric>0 then (price->'purchase'->>'amount')::numeric/(price->'purchase'->>'quantity')::numeric else (price->>'price')::numeric end);end if;
    if each_price>=0 then amount:=each_price*qty*private.recipe_factor(line->>'unit')*(basis->>'count')::numeric/((basis->>'quantity')::numeric*private.recipe_factor(basis->>'unit'));else reason:='待補價格或換算';end if;
   else
    price:=direct;
    if price is null then reason:='待補價格或換算';
    elsif private.recipe_unit(price->'purchase'->>'unit') in ('顆','片') and private.recipe_unit(line->>'unit')<>private.recipe_unit(price->'purchase'->>'unit') and not explicit_package then reason:='待確認單位換算';
    else amount:=coalesce((price->>'cost_price')::numeric,(price->>'price')::numeric)*qty*private.recipe_factor(line->>'unit');end if;
   end if;
  end if;
  if amount is null then missing:=missing+1;else total:=total+amount;end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('id',line->>'id','amount',amount,'reason',reason,'price',price));
 end loop;
 if jsonb_array_length(lines)=0 then missing:=missing+1;end if;
 return jsonb_build_object('total',case when missing=0 then total end,'subtotal',total,'missing',missing,'lines',lines);
end $function$
;
revoke all on function private.recipe_cost_indexed(uuid,jsonb,uuid[],jsonb) from public,anon,authenticated;
create or replace function private.recipe_cost(s uuid,doc jsonb,visited uuid[] default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 return private.recipe_cost_indexed(s,doc,visited,private.recipe_price_index(private.recipe_prices(s)));
end $$;

CREATE OR REPLACE FUNCTION private.recipe_prices(s uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with refs as (
 select *,case when product_id is not null then 'p:'||product_id else 'n:'||lower(btrim(name)) end key
 from private.recipe_price_entries where store_id=s and review_status='confirmed' and (select private.recipe_allowed(s))
 ), mappings as (
 select distinct on(key,private.recipe_unit(unit),coalesce(source_ref->>'product_id',product_id::text),coalesce(source_ref->>'supplier_id',source_ref->>'supplier_name','')) * from refs
 order by key,private.recipe_unit(unit),coalesce(source_ref->>'product_id',product_id::text),coalesce(source_ref->>'supplier_id',source_ref->>'supplier_name',''),effective_date desc nulls last,created_at desc,id desc
 ), receipts as (
 select l.product_id,p.name,l.specification,l.unit,l.unit_price_ex_tax,g.receipt_date,coalesce(l.supplier_id,g.supplier_id) supplier_id,
 coalesce(g.reviewed_at,l.created_at) recorded_at,l.id::text source_id,sp.name supplier_name
 from public.receipt_lines l join public.goods_receipts g on g.id=l.receipt_id
 join public.receipt_upload_batches b on b.id=g.source_batch_id join public.products p on p.id=l.product_id
 left join public.suppliers sp on sp.id=coalesce(l.supplier_id,g.supplier_id)
 where g.store_id=s and b.status::text='COMPLETED' and l.unit_price_ex_tax>=0 and l.quantity>0
 and nullif(btrim(l.unit),'') is not null and (select private.recipe_allowed(s))
 ), candidates as (
 select 'p:'||r.product_id key,r.name,r.product_id,private.recipe_unit(r.unit) unit,
 r.unit_price_ex_tax/private.recipe_factor(r.unit) price,'已核對進貨'::text source,r.receipt_date effective_date,
 r.recorded_at,r.source_id,r.supplier_name,jsonb_build_object('amount',r.unit_price_ex_tax,'quantity',1,'unit',r.unit) purchase,
 null::numeric cost_price,'purchase'::text source_kind,jsonb_build_object('supplier_id',r.supplier_id,'supplier_name',r.supplier_name,'specification',r.specification) source_ref,null::uuid reference_id,0 priority
 from receipts r
 union all
 select q.key,q.name,q.product_id,private.recipe_unit(q.unit),q.price/private.recipe_factor(q.unit),q.source,q.effective_date,
 q.created_at,q.id::text,q.source_ref->>'supplier_name',q.purchase,q.cost_price/private.recipe_factor(q.unit),q.source_kind,q.source_ref,q.id,
 case when q.source_kind='history' then 1 else 0 end
 from refs q
 union all
 -- Reuse only explicitly approved product matches and package conversions.
 select q.key,q.name,q.product_id,private.recipe_unit(q.unit),r.unit_price_ex_tax/conversion.factor,
 '已核對進貨',r.receipt_date,r.recorded_at,r.source_id,r.supplier_name,
 jsonb_build_object('amount',r.unit_price_ex_tax,'quantity',1,'unit',r.unit)||
 case when private.recipe_unit(r.unit)=private.recipe_unit(q.unit) then '{}'::jsonb
 else jsonb_build_object('content_quantity',conversion.factor,'content_unit',private.recipe_unit(q.unit)) end,
 case when q.cost_price is not null then greatest(r.unit_price_ex_tax/conversion.factor,q.cost_price/private.recipe_factor(q.unit)) end,
 'purchase',(q.source_ref-'url'-'review_note')||jsonb_build_object('supplier_id',r.supplier_id,'supplier_name',r.supplier_name,'specification',coalesce(nullif(btrim(r.specification),''),q.source_ref->>'specification')),q.id,0
 from receipts r join mappings q on r.product_id=coalesce(nullif(q.source_ref->>'product_id','')::uuid,q.product_id)
 cross join lateral (select case
 when private.recipe_unit(r.unit)=private.recipe_unit(q.unit) then private.recipe_factor(r.unit)
 when private.recipe_unit(r.unit)=private.recipe_unit(q.purchase->>'unit')
 and private.recipe_unit(q.purchase->>'content_unit')=private.recipe_unit(q.unit)
 then nullif(q.purchase->>'content_quantity','')::numeric*private.recipe_factor(q.purchase->>'content_unit') end factor) conversion
 where conversion.factor>0
 -- A changed, explicitly recorded package must be confirmed before reusing its conversion.
 and (private.recipe_unit(r.unit)=private.recipe_unit(q.unit) or nullif(btrim(r.specification),'') is null or
 regexp_replace(lower(r.specification),'[[:space:]/／]','','g')=regexp_replace(lower(q.source_ref->>'specification'),'[[:space:]/／]','','g'))
 and case
 when nullif(q.source_ref->>'supplier_id','') is not null then r.supplier_id::text=q.source_ref->>'supplier_id'
 when nullif(q.source_ref->>'supplier_name','') is not null then lower(btrim(r.supplier_name))=lower(btrim(q.source_ref->>'supplier_name'))
 else true end
 )
 , changed_packages as (
 select q.key,private.recipe_unit(q.unit) unit,max(r.receipt_date) latest_date
 from receipts r join mappings q on r.product_id=coalesce(nullif(q.source_ref->>'product_id','')::uuid,q.product_id)
 where private.recipe_unit(r.unit)<>private.recipe_unit(q.unit) and nullif(btrim(r.specification),'') is not null
 and regexp_replace(lower(r.specification),'[[:space:]/／]','','g') is distinct from regexp_replace(lower(q.source_ref->>'specification'),'[[:space:]/／]','','g')
 and case when nullif(q.source_ref->>'supplier_id','') is not null then r.supplier_id::text=q.source_ref->>'supplier_id'
 when nullif(q.source_ref->>'supplier_name','') is not null then lower(btrim(r.supplier_name))=lower(btrim(q.source_ref->>'supplier_name')) else true end
 group by q.key,private.recipe_unit(q.unit)
 ), events as (
 -- Deduplicate the native and converted view of the same receipt before comparing events.
 select distinct on(key,unit,source_id) * from candidates
 where source_kind='purchase' and effective_date is not null
 and coalesce(nullif(source_ref->>'supplier_id',''),nullif(btrim(supplier_name),'')) is not null
 order by key,unit,source_id,reference_id nulls last
 ), movements as (
 select key,unit,source_id,
 lag(price) over comparison previous_price,
 lag(effective_date) over comparison previous_date,
 lag(purchase) over comparison previous_purchase
 from events
 window comparison as (partition by key,unit,
 coalesce(nullif(source_ref->>'supplier_id',''),lower(btrim(supplier_name))),
 coalesce(nullif(btrim(source_ref->>'specification'),''),''),
 coalesce(purchase->>'unit',unit),purchase->'content_quantity',purchase->>'content_unit'
 order by effective_date,recorded_at,source_id)
 ), selected as (
 select distinct on(key,unit) * from candidates
 order by key,unit,priority,effective_date desc nulls last,recorded_at desc,source_id desc,reference_id nulls last
 )
 select coalesce(jsonb_agg((to_jsonb(x)-'priority')||jsonb_build_object(
 'conversion_pending',coalesce(changed.latest_date>coalesce(x.effective_date,'-infinity'::date),false),
 'previous_price',m.previous_price,'previous_date',m.previous_date,'previous_purchase',m.previous_purchase)),'[]')
 from selected x left join movements m on x.source_kind='purchase' and m.key=x.key and m.unit=x.unit and m.source_id=x.source_id
 left join changed_packages changed on changed.key=x.key and changed.unit=x.unit
$function$
;
CREATE OR REPLACE FUNCTION private.recipe_workspace(s uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_prices jsonb; price_index jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 current_prices:=private.recipe_prices(s);
 price_index:=private.recipe_price_index(current_prices);
 return jsonb_build_object('can_price',private.recipe_allowed(s,true),
 'recipes',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('cost',private.recipe_cost_indexed(s,r.document,array[r.id],price_index)) order by updated_at desc),'[]') from private.recipe_cards r where store_id=s),
 'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit,'specification',p.specification) order by p.name),'[]') from public.products p join public.stores st on st.organization_id=p.organization_id where st.id=s and p.is_active),
 'prices',current_prices,
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.name) order by sp.name),'[]') from public.suppliers sp join public.stores st on st.organization_id=sp.organization_id where st.id=s and sp.is_active),
 'price_references',(select coalesce(jsonb_agg(jsonb_build_object(
 'key',case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,
 'name',r.name,'product_id',r.product_id,'unit',private.recipe_unit(r.unit),'price',r.price/private.recipe_factor(r.unit),
 'cost_price',r.cost_price/private.recipe_factor(r.unit),'purchase',r.purchase,'source',r.source,'source_kind',r.source_kind,
 'source_ref',r.source_ref,'supplier_name',r.source_ref->>'supplier_name','reference_id',r.id,'effective_date',r.effective_date,
 'review_status',r.review_status,'created_at',r.created_at) order by r.effective_date desc nulls last,r.created_at desc),'[]')
 from private.recipe_price_entries r where r.store_id=s and (r.review_status='confirmed' or not exists(
 select 1 from private.recipe_price_entries c where c.store_id=s and c.review_status='confirmed' and c.source_ref->>'import_key'=r.source_ref->>'import_key'))),
 'price_candidates',(select coalesce(jsonb_agg(jsonb_build_object(
 'key',case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,
 'name',r.name,'product_id',r.product_id,'unit',private.recipe_unit(r.unit),'price',r.price/private.recipe_factor(r.unit),
 'purchase',r.purchase,'source',r.source,'source_kind',r.source_kind,'source_ref',r.source_ref,'reference_id',r.id,'effective_date',r.effective_date
 ) order by r.source_kind,r.effective_date desc nulls last),'[]') from private.recipe_price_entries r
 where r.store_id=s and r.review_status='pending' and not exists (
 select 1 from private.recipe_price_entries c where c.store_id=s and c.review_status='confirmed'
 and c.source_ref->>'import_key'=r.source_ref->>'import_key')));
end $function$
;
