-- 百花猿價格中樞：
-- 進貨明細確認後先歸檔到食材價格表，再由庫存／調撥／廢棄取用。
-- 既有交易仍保存當時單價與金額，不回頭改歷史紀錄。

alter table private.recipe_price_entries
  add column if not exists source_key text;

create unique index if not exists recipe_price_entries_store_source_key
  on private.recipe_price_entries(store_id,source_key)
  where source_key is not null;

create or replace function private.ingredient_price_quote(
  p_store uuid,
  p_product uuid,
  p_unit text
)
returns numeric
language plpgsql
stable security definer
set search_path=''
as $$
declare
  v_price numeric;
begin
  if p_store is null or p_product is null or nullif(btrim(coalesce(p_unit,'')),'') is null then
    return null;
  end if;

  select m.cost_price*private.recipe_factor(p_unit)
  into v_price
  from private.ingredient_aliases a
  join private.ingredient_masters m
    on m.id=a.ingredient_id and m.store_id=a.store_id
  left join private.recipe_price_entries r
    on r.id=m.selected_reference and r.store_id=m.store_id
  where a.store_id=p_store
    and a.source_key='p:'||p_product::text
    and a.source_unit=private.recipe_unit(p_unit)
    and m.review_status='confirmed'
    and m.cost_price is not null
  order by
    case when r.source_kind='purchase' then 0 when r.source_kind='manual' then 1 else 2 end,
    r.effective_date desc nulls last,
    r.created_at desc nulls last,
    m.updated_at desc,
    m.id
  limit 1;

  return v_price;
end;
$$;

revoke all on function private.ingredient_price_quote(uuid,uuid,text)
  from public,anon,authenticated;

