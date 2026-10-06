-- Keep purchased units alongside normalized cost; do not rewrite existing prices or recipes.
alter table private.ingredient_masters add column if not exists purchase jsonb;

CREATE OR REPLACE FUNCTION private.ingredient_catalog(s uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rows jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 with aliases as (
 select ingredient_id,jsonb_agg(jsonb_build_object('id',id,'name',name,'unit',source_unit,'specification',specification,'corrected',corrected) order by name,id) items
 from private.ingredient_aliases where store_id=s group by ingredient_id
 ) select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('aliases',coalesce(a.items,'[]'::jsonb),'source',r.source,'source_kind',r.source_kind,'effective_date',r.effective_date,'purchase',coalesce(m.purchase,case when m.cost_price=coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) then r.purchase end)) order by m.name,m.unit),'[]'::jsonb) into rows
 from private.ingredient_masters m left join aliases a on a.ingredient_id=m.id
 left join private.recipe_price_entries r on r.id=m.selected_reference and r.store_id=s
 where m.store_id=s and (a.ingredient_id is not null or m.manual);
 return jsonb_build_object('ingredients',rows,'can_price',private.recipe_allowed(s,true) and private.store_access_mode(s)='EDIT');
end $function$;

CREATE OR REPLACE FUNCTION private.ingredient_operation(s uuid, action text, data jsonb, request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prior private.app_requests; m private.ingredient_masters; a private.ingredient_aliases; target private.ingredient_masters; ref private.recipe_price_entries; result jsonb; org uuid; nm text; u text; price numeric; old jsonb; purchase_value jsonb; purchase_data jsonb;
begin
 if not private.recipe_allowed(s,true) or private.store_access_mode(s) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if request is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('ingredient:'||s::text,0));
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then
  if prior.actor_id<>auth.uid() or prior.action<>action or prior.payload<>data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return prior.result;
 end if;
 select organization_id into org from public.stores where id=s;
 if action='ingredient.save' then
  if nullif(data->>'id','') is not null then
   select * into m from private.ingredient_masters where id=(data->>'id')::uuid and store_id=s for update;
   if not found then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
   if m.revision is distinct from (data->>'revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  end if;
  old:=to_jsonb(m);nm:=btrim(data->>'name');u:=private.recipe_unit(coalesce(data->>'unit',''));
  price:=nullif(data->>'cost_price','')::numeric/private.recipe_factor(coalesce(data->>'unit',''));
  if nm is null or length(nm) not between 1 and 200 or u='' or price<0 or price::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_INGREDIENT' using errcode='22023';end if;
  if nullif(data->>'selected_reference','') is not null then
   select * into ref from private.recipe_price_entries where id=(data->>'selected_reference')::uuid and store_id=s;
   if ref.id is null or not exists(select 1 from private.ingredient_aliases where ingredient_id=m.id and store_id=s and ref.id=any(reference_ids)) then raise exception 'INVALID_PRICE_REFERENCE' using errcode='22023';end if;
  end if;
  purchase_data:=case when data ? 'purchase' then nullif(data->'purchase','null'::jsonb) when ref.id is not null then ref.purchase else null end;
  if purchase_data is not null then
   purchase_value:=private.recipe_purchase_value(purchase_data,u);
   if (purchase_value->>'price')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_PURCHASE' using errcode='22023';end if;
   if data ? 'purchase' then price:=coalesce((purchase_value->>'cost_price')::numeric,(purchase_value->>'price')::numeric);end if;
  end if;
  if m.id is null then
   insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,review_status,updated_by) values(s,nm,u,price,true,case when price is null or u in ('待確認','待補單位') then 'pending' else 'confirmed' end,auth.uid()) returning * into m;
  else
   -- Keep the former canonical name searchable after a rename.
   if lower(m.name)<>lower(nm) or m.unit<>u then
    insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,corrected) values(s,m.id,m.name,'n:'||lower(btrim(m.name)),m.unit,true) on conflict do nothing;
   end if;
   update private.ingredient_masters set name=nm,unit=u,cost_price=price,selected_reference=ref.id,manual=true,review_status=case when price is null or u in ('待確認','待補單位') then 'pending' else 'confirmed' end,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=m.id returning * into m;
  end if;
  update private.ingredient_masters set purchase=purchase_data where id=m.id;
  result:=jsonb_build_object('id',m.id,'revision',m.revision);
 elsif action='ingredient.alias' then
  select * into a from private.ingredient_aliases where id=(data->>'alias_id')::uuid and store_id=s for update;
  if not found then raise exception 'INVALID_INGREDIENT_ALIAS' using errcode='22023';end if;
  select * into m from private.ingredient_masters where id=a.ingredient_id and store_id=s for update;
  if m.id is distinct from (data->>'id')::uuid or m.revision is distinct from (data->>'revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  old:=to_jsonb(a);
  if nullif(data->>'target_id','') is not null then
   select * into target from private.ingredient_masters where id=(data->>'target_id')::uuid and store_id=s for update;
   if target.id is null or target.id=m.id or target.unit<>a.source_unit then raise exception 'INVALID_INGREDIENT_TARGET' using errcode='22023';end if;
   if target.revision is distinct from (data->>'target_revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  else
   nm:=btrim(data->>'name');
   if nm is null or length(nm) not between 1 and 200 then raise exception 'INVALID_INGREDIENT' using errcode='22023';end if;
   select * into ref from private.recipe_price_entries where id=any(a.reference_ids) and store_id=s and review_status='confirmed' order by effective_date desc nulls last,created_at desc limit 1;
   insert into private.ingredient_masters(store_id,name,unit,cost_price,selected_reference,manual,review_status,updated_by)
   values(s,nm,a.source_unit,case when ref.id is not null then coalesce(ref.cost_price,ref.price)/private.recipe_factor(ref.unit) end,ref.id,true,case when ref.id is null then 'pending' else 'confirmed' end,auth.uid()) returning * into target;
  end if;
  update private.ingredient_aliases set ingredient_id=target.id,corrected=true where id=a.id;
  update private.ingredient_masters set revision=revision+1,updated_at=now(),updated_by=auth.uid(),purchase=case when selected_reference=any(a.reference_ids) then null else purchase end,cost_price=case when selected_reference=any(a.reference_ids) then null else cost_price end,review_status=case when selected_reference=any(a.reference_ids) then 'pending' else review_status end,selected_reference=case when selected_reference=any(a.reference_ids) then null else selected_reference end where id=m.id;
  update private.ingredient_masters set revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=target.id;
  result:=jsonb_build_object('id',target.id,'from_id',m.id);
 else raise exception 'INVALID_INGREDIENT_ACTION' using errcode='22023';end if;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),action,data,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id) values(org,'ingredient',result->>'id',action,old,data||result,auth.uid());
 return result;
