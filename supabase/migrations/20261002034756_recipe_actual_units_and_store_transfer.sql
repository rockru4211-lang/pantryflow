-- Additive recipe upgrade. No existing recipes, prices, inventory or receipts are rewritten.
create or replace function private.recipe_effective_prices(line jsonb, current_prices jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare prices jsonb; item_key text; original jsonb; normalized jsonb;
begin
 item_key:=case when nullif(line->>'product_id','') is not null then 'p:'||(line->>'product_id') else 'n:'||lower(btrim(line->>'name')) end;
 select coalesce(jsonb_agg(value),'[]') into prices from jsonb_array_elements(current_prices) where value->>'key'=item_key;
 if jsonb_typeof(line->'transfer_prices')='array' and nullif(line->>'transfer_price_at','') is not null then
  select coalesce(jsonb_agg(value),'[]') into prices from jsonb_array_elements(prices) where nullif(value->>'recorded_at','')::timestamptz>(line->>'transfer_price_at')::timestamptz;
  select prices||coalesce(jsonb_agg(old.value),'[]') into prices from jsonb_array_elements(line->'transfer_prices') old where old.value->>'key'=item_key and not exists(select 1 from jsonb_array_elements(prices) newer where newer.value->>'unit'=old.value->>'unit');
 end if;
 if not exists(select 1 from jsonb_array_elements(prices) where value->>'unit'=private.recipe_unit(line->>'unit')) then
  select value into original from jsonb_array_elements(prices) where private.recipe_unit(value->'purchase'->>'unit')=private.recipe_unit(line->>'unit') order by coalesce(value->>'recorded_at',value->>'effective_date','') desc limit 1;
  if original is not null then
   normalized:=private.recipe_purchase_value(original->'purchase',line->>'unit');
   prices:=jsonb_build_array(original||jsonb_build_object('unit',normalized->>'unit','price',normalized->'price','cost_price',normalized->'cost_price'))||prices;
  end if;
 end if;
 return prices;
end $$;
revoke all on function private.recipe_effective_prices(jsonb,jsonb) from public;

create or replace function private.recipe_cost(s uuid,doc jsonb,visited uuid[] default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare line jsonb; price jsonb; direct jsonb; child jsonb; result jsonb; lines jsonb:='[]'; total numeric:=0; amount numeric; qty numeric; child_id uuid; missing integer:=0; reason text; basis jsonb; each_price numeric; item_key text; piece boolean; prices jsonb; all_prices jsonb; explicit_package boolean;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 all_prices:=private.recipe_prices(s);
 if cardinality(visited)>20 then raise exception 'INVALID_RECIPE_CYCLE' using errcode='22023';end if;
 for line in select value from jsonb_array_elements(coalesce(doc->'lines','[]')) loop
  amount:=null;reason:=null;price:=null;direct:=null;qty:=nullif(line->>'quantity','')::numeric;
  if qty is null or qty<=0 or nullif(btrim(line->>'unit'),'') is null then reason:='待填用量';
  elsif nullif(line->>'recipe_id','') is not null then
   child_id:=(line->>'recipe_id')::uuid;
   if child_id=any(visited) then raise exception 'INVALID_RECIPE_CYCLE' using errcode='22023';end if;
   select document into child from private.recipe_cards where id=child_id and store_id=s;
   if child is null then raise exception 'INVALID_RECIPE_REFERENCE' using errcode='22023';end if;
   result:=private.recipe_cost(s,child,array_append(visited,child_id));
   if result->>'total' is null then reason:='備料成本未完整';
   elsif nullif(child->>'yield','')::numeric is null or (child->>'yield')::numeric<=0 then reason:='待填製成量';
   elsif private.recipe_unit(child->>'unit')<>private.recipe_unit(line->>'unit') then reason:='待確認單位換算';
   else amount:=(result->>'total')::numeric*qty*private.recipe_factor(line->>'unit')/((child->>'yield')::numeric*private.recipe_factor(child->>'unit'));end if;
  else
   item_key:=case when nullif(line->>'product_id','') is not null then 'p:'||(line->>'product_id') else 'n:'||lower(btrim(line->>'name')) end;
   prices:=private.recipe_effective_prices(line,all_prices);
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
end $$;

create or replace function private.recipe_transfer_plan(s uuid,t uuid,root_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 digest:=md5(jsonb_build_object('source',s,'target',t,'root',root_id,'members',members,'prices',private.recipe_prices(s))::text);
 return jsonb_build_object('token',digest,'source_name',source_name,'target_name',target_name,'recipes',(select jsonb_agg(value-'document') from jsonb_array_elements(members)),
 'duplicate_names',(select coalesce(jsonb_agg(distinct r.document->>'name'),'[]') from private.recipe_cards r where r.store_id=t and lower(btrim(r.document->>'name')) in(select lower(btrim(value->>'name')) from jsonb_array_elements(members))));
end $$;
revoke all on function private.recipe_transfer_plan(uuid,uuid,uuid) from public;
grant execute on function private.recipe_transfer_plan(uuid,uuid,uuid) to authenticated;

create or replace function private.recipe_transfer(s uuid,data jsonb,request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=(data->>'target_store_id')::uuid; root_id uuid:=(data->>'id')::uuid; prior private.app_requests; plan jsonb; mapping jsonb:='{}'; entry jsonb; r private.recipe_cards; doc jsonb; item jsonb; new_lines jsonb; old_quotes jsonb; prices jsonb; new_id uuid; rev integer; moved jsonb:='[]'; copied jsonb:='[]'; updated jsonb:='[]'; result jsonb; org uuid; stamp timestamptz:=clock_timestamp(); lock_store uuid; new_order jsonb;
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
 prices:=private.recipe_prices(s);
 for entry in select value from jsonb_array_elements(plan->'recipes') loop
  new_id:=case when entry->>'mode'='copy' then gen_random_uuid() else (entry->>'id')::uuid end;
  mapping:=mapping||jsonb_build_object(entry->>'id',new_id);
 end loop;
 for entry in select value from jsonb_array_elements(plan->'recipes') loop
  select * into r from private.recipe_cards where id=(entry->>'id')::uuid and store_id=s;
  if not found or r.revision<>(entry->>'revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  doc:=r.document;new_lines:='[]';
  for item in select value from jsonb_array_elements(doc->'lines') loop
   if nullif(item->>'recipe_id','') is not null then item:=jsonb_set(item,'{recipe_id}',mapping->(item->>'recipe_id'));
   else
    select coalesce(jsonb_agg((value-'reference_id')||jsonb_build_object('source','移轉保留 · '||coalesce(value->>'source','原價格'))),'[]') into old_quotes from jsonb_array_elements(private.recipe_effective_prices(item,prices));
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
  updated:=updated||jsonb_build_array(new_id);
 end loop;
 for new_id in select (value#>>'{}')::uuid from jsonb_array_elements(updated) loop
  select * into r from private.recipe_cards where id=new_id and store_id=t;
  insert into private.recipe_versions(recipe_id,revision,document,cost_snapshot,actor_id,created_at) values(r.id,r.revision,r.document,private.recipe_cost(t,r.document,array[r.id]),auth.uid(),now());
 end loop;
 result:=jsonb_build_object('id',root_id,'source_store_id',s,'target_store_id',t,'moved_ids',moved,'copied_ids',copied);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),'recipe.transfer',data,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id) values(org,'recipe',root_id::text,'recipe.transfer',jsonb_build_object('store_id',s),result||jsonb_build_object('at',stamp),auth.uid());
 return result;
end $$;
revoke all on function private.recipe_transfer(uuid,jsonb,uuid) from public;
grant execute on function private.recipe_transfer(uuid,jsonb,uuid) to authenticated;

create or replace function private.recipe_safe_operation(s uuid,action text,data jsonb,request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
 if not private.recipe_allowed(s,action='recipe.price') or private.store_access_mode(s) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if action='recipe.save' then
  for item in select value from jsonb_array_elements(coalesce(data->'document'->'lines','[]')) loop
   -- The browser cannot invent a price snapshot to bypass administrative pricing rights.
   if item ? 'transfer_prices' or item ? 'transfer_price_at' then
    if not exists(select 1 from private.recipe_cards r cross join lateral jsonb_array_elements(r.document->'lines') old where r.store_id=s and old.value->'transfer_prices'=item->'transfer_prices' and old.value->'transfer_price_at'=item->'transfer_price_at') then raise exception 'INVALID_TRANSFER_PRICE_SNAPSHOT' using errcode='22023';end if;
   end if;
  end loop;
 end if;
 return private.recipe_operation(s,action,data,request);
end $$;
revoke all on function private.recipe_safe_operation(uuid,text,jsonb,uuid) from public;
grant execute on function private.recipe_safe_operation(uuid,text,jsonb,uuid) to authenticated;

create or replace function private.recipe_workspace_tools(s uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; moved jsonb;
begin
 result:=private.recipe_workspace(s);
 select coalesce(jsonb_agg(distinct x.value),'[]') into moved from private.app_requests a cross join lateral jsonb_array_elements(a.result->'moved_ids') x where a.store_id=s and a.action='recipe.transfer' and exists(select 1 from private.recipe_cards r where r.id=(x.value#>>'{}')::uuid and r.store_id<>s);
 return result||jsonb_build_object('moved_recipe_ids',moved);
end $$;
revoke all on function private.recipe_workspace_tools(uuid) from public;
grant execute on function private.recipe_workspace_tools(uuid) to authenticated;

create or replace function public.app_workspace(p_store_id uuid,p_section text,p_filter jsonb default '{}')
returns jsonb language sql stable set search_path='' as $$
 select case when p_section='recipes' then private.recipe_workspace_tools(p_store_id) when p_section='recipe.transfer' then private.recipe_transfer_plan(p_store_id,(p_filter->>'target_store_id')::uuid,(p_filter->>'id')::uuid) else private.app_workspace(p_store_id,p_section,p_filter) end
$$;
create or replace function public.app_operation(p_store_id uuid,p_action text,p_data jsonb,p_request_id uuid)
returns jsonb language sql set search_path='' as $$
 select case when p_action='recipe.transfer' then private.recipe_transfer(p_store_id,p_data,p_request_id) when p_action like 'recipe.%' then private.recipe_safe_operation(p_store_id,p_action,p_data,p_request_id) else private.app_operation(p_store_id,p_action,p_data,p_request_id) end
$$;
