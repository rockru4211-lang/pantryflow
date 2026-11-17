-- Register an ingredient once when a reviewed receipt line is projected. The
-- existing price import then attaches its evidence to this product alias.
create function private.receipt_entry_ingredient(
  s uuid, org uuid, product uuid, line jsonb, vendor text, vendor_id uuid, package_spec text
)
returns uuid language plpgsql set search_path='' as $$
declare
  unit_key text:=private.recipe_unit(line->>'unit');
  catalog_name text:=private.ingredient_name(line->>'product_name',line->>'unit')
    ||case when package_spec<>'' then ' · '||package_spec else '' end;
  receipt_name text:=private.ingredient_match_text(coalesce(nullif(line->>'supplier_item_name',''),line->>'product_name'));
  vendor_name text:=private.ingredient_match_text(private.supplier_display_name(org,vendor));
  vendor_key text:=coalesce('id:'||vendor_id::text,'name:'||vendor_name);
  explicit_id uuid:=nullif(line->>'ingredient_id','')::uuid;
  product_ingredient uuid;
  ingredient uuid;
  matches uuid[];
  related_name text:=regexp_replace(receipt_name,'\s*\([^)]+\)$','');
begin
  if line->'ingredient_match_pending'='true'::jsonb then return null; end if;

  select coalesce(m.canonical_ingredient_id,m.id) into product_ingredient
  from private.ingredient_aliases a
  join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=s
  where a.store_id=s and a.source_key='p:'||product and a.source_unit=unit_key
    and a.specification=package_spec;
  if explicit_id is not null then
    select coalesce(m.canonical_ingredient_id,m.id) into ingredient
    from private.ingredient_masters m where m.id=explicit_id and m.store_id=s;
    if ingredient is null or (product_ingredient is not null and product_ingredient<>ingredient) then
      return null;
    end if;
  else
    select array_agg(distinct coalesce(m.canonical_ingredient_id,m.id)) into matches
    from private.receipt_ingredient_bindings b
    join private.ingredient_masters m on m.id=b.ingredient_id and m.store_id=s
    where b.store_id=s and b.name=receipt_name
      and b.unit=private.ingredient_match_text(coalesce(line->>'supplier_item_unit',line->>'unit'))
      and b.specification=private.ingredient_match_text(coalesce(line->>'supplier_item_specification',line->>'specification'))
      and (b.supplier=vendor_name or vendor_id=private.supplier_identity(org,b.supplier));
    if cardinality(matches)>1 or (product_ingredient is not null and matches[1]<>product_ingredient) then
      return null;
    end if;
    ingredient:=coalesce(product_ingredient,matches[1]);

    if ingredient is null then
      select array_agg(distinct coalesce(m.canonical_ingredient_id,m.id)) into matches
      from private.ingredient_masters m
      where m.store_id=s and m.unit=unit_key
        and private.ingredient_match_text(m.name)=private.ingredient_match_text(catalog_name)
        and (package_spec<>'' or not exists (
          select 1 from private.ingredient_aliases a
          where a.store_id=s and a.ingredient_id=m.id and a.specification<>''
        ));
      if cardinality(matches)>1 then return null; end if;
      ingredient:=matches[1];
    end if;
  end if;

  if ingredient is not null then
    if exists (
      select 1 from private.ingredient_supply_state st where st.store_id=s and st.ingredient_id=ingredient
        and st.supplier_key in ('*',vendor_key,'name:'||vendor_name) and st.stopped
    ) then return null; end if;
    return ingredient;
  end if;

  -- A close name only signals review. Confirming a separate package can create
  -- its own identity after exact matches and saved supplier names are checked.
  if line->'create_ingredient' is distinct from 'true'::jsonb and exists (
    select 1 from private.ingredient_masters m
    where m.store_id=s
      and regexp_replace(private.ingredient_match_text(split_part(m.name,' · ',1)),'\s*\([^)]+\)$','')=related_name
    union all
    select 1 from private.ingredient_aliases a
    where a.store_id=s and private.ingredient_match_text(a.name)=receipt_name
    union all
    select 1 from private.ingredient_usage_names n
    where n.store_id=s and receipt_name in (private.ingredient_match_text(n.formal_name),private.ingredient_match_text(n.count_name))
  ) then return null; end if;

  if length(catalog_name)>200 then return null; end if;
  insert into private.ingredient_masters(store_id,name,unit,category,updated_by)
  values(s,catalog_name,unit_key,case when line->>'category' in ('食材','耗材','調料','酒水') then line->>'category' end,auth.uid())
  on conflict do nothing returning id into ingredient;
  if ingredient is null then return null; end if;

  -- A product shared by both stores may already have an official code. Keep
  -- each store's price and count records scoped while following that code.
  select array_agg(distinct coalesce(link.target_id,m.canonical_ingredient_id,m.id)) into matches
  from public.stores peer
  join private.ingredient_aliases a on a.store_id=peer.id and a.source_key='p:'||product
    and a.source_unit=unit_key and a.specification=package_spec
  join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=peer.id
  left join private.ingredient_code_links link on link.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)
  where peer.id<>s and peer.organization_id=org and peer.is_active and peer.name in ('BeApe','Gras');
  if cardinality(matches)=1 then
    insert into private.ingredient_code_links(ingredient_id,target_id,actor_id)
    values(ingredient,matches[1],auth.uid());
  end if;
  return ingredient;
