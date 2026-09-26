-- Retained originals stay immutable. Links record only unique, exact identities.
create function private.history_key(v text) returns text language sql immutable set search_path='' as $$
 select lower(regexp_replace(normalize(coalesce(v,''),NFKC),'\s','','g'))
$$;
create function private.history_unit(v text) returns text language sql immutable set search_path='' as $$
 select case private.history_key(v) when 'kg' then '公斤' when 'g' then '克' when '台斤' then '斤' when 'l' then '公升' when 'ml' then '毫升' else btrim(v) end
$$;
create function private.history_number(v text) returns numeric language sql immutable set search_path='' as $$
 select case when length(v)<40 and btrim(v) ~ '^[0-9]+(\.[0-9]+)?$' then btrim(v)::numeric end
$$;
create table private.historical_product_links (
 import_id uuid not null,kind text not null,source_id text not null,
 product_id uuid not null references public.products(id),evidence jsonb not null,
 primary key(import_id,kind,source_id),
 foreign key(import_id,kind,source_id) references private.historical_source_records(import_id,kind,source_id)
);
alter table private.historical_product_links enable row level security;
revoke all on private.historical_product_links from public,anon,authenticated;
with candidates as (
 select r.import_id,r.kind,r.source_id,p.id,p.name,p.specification,
 count(*) over(partition by r.import_id,r.kind,r.source_id) n
 from private.historical_source_records r join private.historical_imports i on i.id=r.import_id
 join public.stores s on s.id=i.store_id
 join public.products p on p.organization_id=s.organization_id
 left join private.product_details d on d.product_id=p.id
 where i.state='READY' and (private.history_key(p.name)=private.history_key(r.data->>'name')
  or exists(select 1 from unnest(d.aliases) a where private.history_key(a)=private.history_key(r.data->>'name')))
 and private.history_unit(r.data->>'unit') in (private.history_unit(p.base_unit),private.history_unit(p.count_unit))
)
insert into private.historical_product_links
select import_id,kind,source_id,id,jsonb_build_object('method','EXACT_NAME_AND_UNIT','name',name,'specification',specification)
from candidates where n=1 on conflict do nothing;

create function private.historical_inventory_source(p_store uuid,p_month date,p_import uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 with chosen as (
  select i.* from private.historical_imports i where i.store_id=p_store and i.source_month=p_month and i.state='READY'
   and (p_import is null or i.id=p_import)
   and exists(select 1 from private.historical_source_records r where r.import_id=i.id and r.kind='INVENTORY')
  order by i.imported_at desc,i.id limit 1
 ), base as (
  select r.*,i.source_file,i.source_month,l.product_id,
   private.history_unit(r.data->>'unit') unit,
   count(*) over(partition by coalesce(l.product_id::text,r.source_id),private.history_unit(r.data->>'unit')) duplicates,
   exists(select 1 from jsonb_array_elements(r.issues) q where coalesce((q->>'deferred')::boolean,true)
     and q->>'field' in ('期末數量','淨重','單位','包裝規格','重複盤點','整筆紀錄','寄庫','跨店存放')) blocked
  from chosen i join private.historical_source_records r on r.import_id=i.id and r.kind='INVENTORY'
  left join private.historical_product_links l on l.import_id=r.import_id and l.kind=r.kind and l.source_id=r.source_id
 ), rows as (
  select ordinal,jsonb_build_object(
   'row_key',case when product_id is not null and duplicates=1 then product_id::text||':'||unit else 'history:'||source_id end,
   'product_id',case when duplicates=1 then product_id end,'name',data->>'name','supplier',data->>'supplier',
   'unit',coalesce(unit,'未提供'),'category',private.classify_product(data->>'name',data->>'category_suggestion'),'zones','[]'::jsonb,
   'quantity',case when not blocked and duplicates=1 and coalesce(unit,'')<>'' then private.history_number(data->>'quantity') end,
   'unit_price',null,'original_quantity',private.history_number(data->>'quantity'),'corrected',false,'correction_conflict',false,
   'history_source',jsonb_build_object('id',source_id,'file',source_file,'location',data->>'source','date',data->>'date',
    'raw_quantity',data->>'quantity','unit',data->>'unit','note',data->>'note','issues',issues,'custody',data->>'custody','other_store',data->>'other_store',
    'identity_pending',product_id is null or duplicates>1),
   'quantity_pending',blocked or duplicates>1 or coalesce(unit,'')='' or private.history_number(data->>'quantity') is null
  ) row from base
 ) select jsonb_build_object('id',i.id,'file',i.source_file,'month',i.source_month,'imported_at',i.imported_at,
  'rows',coalesce((select jsonb_agg(row order by ordinal) from rows),'[]')) from chosen i
$$;

-- Only guarded admin workspace calls may read retained price sources.
create function private.historical_price_sources(p_store uuid,p_filter jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or coalesce(private.app_role(p_store),'') not in ('OWNER','LOGISTICS')
 or not private.has_active_store_role(p_store,null) or not exists(select 1 from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store and s.is_active and o.business_type<>'CHAIN_RESTAURANT')
 then raise exception 'HISTORY_ADMIN_REQUIRED' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'batch_id','history:'||i.id::text||':'||r.source_id,'row_key',r.source_id,'product_id',l.product_id,
  'product_name',r.data->>'name','supplier_name',r.data->>'supplier','specification',coalesce(l.evidence->>'specification',''),
  'unit',private.history_unit(r.data->>'unit'),'unit_price',private.history_number(r.data->>'price'),
  'quantity',private.history_number(r.data->>'quantity'),'receipt_date',r.data->>'date','uploaded_at',i.imported_at,
  'status','HISTORICAL','review_allowed',false,'source_kind','HISTORICAL','source_month',to_char(i.source_month,'YYYY-MM'),
  'tax_basis',coalesce(r.data->>'tax_basis','UNKNOWN'),
  'price_valid',not exists(select 1 from jsonb_array_elements(r.issues) q where coalesce((q->>'deferred')::boolean,true) and q->>'field' in ('單價','包裝規格','數量與單位','單位','進貨日期','整筆紀錄')),
  'source_file',i.source_file,'source_location',r.data->>'source','source_issues',r.issues
 ) order by i.source_month,r.ordinal),'[]') into result
 from private.historical_imports i join private.historical_source_records r on r.import_id=i.id and r.kind='RECEIVING'
 left join private.historical_product_links l on l.import_id=r.import_id and l.kind=r.kind and l.source_id=r.source_id
 where i.store_id=p_store and i.state='READY';
 return result;
