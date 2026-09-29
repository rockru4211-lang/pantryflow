-- Additive recipe workspace. Keep all existing operation dispatchers and data intact.
create table private.recipe_cards (
 id uuid primary key, store_id uuid not null references public.stores(id),
 document jsonb not null, revision integer not null default 1,
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create index on private.recipe_cards(store_id);
create table private.recipe_versions (
 recipe_id uuid not null references private.recipe_cards(id), revision integer not null,
 document jsonb not null, cost_snapshot jsonb not null, actor_id uuid not null,
 created_at timestamptz not null default now(), primary key(recipe_id,revision)
);
create table private.recipe_price_entries (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
 name text not null, product_id uuid references public.products(id), unit text not null,
 price numeric not null check(price>=0), source text not null, effective_date date not null,
 actor_id uuid not null, created_at timestamptz not null default now()
);
create index on private.recipe_price_entries(store_id,product_id,unit,effective_date desc);
alter table private.recipe_cards enable row level security;
alter table private.recipe_versions enable row level security;
alter table private.recipe_price_entries enable row level security;
revoke all on private.recipe_cards,private.recipe_versions,private.recipe_price_entries from public,anon,authenticated;

create function private.recipe_unit(u text) returns text language sql immutable set search_path='' as $$
 select case lower(btrim(u)) when '公斤' then 'g' when 'kg' then 'g' when '公克' then 'g' when '克' then 'g' when 'g' then 'g' when '台斤' then 'g' when '斤' then 'g' when 'l' then 'ml' when '公升' then 'ml' when '毫升' then 'ml' else lower(btrim(u)) end
$$;
create function private.recipe_factor(u text) returns numeric language sql immutable set search_path='' as $$
 select case lower(btrim(u)) when '公斤' then 1000 when 'kg' then 1000 when '斤' then 600 when '台斤' then 600 when 'l' then 1000 when '公升' then 1000 else 1 end
$$;
create function private.recipe_allowed(s uuid,prices boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(private.app_role(s),'')=any(case when prices then array['OWNER','LOGISTICS'] else array['OWNER','LOGISTICS','SUPERVISOR'] end)
 and exists(select 1 from public.stores st join public.organizations o on o.id=st.organization_id where st.id=s and st.is_active and o.business_type::text='SINGLE_RESTAURANT')
$$;
create function private.recipe_prices(s uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select distinct on(key,unit) * from (
 select 'p:'||l.product_id key,p.name,l.product_id,private.recipe_unit(l.unit) unit,
 l.unit_price_ex_tax/private.recipe_factor(l.unit) price,'已核對進貨'::text source,g.receipt_date effective_date,coalesce(g.reviewed_at,l.created_at) recorded_at,l.id::text source_id,sp.name supplier_name
 from public.receipt_lines l join public.goods_receipts g on g.id=l.receipt_id
 join public.receipt_upload_batches b on b.id=g.source_batch_id join public.products p on p.id=l.product_id
 left join public.suppliers sp on sp.id=g.supplier_id
 where g.store_id=s and b.status::text='COMPLETED' and l.unit_price_ex_tax>=0 and l.quantity>0 and nullif(btrim(l.unit),'') is not null
 union all
 select case when product_id is not null then 'p:'||product_id else 'n:'||lower(btrim(name)) end,name,product_id,private.recipe_unit(unit),price/private.recipe_factor(unit),source,effective_date,created_at,id::text,null::text
 from private.recipe_price_entries where store_id=s
 ) candidates order by key,unit,effective_date desc,recorded_at desc,source_id desc
 ) x where private.recipe_allowed(s)
$$;
create function private.recipe_cost(s uuid,doc jsonb,visited uuid[] default '{}') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare line jsonb; price jsonb; child jsonb; result jsonb; lines jsonb:='[]'; total numeric:=0; amount numeric; qty numeric; child_id uuid; missing integer:=0; reason text;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if cardinality(visited)>20 then raise exception 'INVALID_RECIPE_CYCLE' using errcode='22023';end if;
 for line in select value from jsonb_array_elements(coalesce(doc->'lines','[]')) loop
  amount:=null;reason:=null;price:=null;qty:=nullif(line->>'quantity','')::numeric;
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
   select value into price from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'=case when nullif(line->>'product_id','') is not null then 'p:'||(line->>'product_id') else 'n:'||lower(btrim(line->>'name')) end and value->>'unit'=private.recipe_unit(line->>'unit') limit 1;
   if price is null then reason:='待補價格或換算';else amount:=(price->>'price')::numeric*qty*private.recipe_factor(line->>'unit');end if;
  end if;
  if amount is null then missing:=missing+1;else total:=total+amount;end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('id',line->>'id','amount',amount,'reason',reason,'price',price));
 end loop;
 if jsonb_array_length(lines)=0 then missing:=missing+1;end if;
 return jsonb_build_object('total',case when missing=0 then total end,'subtotal',total,'missing',missing,'lines',lines);
end $$;
create function private.recipe_workspace(s uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('can_price',private.recipe_allowed(s,true),
 'recipes',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('cost',private.recipe_cost(s,r.document,array[r.id])) order by updated_at desc),'[]') from private.recipe_cards r where store_id=s),
 'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit,'specification',p.specification) order by p.name),'[]') from public.products p join public.stores st on st.organization_id=p.organization_id where st.id=s and p.is_active),
 'prices',private.recipe_prices(s));
end $$;
create function private.recipe_operation(s uuid,action text,data jsonb,request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior private.app_requests; card private.recipe_cards; doc jsonb; item jsonb; result jsonb; v_id uuid; org uuid; rev integer; cost jsonb;
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
  insert into private.recipe_price_entries(store_id,name,product_id,unit,price,source,effective_date,actor_id)
  values(s,btrim(data->>'name'),nullif(data->>'product_id','')::uuid,data->>'unit',(data->>'price')::numeric,data->>'source',(data->>'effective_date')::date,auth.uid()) returning id into v_id;
  result:=jsonb_build_object('id',v_id);
 else raise exception 'INVALID_RECIPE_ACTION' using errcode='22023';end if;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),action,data,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id) values(org,'recipe',v_id::text,action,jsonb_build_object('store_id',s,'revision',rev),auth.uid());
 return result;
end $$;
revoke all on function private.recipe_unit(text),private.recipe_factor(text),private.recipe_allowed(uuid,boolean),private.recipe_prices(uuid),private.recipe_cost(uuid,jsonb,uuid[]),private.recipe_workspace(uuid),private.recipe_operation(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.recipe_workspace(uuid),private.recipe_operation(uuid,text,jsonb,uuid) to authenticated;
-- Public invoker wrappers retain every existing private dispatch behavior.
create or replace function public.app_workspace(p_store_id uuid,p_section text,p_filter jsonb default '{}') returns jsonb language sql stable security invoker set search_path='' as $$
 select case when p_section='recipes' then private.recipe_workspace(p_store_id) else private.app_workspace(p_store_id,p_section,p_filter) end
$$;
create or replace function public.app_operation(p_store_id uuid,p_action text,p_data jsonb,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select case when p_action like 'recipe.%' then private.recipe_operation(p_store_id,p_action,p_data,p_request_id) else private.app_operation(p_store_id,p_action,p_data,p_request_id) end
$$;
notify pgrst,'reload schema';