create or replace function private.sync_ingredient_prices(
  p_store uuid,
  p_batch uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_row record;
  v_entry uuid;
  v_unit text;
  v_spec text;
  v_key text;
  v_name text;
  v_master uuid;
  v_count integer:=0;
begin
  if auth.uid() is null then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;

  select organization_id into v_org
  from public.stores
  where id=p_store and is_active and name in ('BeApe','Gras');

  if v_org is null then
    raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501';
  end if;

  for v_row in
    with staged as (
      select
        'receipt:'||b.id::text||':'||(x.row->>'row_key') source_key,
        b.id batch_id,
        nullif(x.row->>'run_id','')::uuid run_id,
        x.row->>'row_key' row_key,
        nullif(x.row->>'product_id','')::uuid product_id,
        btrim(x.row->>'product_name') name,
        btrim(x.row->>'unit') unit,
        (x.row->>'unit_price')::numeric unit_price,
        coalesce(
          case when coalesce(x.row->>'receipt_date','') ~ '^\d{4}-\d{2}-\d{2}$'
            then (x.row->>'receipt_date')::date end,
          b.work_date
        ) effective_date,
        rs.saved_by actor_id,
        nullif(x.row->>'supplier_id','')::uuid supplier_id,
        nullif(btrim(x.row->>'supplier_name'),'') supplier_name,
        btrim(coalesce(x.row->>'specification','')) specification,
        rs.saved_at recorded_at,
        1 priority
      from jsonb_array_elements(private.baihuayuan_receipt_detail_ledger(p_store)) x(row)
      join public.receipt_upload_batches b
        on b.id=(x.row->>'batch_id')::uuid and b.store_id=p_store
      join private.receipt_review_saves rs
        on rs.ocr_run_id=nullif(x.row->>'run_id','')::uuid
       and rs.row_key=x.row->>'row_key'
      where (p_batch is null or b.id=p_batch)
        and nullif(x.row->>'product_id','') is not null
        and nullif(btrim(x.row->>'product_name'),'') is not null
        and nullif(btrim(x.row->>'unit'),'') is not null
        and jsonb_typeof(x.row->'quantity')='number'
        and (x.row->>'quantity')::numeric>0
        and jsonb_typeof(x.row->'unit_price')='number'
        and (x.row->>'unit_price')::numeric>=0
        and coalesce(x.row->>'handling','NORMAL')='NORMAL'
        and coalesce((
          select f.state
          from private.baihuayuan_record_flags f
          where f.store_id=p_store
            and f.entity_type='RECEIPT_BATCH'
            and f.entity_id=b.id
        ),'LIVE')='LIVE'
    ),
    posted as (
      select
        'receipt:'||b.id::text||':'||coalesce(nullif(l.source_row_key,''),'line-'||l.id::text) source_key,
        b.id batch_id,
        null::uuid run_id,
        coalesce(nullif(l.source_row_key,''),'line-'||l.id::text) row_key,
        l.product_id,
        coalesce(nullif(btrim(l.human_correction->>'product_name'),''),p.name) name,
        btrim(l.unit) unit,
        l.unit_price_ex_tax unit_price,
        coalesce(g.receipt_date,b.work_date) effective_date,
        coalesce(g.reviewed_by,l.modified_by,b.uploaded_by) actor_id,
        coalesce(l.supplier_id,g.supplier_id) supplier_id,
        sp.name supplier_name,
        btrim(coalesce(l.specification,'')) specification,
        coalesce(g.reviewed_at,l.modified_at,l.created_at) recorded_at,
        0 priority
      from public.receipt_lines l
      join public.goods_receipts g on g.id=l.receipt_id
      join public.receipt_upload_batches b on b.id=g.source_batch_id
      join public.products p on p.id=l.product_id
      left join public.suppliers sp on sp.id=coalesce(l.supplier_id,g.supplier_id)
      where coalesce(g.store_id,b.store_id)=p_store
        and (p_batch is null or b.id=p_batch)
        and b.status::text='COMPLETED'
        and g.reviewed_at is not null
        and l.product_id is not null
        and l.quantity>0
        and l.unit_price_ex_tax is not null
        and l.unit_price_ex_tax>=0
        and nullif(btrim(l.unit),'') is not null
        and coalesce((
          select f.state
          from private.baihuayuan_record_flags f
          where f.store_id=p_store
            and f.entity_type='RECEIPT_BATCH'
            and f.entity_id=b.id
        ),'LIVE')='LIVE'
    )
    select distinct on(source_key)
      source_key,batch_id,run_id,row_key,product_id,name,unit,unit_price,
      effective_date,actor_id,supplier_id,supplier_name,specification,recorded_at
    from (
      select * from posted
      union all
      select * from staged
    ) q
    order by source_key,priority,recorded_at desc nulls last
  loop
    insert into private.recipe_price_entries(
      store_id,name,product_id,unit,price,source,effective_date,actor_id,
      purchase,cost_price,source_kind,review_status,source_ref,source_key
    )
    values(
      p_store,v_row.name,v_row.product_id,v_row.unit,v_row.unit_price,
      '已核對進貨明細',v_row.effective_date,v_row.actor_id,
      jsonb_build_object('amount',v_row.unit_price,'quantity',1,'unit',v_row.unit),
      null,'purchase','confirmed',
      jsonb_strip_nulls(jsonb_build_object(
        'batch_id',v_row.batch_id,
        'run_id',v_row.run_id,
        'row_key',v_row.row_key,
        'supplier_id',v_row.supplier_id,
        'supplier_name',v_row.supplier_name,
        'specification',v_row.specification
      )),
      v_row.source_key
    )
    on conflict(store_id,source_key) where source_key is not null
    do update set
      name=excluded.name,
      product_id=excluded.product_id,
      unit=excluded.unit,
      price=excluded.price,
      source=excluded.source,
      effective_date=excluded.effective_date,
      actor_id=excluded.actor_id,
      purchase=excluded.purchase,
      cost_price=excluded.cost_price,
      source_kind='purchase',
      review_status='confirmed',
      source_ref=excluded.source_ref
    returning id into v_entry;

    v_unit:=private.recipe_unit(v_row.unit);
    v_spec:=btrim(coalesce(v_row.specification,''));
    v_key:='p:'||v_row.product_id::text;
    v_name:=private.ingredient_name(v_row.name,v_row.unit)
      ||case when v_spec<>'' then ' · '||v_spec else '' end;

    insert into private.ingredient_masters(store_id,name,unit)
    values(p_store,v_name,v_unit)
    on conflict do nothing;

    select id into v_master
    from private.ingredient_masters
    where store_id=p_store
      and lower(btrim(name))=lower(btrim(v_name))
      and unit=v_unit
    limit 1;

    insert into private.ingredient_aliases as a(
      store_id,ingredient_id,name,source_key,source_unit,specification,reference_ids
    )
    values(
      p_store,v_master,v_row.name,v_key,v_unit,v_spec,
      (
        select array_agg(r.id order by r.effective_date,r.created_at,r.id)
        from private.recipe_price_entries r
        where r.store_id=p_store
          and r.product_id=v_row.product_id
          and private.recipe_unit(r.unit)=v_unit
          and btrim(coalesce(r.source_ref->>'specification',''))=v_spec
      )
    )
    on conflict(store_id,source_key,source_unit,specification)
    do update set reference_ids=excluded.reference_ids;

    v_count:=v_count+1;
  end loop;

  if v_count>0 then
    with ranked as (
      select distinct on(a.ingredient_id)
        a.ingredient_id,r.id,
        coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) cost_price,
        r.purchase
      from private.ingredient_aliases a
      join private.recipe_price_entries r on r.id=any(a.reference_ids)
      where a.store_id=p_store
        and r.store_id=p_store
        and r.review_status='confirmed'
        and coalesce(r.source_ref->>'missing_price','false')<>'true'
      order by
        a.ingredient_id,
        case when r.source_kind='purchase' then 0 when r.source_kind='manual' then 1 else 2 end,
        r.effective_date desc nulls last,
        r.created_at desc,
        r.id desc
    )
    update private.ingredient_masters m
    set selected_reference=r.id,
        cost_price=r.cost_price,
        purchase=r.purchase,
        review_status='confirmed',
        revision=m.revision+1,
        updated_at=now(),
        updated_by=auth.uid()
    from ranked r
    where m.id=r.ingredient_id
      and m.store_id=p_store
      and not m.manual
      and (
        m.selected_reference is distinct from r.id
        or m.cost_price is distinct from r.cost_price
        or m.purchase is distinct from r.purchase
        or m.review_status<>'confirmed'
      );

    insert into public.audit_logs(
      organization_id,entity_type,entity_id,action,new_value,user_id,store_id
    )
    values(
      v_org,'ingredient_price_hub',p_store::text,'INGREDIENT_PRICES_SYNCED',
      jsonb_build_object('store_id',p_store,'batch_id',p_batch,'rows',v_count),
      auth.uid(),p_store
    );
  end if;

  return jsonb_build_object('synced',v_count,'batch_id',p_batch);
