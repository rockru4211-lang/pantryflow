-- Shared field reminders and immutable waste history. Public RPCs are invokers;
-- private implementations enforce active store membership on every request.
create table private.expiry_items (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 store_id uuid not null, name text not null check (length(btrim(name)) between 1 and 200),
 expires_on date not null, zone_id uuid references public.count_zones(id), zone_name text not null,
 attention_reason text not null, source text not null check(source in ('FIELD','RECEIPT')),
 lot_id uuid unique references public.inventory_lots(id), product_id uuid references public.products(id),
 unit text, created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
 foreign key(store_id,organization_id) references public.stores(id,organization_id)
);
create index expiry_items_store_date on private.expiry_items(store_id,expires_on,id);
create table private.waste_records (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 store_id uuid not null, store_name text not null, name text not null,
 quantity numeric(14,3) not null check(quantity>0), unit text not null check(length(btrim(unit)) between 1 and 30),
 reason text not null check(reason in ('效期到期','品質異常','製作或操作損耗','保存或設備異常','供應商問題','其他')),
 note text, delay_reason text, source text not null check(source in ('FIELD','EXPIRY')),
 expiry_id uuid unique references private.expiry_items(id), lot_id uuid references public.inventory_lots(id),
 product_id uuid references public.products(id), expires_on date, zone_name text,
 reference_price numeric, price_receipt_line_id uuid references public.receipt_lines(id),
 erp_required boolean not null, created_by uuid not null references public.profiles(id), actor_name text not null,
 created_at timestamptz not null default now(), work_date date not null default (now() at time zone 'Asia/Taipei')::date,
 foreign key(store_id,organization_id) references public.stores(id,organization_id)
);
create index waste_records_store_date on private.waste_records(store_id,work_date,created_at);
create table private.expiry_resolutions (
 expiry_id uuid primary key references private.expiry_items(id), action text not null check(action in ('WASTE','USED')),
 waste_id uuid unique references private.waste_records(id), created_by uuid not null references public.profiles(id),
 actor_name text not null, created_at timestamptz not null default now(),
 check((action='WASTE' and waste_id is not null) or (action='USED' and waste_id is null))
);
create table private.expiry_risk_locations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 store_id uuid not null, zone_id uuid not null references public.count_zones(id), zone_name text not null,
 name text not null, detail text not null, cadence text not null check(cadence in ('DAILY','MON','WED','FRI')),
 is_active boolean not null default true, updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid not null references public.profiles(id),
 foreign key(store_id,organization_id) references public.stores(id,organization_id)
);
create index expiry_risk_locations_store on private.expiry_risk_locations(store_id,is_active);
create table private.expiry_risk_events (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
 risk_id uuid not null references private.expiry_risk_locations(id), type text not null check(type in ('SETTINGS','LABEL','OTHER')),
 snapshot jsonb not null, note text, created_by uuid not null references public.profiles(id), actor_name text not null,
 created_at timestamptz not null default now()
);
create index expiry_risk_events_store_time on private.expiry_risk_events(store_id,created_at);
create table private.waste_erp_reports (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
 work_date date not null, waste_ids uuid[] not null check(cardinality(waste_ids)>0),
 created_by uuid not null references public.profiles(id), actor_name text not null, created_at timestamptz not null default now()
);
create index waste_erp_reports_store_date on private.waste_erp_reports(store_id,work_date);
create table private.expiry_waste_requests (
 store_id uuid not null references public.stores(id), request_id uuid not null, action text not null,
 payload jsonb not null, result jsonb not null, created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), primary key(store_id,request_id)
);
alter table public.stores add column waste_erp_reminder_time time not null default '21:30';

