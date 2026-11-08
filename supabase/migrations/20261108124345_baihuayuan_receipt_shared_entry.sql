-- Use completed entry lines for shared product selection and price evidence.
-- A catalog assignment does not create a physical stock balance or a count.
create table private.receipt_entry_items (
  batch_id uuid not null references public.receipt_upload_batches(id),
  row_key text not null,
  product_id uuid not null references public.products(id),
  run_id uuid references public.receipt_ocr_runs(id),
  supplier_id uuid references public.suppliers(id),
  supplier_name text not null,
  receipt_date date not null,
  unit text not null,
  unit_price numeric not null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key(batch_id,row_key)
);
alter table private.receipt_entry_items enable row level security;
revoke all on private.receipt_entry_items from public,anon,authenticated;

create function private.sync_receipt_entry_items(p_batch uuid,p_account jsonb)
returns void language plpgsql set search_path='' as $$
declare
  batch public.receipt_upload_batches;
  line jsonb;
  product uuid;
  candidates uuid[];
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
    if coalesce(line->>'handling','NORMAL')<>'NORMAL' then continue; end if;
    item_name:=btrim(coalesce(line->>'product_name',''));
    item_spec:=btrim(coalesce(line->>'specification',''));
    unit_name:=btrim(coalesce(line->>'unit',''));
    unit_key:=private.recipe_unit(unit_name);
    item_price:=private.receipt_account_number(line->>'unit_price');
    if item_name in ('','未命名品項') or item_name ~ '^(其他)?(運費|運送費|配送費|宅配費)([（(].*[）)])?$' or unit_name='' or item_price is null
      or coalesce(private.receipt_account_number(line->>'quantity'),0)<=0 then continue; end if;

    select p.id into product from public.products p
    where p.organization_id=batch.organization_id and p.is_active
      and private.recipe_unit(p.base_unit)=unit_key
      and private.history_key(p.specification)=private.history_key(item_spec)
      and private.history_key(p.name)=private.history_key(item_name)
    order by (p.id::text=line->>'product_id') desc nulls last,p.created_at,p.id limit 1;

    if product is null and nullif(line->>'ingredient_id','') is not null then
      select array_agg(distinct p.id) into candidates
      from private.ingredient_aliases a join public.products p on a.source_key='p:'||p.id
      where a.store_id=batch.store_id and a.ingredient_id::text=line->>'ingredient_id'
        and p.organization_id=batch.organization_id and p.is_active
        and private.recipe_unit(p.base_unit)=unit_key
        and private.history_key(p.specification)=private.history_key(item_spec);
      if cardinality(candidates)=1 then product:=candidates[1]; end if;
    end if;
    if product is null then
      if exists(select 1 from public.products p where p.organization_id=batch.organization_id and not p.is_active
        and private.recipe_unit(p.base_unit)=unit_key and private.history_key(p.specification)=private.history_key(item_spec)
        and private.history_key(p.name)=private.history_key(item_name)) then continue; end if;
      product:=private.baihuayuan_resolve_receipt_product(batch.organization_id,batch.store_id,item_name,item_spec,unit_name);
    end if;

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
end $$;
revoke all on function private.sync_receipt_entry_items(uuid,jsonb) from public,anon,authenticated;

-- Overlay only the product identity on read. The existing raw evidence and
-- revision fingerprints remain the source of truth for receipt corrections.
create function private.receipt_apply_entry_products(p_rows jsonb)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(case when account->'review_completed'='true'::jsonb then
    account||jsonb_build_object('lines',coalesce((
      select jsonb_agg(case when p.id is null then line else
        line||jsonb_build_object('product_id',p.id,'product_code',p.product_code) end order by line_order)
      from jsonb_array_elements(account->'lines') with ordinality lines(line,line_order)
      left join private.receipt_entry_items i on i.batch_id=(account->>'batch_id')::uuid and i.row_key=line->>'row_key' and i.retired_at is null
        and i.run_id is not distinct from nullif(account->>'run_id','')::uuid
      left join public.products p on p.id=i.product_id and p.is_active
    ),'[]'::jsonb)) else account end order by account_order),'[]'::jsonb)
  from jsonb_array_elements(p_rows) with ordinality accounts(account,account_order)
$$;
revoke all on function private.receipt_apply_entry_products(jsonb) from public,anon,authenticated;

