CREATE OR REPLACE FUNCTION private.recipe_operation(s uuid, action text, data jsonb, request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prior private.app_requests; card private.recipe_cards; doc jsonb; item jsonb; result jsonb; v_id uuid; org uuid; rev integer; cost jsonb; saved jsonb; normalized jsonb; reference private.recipe_price_entries; price_ref jsonb; supplier_key uuid; supplier_label text;
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
  saved:=private.recipe_saved_snapshot(v_id);
  if coalesce((data->>'snapshot_only')::boolean,false) then
   -- Recipe commits use only their stored quotes; catalog lookup is an explicit user action.
   cost:=private.recipe_scoped_cost(s,doc,saved,array[v_id],private.recipe_price_index(
    (select coalesce(jsonb_agg(value->'price'),'[]') from jsonb_array_elements(coalesce(saved#>'{cost,lines}','[]')) where jsonb_typeof(value->'price')='object')
   ))->'cost';
  else
   cost:=private.recipe_scoped_cost(s,doc,private.recipe_saved_snapshot(v_id),array[v_id],private.recipe_price_index(private.recipe_prices(s)))->'cost';
  end if;
  saved:=private.recipe_saved_snapshot(v_id);
  if jsonb_typeof(saved->'cost')='object' then
   cost:=private.recipe_locked_cost(doc,saved->'document',saved->'cost',cost);
  end if;
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
end $function$;

CREATE OR REPLACE FUNCTION private.recipe_commit(s uuid, data jsonb, request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare prior private.app_requests; card private.recipe_cards; item jsonb; line jsonb; result jsonb; baseline jsonb; cost jsonb; accepted jsonb:='[]';
 rev int; original_revision int; master uuid; seen uuid[]:='{}'; entries uuid[]:='{}'; entry private.recipe_price_entries; normalized jsonb; quote jsonb; one jsonb; chosen jsonb; rows jsonb; item_key text; subtotal numeric; missing int;
begin
 if auth.uid() is null or not private.recipe_allowed(s) or private.store_access_mode(s) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if request is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('recipe:'||s::text,0));
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then
  if prior.actor_id<>auth.uid() or prior.action<>'recipe.commit' or prior.payload<>data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;return prior.result;
 end if;
 if jsonb_typeof(coalesce(data->'prices','[]'))<>'array' or jsonb_array_length(coalesce(data->'prices','[]'))>150 then raise exception 'INVALID_PRICE' using errcode='22023';end if;
 if jsonb_array_length(coalesce(data->'prices','[]'))>0 and not private.recipe_allowed(s,true) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 result:=private.recipe_safe_operation(s,'recipe.save',(data-'prices')||jsonb_build_object('snapshot_only',true),gen_random_uuid());rev:=(result->>'revision')::int;
 select * into card from private.recipe_cards where id=(data->>'id')::uuid and store_id=s;
 baseline:=private.recipe_saved_snapshot(card.id);rows:=baseline#>'{cost,lines}';
 for item in select value from jsonb_array_elements(coalesce(data->'prices','[]')) loop
  select value into line from jsonb_array_elements(card.document->'lines') where value->>'id'=item->>'line_id';
  if line is null or nullif(line->>'recipe_id','') is not null or line->>'name' is distinct from item->>'name'
   or nullif(line->>'ingredient_id','') is distinct from nullif(item->>'ingredient_id','')
   or nullif(line->>'product_id','') is distinct from nullif(item->>'product_id','') then raise exception 'INVALID_INGREDIENT_TARGET' using errcode='22023';end if;
  master:=nullif(item->>'ingredient_id','')::uuid;
  if master is not null and not exists(select 1 from private.ingredient_masters where id=master and store_id=s) then
   raise exception 'INVALID_INGREDIENT_TARGET' using errcode='22023';
  end if;
  -- A quote belongs to this saved recipe. Do not update shared prices or alias catalogs.
  normalized:=private.recipe_purchase_value(item->'purchase',item->>'unit');
  item_key:=case when master is not null then 'i:'||master when nullif(line->>'product_id','') is not null then 'p:'||(line->>'product_id') else 'n:'||lower(btrim(line->>'name')) end;
  quote:=jsonb_build_object('key',item_key,'name',line->>'name','product_id',line->>'product_id','unit',normalized->>'unit','price',normalized->'price','cost_price',normalized->'cost_price','purchase',item->'purchase','source',item->>'source','source_kind','manual','effective_date',item->>'effective_date','recorded_at',clock_timestamp());
  one:=private.recipe_cost_indexed(s,jsonb_set(card.document,'{lines}',jsonb_build_array(line)),array[card.id],jsonb_build_object(item_key,jsonb_build_array(quote)))#>'{lines,0}';
  if jsonb_typeof(one->'amount')='number' then chosen:=one;
  else select value into chosen from jsonb_array_elements(rows) where value->>'id'=line->>'id';end if;
  chosen:=chosen||jsonb_build_object('price',quote);
  select jsonb_agg(case when value->>'id'=line->>'id' then chosen else value end order by ord) into rows from jsonb_array_elements(rows) with ordinality t(value,ord);
  accepted:=accepted||jsonb_build_array(item->>'line_id');
 end loop;
 select coalesce(sum((value->>'amount')::numeric),0),count(*) filter(where jsonb_typeof(value->'amount') is distinct from 'number') into subtotal,missing from jsonb_array_elements(rows);
 if jsonb_array_length(rows)=0 then missing:=1;end if;
 cost:=jsonb_build_object('lines',rows,'subtotal',subtotal,'missing',missing,'total',case when missing=0 then subtotal end);
 update private.recipe_versions set cost_snapshot=cost where recipe_id=card.id and revision=rev;
 insert into private.recipe_cost_approvals(recipe_id,document,cost_snapshot,source_revision,actor_id,origin) values(card.id,card.document,cost,rev,auth.uid(),'confirmed');
 result:=result||jsonb_build_object('cost',cost,'accepted_lines',accepted,'ingredient_revisions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision)),'[]') from private.ingredient_masters where store_id=s and (id=any(seen) or selected_reference=any(entries))));
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),'recipe.commit',data,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id) select organization_id,'recipe',card.id::text,'recipe.commit',baseline->'cost',cost,auth.uid() from public.stores where id=s;
 return result;
end $function$;