-- Append-only records cannot be silently rewritten even through an accidental privileged update.
do $$ declare t text; begin
 foreach t in array array['expiry_items','waste_records','expiry_resolutions','expiry_risk_locations','expiry_risk_events','waste_erp_reports','expiry_waste_requests'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
  execute format('grant all on private.%I to service_role',t);
  if t <> 'expiry_risk_locations' then
   execute format('create trigger immutable_history before update or delete on private.%I for each row execute function private.prevent_pilot_history_mutation()',t);
  end if;
 end loop;
end $$;

-- Only reviewed, actually dated receipt lots can supply package reminders.
create function private.expiry_from_receipt_lot() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source_type='GOODS_RECEIPT' and new.original_expiry_date is not null and new.store_id is not null then
  insert into private.expiry_items(organization_id,store_id,name,expires_on,zone_id,zone_name,attention_reason,source,lot_id,product_id,unit,created_by)
  select new.organization_id,new.store_id,p.name,new.original_expiry_date,new.zone_id,coalesce(z.name,'未分類'),'包裝效期','RECEIPT',new.id,p.id,p.base_unit,new.created_by
  from public.products p left join public.count_zones z on z.id=new.zone_id and z.store_id=new.store_id
  where p.id=new.product_id on conflict(lot_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function private.expiry_from_receipt_lot() from public,anon,authenticated;
create trigger receipt_lot_expiry after insert on public.inventory_lots for each row execute function private.expiry_from_receipt_lot();
create or replace function public.create_lot_from_receipt_line() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.goods_receipts; b public.receipt_upload_batches; lot uuid; expiry date; actor uuid;
begin
 select * into strict r from public.goods_receipts where id=new.receipt_id;
 select * into b from public.receipt_upload_batches where id=r.source_batch_id;
 actor:=coalesce(r.reviewed_by,b.uploaded_by);
 if nullif(new.batch_or_expiry,'') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
  begin expiry:=new.batch_or_expiry::date; exception when datetime_field_overflow or invalid_datetime_format then expiry:=null; end;
 end if;
 insert into public.inventory_lots(organization_id,store_id,store_name,product_id,lot_code,original_expiry_date,source_type,source_id,created_by)
 values(new.organization_id,coalesce(r.store_id,b.store_id),coalesce(b.store_name,'未指定門市'),new.product_id,nullif(new.batch_or_expiry,''),expiry,'GOODS_RECEIPT',new.id,actor) returning id into lot;
 insert into public.inventory_lot_events(organization_id,lot_id,event_type,preservation_state,quantity,unit,occurred_on,source_type,source_id,recorded_by)
 values(new.organization_id,lot,'RECEIVED','ORIGINAL_EXPIRY',new.quantity,new.unit,r.receipt_date,'GOODS_RECEIPT',new.id,actor);
 return new;
end $$;
revoke all on function public.create_lot_from_receipt_line() from public,anon,authenticated;
alter table public.inventory_lot_events drop constraint inventory_lot_events_event_type_check;
alter table public.inventory_lot_events add constraint inventory_lot_events_event_type_check check(event_type in ('RECEIVED','THAWED_UNOPENED','OPENED','DISCARDED'));
alter table public.inventory_lot_events drop constraint inventory_lot_events_source_type_check;
alter table public.inventory_lot_events add constraint inventory_lot_events_source_type_check check(source_type in ('GOODS_RECEIPT','MANUAL','WASTE'));

create function private.expiry_waste_command(p_store_id uuid,p_request_id uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 s public.stores; erp boolean; actor text; org uuid; prior private.expiry_waste_requests; result jsonb; eid uuid; wid uuid; rid uuid;
 item private.expiry_items; resolved private.expiry_resolutions; risk private.expiry_risk_locations;
 zone public.count_zones; prod public.products; price public.receipt_lines;
 qty numeric; unit_text text; item_name text; reason_text text; delay_text text; day date; selected_ids uuid[]; pending_ids uuid[];
 today date:=(now() at time zone 'Asia/Taipei')::date;
begin
 if auth.uid() is null or not private.has_active_store_role(p_store_id) then raise exception 'STORE_ACCESS_DENIED'; end if;
 if p_action not in ('REMINDER','WASTE','USED','RISK_SAVE','RISK_ISSUE','ERP_COMPLETE') or p_action is null then raise exception 'INVALID_ACTION'; end if;
 if p_action in ('RISK_SAVE','ERP_COMPLETE') then
  if not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then raise exception 'FIELD_MANAGER_REQUIRED'; end if;
 elsif not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[]) then raise exception 'FIELD_ROLE_REQUIRED'; end if;
 if p_request_id is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'INVALID_REQUEST'; end if;
 select * into strict s from public.stores where id=p_store_id;
 org:=s.organization_id; select has_erp into erp from public.organizations where id=org;
 select coalesce(nullif(display_name,''),'門市人員') into actor from public.profiles where id=auth.uid();
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_request_id::text,0));
 select * into prior from private.expiry_waste_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
  if prior.action<>p_action or prior.payload<>p_data then raise exception 'REQUEST_REUSED'; end if;
  return prior.result;
 end if;
 if p_action='REMINDER' then
  item_name:=btrim(p_data->>'name'); day:=(p_data->>'expires_on')::date;
  if item_name is null or length(item_name) not between 1 and 200 or day is null or day not between date '2000-01-01' and date '2200-01-01' or coalesce(p_data->>'attention_reason','') not in ('保存期限短','使用速度慢','容易被遺忘','高單價食材（主管自訂）') then raise exception 'REMINDER_FIELDS_REQUIRED'; end if;
  select * into zone from public.count_zones where id=(p_data->>'zone_id')::uuid and store_id=p_store_id and is_active;
  if not found then raise exception 'ZONE_REQUIRED'; end if;
  insert into private.expiry_items(organization_id,store_id,name,expires_on,zone_id,zone_name,attention_reason,source,created_by)
  values(org,p_store_id,item_name,day,zone.id,zone.name,p_data->>'attention_reason','FIELD',auth.uid()) returning id into eid;
  result:=jsonb_build_object('id',eid,'type','REMINDER');
 elsif p_action in ('WASTE','USED') then
  eid:=nullif(p_data->>'expiry_id','')::uuid;
  if eid is not null then
   select * into item from private.expiry_items where id=eid and store_id=p_store_id for update;
   if not found then raise exception 'EXPIRY_NOT_FOUND'; end if;
   select * into resolved from private.expiry_resolutions where expiry_id=eid;
   if found then result:=jsonb_build_object('id',coalesce(resolved.waste_id,eid),'type',resolved.action,'already_completed',true);
   elsif item.expires_on>today then raise exception 'EXPIRY_NOT_DUE'; end if;
  elsif p_action='USED' then raise exception 'EXPIRY_REQUIRED'; end if;
  if result is null and p_action='USED' then
   insert into private.expiry_resolutions(expiry_id,action,created_by,actor_name) values(eid,'USED',auth.uid(),actor);
   result:=jsonb_build_object('id',eid,'type','USED');
  elsif result is null then
   qty:=nullif(p_data->>'quantity','')::numeric; unit_text:=btrim(p_data->>'unit');
   if qty is null or qty<=0 or qty::text in ('NaN','Infinity','-Infinity') or qty>99999999999.999 or scale(qty)>3 or unit_text is null or length(unit_text) not between 1 and 30 then raise exception 'QUANTITY_UNIT_REQUIRED'; end if;
   item_name:=coalesce(item.name,btrim(p_data->>'name')); reason_text:=case when eid is not null then '效期到期' else p_data->>'reason' end;
   delay_text:=nullif(btrim(p_data->>'delay_reason'),'');
   if item_name is null or length(item_name) not between 1 and 200 or reason_text is null or reason_text not in ('效期到期','品質異常','製作或操作損耗','保存或設備異常','供應商問題','其他') then raise exception 'WASTE_FIELDS_REQUIRED'; end if;
   if eid is not null and item.expires_on<today and delay_text is null then raise exception 'DELAY_REASON_REQUIRED'; end if;
   if length(coalesce(p_data->>'note',''))>2000 or length(coalesce(delay_text,''))>2000 then raise exception 'NOTE_TOO_LONG'; end if;
   if item.product_id is not null then select * into prod from public.products where id=item.product_id;
   elsif nullif(p_data->>'product_id','') is not null then
    select * into prod from public.products where id=(p_data->>'product_id')::uuid and organization_id=org and is_active and name=item_name;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
   end if;
   if not erp and prod.id is not null then
    select l.* into price from public.receipt_lines l join public.goods_receipts g on g.id=l.receipt_id
    join public.receipt_upload_batches b on b.id=g.source_batch_id
    where l.product_id=prod.id and l.organization_id=org and coalesce(g.store_id,b.store_id)=p_store_id
    and g.reviewed_at is not null and b.status='COMPLETED' and l.unit=unit_text and l.unit_price_ex_tax>=0
    order by g.reviewed_at desc,l.created_at desc,l.id limit 1;
   end if;
   insert into private.waste_records(organization_id,store_id,store_name,name,quantity,unit,reason,note,delay_reason,source,expiry_id,lot_id,product_id,expires_on,zone_name,reference_price,price_receipt_line_id,erp_required,created_by,actor_name)
   values(org,p_store_id,s.name,item_name,qty,unit_text,reason_text,nullif(btrim(p_data->>'note'),''),delay_text,case when eid is null then 'FIELD' else 'EXPIRY' end,eid,item.lot_id,prod.id,item.expires_on,item.zone_name,price.unit_price_ex_tax,price.id,erp,auth.uid(),actor) returning id into wid;
   if eid is not null then
    insert into private.expiry_resolutions(expiry_id,action,waste_id,created_by,actor_name) values(eid,'WASTE',wid,auth.uid(),actor);
    -- A real lot is required. Free-text reminders never invent a stock association.
    if item.lot_id is not null then
     insert into public.inventory_lot_events(organization_id,lot_id,event_type,preservation_state,quantity,unit,occurred_on,source_type,source_id,recorded_by,note)
     values(org,item.lot_id,'DISCARDED',coalesce((select preservation_state from public.inventory_lot_events where lot_id=item.lot_id order by recorded_at desc,id desc limit 1),'ORIGINAL_EXPIRY'),qty,unit_text,today,'WASTE',wid,auth.uid(),'廢棄紀錄');
    end if;
   end if;
   result:=jsonb_build_object('id',wid,'type','WASTE');
  end if;
 elsif p_action='RISK_SAVE' then
  rid:=nullif(p_data->>'id','')::uuid;
  if rid is not null then
   select * into risk from private.expiry_risk_locations where id=rid and store_id=p_store_id for update;
   if not found then raise exception 'RISK_NOT_FOUND'; end if;
   if risk.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'RISK_CHANGED'; end if;
  end if;
  select * into zone from public.count_zones where id=(p_data->>'zone_id')::uuid and store_id=p_store_id and is_active;
  if not found then raise exception 'ZONE_REQUIRED'; end if;
  if coalesce(length(btrim(p_data->>'name')),0) not between 1 and 200 or coalesce(length(btrim(p_data->>'detail')),0) not between 1 and 500 or coalesce(p_data->>'cadence','') not in ('DAILY','MON','WED','FRI') then raise exception 'RISK_FIELDS_REQUIRED'; end if;
  insert into private.expiry_risk_locations(id,organization_id,store_id,zone_id,zone_name,name,detail,cadence,is_active,updated_by)
  values(coalesce(rid,gen_random_uuid()),org,p_store_id,zone.id,zone.name,btrim(p_data->>'name'),btrim(p_data->>'detail'),p_data->>'cadence',coalesce((p_data->>'is_active')::boolean,true),auth.uid())
  on conflict(id) do update set zone_id=excluded.zone_id,zone_name=excluded.zone_name,name=excluded.name,detail=excluded.detail,cadence=excluded.cadence,is_active=excluded.is_active,updated_by=excluded.updated_by,updated_at=clock_timestamp()
  returning * into risk;
  insert into private.expiry_risk_events(store_id,risk_id,type,snapshot,created_by,actor_name)
  values(p_store_id,risk.id,'SETTINGS',to_jsonb(risk),auth.uid(),actor);
  result:=jsonb_build_object('id',risk.id,'type','RISK_SAVE','active',risk.is_active);
 elsif p_action='RISK_ISSUE' then
  select * into risk from private.expiry_risk_locations where id=(p_data->>'risk_id')::uuid and store_id=p_store_id and is_active;
  if not found then raise exception 'RISK_NOT_FOUND'; end if;
  if coalesce(p_data->>'type','') not in ('LABEL','OTHER') or coalesce(length(btrim(p_data->>'note')),0) not between 1 and 2000 then raise exception 'ISSUE_FIELDS_REQUIRED'; end if;
  insert into private.expiry_risk_events(store_id,risk_id,type,snapshot,note,created_by,actor_name)
  values(p_store_id,risk.id,p_data->>'type',to_jsonb(risk),btrim(p_data->>'note'),auth.uid(),actor) returning id into rid;
  result:=jsonb_build_object('id',rid,'type','RISK_ISSUE');
 elsif p_action='ERP_COMPLETE' then
  if not erp then raise exception 'ERP_NOT_ENABLED'; end if;
  day:=(p_data->>'work_date')::date;
  if day is null or day>today then raise exception 'ERP_DATE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||day::text,1));
  select array_agg(distinct value::uuid order by value::uuid) into selected_ids from jsonb_array_elements_text(p_data->'waste_ids');
  select array_agg(w.id order by w.id) into pending_ids from private.waste_records w where w.store_id=p_store_id and w.erp_required and w.work_date=day
   and not exists(select 1 from private.waste_erp_reports r where r.store_id=p_store_id and w.id=any(r.waste_ids));
  if selected_ids is null or pending_ids is distinct from selected_ids then raise exception 'ERP_LIST_CHANGED'; end if;
  insert into private.waste_erp_reports(store_id,work_date,waste_ids,created_by,actor_name) values(p_store_id,day,selected_ids,auth.uid(),actor) returning id into rid;
  result:=jsonb_build_object('id',rid,'type','ERP_COMPLETE');
 end if;
 insert into private.expiry_waste_requests(store_id,request_id,action,payload,result,created_by) values(p_store_id,p_request_id,p_action,p_data,result,auth.uid());
 return result;
