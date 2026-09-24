-- Monthly administrative review is separate from immutable original count entries.
create table private.inventory_month_reviews (
 store_id uuid not null references public.stores(id), month date not null,
 session_id uuid not null references public.inventory_count_sessions(id), row_key text not null,
 source_signature text not null, price_set boolean not null default false, unit_price numeric,
 acknowledged boolean not null default false, note text not null default '',
 reviewed_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(),
 primary key(store_id,month,session_id,row_key),
 check(month=date_trunc('month',month)::date),
 check(unit_price is null or (unit_price>=0 and unit_price<1000000000)),check(length(note)<=2000)
);
create table private.inventory_month_closures (
 store_id uuid not null references public.stores(id), month date not null,
 session_id uuid not null references public.inventory_count_sessions(id), payload jsonb not null,
 confirmed_by uuid not null references public.profiles(id),confirmed_at timestamptz not null default now(),
 primary key(store_id,month),check(month=date_trunc('month',month)::date)
);
alter table private.inventory_month_reviews enable row level security;
alter table private.inventory_month_closures enable row level security;
revoke all on private.inventory_month_reviews,private.inventory_month_closures from public,anon,authenticated;

-- Internal only. One row per product and exact unit, never add unlike units.
create function private.inventory_month_source(p_session uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with entries as (
  select e.*,coalesce(snap.item->>'product_name',p.name) as product_name,
   coalesce(snap.item->>'zone_name',z.name) as zone_name,
   coalesce(snap.item->>'supplier',sp.name,'') as supplier_name,
   coalesce(p.category,'其他') as category_name,price.unit_price,
   coalesce(si.display_name,pr.display_name,'未提供') as actor_name
  from public.count_entries e join public.inventory_count_sessions s on s.id=e.session_id
  join public.products p on p.id=e.product_id join public.count_zones z on z.id=e.zone_id
  left join public.suppliers sp on sp.id=p.current_supplier_id
  left join lateral(select item from jsonb_array_elements(coalesce(s.snapshot->'zones','[]')) a(item)
   where item->>'zone_id'=e.zone_id::text and item->>'product_id'=e.product_id::text limit 1) snap on true
  left join private.count_price_snapshots price on price.session_id=e.session_id and price.product_id=e.product_id and price.unit=e.unit
  left join public.staff_identities si on si.user_id=e.entered_by and si.organization_id=s.organization_id
  left join public.profiles pr on pr.id=e.entered_by
  where e.session_id=p_session and e.entry_type='INITIAL_COUNT'
 ), grouped as (
  select product_id,unit,min(product_name) as name,min(supplier_name) as supplier,min(category_name) as category,
   sum(quantity) as original_quantity,min(unit_price) as unit_price,
   jsonb_agg(jsonb_build_object('id',id,'zone_id',zone_id,'zone',zone_name,'quantity',quantity,'note',note,'entered_by',actor_name,'entered_at',entered_at) order by zone_name,id) as zones
  from entries group by product_id,unit
 ), corrections as (
  select d.product_id,count(*) as n,max(f.quantity) as quantity
  from public.inventory_count_discrepancies d join public.count_entries f on f.id=d.final_entry_id
  where d.session_id=p_session and d.status='RESOLVED' group by d.product_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'row_key',g.product_id::text||':'||g.unit,'product_id',g.product_id,'unit',g.unit,'name',g.name,'supplier',g.supplier,'category',g.category,
  'quantity',case when c.n=1 and (select count(*) from grouped gg where gg.product_id=g.product_id)=1 then c.quantity else g.original_quantity end,
  'original_quantity',g.original_quantity,'corrected',coalesce(c.n=1 and (select count(*) from grouped gg where gg.product_id=g.product_id)=1,false),
  'correction_conflict',coalesce(c.n>1 or (c.n>0 and (select count(*) from grouped gg where gg.product_id=g.product_id)>1),false),
  'unit_price',g.unit_price,'zones',g.zones
 ) order by g.name,g.unit),'[]'::jsonb) from grouped g left join corrections c on c.product_id=g.product_id
$$;
revoke all on function private.inventory_month_source(uuid) from public,anon,authenticated;

