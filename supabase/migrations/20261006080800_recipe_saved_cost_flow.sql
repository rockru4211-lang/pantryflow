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
  -- All document saves, including retries from older clients, use stored quotes only.
  cost:=private.recipe_scoped_cost(s,doc,saved,array[v_id],'{}'::jsonb)->'cost';
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

CREATE OR REPLACE FUNCTION private.recipe_scoped_cost(s uuid, doc jsonb, baseline jsonb, path uuid[], idx jsonb, targets text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare line jsonb; old jsonb; one jsonb; chosen jsonb; rows jsonb:='[]'; child private.recipe_cards; nested jsonb; child_baseline jsonb; child_doc jsonb;
 key text; affected boolean:=false; hit boolean; subtotal numeric; missing int; amount numeric; qty numeric; y numeric;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 for line in select value from jsonb_array_elements(coalesce(doc->'lines','[]')) loop
  key:=case when nullif(line->>'ingredient_id','') is not null then 'i:'||(line->>'ingredient_id') when nullif(line->>'product_id','') is not null then 'p:'||(line->>'product_id') else 'n:'||lower(btrim(line->>'name')) end;
  hit:=targets is not null and key=any(targets);
  select value into old from jsonb_array_elements(coalesce(baseline#>'{cost,lines}','[]')) where value->>'id'=line->>'id';
  if nullif(line->>'recipe_id','') is not null then
   one:=jsonb_build_object('id',line->>'id','amount',null,'reason','配件尚無可計算金額','price',null);
   select * into child from private.recipe_cards where store_id=s and id=(line->>'recipe_id')::uuid;
   if child.id is not null and not child.id=any(path) and cardinality(path)<20 then
    child_baseline:=case when targets is not null then coalesce(old->'child_snapshot',private.recipe_saved_snapshot(child.id)) else private.recipe_saved_snapshot(child.id) end;
    child_doc:=case when targets is not null then coalesce(child_baseline->'document',child.document) else child.document end;
    if targets is null and child_baseline->'document'=child_doc and jsonb_typeof(child_baseline->'cost')='object' then
     nested:=jsonb_build_object('affected',false,'cost',child_baseline->'cost');
    else
     nested:=private.recipe_scoped_cost(s,child_doc,child_baseline,array_append(path,child.id),idx,targets);
    end if;
    hit:=coalesce((nested->>'affected')::boolean,false);
    qty:=nullif(line->>'quantity','')::numeric;y:=nullif(child_doc->>'yield','')::numeric;
    if qty>0 and y>0 and private.recipe_unit(line->>'unit')=private.recipe_unit(child_doc->>'unit') and jsonb_typeof(nested#>'{cost,total}')='number' then
     amount:=(nested#>>'{cost,total}')::numeric*qty*private.recipe_factor(line->>'unit')/(y*private.recipe_factor(child_doc->>'unit'));
     -- Apply only this ingredient's delta to an already locked parent amount.
     -- Keep unrelated prep edits out of this confirmation, including legacy parents.
     if targets is not null and jsonb_typeof(old->'amount')='number' and jsonb_typeof(child_baseline#>'{cost,total}')='number' then
      amount:=(old->>'amount')::numeric+((nested#>>'{cost,total}')::numeric-(child_baseline#>>'{cost,total}')::numeric)*qty*private.recipe_factor(line->>'unit')/(y*private.recipe_factor(child_doc->>'unit'));
     end if;
     one:=one||jsonb_build_object('amount',amount,'reason',null,'child_snapshot',jsonb_build_object('document',child_doc,'cost',nested->'cost'));
    end if;
   end if;
  else
   -- A saved quote is per line, even when two rows use the same ingredient.
   if targets is null and jsonb_typeof(old->'price')='object' and exists(
    select 1 from jsonb_array_elements(coalesce(baseline#>'{document,lines}','[]')) b
    where b->>'id'=line->>'id' and b->>'name' is not distinct from line->>'name'
     and b->>'ingredient_id' is not distinct from line->>'ingredient_id'
     and b->>'product_id' is not distinct from line->>'product_id'
   ) then
    one:=private.recipe_cost_indexed(s,jsonb_set(doc,'{lines}',jsonb_build_array(line)),path,jsonb_build_object(key,jsonb_build_array((old->'price')||jsonb_build_object('key',key))))#>'{lines,0}';
   else
    one:=private.recipe_cost_indexed(s,jsonb_set(doc,'{lines}',jsonb_build_array(line)),path,idx)#>'{lines,0}';
   end if;
  end if;
  affected:=affected or hit;
  if targets is not null then
   chosen:=coalesce(old,one);
   if hit and jsonb_typeof(one->'amount')='number' then chosen:=one;end if;
  else
   chosen:=private.recipe_locked_cost(jsonb_set(doc,'{lines}',jsonb_build_array(line)),baseline->'document',baseline->'cost',jsonb_build_object('lines',jsonb_build_array(one)))#>'{lines,0}';
  end if;
  rows:=rows||jsonb_build_array(chosen);
 end loop;
 select coalesce(sum((value->>'amount')::numeric),0),count(*) filter(where jsonb_typeof(value->'amount') is distinct from 'number') into subtotal,missing from jsonb_array_elements(rows);
 if jsonb_array_length(rows)=0 then missing:=1;end if;
 return jsonb_build_object('affected',affected,'cost',jsonb_build_object('lines',rows,'subtotal',subtotal,'missing',missing,'total',case when missing=0 then subtotal end));
end $function$;

CREATE OR REPLACE FUNCTION private.recipe_transfer_plan(s uuid, t uuid, root_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare root private.recipe_cards; ids uuid[]; copies uuid[]; members jsonb; digest text; source_name text; target_name text; org uuid;
begin
 if not private.recipe_allowed(s,true) or not private.recipe_allowed(t,true) or private.store_access_mode(s) is distinct from 'EDIT' or private.store_access_mode(t) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id,name into org,source_name from public.stores where id=s;
 select name into target_name from public.stores where id=t and organization_id=org and id<>s and is_active;
 if not found then raise exception 'INVALID_RECIPE_TARGET' using errcode='22023';end if;
 select * into root from private.recipe_cards where id=root_id and store_id=s and document->>'kind'='dish';
 if not found then raise exception 'RECIPE_MAIN_REQUIRED' using errcode='22023';end if;
 with recursive seeds(id) as (
  select root_id union
  select r.id from private.recipe_cards r where r.store_id=s and r.document->>'kind'='prep' and (
   coalesce(root.document->'component_order','[]') ? r.id::text or
   ((nullif(root.document->>'source_import_id','') is not null and r.document->>'source_import_id'=root.document->>'source_import_id' or nullif(root.document->>'source_import_id','') is null and nullif(root.document->>'source_name','') is not null and nullif(r.document->>'source_import_id','') is null and r.document->>'source_name'=root.document->>'source_name')
    and not exists(select 1 from private.recipe_cards other where other.store_id=s and other.id<>root_id and other.document->>'kind'='dish' and (nullif(root.document->>'source_import_id','') is not null and other.document->>'source_import_id'=root.document->>'source_import_id' or nullif(root.document->>'source_import_id','') is null and nullif(other.document->>'source_import_id','') is null and other.document->>'source_name'=root.document->>'source_name')))
  )
 ), graph(id) as (
  select id from seeds union
  select (line.value->>'recipe_id')::uuid from graph g join private.recipe_cards r on r.id=g.id and r.store_id=s cross join lateral jsonb_array_elements(r.document->'lines') line where nullif(line.value->>'recipe_id','') is not null
 ) select array_agg(id order by id) into ids from graph;
 if cardinality(ids)>100 or exists(select 1 from unnest(ids) x(id) where not exists(select 1 from private.recipe_cards r where r.id=x.id and r.store_id=s)) then raise exception 'INVALID_RECIPE_REFERENCE' using errcode='22023';end if;
 with recursive shared(id) as (
  select r.id from private.recipe_cards r where r.id=any(ids) and exists(select 1 from private.recipe_cards parent where parent.store_id=s and not parent.id=any(ids) and (coalesce(parent.document->'component_order','[]') ? r.id::text or exists(select 1 from jsonb_array_elements(parent.document->'lines') line where line.value->>'recipe_id'=r.id::text)))
  union
  select (line.value->>'recipe_id')::uuid from shared sh join private.recipe_cards r on r.id=sh.id cross join lateral jsonb_array_elements(r.document->'lines') line where nullif(line.value->>'recipe_id','') is not null
 ) select coalesce(array_agg(id),'{}') into copies from shared;
 if root_id=any(copies) then raise exception 'RECIPE_SHARED_MAIN' using errcode='22023';end if;
 select jsonb_agg(jsonb_build_object('id',r.id,'name',r.document->>'name','revision',r.revision,'mode',case when r.id=any(copies) then 'copy' else 'move' end,'document',r.document) order by r.id) into members from private.recipe_cards r where r.id=any(ids);
 digest:=md5(jsonb_build_object('source',s,'target',t,'root',root_id,'members',members,'snapshots',(select jsonb_agg(private.recipe_saved_snapshot(x.id) order by x.id) from unnest(ids) x(id)))::text);
 return jsonb_build_object('token',digest,'source_name',source_name,'target_name',target_name,'recipes',(select jsonb_agg(value-'document') from jsonb_array_elements(members)),
 'duplicate_names',(select coalesce(jsonb_agg(distinct r.document->>'name'),'[]') from private.recipe_cards r where r.store_id=t and lower(btrim(r.document->>'name')) in(select lower(btrim(value->>'name')) from jsonb_array_elements(members))));
end $function$;

CREATE OR REPLACE FUNCTION private.recipe_transfer(s uuid, data jsonb, request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t uuid:=(data->>'target_store_id')::uuid; root_id uuid:=(data->>'id')::uuid; prior private.app_requests; plan jsonb; mapping jsonb:='{}'; entry jsonb; r private.recipe_cards; doc jsonb; item jsonb; new_lines jsonb; old_quotes jsonb; prices jsonb; new_id uuid; rev integer; moved jsonb:='[]'; copied jsonb:='[]'; updated jsonb:='[]'; result jsonb; org uuid; stamp timestamptz:=clock_timestamp(); lock_store uuid; new_order jsonb; snapshots jsonb:='{}'; snapshot jsonb;
begin
 if request is null or root_id is null or t is null then raise exception 'INVALID_RECIPE_TRANSFER' using errcode='22023';end if;
 if not private.recipe_allowed(s,true) or not private.recipe_allowed(t,true) or private.store_access_mode(s) is distinct from 'EDIT' or private.store_access_mode(t) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into org from public.stores where id=s;
 if s=t or not exists(select 1 from public.stores where id=t and organization_id=org and is_active) then raise exception 'INVALID_RECIPE_TARGET' using errcode='22023';end if;
 for lock_store in select x from unnest(array[s,t]) x order by x loop perform pg_advisory_xact_lock(hashtextextended('recipe:'||lock_store::text,0));end loop;
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then if prior.actor_id<>auth.uid() or prior.action<>'recipe.transfer' or prior.payload<>data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;return prior.result;end if;
 plan:=private.recipe_transfer_plan(s,t,root_id);
 if data->>'token' is distinct from plan->>'token' then raise exception 'RECIPE_TRANSFER_CHANGED' using errcode='40001';end if;
 -- Transfer the exact stored costs, never the current catalog.
 for entry in select value from jsonb_array_elements(plan->'recipes') loop
  new_id:=case when entry->>'mode'='copy' then gen_random_uuid() else (entry->>'id')::uuid end;
  mapping:=mapping||jsonb_build_object(entry->>'id',new_id);
 end loop;
 for entry in select value from jsonb_array_elements(plan->'recipes') loop
  select * into r from private.recipe_cards where id=(entry->>'id')::uuid and store_id=s;
  if not found or r.revision<>(entry->>'revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  snapshot:=private.recipe_saved_snapshot(r.id);
  if jsonb_typeof(snapshot->'cost') is distinct from 'object' then raise exception 'RECIPE_SNAPSHOT_NOT_FOUND';end if;
  doc:=r.document;new_lines:='[]';
  for item in select value from jsonb_array_elements(doc->'lines') loop
   if nullif(item->>'recipe_id','') is not null then item:=jsonb_set(item,'{recipe_id}',mapping->(item->>'recipe_id'));
   else
    item:=item-'ingredient_id';
    select coalesce(jsonb_agg(((value->'price')-'reference_id')||jsonb_build_object('key',case when nullif(item->>'product_id','') is not null then 'p:'||(item->>'product_id') else 'n:'||lower(btrim(item->>'name')) end)),'[]')
     into old_quotes from jsonb_array_elements(snapshot#>'{cost,lines}')
     where value->>'id'=item->>'id' and jsonb_typeof(value->'price')='object';
    item:=item||jsonb_build_object('transfer_prices',old_quotes,'transfer_price_at',stamp);
   end if;
   new_lines:=new_lines||jsonb_build_array(item);
  end loop;
  doc:=jsonb_set(doc,'{lines}',new_lines);
  if jsonb_typeof(doc->'component_order')='array' then
   select coalesce(jsonb_agg(coalesce(mapping->(value#>>'{}'),value) order by ordinal),'[]') into new_order from jsonb_array_elements(doc->'component_order') with ordinality as x(value,ordinal);
   doc:=jsonb_set(doc,'{component_order}',new_order);
  end if;
  doc:=doc||jsonb_build_object('last_store_transfer',jsonb_build_object('from_store_id',s,'to_store_id',t,'at',stamp,'actor_id',auth.uid(),'source_recipe_id',r.id));
  new_id:=(mapping->>r.id::text)::uuid;
  if entry->>'mode'='copy' then
   rev:=1;insert into private.recipe_cards(id,store_id,document,revision,updated_by) values(new_id,t,doc,rev,auth.uid());copied:=copied||jsonb_build_array(jsonb_build_object('from',r.id,'to',new_id));
  else
   rev:=r.revision+1;update private.recipe_cards set store_id=t,document=doc,revision=rev,updated_by=auth.uid(),updated_at=now() where id=r.id;moved:=moved||jsonb_build_array(r.id);
  end if;
  snapshots:=snapshots||jsonb_build_object(new_id::text,snapshot->'cost');
  updated:=updated||jsonb_build_array(new_id);
 end loop;
 for new_id in select (value#>>'{}')::uuid from jsonb_array_elements(updated) loop
  select * into r from private.recipe_cards where id=new_id and store_id=t;
  insert into private.recipe_versions(recipe_id,revision,document,cost_snapshot,actor_id,created_at) values(r.id,r.revision,r.document,snapshots->r.id::text,auth.uid(),now());
 end loop;
 result:=jsonb_build_object('id',root_id,'source_store_id',s,'target_store_id',t,'moved_ids',moved,'copied_ids',copied);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),'recipe.transfer',data,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id) values(org,'recipe',root_id::text,'recipe.transfer',jsonb_build_object('store_id',s),result||jsonb_build_object('at',stamp),auth.uid());
 return result;
end $function$;