end;
$$;

revoke all on function private.sync_ingredient_prices(uuid,uuid)
  from public,anon,authenticated;

-- 百花猿：一張貨單的明細都確認後，就先歸檔價格；正式完成時再同步一次，
-- 讓之後對帳、庫存、調撥與廢棄不用回頭讀原貨單。
do $patch$
declare
  definition text;
  changed text;
begin
  definition:=pg_get_functiondef('public.save_pilot_receipt_review(uuid,text,uuid)'::regprocedure);
  changed:=replace(
    definition,
    'if store_name in (''BeApe'',''Gras'') then'||chr(10)||'    return progress',
    'if store_name in (''BeApe'',''Gras'') then'||chr(10)||
    '    if (progress->>''complete'')::boolean then'||chr(10)||
    '      perform private.sync_ingredient_prices((select store_id from public.receipt_upload_batches where id=p_batch_id),p_batch_id);'||chr(10)||
    '    end if;'||chr(10)||
    '    return progress'
  );
  if changed=definition then raise exception 'Ingredient price sync patch missing from save_pilot_receipt_review'; end if;
  execute changed;

  definition:=pg_get_functiondef('public.complete_baihuayuan_receipt(uuid,uuid,uuid)'::regprocedure);
  changed:=replace(
    definition,
    'v_receipt:=private.publish_receipt(p_batch_id,auth.uid(),false);'||chr(10)||chr(10)||'  return',
    'v_receipt:=private.publish_receipt(p_batch_id,auth.uid(),false);'||chr(10)||
    '  perform private.sync_ingredient_prices(p_store_id,p_batch_id);'||chr(10)||chr(10)||'  return'
  );
  if changed=definition then raise exception 'Ingredient price sync patch missing from complete_baihuayuan_receipt'; end if;
  execute changed;

  definition:=pg_get_functiondef('public.create_baihuayuan_direct_receipt(uuid,text,date,text,jsonb)'::regprocedure);
  changed:=replace(
    definition,
    'where id=v_receipt;'||chr(10)||chr(10)||'  insert into public.audit_logs',
    'where id=v_receipt;'||chr(10)||
    '  perform private.sync_ingredient_prices(p_store_id,v_batch);'||chr(10)||chr(10)||
    '  insert into public.audit_logs'
  );
  if changed=definition then raise exception 'Ingredient price sync patch missing from create_baihuayuan_direct_receipt'; end if;
  execute changed;