end $$;
revoke all on function private.receipt_entry_ingredient(uuid,uuid,uuid,jsonb,text,uuid,text) from public,anon,authenticated;

create function private.receipt_entry_ingredient_product(s uuid, org uuid, ingredient uuid, unit_name text, package_spec text)
returns uuid language sql stable set search_path='' as $$
  select (array_agg(distinct p.id))[1]
  from private.ingredient_aliases a
  join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=s
  join public.products p on a.source_key='p:'||p.id
  where a.store_id=s and coalesce(m.canonical_ingredient_id,m.id)=ingredient
    and p.organization_id=org and p.is_active
    and private.recipe_unit(p.base_unit)=private.recipe_unit(unit_name)
    and private.recipe_factor(p.base_unit)=private.recipe_factor(unit_name)
    and private.history_key(p.specification)=private.history_key(package_spec)
  having count(distinct p.id)=1
$$;
revoke all on function private.receipt_entry_ingredient_product(uuid,uuid,uuid,text,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.sync_receipt_entry_items(p_batch uuid, p_account jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  batch public.receipt_upload_batches;
  line jsonb;
  product uuid;
  ingredient uuid;
  product_spec text;
  supplier uuid;
  item_name text;
  item_spec text;
  unit_name text;
  unit_key text;
  item_price numeric;
  active_keys text[]:='{}';
  date_received date:=private.receipt_account_date(p_account->>'receipt_date');
begin
  select * into strict batch from public.receipt_upload_batches where id=p_batch;
  if batch.store_name not in ('BeApe','Gras') or batch.status='COMPLETED'
    or exists(select 1 from public.goods_receipts where source_batch_id=p_batch)
    or p_account->>'record_state' is distinct from 'LIVE' or date_received is null
  then return; end if;

  supplier:=private.supplier_identity(batch.organization_id,p_account->>'supplier_name');
  -- Serialize shared identities across both stores. The existing resolver
  -- still handles product creation and its compatibility with direct entry.
  perform pg_advisory_xact_lock(hashtextextended('receipt-entry-products:'||batch.organization_id,0));
  for line in select value from jsonb_array_elements(p_account->'lines') loop
    if coalesce(line->>'handling','NORMAL')<>'NORMAL' or line->'ingredient_match_pending'='true'::jsonb then continue; end if;
    item_name:=btrim(coalesce(line->>'product_name',''));
    item_spec:=btrim(coalesce(line->>'specification',''));
    unit_name:=btrim(coalesce(line->>'unit',''));
    unit_key:=private.recipe_unit(unit_name);
    item_price:=private.receipt_account_number(line->>'unit_price');
    if item_name in ('','未命名品項') or item_name ~ '^(其他)?(運費|運送費|配送費|宅配費)([（(].*[）)])?$' or unit_name='' or item_price is null
      or coalesce(private.receipt_account_number(line->>'quantity'),0)<=0 then continue; end if;

    product:=null;
    if nullif(line->>'ingredient_id','') is not null then
      product:=private.receipt_entry_ingredient_product(batch.store_id,batch.organization_id,
        (line->>'ingredient_id')::uuid,unit_name,item_spec);
    end if;
    if product is null then
      select p.id into product from public.products p
      where p.organization_id=batch.organization_id and p.is_active
        and private.recipe_unit(p.base_unit)=unit_key and private.recipe_factor(p.base_unit)=private.recipe_factor(unit_name)
        and private.history_key(p.specification)=private.history_key(item_spec)
        and private.history_key(p.name)=private.history_key(item_name)
      order by (p.id::text=line->>'product_id') desc nulls last,p.created_at,p.id limit 1;
    end if;
    if product is null and exists(select 1 from public.products p where p.organization_id=batch.organization_id and not p.is_active
        and private.recipe_unit(p.base_unit)=unit_key and private.history_key(p.specification)=private.history_key(item_spec)
        and private.history_key(p.name)=private.history_key(item_name)) then continue; end if;

    select btrim(coalesce(p.specification,'')) into product_spec from public.products p where p.id=product;
    product_spec:=coalesce(product_spec,item_spec);
    ingredient:=private.receipt_entry_ingredient(batch.store_id,batch.organization_id,product,line,
      p_account->>'supplier_name',supplier,product_spec);
    if ingredient is null then continue; end if;

    if product is null then
      product:=coalesce(
        private.receipt_entry_ingredient_product(batch.store_id,batch.organization_id,ingredient,unit_name,item_spec),
        private.baihuayuan_resolve_receipt_product(batch.organization_id,batch.store_id,item_name,item_spec,unit_name)
      );
      select btrim(coalesce(p.specification,'')) into product_spec from public.products p where p.id=product;
    end if;
    insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,specification,corrected)
    values(batch.store_id,ingredient,coalesce(nullif(line->>'supplier_item_name',''),item_name),'p:'||product,unit_key,
      product_spec,nullif(line->>'ingredient_id','') is not null)
    on conflict(store_id,source_key,source_unit,specification) do nothing;

    insert into private.receipt_entry_items(batch_id,row_key,product_id,run_id,supplier_id,supplier_name,receipt_date,unit,unit_price,recorded_by)
    values(p_batch,line->>'row_key',product,nullif(p_account->>'run_id','')::uuid,supplier,
      p_account->>'supplier_name',date_received,unit_name,item_price,auth.uid())
    on conflict(batch_id,row_key) do update
    set product_id=excluded.product_id,run_id=excluded.run_id,supplier_id=excluded.supplier_id,
        supplier_name=excluded.supplier_name,receipt_date=excluded.receipt_date,unit=excluded.unit,
        unit_price=excluded.unit_price,recorded_by=excluded.recorded_by,recorded_at=now(),retired_at=null;
    active_keys:=array_append(active_keys,line->>'row_key');
  end loop;

  -- Keep old references for confirmed standards and recipe snapshots, while
  -- withdrawing them as price candidates when their entry row is removed.
  update private.recipe_price_entries r set source_ref=r.source_ref||'{"missing_price":true}'::jsonb
  from private.receipt_entry_items i
  where i.batch_id=p_batch and i.retired_at is null and not(i.row_key=any(active_keys)) and r.store_id=batch.store_id
    and r.source_key='receipt:'||i.batch_id||':'||i.row_key;
  update private.receipt_entry_items i set retired_at=now()
  where i.batch_id=p_batch and i.retired_at is null and not(i.row_key=any(active_keys));

  if cardinality(active_keys)>0 then perform private.sync_ingredient_prices(batch.store_id,p_batch); end if;
end $function$;

create or replace function private.receipt_apply_entry_products(p_rows jsonb)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(case when account->'review_completed'='true'::jsonb then
    account||jsonb_build_object('lines',coalesce((
      select jsonb_agg(
        line
        ||case when p.id is not null then jsonb_build_object('product_id',p.id,'product_code',p.product_code) else '{}'::jsonb end
        ||case when m.id is not null then jsonb_build_object(
          'ingredient_id',coalesce(m.canonical_ingredient_id,m.id),'ingredient_code',private.managed_ingredient_code(m.id),
          'create_ingredient',false,'ingredient_status','LINKED')
        when account->>'receipt_status'<>'COMPLETED'
          and coalesce(line->>'handling','NORMAL')='NORMAL' and nullif(btrim(line->>'product_name'),'') is not null
          and line->>'product_name' !~ '^(其他)?(運費|運送費|配送費|宅配費)([（(].*[）)])?$'
          then jsonb_build_object('ingredient_status','REVIEW')
        else '{}'::jsonb end
        order by line_order)
      from jsonb_array_elements(account->'lines') with ordinality lines(line,line_order)
      join public.receipt_upload_batches b on b.id=(account->>'batch_id')::uuid
      left join private.receipt_entry_items i on i.batch_id=(account->>'batch_id')::uuid and i.row_key=line->>'row_key'
        and i.retired_at is null and i.run_id is not distinct from nullif(account->>'run_id','')::uuid
      left join public.products p on p.id=i.product_id and p.is_active
      left join private.ingredient_aliases a on a.store_id=b.store_id and a.source_key='p:'||p.id
        and a.source_unit=private.recipe_unit(i.unit) and a.specification=btrim(coalesce(p.specification,''))
      left join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=a.store_id
    ),'[]'::jsonb)) else account end order by account_order),'[]'::jsonb)
  from jsonb_array_elements(p_rows) with ordinality accounts(account,account_order)
