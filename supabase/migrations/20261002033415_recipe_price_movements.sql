-- Comparable supplier/package price movements and explicit receiving matches.
-- No recipe quantities or stored cost snapshots are rewritten.
create or replace function private.recipe_prices(s uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with refs as (
 select *,case when product_id is not null then 'p:'||product_id else 'n:'||lower(btrim(name)) end key
 from private.recipe_price_entries where store_id=s and review_status='confirmed' and private.recipe_allowed(s)
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
 and nullif(btrim(l.unit),'') is not null and private.recipe_allowed(s)
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
$$;

create or replace function private.recipe_operation(s uuid,action text,data jsonb,request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior private.app_requests; card private.recipe_cards; doc jsonb; item jsonb; result jsonb; v_id uuid; org uuid; rev integer; cost jsonb; normalized jsonb; reference private.recipe_price_entries; price_ref jsonb; supplier_key uuid; supplier_label text;
begin
 if not private.recipe_allowed(s,action='recipe.price') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if request is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('recipe:'||s::text,0));
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then
  if prior.actor_id<>auth.uid() or prior.action<>action or prior.payload<>data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return prior.result;
 end if;
 select organization_id into org from public.stores where id=s;
 if action='recipe.save' then
  v_id:=(data->>'id')::uuid;doc:=data->'document';
  if v_id is null or doc is null or jsonb_typeof(doc)<>'object' or length(coalesce(doc->>'name','')) not between 1 and 160 or coalesce(doc->>'kind','') not in ('dish','prep') or jsonb_typeof(doc->'lines')<>'array' or jsonb_array_length(doc->'lines')>150 or octet_length(doc::text)>2000000 then raise exception 'INVALID_RECIPE' using errcode='22023';end if;
  if nullif(doc->>'yield','')::numeric<0 then raise exception 'INVALID_YIELD' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(doc->'lines') loop
   if length(coalesce(item->>'name','')) not between 1 and 160 or nullif(item->>'quantity','')::numeric<0 then raise exception 'INVALID_INGREDIENT' using errcode='22023';end if;
   if nullif(item->>'product_id','') is not null and not exists(select 1 from public.products where id=(item->>'product_id')::uuid and organization_id=org) then raise exception 'INVALID_PRODUCT' using errcode='22023';end if;
  end loop;
  select * into card from private.recipe_cards where id=v_id;
  if found and (card.store_id<>s or card.revision<>coalesce((data->>'revision')::integer,0)) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  if not found and coalesce((data->>'revision')::integer,0)<>0 then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  rev:=coalesce(card.revision,0)+1;
  cost:=private.recipe_cost(s,doc,array[v_id]);
  insert into private.recipe_cards(id,store_id,document,revision,updated_by) values(v_id,s,doc,rev,auth.uid()) on conflict(id) do update set document=excluded.document,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now();
  insert into private.recipe_versions values(v_id,rev,doc,cost,auth.uid(),now());
  result:=jsonb_build_object('id',v_id,'revision',rev,'cost',cost);
 elsif action='recipe.price' then
  if nullif(data->>'reference_id','') is not null then
   select * into reference from private.recipe_price_entries where id=(data->>'reference_id')::uuid and store_id=s;
   if reference.id is null or lower(btrim(reference.name))<>lower(btrim(data->>'name'))
   or reference.product_id is distinct from nullif(data->>'product_id','')::uuid then
    raise exception 'INVALID_PRICE_REFERENCE' using errcode='22023';end if;
  end if;
  if length(btrim(coalesce(data->>'name',''))) not between 1 and 160 or nullif(btrim(data->>'unit'),'') is null or nullif(data->>'price','')::numeric is null or (data->>'price')::numeric<0 or length(btrim(coalesce(data->>'source','')))=0 or (nullif(data->>'effective_date','')::date is null and reference.id is null) then raise exception 'INVALID_PRICE' using errcode='22023';end if;
  if nullif(data->>'product_id','') is not null and not exists(select 1 from public.products where id=(data->>'product_id')::uuid and organization_id=org) then raise exception 'INVALID_PRODUCT' using errcode='22023';end if;
  -- Retain the original payload for replay checks. Recalculate purchase quotes on the server.
  if data ? 'purchase' then
   normalized:=private.recipe_purchase_value(data->'purchase',data->>'unit');
  else
   normalized:=jsonb_build_object('unit',data->>'unit','price',(data->>'price')::numeric);
  end if;
  price_ref:=reference.source_ref;
  if data ? 'supplier_name' or data ? 'supplier_id' then
   supplier_key:=nullif(data->>'supplier_id','')::uuid;
   supplier_label:=nullif(btrim(data->>'supplier_name'),'');
   if length(coalesce(supplier_label,''))>160 then raise exception 'INVALID_SUPPLIER' using errcode='22023';end if;
   if supplier_key is not null then
    select name into supplier_label from public.suppliers where id=supplier_key and organization_id=org;
    if not found then raise exception 'INVALID_SUPPLIER' using errcode='22023';end if;
   end if;
   price_ref:=(coalesce(price_ref,'{}')-'supplier_id'-'supplier_name')||jsonb_strip_nulls(jsonb_build_object('supplier_id',supplier_key,'supplier_name',supplier_label));
  end if;
  if data ? 'specification' then
   if length(coalesce(data->>'specification',''))>500 then raise exception 'INVALID_SPECIFICATION' using errcode='22023';end if;
   price_ref:=coalesce(price_ref,'{}')||jsonb_build_object('specification',btrim(coalesce(data->>'specification','')));
  end if;
  if data ? 'matched_product_id' then
   if nullif(data->>'matched_product_id','') is not null and not exists(
    select 1 from public.products where id=(data->>'matched_product_id')::uuid and organization_id=org
   ) then raise exception 'INVALID_PRODUCT' using errcode='22023';end if;
   price_ref:=(coalesce(price_ref,'{}')-'product_id')||jsonb_strip_nulls(jsonb_build_object('product_id',nullif(data->>'matched_product_id','')));
  end if;
  insert into private.recipe_price_entries(store_id,name,product_id,unit,price,source,effective_date,actor_id,purchase,cost_price,source_kind,source_ref)
  values(s,btrim(data->>'name'),nullif(data->>'product_id','')::uuid,normalized->>'unit',(normalized->>'price')::numeric,data->>'source',nullif(data->>'effective_date','')::date,auth.uid(),data->'purchase',(normalized->>'cost_price')::numeric,coalesce(reference.source_kind,'manual'),price_ref) returning id into v_id;
  result:=jsonb_build_object('id',v_id);
 else raise exception 'INVALID_RECIPE_ACTION' using errcode='22023';end if;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),action,data,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id) values(org,'recipe',v_id::text,action,jsonb_build_object('store_id',s,'revision',rev),auth.uid());
 return result;
end $$;

notify pgrst,'reload schema';