end
$patch$;

-- 庫存：當月尚未人工鎖定成本時，先讀食材價格表；歷史／已確認月份照舊保存。
do $patch$
declare
  definition text;
  changed text;
begin
  definition:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
  changed:=replace(
    definition,
    'case when r.price_set then r.unit_price else (x.c->>''unit_price'')::numeric end as price,',
    'case when r.price_set then r.unit_price else coalesce(private.ingredient_price_quote(p_store,nullif(x.c->>''product_id'','''')::uuid,x.c->>''unit''),(x.c->>''unit_price'')::numeric) end as price,'
  );
  if changed=definition then raise exception 'Ingredient price hub patch missing from inventory_month_state'; end if;
  execute changed;
end
$patch$;

-- 調撥：未手動填價時直接使用食材價格表，確認後仍寫入 snapshot，歷史不跟著變。
do $patch$
declare
  definition text;
  changed text;
begin
  definition:=pg_get_functiondef('private.confirm_store_transfer(uuid,jsonb)'::regprocedure);
  changed:=replace(
    definition,
    'v_price:=nullif(p_data->>''unit_price'','''')::numeric;',
    'v_price:=coalesce(nullif(p_data->>''unit_price'','''')::numeric,private.ingredient_price_quote(v_move.from_store_id,v_move.product_id,v_unit));'
  );
  if changed=definition then raise exception 'Ingredient price hub patch missing from confirm_store_transfer'; end if;
  execute changed;

  definition:=pg_get_functiondef('private.transfers_workspace_v2(uuid,jsonb)'::regprocedure);
  changed:=replace(
    definition,
    '''reference_price'',case when m.review_status=''CONFIRMED'' then m.unit_price_snapshot else legacy.unit_price end,',
    '''reference_price'',case when m.review_status=''CONFIRMED'' then m.unit_price_snapshot else coalesce(private.ingredient_price_quote(m.from_store_id,m.product_id,m.unit),legacy.unit_price) end,'
  );
  if changed=definition then raise exception 'Ingredient price hub patch missing from transfers_workspace_v2'; end if;
  execute changed;
end
$patch$;

-- 廢棄：先由食材價格表報價；食材表尚未建立時才退回既有庫存成本。
create or replace function private.waste_review_quote(p_waste uuid)
returns numeric
language plpgsql
stable security definer
set search_path=''
as $$
declare
  w private.waste_records;
  v_price numeric;
begin
  select * into w from private.waste_records where id=p_waste;
  if not found or w.product_id is null then return null; end if;

  v_price:=private.ingredient_price_quote(w.store_id,w.product_id,w.unit);
  if v_price is not null then return v_price; end if;

  return private.stock_cost_quote(w.store_id,w.product_id,w.unit);
end;
$$;

revoke all on function private.waste_review_quote(uuid)
  from public,anon,authenticated;

notify pgrst,'reload schema';