$$;

do $migration$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
  anchor:=$anchor$  l:=private.save_receipt_ingredient_match(p_store_id,p_batch_id,header->>'supplier_name',l,(select x from jsonb_array_elements(current_row->'lines') x where x->>'row_key'=l->>'row_key'),current_row->>'supplier_name');$anchor$;
  if strpos(definition,anchor)=0 then raise exception 'RECEIPT_INGREDIENT_CONFIRMATION_ANCHOR'; end if;
  definition:=replace(definition,anchor,$patch$
  if coalesce(l->>'handling','NORMAL')<>'NORMAL' then
    l:=l-'create_ingredient'-'ingredient_match_pending';
  end if;
  if l->'create_ingredient' is distinct from 'true'::jsonb then
$patch$||anchor||$patch$
  elsif nullif(l->>'ingredient_id','') is not null then
    raise exception 'INGREDIENT_MATCH_INVALID' using errcode='22023';
  end if;
$patch$);
  anchor:=$anchor$where key in ('discount','custody_remaining','custody_reminder_id','custody_reminder_kind','ingredient_id'$anchor$;
  if strpos(definition,anchor)=0 then raise exception 'RECEIPT_INGREDIENT_FIELDS_ANCHOR'; end if;
  definition:=replace(definition,anchor,replace(anchor,'''ingredient_id''','''create_ingredient'',''ingredient_match_pending'',''ingredient_id'''));
  anchor:=$anchor$perform private.sync_receipt_entry_items(p_batch_id,result->'account');$anchor$;
  if strpos(definition,anchor)=0 then raise exception 'RECEIPT_INGREDIENT_PROJECTION_ANCHOR'; end if;
  execute replace(definition,anchor,$patch$
    perform private.sync_receipt_entry_items(p_batch_id,(result->'account')||jsonb_build_object('lines',(
      select jsonb_agg(raw_line||coalesce(edits->(raw_line->>'row_key'),'{}'))
      from jsonb_array_elements(current_row->'raw_lines') raw_line
    )));
$patch$);

  definition:=pg_get_functiondef('private.sync_ingredient_prices(uuid,uuid)'::regprocedure);
  anchor:=$anchor$i.product_id,p.name,i.unit,i.unit_price,i.receipt_date,i.recorded_by,i.supplier_id,$anchor$;
  if strpos(definition,anchor)=0 then raise exception 'RECEIPT_INGREDIENT_PRICE_NAME_ANCHOR'; end if;
  definition:=replace(definition,anchor,$patch$i.product_id,
        coalesce(nullif(btrim(e.line_values#>>array[i.row_key,'supplier_item_name']),''),p.name),
        i.unit,i.unit_price,i.receipt_date,i.recorded_by,i.supplier_id,$patch$);
  anchor:=$anchor$      left join public.suppliers sp on sp.id=i.supplier_id$anchor$;
  if strpos(definition,anchor)=0 then raise exception 'RECEIPT_INGREDIENT_PRICE_EDITS_ANCHOR'; end if;
  execute replace(definition,anchor,$patch$      left join private.receipt_account_edits e on e.batch_id=i.batch_id and e.store_id=p_store
        and e.run_id is not distinct from i.run_id
$patch$||anchor);
end $migration$;

notify pgrst,'reload schema';