create function private.inventory_month_state(p_store uuid,p_month date,p_session uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare source public.inventory_count_sessions%rowtype; previous public.inventory_count_sessions%rowtype;
 closure private.inventory_month_closures%rowtype; prev_closure private.inventory_month_closures%rowtype;
 choices jsonb; current_rows jsonb:='[]'; previous_rows jsonb:='[]'; rows jsonb:='[]'; result jsonb;
 previous_month date:=(p_month-interval '1 month')::date; complete boolean:=false; has_previous boolean:=false;
 total numeric; previous_total numeric; missing integer; prev_missing integer; pending integer; source_count integer;
begin
 select * into closure from private.inventory_month_closures where store_id=p_store and month=p_month;
 if found then return closure.payload||jsonb_build_object('closed',true,'confirmed_at',closure.confirmed_at,'confirmed_by',closure.confirmed_by);end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'completed_at',s.completed_at,'status',s.status) order by s.completed_at desc,s.id),'[]') into choices
 from public.inventory_count_sessions s where s.store_id=p_store and s.status in ('REVIEWING','CLOSED')
 and s.completed_at>=p_month::timestamp at time zone 'Asia/Taipei'
 and s.completed_at<(p_month+interval '1 month')::timestamp at time zone 'Asia/Taipei';
 if p_session is not null and not exists(select 1 from jsonb_array_elements(choices) a where a->>'id'=p_session::text) then
  raise exception using errcode='22023',message='INVENTORY_SOURCE_NOT_IN_MONTH';end if;
 select * into source from public.inventory_count_sessions where id=coalesce(p_session,nullif(choices->0->>'id','')::uuid);
 select * into prev_closure from private.inventory_month_closures where store_id=p_store and month=previous_month;
 if found then
  has_previous:=true;
  select coalesce(jsonb_agg(r||jsonb_build_object('quantity',r->'current_quantity')),'[]') into previous_rows
  from jsonb_array_elements(prev_closure.payload->'rows') r where r->>'current_quantity' is not null;
 else
  select * into previous from public.inventory_count_sessions s where s.store_id=p_store and s.status in ('REVIEWING','CLOSED')
   and s.completed_at>=previous_month::timestamp at time zone 'Asia/Taipei'
   and s.completed_at<p_month::timestamp at time zone 'Asia/Taipei' order by completed_at desc,id limit 1;
  if found then has_previous:=true;previous_rows:=private.inventory_month_source(previous.id);end if;
 end if;
 if source.id is not null then
  current_rows:=private.inventory_month_source(source.id);
  complete:=jsonb_array_length(coalesce(source.snapshot->'zones','[]'))>0
   and not exists(select 1 from public.count_zone_progress g where g.session_id=source.id and g.status<>'COMPLETED')
   and not exists(select 1 from jsonb_array_elements(coalesce(source.snapshot->'zones','[]')) a
    where not exists(select 1 from public.count_zone_progress g where g.session_id=source.id and g.zone_id::text=a->>'zone_id' and g.status='COMPLETED')
     or not exists(select 1 from public.count_entries e where e.session_id=source.id and e.entry_type='INITIAL_COUNT' and e.zone_id::text=a->>'zone_id' and e.product_id::text=a->>'product_id'))
   and not exists(select 1 from public.count_entries e where e.session_id=source.id and e.entry_type='INITIAL_COUNT'
    and not exists(select 1 from jsonb_array_elements(coalesce(source.snapshot->'zones','[]')) a where a->>'zone_id'=e.zone_id::text and a->>'product_id'=e.product_id::text));
  with paired as (
   select c,p,coalesce(c->>'row_key',p->>'row_key') as row_key,md5(jsonb_build_array(c,p)::text) as signature
   from jsonb_array_elements(current_rows) c full join jsonb_array_elements(previous_rows) p on c->>'row_key'=p->>'row_key'
  ), valued as (
   select x.*,r.acknowledged,r.note,r.reviewed_by,
    case when r.price_set then r.unit_price else (x.c->>'unit_price')::numeric end as price,
    (x.c->>'quantity')::numeric as qty,(x.p->>'quantity')::numeric as previous_qty,
    case when not has_previous then 'NO_BASELINE'
     when x.c is null then 'MISSING'
     when x.p is null and exists(select 1 from jsonb_array_elements(previous_rows) a where a->>'product_id'=x.c->>'product_id') then 'UNIT_CHANGED'
     when x.p is null then 'NEW' else 'MATCHED' end as comparison
   from paired x left join private.inventory_month_reviews r on r.store_id=p_store and r.month=p_month and r.session_id=source.id and r.row_key=x.row_key and r.source_signature=x.signature
  )
  select coalesce(jsonb_agg(jsonb_build_object(
   'row_key',v.row_key,'source_signature',v.signature,'product_id',coalesce(v.c,v.p)->>'product_id','name',coalesce(v.c,v.p)->>'name',
   'unit',coalesce(v.c,v.p)->>'unit','supplier',coalesce(v.c,v.p)->>'supplier','category',coalesce(v.c,v.p)->>'category',
   'zones',coalesce(v.c,v.p)->'zones','current_quantity',v.qty,'previous_quantity',v.previous_qty,
   'difference',case when v.comparison='MATCHED' then v.qty-v.previous_qty end,'comparison',v.comparison,
   'unit_price',v.price,'amount',round(v.qty*v.price,2),'previous_amount',round(v.previous_qty*(v.p->>'unit_price')::numeric,2),
   'original_quantity',v.c->'original_quantity','corrected',coalesce((v.c->>'corrected')::boolean,false),
   'correction_conflict',coalesce((v.c->>'correction_conflict')::boolean,false),
   'missing_price',v.qty is not null and v.price is null,
   'needs_review',((v.qty is not null and v.price is null) or coalesce((v.c->>'correction_conflict')::boolean,false)
     or ((v.comparison in ('MISSING','UNIT_CHANGED') or (v.comparison='MATCHED' and v.qty<>v.previous_qty)) and not coalesce(v.acknowledged,false))),
   'acknowledged',coalesce(v.acknowledged,false),'review_note',coalesce(v.note,''),'reviewed_by',v.reviewed_by
  ) order by coalesce(v.c,v.p)->>'name',coalesce(v.c,v.p)->>'unit'),'[]') into rows from valued v;
 end if;
 select count(*) filter(where r->>'current_quantity' is not null),coalesce(sum((r->>'amount')::numeric),0),count(*) filter(where (r->>'missing_price')::boolean),count(*) filter(where (r->>'needs_review')::boolean)
 into source_count,total,missing,pending from jsonb_array_elements(rows) r;
 select coalesce(sum(round((r->>'quantity')::numeric*(r->>'unit_price')::numeric,2)),0),count(*) filter(where r->>'unit_price' is null) into previous_total,prev_missing from jsonb_array_elements(previous_rows) r;
 result:=jsonb_build_object('month',p_month,'store_id',p_store,'closed',false,'sessions',choices,
  'source_id',source.id,'completed_at',source.completed_at,'source_complete',complete,'has_active_count',exists(select 1 from public.inventory_count_sessions s where s.store_id=p_store and s.status in ('DRAFT','IN_PROGRESS')),
  'previous_source_id',coalesce(prev_closure.session_id,previous.id),'previous_completed_at',coalesce((prev_closure.payload->>'completed_at')::timestamptz,previous.completed_at),
  'previous_month',previous_month,'previous_closed',prev_closure.store_id is not null,'has_previous',has_previous,
  'rows',rows,'summary',jsonb_build_object('items',source_count,'subtotal',case when source.id is not null then total end,'missing_prices',missing,'pending',pending,
   'previous_subtotal',case when has_previous then previous_total end,'previous_missing_prices',prev_missing,
   'amount_difference',case when has_previous and source.id is not null then total-previous_total end));
 return result||jsonb_build_object('revision',md5(result::text));