end $function$;

CREATE OR REPLACE FUNCTION private.recipe_prices(s uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare original jsonb; result jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 original:=private.recipe_prices_before_master(s);
 with maps as materialized (
   select 'i:'||id key,unit,id ingredient_id
   from private.ingredient_masters where store_id=s
   union
   select 'n:'||lower(btrim(m.name)),m.unit,m.id
   from private.ingredient_masters m
   where m.store_id=s
     and not exists(
       select 1 from private.ingredient_aliases a
       where a.store_id=s
         and a.source_key='n:'||lower(btrim(m.name))
         and a.source_unit=m.unit
         and a.ingredient_id<>m.id
     )
   union
   select source_key,source_unit,ingredient_id
   from private.ingredient_aliases where store_id=s
 ), unique_maps as (
   select key,unit,min(ingredient_id::text)::uuid ingredient_id
   from maps
   group by key,unit
   having count(distinct ingredient_id)=1
 ), resolved as materialized (
   select distinct u.key,m.*
   from unique_maps u
   join private.ingredient_masters m on m.id=u.ingredient_id
   where m.cost_price is not null and m.review_status='confirmed'
 ), quotes as (
   select jsonb_build_object(
     'key',m.key,
     'name',m.name,
     'product_id',case when m.key like 'p:%' then substring(m.key from 3) end,
     'unit',m.unit,
     'price',m.cost_price,
     'cost_price',m.cost_price,
     'source',coalesce(r.source,'人工設定'),
     'source_kind',coalesce(r.source_kind,'manual'),
     'effective_date',coalesce(r.effective_date,m.updated_at::date),
     'recorded_at',m.updated_at,
     'reference_id',m.selected_reference,
     'source_ref',coalesce(r.source_ref,'{}'::jsonb)||jsonb_build_object('ingredient_id',m.id),
     'purchase',coalesce(coalesce(m.purchase,case when m.cost_price=coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) then r.purchase end),jsonb_build_object('amount',m.cost_price,'quantity',1,'unit',m.unit))
   ) value
   from resolved m
   left join private.recipe_price_entries r on r.id=m.selected_reference
   union all
   select x.value
   from jsonb_array_elements(original) x
   where not exists(
     select 1 from resolved m
     where m.key=x.value->>'key'
   )
 )
 select coalesce(jsonb_agg(value),'[]') into result from quotes;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION private.recipe_price_catalog_operation(s uuid, action text, data jsonb, request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare result jsonb; ref private.recipe_price_entries; master private.ingredient_masters;
begin
 if action='recipe.price' and nullif(data->>'ingredient_id','') is not null then
  select * into master from private.ingredient_masters where id=(data->>'ingredient_id')::uuid and store_id=s;
  if master.id is null then raise exception 'INVALID_INGREDIENT_TARGET' using errcode='22023';end if;
  return private.ingredient_operation(s,'ingredient.save',jsonb_build_object('id',master.id,'revision',data->'ingredient_revision','name',master.name,'unit',data->>'unit','cost_price',coalesce(nullif(data->>'cost_price',''),data->>'price'))||case when data ? 'purchase' then jsonb_build_object('purchase',data->'purchase') else '{}'::jsonb end,request);
 end if;
 result:=private.recipe_safe_operation(s,action,data,request);
 if action='recipe.price' then
  select * into ref from private.recipe_price_entries where id=(result->>'id')::uuid and store_id=s;
  if ref.id is not null then
   perform private.seed_ingredient_masters(s);
   update private.ingredient_masters m set purchase=ref.purchase,cost_price=coalesce(ref.cost_price,ref.price)/private.recipe_factor(ref.unit),selected_reference=ref.id,review_status='confirmed',manual=true,revision=revision+1,updated_at=now(),updated_by=auth.uid()
   from private.ingredient_aliases a where a.ingredient_id=m.id and a.store_id=s and ref.id=any(a.reference_ids) and m.selected_reference is distinct from ref.id;
  end if;
 end if;
 return result;
end $function$;

notify pgrst,'reload schema';