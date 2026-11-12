-- Read verified requisition prices on the exact stored product when live
-- receipt and standard pricing leave an open inventory row unpriced.
create function private.inventory_saved_purchase_quote(s uuid,product uuid,u text,cutoff date)
returns jsonb language sql stable set search_path='' set jit=off as $$
 with item as (
  select p.id,private.recipe_unit(u) unit,
   lower(btrim(normalize(coalesce(p.specification,''),NFKC))) spec,
   coalesce(private.cost_package_measure(u,p.specification),private.cost_package_measure(u,p.name),
    case when private.recipe_unit(u)='片'
     then private.cost_package_measure('包',substring(lower(normalize(p.name,NFKC)) from
      '(?:切|每片)[[:space:]]*([0-9]+(?:[.][0-9]+)?[[:space:]]*(?:kg|公斤|g|公克))(?![a-z0-9])')) end
   ) target_package
  from public.products p join public.stores st on st.organization_id=p.organization_id
  where p.id=product and st.id=s and st.is_active
 ), records as materialized (
  select r.id,r.source,r.effective_date,r.created_at,r.purchase,
   round((r.purchase->>'amount')::numeric/(r.purchase->>'quantity')::numeric,4) raw_price,
   case
    when i.target_package is not null then private.cost_purchase_price(r.purchase,i.target_package->>'unit')
     *(i.target_package->>'quantity')::numeric
    when i.unit in ('g','ml','顆') then private.cost_purchase_price(r.purchase,u)
    when private.recipe_unit(r.purchase->>'unit')=i.unit
     and private.recipe_factor(r.purchase->>'unit')=private.recipe_factor(u)
     and lower(btrim(normalize(coalesce(r.source_ref->>'specification',''),NFKC)))=i.spec
     then (r.purchase->>'amount')::numeric/(r.purchase->>'quantity')::numeric
   end converted
  from item i join private.recipe_price_entries r on r.product_id=i.id and r.store_id=s
  where r.source_kind='purchase' and r.source like '請購表%' and r.review_status='confirmed'
   and r.effective_date<=cutoff and coalesce(r.source_ref->>'missing_price','false')<>'true'
   and jsonb_typeof(r.purchase->'amount')='number' and (r.purchase->>'amount')::numeric>=0
   and jsonb_typeof(r.purchase->'quantity')='number' and (r.purchase->>'quantity')::numeric>0
   and nullif(btrim(r.purchase->>'unit'),'') is not null
 ), usable as (
  select *,dense_rank() over(order by effective_date desc) priority
  from records where converted>=0 and converted<1000000000
 ), confirmed as (
  select * from usable where priority=1 and (select count(distinct round(converted,6)) from usable where priority=1)=1
  order by created_at desc,id limit 1
 ), raw as (
  select * from records where effective_date=(select max(effective_date) from records)
   and not exists(select 1 from usable)
   and (select count(distinct jsonb_build_array(r.raw_price,r.purchase->>'unit')) from records r
    where r.effective_date=(select max(effective_date) from records))=1
  order by created_at desc,id limit 1
 )
 select coalesce(
  (select jsonb_build_object('price',round(converted,6),'unit',u,'basis','purchase','source',source,
   'date',effective_date,'reference_id',id,'purchase',purchase) from confirmed),
  (select jsonb_build_object('price',null,'unit',u,'basis','purchase','date',effective_date,'reference_id',id,
   'reason','盤點單位待確認 · 原進價 NT$ '||trim_scale(raw_price)||'／'||(purchase->>'unit')) from raw)
 )
$$;
revoke all on function private.inventory_saved_purchase_quote(uuid,uuid,text,date) from public,anon,authenticated;

do $patch$
declare source text; anchor text;
begin
 source:=pg_get_functiondef('private.inventory_latest_price_quote(uuid,uuid,text,text,date)'::regprocedure);
 anchor:='return coalesce(known,private.inventory_known_standard(s,product,u,price_date),quote);';
 if strpos(source,anchor)=0 then raise exception 'INVENTORY_PURCHASE_FALLBACK_ANCHOR';end if;
 execute replace(source,anchor,$new$
  return coalesce(known,private.inventory_known_standard(s,product,u,price_date),
   private.inventory_saved_purchase_quote(s,product,u,price_date),quote);$new$);
end
$patch$;
notify pgrst,'reload schema';