end $$;

create function private.expiry_waste_workspace(p_store_id uuid,p_from date,p_until date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare erp boolean; manager boolean; field boolean; today date:=(now() at time zone 'Asia/Taipei')::date; s public.stores;
begin
 if auth.uid() is null or not private.has_active_store_role(p_store_id) then raise exception 'STORE_ACCESS_DENIED'; end if;
 if p_from is null or p_until is null or p_until<p_from or p_until-p_from>366 then raise exception 'INVALID_DATE_RANGE'; end if;
 select * into strict s from public.stores where id=p_store_id;
 select has_erp into erp from public.organizations where id=s.organization_id;
 manager:=private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]);
 field:=private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[]);
 return jsonb_build_object(
  'today',today,'store_name',s.name,'has_erp',erp,'erp_time',to_char(s.waste_erp_reminder_time,'HH24:MI'),
  'permissions',jsonb_build_object('field',field,'manage',manager,'audit',private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR','LOGISTICS','OWNER']::public.app_role[])),
  'items',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('category',case when e.expires_on<=today then 'urgent' when e.expires_on<=today+3 then 'upcoming' else 'special' end) order by e.expires_on,e.created_at,e.id)
   from private.expiry_items e where e.store_id=p_store_id and not exists(select 1 from private.expiry_resolutions r where r.expiry_id=e.id)
   and (e.expires_on<=today+3 or e.attention_reason in ('使用速度慢','容易被遺忘','高單價食材（主管自訂）'))),'[]'::jsonb),
  'zones',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by sort_order,id) from public.count_zones where store_id=p_store_id and is_active),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(to_jsonb(p) order by p.name,p.id) from (select distinct p.id,p.name,p.base_unit from public.products p join public.zone_products zp on zp.product_id=p.id join public.count_zones z on z.id=zp.zone_id where z.store_id=p_store_id and z.is_active and p.is_active) p),'[]'::jsonb),
  'risks',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('due',r.cadence='DAILY' or r.cadence=case extract(isodow from today) when 1 then 'MON' when 3 then 'WED' when 5 then 'FRI' else '' end) order by r.name,r.id) from private.expiry_risk_locations r where r.store_id=p_store_id and (r.is_active or manager or not field)),'[]'::jsonb),
  'waste',coalesce((select jsonb_agg((to_jsonb(w)-'delay_reason'-'reference_price'-'price_receipt_line_id')||
   jsonb_build_object('delay_reason',case when manager or not field then w.delay_reason end,'reference_price',case when not erp then w.reference_price end,'reference_amount',case when not erp then w.quantity*w.reference_price end,
   'erp_report',(select jsonb_build_object('actor_name',r.actor_name,'created_at',r.created_at) from private.waste_erp_reports r where r.store_id=p_store_id and w.id=any(r.waste_ids) limit 1)) order by w.created_at desc,w.id)
   from private.waste_records w where w.store_id=p_store_id and w.work_date between p_from and p_until),'[]'::jsonb),
  'used',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'zone_name',e.zone_name,'expires_on',e.expires_on,'actor_name',r.actor_name,'created_at',r.created_at) order by r.created_at desc)
   from private.expiry_resolutions r join private.expiry_items e on e.id=r.expiry_id where e.store_id=p_store_id and r.action='USED' and (r.created_at at time zone 'Asia/Taipei')::date between p_from and p_until),'[]'::jsonb),
  'issues',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from private.expiry_risk_events r where r.store_id=p_store_id and r.type<>'SETTINGS' and (r.created_at at time zone 'Asia/Taipei')::date between p_from and p_until),'[]'::jsonb),
  'erp_pending',case when erp and (manager or not field) then coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'quantity',w.quantity,'unit',w.unit,'reason',w.reason,'actor_name',w.actor_name,'created_at',w.created_at,'work_date',w.work_date) order by w.created_at,w.id) from private.waste_records w where w.store_id=p_store_id and w.erp_required and not exists(select 1 from private.waste_erp_reports r where r.store_id=p_store_id and w.id=any(r.waste_ids))),'[]'::jsonb) else '[]'::jsonb end,
  'erp_reminder_due',(now() at time zone 'Asia/Taipei')::time>=s.waste_erp_reminder_time
 );
end $$;

create function public.get_pilot_expiry_waste(p_store_id uuid,p_from date,p_until date) returns jsonb language sql security invoker set search_path='' as $$ select private.expiry_waste_workspace(p_store_id,p_from,p_until) $$;
create function public.save_pilot_expiry_waste(p_store_id uuid,p_request_id uuid,p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.expiry_waste_command(p_store_id,p_request_id,p_action,p_data) $$;
revoke all on function private.expiry_waste_workspace(uuid,date,date),private.expiry_waste_command(uuid,uuid,text,jsonb),public.get_pilot_expiry_waste(uuid,date,date),public.save_pilot_expiry_waste(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.expiry_waste_workspace(uuid,date,date),private.expiry_waste_command(uuid,uuid,text,jsonb),public.get_pilot_expiry_waste(uuid,date,date),public.save_pilot_expiry_waste(uuid,uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
