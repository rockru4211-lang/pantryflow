-- Preserve original purchase quotes alongside normalized recipe prices.
-- Additive; legacy clients and existing recipe snapshots remain valid.
alter table private.recipe_price_entries add column purchase jsonb;

create or replace function private.recipe_unit(u text) returns text language sql immutable set search_path='' as $$
 select case lower(btrim(u)) when '公斤' then 'g' when 'kg' then 'g' when '公克' then 'g' when '克' then 'g' when 'g' then 'g' when '臺斤' then 'g' when '台斤' then 'g' when '斤' then 'g' when 'l' then 'ml' when '公升' then 'ml' when '毫升' then 'ml' when '個' then '顆' when 'pc' then '顆' when 'pcs' then '顆' when 'box' then '盒' else lower(btrim(u)) end
$$;

create or replace function private.recipe_factor(u text) returns numeric language sql immutable set search_path='' as $$
 select case lower(btrim(u)) when '公斤' then 1000 when 'kg' then 1000 when '斤' then 600 when '臺斤' then 600 when '台斤' then 600 when 'l' then 1000 when '公升' then 1000 else 1 end
$$;

create function private.recipe_purchase_value(p jsonb,target_unit text) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare amount numeric; qty numeric; content_qty numeric; base_qty numeric; unit text;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>2048
 or jsonb_typeof(p->'amount') is distinct from 'number' or jsonb_typeof(p->'quantity') is distinct from 'number'
 or jsonb_typeof(p->'unit') is distinct from 'string' or length(btrim(coalesce(p->>'unit',''))) not between 1 and 40
 or length(btrim(coalesce(target_unit,''))) not between 1 and 40 then
  raise exception 'INVALID_PURCHASE' using errcode='22023';end if;
 amount:=(p->>'amount')::numeric;qty:=(p->>'quantity')::numeric;unit:=private.recipe_unit(target_unit);
 if amount<0 or qty<=0 then raise exception 'INVALID_PURCHASE' using errcode='22023';end if;
 base_qty:=qty*private.recipe_factor(p->>'unit');
 if private.recipe_unit(p->>'unit')<>unit then
  if jsonb_typeof(p->'content_quantity') is distinct from 'number'
  or jsonb_typeof(p->'content_unit') is distinct from 'string'
  or private.recipe_unit(p->>'content_unit')<>unit then
   raise exception 'INVALID_PURCHASE_CONVERSION' using errcode='22023';end if;
  content_qty:=(p->>'content_quantity')::numeric;
  if content_qty<=0 then raise exception 'INVALID_PURCHASE_CONVERSION' using errcode='22023';end if;
  base_qty:=qty*content_qty*private.recipe_factor(p->>'content_unit');
 end if;
 return jsonb_build_object('unit',unit,'price',amount/base_qty,'base_quantity',base_qty);
end $$;
revoke all on function private.recipe_purchase_value(jsonb,text) from public,anon,authenticated;


create or replace function private.recipe_prices(s uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select distinct on(key,unit) * from (
 select 'p:'||l.product_id key,p.name,l.product_id,private.recipe_unit(l.unit) unit,
 l.unit_price_ex_tax/private.recipe_factor(l.unit) price,'已核對進貨'::text source,g.receipt_date effective_date,coalesce(g.reviewed_at,l.created_at) recorded_at,l.id::text source_id,sp.name supplier_name,jsonb_build_object('amount',l.unit_price_ex_tax,'quantity',1,'unit',l.unit) purchase
 from public.receipt_lines l join public.goods_receipts g on g.id=l.receipt_id
 join public.receipt_upload_batches b on b.id=g.source_batch_id join public.products p on p.id=l.product_id
 left join public.suppliers sp on sp.id=g.supplier_id
 where g.store_id=s and b.status::text='COMPLETED' and l.unit_price_ex_tax>=0 and l.quantity>0 and nullif(btrim(l.unit),'') is not null
 union all
 select case when product_id is not null then 'p:'||product_id else 'n:'||lower(btrim(name)) end,name,product_id,private.recipe_unit(unit),price/private.recipe_factor(unit),source,effective_date,created_at,id::text,null::text,purchase
 from private.recipe_price_entries where store_id=s
 ) candidates order by key,unit,effective_date desc,recorded_at desc,source_id desc
 ) x where private.recipe_allowed(s)
$$;

create or replace function private.recipe_operation(s uuid,action text,data jsonb,request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior private.app_requests; card private.recipe_cards; doc jsonb; item jsonb; result jsonb; v_id uuid; org uuid; rev integer; cost jsonb; normalized jsonb;
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
  if length(btrim(coalesce(data->>'name',''))) not between 1 and 160 or nullif(btrim(data->>'unit'),'') is null or nullif(data->>'price','')::numeric is null or (data->>'price')::numeric<0 or length(btrim(coalesce(data->>'source','')))=0 or nullif(data->>'effective_date','')::date is null then raise exception 'INVALID_PRICE' using errcode='22023';end if;
  if nullif(data->>'product_id','') is not null and not exists(select 1 from public.products where id=(data->>'product_id')::uuid and organization_id=org) then raise exception 'INVALID_PRODUCT' using errcode='22023';end if;
  -- Retain the original payload for replay checks. Recalculate purchase quotes on the server.
  if data ? 'purchase' then
   normalized:=private.recipe_purchase_value(data->'purchase',data->>'unit');
  else
   normalized:=jsonb_build_object('unit',data->>'unit','price',(data->>'price')::numeric);
  end if;
  insert into private.recipe_price_entries(store_id,name,product_id,unit,price,source,effective_date,actor_id,purchase)
  values(s,btrim(data->>'name'),nullif(data->>'product_id','')::uuid,normalized->>'unit',(normalized->>'price')::numeric,data->>'source',(data->>'effective_date')::date,auth.uid(),data->'purchase') returning id into v_id;
  result:=jsonb_build_object('id',v_id);
 else raise exception 'INVALID_RECIPE_ACTION' using errcode='22023';end if;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),action,data,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id) values(org,'recipe',v_id::text,action,jsonb_build_object('store_id',s,'revision',rev),auth.uid());
 return result;
end $$;
notify pgrst,'reload schema';
