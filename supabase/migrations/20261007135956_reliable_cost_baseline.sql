-- Shared, date-bounded costing. Source quotes and saved transaction snapshots stay intact.
create or replace function private.cost_name_key(raw text) returns text
language sql immutable security invoker set search_path='' as $$
 select lower(regexp_replace(private.ingredient_name(regexp_replace(normalize(coalesce(raw,''),NFKC),'[[:space:]]*·[[:space:]]*原表計價基準:.*$','','g'),''),'[[:space:]]+','','g'))
$$;
revoke all on function private.cost_name_key(text) from public,anon,authenticated;

create or replace function private.cost_purchase_price(p jsonb,u text) returns numeric
language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb;
begin
 if p is null or nullif(btrim(u),'') is null then return null;end if;
 v:=private.recipe_purchase_value(p,u);
 return (v->>'price')::numeric*private.recipe_factor(u);
 exception when sqlstate '22023' or invalid_text_representation or numeric_value_out_of_range or division_by_zero then return null;
end $$;
revoke all on function private.cost_purchase_price(jsonb,text) from public,anon,authenticated;

create index if not exists recipe_price_cost_name on private.recipe_price_entries(store_id,private.cost_name_key(name));
create index if not exists ingredient_alias_cost_name on private.ingredient_aliases(store_id,private.cost_name_key(name));
create index if not exists ingredient_cost_name on private.ingredient_masters(store_id,private.cost_name_key(name));

create or replace function private.cost_quote(s uuid,product uuid,nm text,u text,at_date date) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare chosen record; product_name text; specs text; result jsonb; target_date date:=coalesce(at_date,(now() at time zone 'Asia/Taipei')::date);
begin
 if s is null or nullif(btrim(u),'') is null then return jsonb_build_object('price',null,'reason','待補計價單位');end if;
 if product is not null then
  select p.name,coalesce(p.specification,'') into product_name,specs from public.products p
  join public.stores st on st.organization_id=p.organization_id where st.id=s and p.id=product;
  if product_name is null then return jsonb_build_object('price',null,'reason','品項不屬於此門市');end if;
 else product_name:=nm;specs:='';end if;
 if nullif(btrim(product_name),'') is null then return jsonb_build_object('price',null,'reason','待補品名');end if;
 -- Explicitly saved prices and corrected identity links win; do not overwrite human work.
 select m.*,case when m.unit=private.recipe_unit(u) then m.cost_price*private.recipe_factor(u)
  else private.cost_purchase_price(m.purchase,u) end value into chosen
 from private.ingredient_masters m
 where m.store_id=s and m.manual and m.review_status='confirmed' and m.cost_price is not null
 and (private.cost_name_key(m.name)=private.cost_name_key(product_name) or exists(
 select 1 from private.ingredient_aliases a where a.store_id=s and a.ingredient_id=m.id
 and (a.source_key='p:'||product::text or private.cost_name_key(a.name)=private.cost_name_key(product_name))))
 and (m.unit=private.recipe_unit(u) or private.cost_purchase_price(m.purchase,u) is not null)
 order by m.updated_at desc,m.id limit 1;
 if found then return jsonb_build_object('price',chosen.value,'source','人工確認','date',null,'reference_id',chosen.selected_reference,'basis','manual');end if;
 with linked as materialized (
  select a.ingredient_id,a.reference_ids,a.corrected
  from private.ingredient_aliases a
  where a.store_id=s and (a.source_key='p:'||product::text or private.cost_name_key(a.name)=private.cost_name_key(product_name))
 ), candidates as materialized (
  select r.*,case when r.purchase is not null then private.cost_purchase_price(r.purchase,u)
   when private.recipe_unit(r.unit)=private.recipe_unit(u) then r.price/private.recipe_factor(r.unit)*private.recipe_factor(u) end value,
   exists(select 1 from linked a where a.corrected and r.id=any(a.reference_ids)) corrected,
   case when r.source_kind='purchase' then 0 when r.source_kind='manual' then 1 else 2 end priority
  from private.recipe_price_entries r
  where r.store_id=s and r.review_status='confirmed' and r.price is not null
  and coalesce(r.source_ref->>'missing_price','false')<>'true'
  and (r.source_kind='history' or r.effective_date is null or r.effective_date<=target_date)
  and (r.product_id=product or private.cost_name_key(r.name)=private.cost_name_key(product_name)
   or exists(select 1 from linked a where r.id=any(a.reference_ids)))
  and (coalesce(r.source_ref->>'specification','')='' or r.source_ref->>'specification' like '原表計價基準:%'
   or r.source_ref->>'specification'=specs or r.product_id=product
   or exists(select 1 from linked a where a.corrected and r.id=any(a.reference_ids)))
 ), ranked as (
  select * from candidates where value is not null and value>=0
  order by priority,effective_date desc nulls last,
   (source like '請購表%') desc,created_at desc,id desc limit 1
 ) select jsonb_build_object('price',value,'source',case when source_kind='history' then '食譜參考價 · '||source else source end,
  'date',case when source_kind='history' then null else effective_date end,'reference_id',id,
  'basis',case when source_kind='history' then 'recipe_reference' else 'purchase' end) into result from ranked;
 -- Legacy catalog prices and explicit package corrections have preserved purchase evidence.
 if result is null or result->>'basis'='recipe_reference' then
  select m.*,private.cost_purchase_price(m.purchase,u) value into chosen
  from private.ingredient_masters m where m.store_id=s and not m.manual and m.review_status='confirmed'
  and m.cost_price is not null and private.cost_purchase_price(m.purchase,u) is not null
  and (m.selected_reference is null and m.purchase->>'source'='歷史進貨' or exists(
   select 1 from private.ingredient_aliases a where a.store_id=s and a.ingredient_id=m.id and a.corrected and a.source_key='p:'||product::text))
  and (private.cost_name_key(m.name)=private.cost_name_key(product_name) or exists(
   select 1 from private.ingredient_aliases a where a.store_id=s and a.ingredient_id=m.id and a.source_key='p:'||product::text))
  and (nullif(m.purchase->>'effective_date','') is null or (m.purchase->>'effective_date')::date<=target_date)
  order by m.purchase->>'effective_date' desc nulls last,m.updated_at desc,m.id limit 1;
  if found then result:=jsonb_build_object('price',chosen.value,'source',coalesce(chosen.purchase->>'source','已確認規格換算'),
    'date',chosen.purchase->>'effective_date','reference_id',chosen.selected_reference,'basis','purchase');end if;
 end if;
 return coalesce(result,jsonb_build_object('price',null,'reason','缺少相符規格的價格或單位換算'));
