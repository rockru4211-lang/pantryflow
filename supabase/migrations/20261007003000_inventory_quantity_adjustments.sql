-- Preserve original count evidence while allowing backoffice to correct the
-- reporting quantity used for monthly inventory values.

create table if not exists private.inventory_month_quantity_adjustments (
  store_id uuid not null references public.stores(id),
  month date not null,
  session_id uuid not null references public.inventory_count_sessions(id),
  row_key text not null,
  source_quantity numeric not null,
  quantity numeric not null,
  reason text not null default '',
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key(store_id,month,session_id,row_key),
  check(month=date_trunc('month',month)::date),
  check(source_quantity>=0 and source_quantity<1000000000),
  check(quantity>=0 and quantity<1000000000),
  check(length(reason)<=2000)
);
alter table private.inventory_month_quantity_adjustments enable row level security;
revoke all on private.inventory_month_quantity_adjustments from public,anon,authenticated;

do $patch$
declare definition text; changed text;
begin
  definition:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);

  changed:=replace(
    definition,
    'from paired x left join private.inventory_month_reviews r on r.store_id=p_store and r.month=p_month and r.session_id=source.id and r.row_key=x.row_key and r.source_signature=x.signature',
    'from paired x left join private.inventory_month_reviews r on r.store_id=p_store and r.month=p_month and r.session_id=source.id and r.row_key=x.row_key and r.source_signature=x.signature left join private.inventory_month_quantity_adjustments q on q.store_id=p_store and q.month=p_month and q.session_id=source.id and q.row_key=x.row_key'
  );
  if changed=definition then raise exception 'Inventory quantity adjustment join patch missing'; end if;
  definition:=changed;

  changed:=replace(
    definition,
    '(x.c->>''quantity'')::numeric as qty,(x.p->>''quantity'')::numeric as previous_qty,',
    'coalesce(q.quantity,(x.c->>''quantity'')::numeric) as qty,(x.c->>''quantity'')::numeric as source_qty,q.quantity is not null as quantity_adjusted,q.reason as quantity_adjustment_reason,(x.p->>''quantity'')::numeric as previous_qty,'
  );
  if changed=definition then raise exception 'Inventory quantity adjustment quantity patch missing'; end if;
  definition:=changed;

  changed:=replace(
    definition,
    '''history_source'',v.c->''history_source'',''baseline_source'',v.p->''history_source'',''quantity_pending'',coalesce((v.c->>''quantity_pending'')::boolean,false),''zones'',coalesce(v.c,v.p)->''zones'',''current_quantity'',v.qty,''previous_quantity'',v.previous_qty,',
    '''history_source'',v.c->''history_source'',''baseline_source'',v.p->''history_source'',''quantity_pending'',coalesce((v.c->>''quantity_pending'')::boolean,false),''zones'',coalesce(v.c,v.p)->''zones'',''source_quantity'',v.source_qty,''quantity_adjusted'',v.quantity_adjusted,''quantity_adjustment_reason'',v.quantity_adjustment_reason,''current_quantity'',v.qty,''previous_quantity'',v.previous_qty,'
  );
  if changed=definition then raise exception 'Inventory quantity adjustment output patch missing'; end if;

  execute changed;
end
$patch$;

do $patch$
declare definition text; changed text;
begin
  definition:=pg_get_functiondef('private.baihuayuan_inventory_month(uuid,date,text,jsonb)'::regprocedure);

  changed:=replace(
    definition,
    'declare state jsonb; row_data jsonb; source_id uuid; price numeric; org uuid;',
    'declare state jsonb; row_data jsonb; source_id uuid; price numeric; quantity numeric; source_quantity numeric; org uuid;'
  );
  if changed=definition then raise exception 'Inventory review declaration patch missing'; end if;
  definition:=changed;

  changed:=replace(
    definition,
    'price:=nullif(p_data->>''unit_price'','''')::numeric;'||chr(10)||
    '  if price is not null and (price<0 or price>=1000000000 or price::text in (''NaN'',''Infinity'',''-Infinity'')) then raise exception using errcode=''22023'',message=''INVALID_INVENTORY_PRICE'';end if;',
    'if p_data?''current_quantity'' then'||chr(10)||
    '   quantity:=nullif(p_data->>''current_quantity'','''')::numeric;'||chr(10)||
    '   source_quantity:=nullif(row_data->>''source_quantity'','''')::numeric;'||chr(10)||
    '   if quantity is null or quantity<0 or quantity>=1000000000 or quantity::text in (''NaN'',''Infinity'',''-Infinity'') or source_quantity is null then raise exception using errcode=''22023'',message=''INVALID_INVENTORY_QUANTITY'';end if;'||chr(10)||
    '   if quantity is distinct from source_quantity then'||chr(10)||
    '    insert into private.inventory_month_quantity_adjustments(store_id,month,session_id,row_key,source_quantity,quantity,reason,updated_by)'||chr(10)||
    '    values(p_store_id,p_month,source_id,row_data->>''row_key'',source_quantity,quantity,coalesce(nullif(btrim(p_data->>''note''),''''),''行政核對數量''),auth.uid())'||chr(10)||
    '    on conflict(store_id,month,session_id,row_key) do update set source_quantity=excluded.source_quantity,quantity=excluded.quantity,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();'||chr(10)||
    '   else'||chr(10)||
    '    delete from private.inventory_month_quantity_adjustments where store_id=p_store_id and month=p_month and session_id=source_id and row_key=row_data->>''row_key'';'||chr(10)||
    '   end if;'||chr(10)||
    '   state:=private.inventory_month_state(p_store_id,p_month,source_id);'||chr(10)||
    '   select r into row_data from jsonb_array_elements(state->''rows'')r where r->>''row_key''=p_data->>''row_key'';'||chr(10)||
    '  end if;'||chr(10)||
    '  price:=nullif(p_data->>''unit_price'','''')::numeric;'||chr(10)||
    '  if price is not null and (price<0 or price>=1000000000 or price::text in (''NaN'',''Infinity'',''-Infinity'')) then raise exception using errcode=''22023'',message=''INVALID_INVENTORY_PRICE'';end if;'
  );
  if changed=definition then raise exception 'Inventory review quantity patch missing'; end if;

  execute changed;
end
$patch$;

-- Current September correction requested in operations: the count was entered as
-- 122 while the row unit is kg. Preserve the original entry and use 0.122 kg for
-- the monthly inventory value. This is a reporting correction only.
insert into private.inventory_month_quantity_adjustments(
  store_id,month,session_id,row_key,source_quantity,quantity,reason,updated_by
)
select
  s.store_id,
  date_trunc('month',coalesce(s.completed_at,s.started_at) at time zone 'Asia/Taipei')::date,
  s.id,
  e.product_id::text||':'||e.unit,
  sum(e.quantity),
  0.122,
  '122 為公克，折算 0.122 公斤；原始盤點保留。',
  null
from public.inventory_count_sessions s
join public.count_entries e on e.session_id=s.id and e.entry_type='INITIAL_COUNT'
join public.products p on p.id=e.product_id
join public.stores st on st.id=s.store_id
where st.name='BeApe'
  and p.name='香草莢'
  and e.unit='公斤'
  and s.started_at>='2026-09-01'::timestamptz
  and s.started_at<'2026-10-01'::timestamptz
group by s.store_id,s.id,e.product_id,e.unit,s.completed_at,s.started_at
having sum(e.quantity)=122
on conflict(store_id,month,session_id,row_key)
do update set source_quantity=excluded.source_quantity,quantity=excluded.quantity,reason=excluded.reason,updated_at=now();

notify pgrst,'reload schema';