do $patch$
declare source text; anchor text;
begin
  source:=pg_get_functiondef('private.sync_ingredient_prices(uuid,uuid)'::regprocedure);
  anchor:='    ),'||chr(10)||'    posted as (';
  if strpos(source,anchor)=0 then raise exception 'RECEIPT_ENTRY_PRICING_ANCHOR';end if;
  source:=replace(source,anchor,$sql$
      union all
      select 'receipt:'||i.batch_id||':'||i.row_key,i.batch_id,i.run_id,i.row_key,
        i.product_id,p.name,i.unit,i.unit_price,i.receipt_date,i.recorded_by,i.supplier_id,
        coalesce(sp.name,i.supplier_name),coalesce(p.specification,''),i.recorded_at,1
      from private.receipt_entry_items i
      join public.receipt_upload_batches b on b.id=i.batch_id and b.store_id=p_store
      join public.products p on p.id=i.product_id and p.is_active
      left join public.suppliers sp on sp.id=i.supplier_id
      where (p_batch is null or b.id=p_batch) and b.status<>'COMPLETED' and i.retired_at is null
        and not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=b.id)
        and not exists(select 1 from private.baihuayuan_record_flags f where f.store_id=p_store
          and f.entity_type='RECEIPT_BATCH' and f.entity_id=b.id and f.state<>'LIVE')
    ),
    posted as ($sql$);
  anchor:='private.baihuayuan_receipt_detail_ledger(p_store)';
  if strpos(source,anchor)=0 then raise exception 'RECEIPT_ENTRY_LEDGER_ANCHOR';end if;
  source:=replace(source,anchor,$sql$case when p_batch is not null and exists(
    select 1 from private.receipt_entry_items where batch_id=p_batch)
    then '[]'::jsonb else private.baihuayuan_receipt_detail_ledger(p_store) end$sql$);
  anchor:='    insert into private.ingredient_masters(store_id,name,unit)';
  if strpos(source,anchor)=0 then raise exception 'RECEIPT_ENTRY_PRICE_IDENTITY_ANCHOR';end if;
  source:=replace(source,anchor,$sql$
    select a.ingredient_id into v_master from private.ingredient_aliases a
    where a.store_id=p_store and a.source_key=v_key and a.source_unit=v_unit and a.specification=v_spec;
    if v_master is null then
    insert into private.ingredient_masters(store_id,name,unit)$sql$);
  anchor:='    insert into private.ingredient_aliases as a(';
  if strpos(source,anchor)=0 then raise exception 'RECEIPT_ENTRY_PRICE_ALIAS_ANCHOR';end if;
  source:=replace(source,anchor,'    end if;'||chr(10)||anchor);
  execute source;

  source:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
  anchor:='return result;';
  if strpos(source,anchor)=0 then raise exception 'RECEIPT_ENTRY_READ_ANCHOR';end if;
  execute replace(source,anchor,'return private.receipt_apply_entry_products(result);');

  source:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
  anchor:='insert into private.app_requests(store_id,request_id,actor_id,action,payload,result)';
  if strpos(source,anchor)=0 then raise exception 'RECEIPT_ENTRY_COMPLETION_ANCHOR';end if;
  source:=replace(source,anchor,$sql$
  if coalesce((p_data->>'review_completed')::boolean,false)
    and coalesce((result#>>'{account,review_completed}')::boolean,false) then
    perform private.sync_receipt_entry_items(p_batch_id,result->'account');
    result:=jsonb_build_object('saved',true,'account',private.receipt_apply_entry_products(jsonb_build_array(result->'account'))->0);
  end if;
  insert into private.app_requests(store_id,request_id,actor_id,action,payload,result)$sql$);
  execute source;
end $patch$;

create or replace function private.receipt_count_candidates(p_store uuid)
returns jsonb language sql stable set search_path='' as $$
  with sources as (
    select b.id batch_id,l.product_id,sp.name supplier,g.receipt_date
    from public.goods_receipts g
    join public.receipt_upload_batches b on b.id=g.source_batch_id
    join public.receipt_lines l on l.receipt_id=g.id
    left join public.suppliers sp on sp.id=coalesce(l.supplier_id,g.supplier_id)
    where b.store_id=p_store and g.store_id=p_store and b.status='COMPLETED' and l.quantity>0
      and coalesce(l.human_correction->>'handling','NORMAL')='NORMAL'
    union all
    select i.batch_id,i.product_id,coalesce(sp.name,i.supplier_name),i.receipt_date
    from private.receipt_entry_items i
    join public.receipt_upload_batches b on b.id=i.batch_id
    left join public.suppliers sp on sp.id=i.supplier_id
    where b.store_id=p_store and b.status<>'COMPLETED' and i.retired_at is null
  )
  select coalesce(jsonb_agg(to_jsonb(q) order by q.receipt_date desc,q.name,q.id),'[]'::jsonb) from (
    select distinct on(p.id) p.id,p.name,coalesce(nullif(p.count_unit,''),p.base_unit) unit,
      coalesce(p.specification,'') specification,s.supplier,s.receipt_date
    from sources s join public.stores st on st.id=p_store
    join public.products p on p.id=s.product_id and p.organization_id=st.organization_id and p.is_active
    where not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=s.batch_id)
      and not exists(select 1 from private.baihuayuan_record_flags f where f.store_id=p_store
        and f.entity_type='RECEIPT_BATCH' and f.entity_id=s.batch_id and f.state<>'LIVE')
      and not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
        where z.store_id=p_store and z.is_active and zp.product_id=p.id)
      and not exists(select 1 from private.count_catalog_removed r where r.store_id=p_store and r.product_id=p.id)
      and not exists(select 1 from private.receipt_count_decisions d where d.store_id=p_store and d.product_id=p.id)
    order by p.id,s.receipt_date desc,s.batch_id
  ) q
$$;