end $$;
revoke all on function private.inventory_month_state(uuid,date,uuid) from public,anon,authenticated;

create function private.baihuayuan_inventory_month(p_store_id uuid,p_month date,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state jsonb; row_data jsonb; source_id uuid; price numeric; org uuid;
begin
 if auth.uid() is null or coalesce(private.app_role(p_store_id),'') not in ('LOGISTICS','OWNER')
  or not private.has_active_store_role(p_store_id,null) then raise exception using errcode='42501',message='INVENTORY_ADMIN_REQUIRED';end if;
 select organization_id into org from public.stores where id=p_store_id and is_active and name in ('BeApe','Gras');
 if org is null then raise exception using errcode='42501',message='INVENTORY_ADMIN_REQUIRED';end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_month<'2000-01-01' or p_month>'2100-12-01'
  or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then raise exception using errcode='22023',message='INVALID_INVENTORY_MONTH';end if;
 if p_action is null or p_action not in ('read','review','close','export') then raise exception using errcode='22023',message='INVALID_APP_ACTION';end if;
 if p_action='export' and not private.has_app_feature(p_store_id,'DATA_EXPORT') then raise exception using errcode='42501',message='DATA_EXPORT_REQUIRED';end if;
 if p_action in ('review','close') then perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_month::text,819));end if;
 state:=private.inventory_month_state(p_store_id,p_month,nullif(p_data->>'session_id','')::uuid);
 if p_action in ('read','export') then return state;end if;
 if (state->>'closed')::boolean then
  if p_action='close' then return state;end if;
  raise exception using errcode='22023',message='INVENTORY_MONTH_CLOSED';
 end if;
 if p_data->>'revision' is distinct from state->>'revision' then raise exception using errcode='40001',message='INVENTORY_REVISION_CHANGED';end if;
 source_id:=(state->>'source_id')::uuid;
 if source_id is null then raise exception using errcode='22023',message='INVENTORY_SOURCE_REQUIRED';end if;
 if p_action='review' then
  select r into row_data from jsonb_array_elements(state->'rows') r where r->>'row_key'=p_data->>'row_key';
  if row_data is null then raise exception using errcode='22023',message='INVENTORY_ROW_NOT_FOUND';end if;
  price:=nullif(p_data->>'unit_price','')::numeric;
  if price is not null and (price<0 or price>=1000000000 or price::text in ('NaN','Infinity','-Infinity')) then raise exception using errcode='22023',message='INVALID_INVENTORY_PRICE';end if;
  if length(coalesce(p_data->>'note',''))>2000 then raise exception using errcode='22023',message='INVALID_INVENTORY_NOTE';end if;
  if coalesce((p_data->>'acknowledged')::boolean,false) and ((row_data->>'difference')::numeric<>0 or row_data->>'comparison' in ('MISSING','UNIT_CHANGED')) and btrim(coalesce(p_data->>'note',''))='' then
   raise exception using errcode='22023',message='INVENTORY_REVIEW_NOTE_REQUIRED';end if;
  insert into private.inventory_month_reviews(store_id,month,session_id,row_key,source_signature,price_set,unit_price,acknowledged,note,reviewed_by)
  values(p_store_id,p_month,source_id,row_data->>'row_key',row_data->>'source_signature',true,price,coalesce((p_data->>'acknowledged')::boolean,false),coalesce(p_data->>'note',''),auth.uid())
  on conflict(store_id,month,session_id,row_key) do update set source_signature=excluded.source_signature,price_set=excluded.price_set,unit_price=excluded.unit_price,acknowledged=excluded.acknowledged,note=excluded.note,reviewed_by=excluded.reviewed_by,updated_at=now();
  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
   values(org,p_store_id,'inventory_month',source_id::text,'INVENTORY_MONTH_REVIEW',row_data,p_data,auth.uid());
  return private.inventory_month_state(p_store_id,p_month,source_id);
 end if;
 if not (state->>'source_complete')::boolean or (state#>>'{summary,items}')::integer=0 then raise exception using errcode='22023',message='INVENTORY_COUNT_INCOMPLETE';end if;
 if (state#>>'{summary,pending}')::integer>0 then raise exception using errcode='22023',message='INVENTORY_REVIEW_REQUIRED';end if;
 insert into private.inventory_month_closures(store_id,month,session_id,payload,confirmed_by) values(p_store_id,p_month,source_id,state,auth.uid());
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
 values(org,p_store_id,'inventory_month',source_id::text,'INVENTORY_MONTH_CONFIRMED',jsonb_build_object('month',p_month,'summary',state->'summary'),auth.uid());
 return private.inventory_month_state(p_store_id,p_month,source_id);
end $$;
revoke all on function private.baihuayuan_inventory_month(uuid,date,text,jsonb) from public,anon,authenticated;
grant execute on function private.baihuayuan_inventory_month(uuid,date,text,jsonb) to authenticated;
create function public.baihuayuan_inventory_month(p_store_id uuid,p_month date,p_action text default 'read',p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.baihuayuan_inventory_month(p_store_id,p_month,p_action,p_data)$$;
revoke all on function public.baihuayuan_inventory_month(uuid,date,text,jsonb) from public,anon,authenticated;
grant execute on function public.baihuayuan_inventory_month(uuid,date,text,jsonb) to authenticated;