end $$;
revoke all on function private.history_key(text),private.history_unit(text),private.history_number(text),private.historical_inventory_source(uuid,date,uuid),private.historical_price_sources(uuid,jsonb) from public,anon,authenticated;

create or replace function private.inventory_month_state(p_store uuid,p_month date,p_session uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare source public.inventory_count_sessions%rowtype; previous public.inventory_count_sessions%rowtype;
 closure private.inventory_month_closures%rowtype; prev_closure private.inventory_month_closures%rowtype;
 choices jsonb; current_rows jsonb:='[]'; previous_rows jsonb:='[]'; rows jsonb:='[]'; result jsonb;
 previous_month date:=(p_month-interval '1 month')::date; complete boolean:=false; has_previous boolean:=false;
 hist jsonb; prev_hist jsonb; historical boolean:=false; baseline_pending boolean:=false;
 total numeric; previous_total numeric; missing integer; prev_missing integer; pending integer; source_count integer;
begin
 select * into closure from private.inventory_month_closures where store_id=p_store and month=p_month;
 if found then return closure.payload||jsonb_build_object('closed',true,'confirmed_at',closure.confirmed_at,'confirmed_by',closure.confirmed_by);end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'completed_at',s.completed_at,'status',s.status) order by s.completed_at desc,s.id),'[]') into choices
 from public.inventory_count_sessions s where s.store_id=p_store and s.status in ('REVIEWING','CLOSED')
 and s.completed_at>=p_month::timestamp at time zone 'Asia/Taipei'
 and s.completed_at<(p_month+interval '1 month')::timestamp at time zone 'Asia/Taipei';
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'completed_at',null,'status','HISTORICAL','label',to_char(i.source_month,'YYYY-MM')||' 歷史盤點') order by i.imported_at desc,i.id),'[]')||'[]'::jsonb into hist
 from private.historical_imports i where i.store_id=p_store and i.source_month=p_month and i.state='READY'
 and exists(select 1 from private.historical_source_records r where r.import_id=i.id and r.kind='INVENTORY');
 choices:=choices||hist;
 if p_session is not null and not exists(select 1 from jsonb_array_elements(choices) a where a->>'id'=p_session::text) then
  raise exception using errcode='22023',message='INVENTORY_SOURCE_NOT_IN_MONTH';end if;
 select * into source from public.inventory_count_sessions where id=coalesce(p_session,nullif(choices->0->>'id','')::uuid);
 if source.id is null then
  hist:=private.historical_inventory_source(p_store,p_month,p_session);
  historical:=hist is not null;
  if historical then source.id:=(hist->>'id')::uuid;current_rows:=hist->'rows';end if;
 end if;
 select * into prev_closure from private.inventory_month_closures where store_id=p_store and month=previous_month;
 if found then
  has_previous:=true;
  select coalesce(jsonb_agg(r||jsonb_build_object('quantity',r->'current_quantity')),'[]') into previous_rows
  from jsonb_array_elements(prev_closure.payload->'rows') r where r->>'current_quantity' is not null;
 else
  prev_hist:=private.historical_inventory_source(p_store,previous_month);
  if prev_hist is not null then has_previous:=true;previous_rows:=prev_hist->'rows';
  else baseline_pending:=exists(select 1 from public.inventory_count_sessions s where s.store_id=p_store and s.status in ('REVIEWING','CLOSED') and s.completed_at>=previous_month::timestamp at time zone 'Asia/Taipei' and s.completed_at<p_month::timestamp at time zone 'Asia/Taipei');end if;
 end if;
 if source.id is not null then
  if not historical then
  current_rows:=private.inventory_month_source(source.id);
  complete:=jsonb_array_length(coalesce(source.snapshot->'zones','[]'))>0
   and not exists(select 1 from public.count_zone_progress g where g.session_id=source.id and g.status<>'COMPLETED')
   and not exists(select 1 from jsonb_array_elements(coalesce(source.snapshot->'zones','[]')) a
    where not exists(select 1 from public.count_zone_progress g where g.session_id=source.id and g.zone_id::text=a->>'zone_id' and g.status='COMPLETED')
     or not exists(select 1 from public.count_entries e where e.session_id=source.id and e.entry_type='INITIAL_COUNT' and e.zone_id::text=a->>'zone_id' and e.product_id::text=a->>'product_id'))
   and not exists(select 1 from public.count_entries e where e.session_id=source.id and e.entry_type='INITIAL_COUNT'
    and not exists(select 1 from jsonb_array_elements(coalesce(source.snapshot->'zones','[]')) a where a->>'zone_id'=e.zone_id::text and a->>'product_id'=e.product_id::text));
  end if;
  with paired as (
   select c,p,coalesce(c->>'row_key',p->>'row_key') as row_key,md5(jsonb_build_array(c,p)::text) as signature
   from jsonb_array_elements(current_rows) c full join jsonb_array_elements(previous_rows) p on c->>'row_key'=p->>'row_key' or (c->>'product_id' is not null and c->>'product_id'=p->>'product_id' and private.history_unit(c->>'unit')=private.history_unit(p->>'unit'))
  ), valued as (
   select x.*,r.acknowledged,r.note,r.reviewed_by,
    case when r.price_set then r.unit_price else (x.c->>'unit_price')::numeric end as price,
    (x.c->>'quantity')::numeric as qty,(x.p->>'quantity')::numeric as previous_qty,
    case when coalesce((x.p->>'quantity_pending')::boolean,false) then 'PENDING_BASELINE'
     when not has_previous then 'NO_BASELINE'
     when x.c is null then 'MISSING'
     when x.p is null and exists(select 1 from jsonb_array_elements(previous_rows) a where a->>'product_id'=x.c->>'product_id') then 'UNIT_CHANGED'
     when x.p is null and exists(select 1 from jsonb_array_elements(previous_rows) a where a->>'product_id' is null and private.history_key(a->>'name')=private.history_key(x.c->>'name')) then 'PENDING_BASELINE'
     when x.p is null then 'NEW' else 'MATCHED' end as comparison
   from paired x left join private.inventory_month_reviews r on r.store_id=p_store and r.month=p_month and r.session_id=source.id and r.row_key=x.row_key and r.source_signature=x.signature
  )
  select coalesce(jsonb_agg(jsonb_build_object(
   'row_key',v.row_key,'source_signature',v.signature,'product_id',coalesce(v.c,v.p)->>'product_id','name',coalesce(v.c,v.p)->>'name',
   'unit',coalesce(v.c,v.p)->>'unit','supplier',coalesce(v.c,v.p)->>'supplier','category',coalesce(v.c,v.p)->>'category',
   'history_source',v.c->'history_source','baseline_source',v.p->'history_source','quantity_pending',coalesce((v.c->>'quantity_pending')::boolean,false),'zones',coalesce(v.c,v.p)->'zones','current_quantity',v.qty,'previous_quantity',v.previous_qty,
   'difference',case when v.comparison='MATCHED' then v.qty-v.previous_qty end,'comparison',v.comparison,
   'unit_price',v.price,'amount',round(v.qty*v.price,2),'previous_amount',round(v.previous_qty*(v.p->>'unit_price')::numeric,2),
   'original_quantity',v.c->'original_quantity','corrected',coalesce((v.c->>'corrected')::boolean,false),
   'correction_conflict',coalesce((v.c->>'correction_conflict')::boolean,false),
   'missing_price',v.qty is not null and v.price is null,
   'needs_review',(coalesce((v.c->>'quantity_pending')::boolean,false) or (v.qty is not null and v.price is null) or coalesce((v.c->>'correction_conflict')::boolean,false)
     or ((v.comparison in ('MISSING','UNIT_CHANGED') or (v.comparison='MATCHED' and v.qty<>v.previous_qty)) and not coalesce(v.acknowledged,false))),
   'acknowledged',coalesce(v.acknowledged,false),'review_note',coalesce(v.note,''),'reviewed_by',v.reviewed_by
  ) order by coalesce(v.c,v.p)->>'name',coalesce(v.c,v.p)->>'unit'),'[]') into rows from valued v;
 end if;
 select count(*) filter(where r->>'current_quantity' is not null),sum((r->>'amount')::numeric),count(*) filter(where (r->>'missing_price')::boolean),count(*) filter(where (r->>'needs_review')::boolean)
 into source_count,total,missing,pending from jsonb_array_elements(rows) r;
 select sum(round((r->>'quantity')::numeric*(r->>'unit_price')::numeric,2)),count(*) filter(where r->>'unit_price' is null) into previous_total,prev_missing from jsonb_array_elements(previous_rows) r;
 result:=jsonb_build_object('month',p_month,'store_id',p_store,'closed',false,'historical',historical,'source_file',case when historical then hist->>'file' end,'baseline_file',prev_hist->>'file','baseline_pending',baseline_pending,'sessions',choices,
  'source_id',source.id,'completed_at',source.completed_at,'source_complete',complete,'has_active_count',exists(select 1 from public.inventory_count_sessions s where s.store_id=p_store and s.status in ('DRAFT','IN_PROGRESS')),
  'previous_source_id',coalesce(prev_closure.session_id,(prev_hist->>'id')::uuid),'previous_completed_at',coalesce((prev_closure.payload->>'completed_at')::timestamptz,previous.completed_at),
  'previous_month',previous_month,'previous_closed',prev_closure.store_id is not null,'has_previous',has_previous,
  'rows',rows,'summary',jsonb_build_object('items',source_count,'subtotal',case when source.id is not null then total end,'missing_prices',missing,'pending',pending,
   'previous_subtotal',case when has_previous then previous_total end,'previous_missing_prices',prev_missing,
   'amount_difference',case when has_previous and source.id is not null and missing=0 and prev_missing=0 then total-previous_total end));
 return result||jsonb_build_object('revision',md5(result::text));