end $$;
revoke all on function private.cost_quote(uuid,uuid,text,text,date) from public,anon,authenticated;

create or replace function private.ingredient_price_quote(p_store uuid,p_product uuid,p_unit text) returns numeric
language sql stable security definer set search_path='' as $$
 select (private.cost_quote(p_store,p_product,null,p_unit,(now() at time zone 'Asia/Taipei')::date)->>'price')::numeric
$$;
revoke all on function private.ingredient_price_quote(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.baihuayuan_cost_quotes(p_store_id uuid,p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare item jsonb; answer jsonb:='[]'; source_store uuid; org uuid;
begin
 if auth.uid() is null or not private.recipe_allowed(p_store_id) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into org from public.stores where id=p_store_id and is_active and name in ('BeApe','Gras');
 if org is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>500 then raise exception 'INVALID_PRICE_REQUEST';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  source_store:=p_store_id;
  if nullif(item->>'from','') is not null then
   select id into source_store from public.stores where organization_id=org and is_active and name=item->>'from' and name in ('BeApe','Gras');
   if source_store is null or not private.recipe_allowed(source_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  end if;
  answer:=answer||jsonb_build_array(private.cost_quote(source_store,nullif(item->>'product_id','')::uuid,item->>'name',item->>'unit',nullif(item->>'date','')::date));
 end loop;
 return answer;
end $$;
revoke all on function public.baihuayuan_cost_quotes(uuid,jsonb) from public,anon;
grant execute on function public.baihuayuan_cost_quotes(uuid,jsonb) to authenticated;

-- Only unclosed/unlocked inventory reads use the month-end reference; closure snapshots return earlier.
do $patch$
declare original text; revised text;
begin
 original:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
 revised:=replace(original,'private.ingredient_price_quote(p_store,nullif(x.c->>''product_id'','''')::uuid,x.c->>''unit'')',
 '(private.cost_quote(p_store,nullif(x.c->>''product_id'','''')::uuid,x.c->>''name'',x.c->>''unit'',(p_month+interval ''1 month - 1 day'')::date)->>''price'')::numeric');
 if revised=original then raise exception 'Inventory price source changed';end if;execute revised;
 -- New desktop movements can use a quote without requiring manual retyping.
 original:=pg_get_functiondef('public.save_baihuayuan_sheet_row(uuid,text,uuid,jsonb,jsonb,uuid)'::regprocedure);
 revised:=replace(original,'if price is null then raise exception ''TRANSFER_PRICE_REQUIRED'';end if;',
 'price:=coalesce(price,(private.cost_quote(source_store,product,null,unit_name,(p_value->>''date'')::date)->>''price'')::numeric);'||chr(10)||'   if price is null then raise exception ''TRANSFER_PRICE_REQUIRED'';end if;');
 revised:=replace(revised,'result:=public.create_baihuayuan_waste_backfill(p_store_id,product,qty,unit_name,p_value->>''reason'',price,',
 'price:=coalesce(price,(private.cost_quote(p_store_id,product,null,unit_name,(p_value->>''date'')::date)->>''price'')::numeric);'||chr(10)||'   result:=public.create_baihuayuan_waste_backfill(p_store_id,product,qty,unit_name,p_value->>''reason'',price,');
 if revised=original then raise exception 'Sheet price source changed';end if;execute revised;
end $patch$;
notify pgrst,'reload schema';