end $$;
revoke all on function private.inventory_month_state(uuid,date,uuid) from public,anon,authenticated;


-- Keep original historical categories when no unambiguous product identity exists.
create or replace function private.inventory_category_rows(p_state jsonb,p_store uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_set(p_state,'{rows}',coalesce((select jsonb_agg(r||jsonb_build_object(
 'original_category',r->'category','category',coalesce(c.category,private.classify_product(coalesce(p.name,r->>'name'),coalesce(p.category,r->>'category'))),
 'category_revision',coalesce(c.revision,0)) order by ord)
 from jsonb_array_elements(p_state->'rows') with ordinality x(r,ord)
 left join public.products p on p.id=(r->>'product_id')::uuid and p.organization_id=(select organization_id from public.stores where id=p_store)
 left join private.product_categories c on c.product_id=p.id),'[]'))
$$;
do $$ declare src text; anchor text; begin
 src:=pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure);
 anchor:=' if v_role is null then';
 if strpos(src,anchor)=0 then raise exception 'HISTORY_PRICE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,' if p_section=''historical-prices'' then return private.historical_price_sources(p_store,p_filter);end if;'||chr(10)||anchor);execute src;
 src:=pg_get_functiondef('private.baihuayuan_inventory_month(uuid,date,text,jsonb)'::regprocedure);
 anchor:=' if (state->>''closed'')::boolean then';
 if strpos(src,anchor)=0 then raise exception 'HISTORY_READONLY_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,' if coalesce((state->>''historical'')::boolean,false) then raise exception ''HISTORY_READ_ONLY'' using errcode=''22023'';end if;'||chr(10)||anchor);execute src;
end $$;
notify pgrst,'reload schema';
