-- Optional expiry registration keeps the source operation and stock unchanged.
alter table private.expiry_items add column context_type text check(context_type in ('COUNT','RECEIPT'));
alter table private.expiry_items add column context_id uuid;
alter table private.expiry_items add column context_key text;
alter table private.expiry_items add column context_run_id uuid references public.receipt_ocr_runs(id);
create unique index expiry_receipt_context on private.expiry_items(store_id,context_id,context_key) where context_type='RECEIPT';

-- The first observed expiry remains immutable. Corrections append a revision.
create table private.expiry_item_revisions (
 id uuid primary key default gen_random_uuid(), expiry_id uuid not null references private.expiry_items(id),
 revision integer not null check(revision>0), expires_on date not null,
 zone_id uuid not null references public.count_zones(id), zone_name text not null, attention_reason text not null,
 context_type text not null, context_id uuid not null, context_key text not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp(),
 unique(expiry_id,revision)
);
alter table private.expiry_item_revisions enable row level security;
revoke all on private.expiry_item_revisions from public,anon,authenticated;
grant all on private.expiry_item_revisions to service_role;
create trigger immutable_history before update or delete on private.expiry_item_revisions for each row execute function private.prevent_pilot_history_mutation();
create view private.expiry_current with(security_invoker=true) as
select e.id,e.organization_id,e.store_id,e.name,coalesce(r.expires_on,e.expires_on) expires_on,
 coalesce(r.zone_id,e.zone_id) zone_id,coalesce(r.zone_name,e.zone_name) zone_name,
 coalesce(r.attention_reason,e.attention_reason) attention_reason,e.source,e.lot_id,e.product_id,e.unit,e.created_by,e.created_at,
 e.context_type,e.context_id,e.context_key,e.context_run_id,e.expires_on original_expires_on,coalesce(r.revision,0) revision
from private.expiry_items e left join lateral(select * from private.expiry_item_revisions where expiry_id=e.id order by revision desc limit 1) r on true;
revoke all on private.expiry_current from public,anon,authenticated;

create function private.context_expiry_options(p_store_id uuid,p_context_type text,p_context_id uuid,p_zone_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.stores; c public.inventory_count_sessions; b public.receipt_upload_batches; run_id uuid; options jsonb;
begin
 if auth.uid() is null or not private.has_active_store_role(p_store_id) then raise exception 'STORE_ACCESS_DENIED'; end if;
 select * into strict s from public.stores where id=p_store_id;
 if p_context_type='COUNT' then
  if not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[]) then raise exception 'FIELD_ROLE_REQUIRED'; end if;
  select * into c from public.inventory_count_sessions where id=p_context_id and store_id=p_store_id;
  if not found or c.status not in ('DRAFT','IN_PROGRESS') then raise exception 'COUNT_CONTEXT_CLOSED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',p.id::text,'name',p.name,'unit',zp.count_unit,'product_id',p.id,'zone_id',z.id,
   'reminders',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'expires_on',e.expires_on,'zone_id',e.zone_id,'zone_name',e.zone_name,'attention_reason',e.attention_reason,'revision',e.revision,'created_at',e.created_at,'source',e.source) order by e.expires_on,e.created_at,e.id)
    from private.expiry_current e where e.store_id=p_store_id and e.product_id=p.id and not exists(select 1 from private.expiry_resolutions x where x.expiry_id=e.id)),'[]'::jsonb)) order by zp.sort_order,p.id),'[]'::jsonb) into options
  from public.count_zones z join public.zone_products zp on zp.zone_id=z.id join public.products p on p.id=zp.product_id
  where z.id=p_zone_id and z.store_id=p_store_id and z.is_active
  and exists(select 1 from jsonb_array_elements(c.snapshot->'zones') x where x->>'zone_id'=z.id::text and x->>'product_id'=p.id::text);
 elsif p_context_type='RECEIPT' then
  if not private.can_review_receipt(p_context_id) then raise exception 'RECEIPT_REVIEWER_REQUIRED'; end if;
  select * into b from public.receipt_upload_batches where id=p_context_id and store_id=p_store_id;
  if not found then raise exception 'RECEIPT_ACCESS_DENIED'; end if;
  select id into run_id from public.receipt_ocr_runs where batch_id=b.id and status='SUCCEEDED' order by version desc limit 1;
  if run_id is null then raise exception 'OCR_NOT_READY'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',f.row_key,'name',f.values->>'product','unit',f.values->>'unit','product_id',m.product_id,
    'zone_id',(select z.id from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where zp.product_id=m.product_id and z.store_id=p_store_id and z.is_active order by z.sort_order,z.id limit 1),
    'reminders',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'expires_on',e.expires_on,'zone_id',e.zone_id,'zone_name',e.zone_name,'attention_reason',e.attention_reason,'revision',e.revision,'created_at',e.created_at,'source',e.source)) from private.expiry_current e
     where e.store_id=p_store_id and e.context_type='RECEIPT' and e.context_id=b.id and e.context_key=f.row_key and not exists(select 1 from private.expiry_resolutions x where x.expiry_id=e.id)),'[]'::jsonb)) order by f.row_key),'[]'::jsonb) into options
  from (select row_key,jsonb_object_agg(field_name,value) values from private.receipt_effective_fields(run_id) where row_key<>'document' group by row_key) f
  left join public.receipt_product_mappings m on m.batch_id=b.id and m.row_key=f.row_key;
 else raise exception 'INVALID_CONTEXT'; end if;
 return jsonb_build_object('store_name',s.name,'run_id',run_id,'items',options,'zones',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by sort_order,id) from public.count_zones where store_id=p_store_id and is_active),'[]'::jsonb));
end $$;

create function private.context_expiry_save(p_store_id uuid,p_request_id uuid,p_context_type text,p_context_id uuid,p_zone_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare options jsonb; choice jsonb; existing private.expiry_items; effective private.expiry_current;
 zone public.count_zones; org uuid; eid uuid; prior private.expiry_waste_requests; payload jsonb; result jsonb; day date; reason text;
begin
 -- Resolve permissions and all source data on the server, never by a supplied name or quantity.
 options:=private.context_expiry_options(p_store_id,p_context_type,p_context_id,p_zone_id);
 if p_request_id is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'INVALID_REQUEST'; end if;
 payload:=jsonb_build_object('context_type',p_context_type,'context_id',p_context_id,'zone_id',p_zone_id,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_request_id::text,0));
 select * into prior from private.expiry_waste_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
  if prior.action<>'CONTEXT_REMINDER' or prior.payload<>payload then raise exception 'REQUEST_REUSED'; end if;
  return prior.result;
 end if;
 select x into choice from jsonb_array_elements(options->'items') x where x->>'key'=p_data->>'item_key';
 if choice is null or coalesce(length(btrim(choice->>'name')),0) not between 1 and 200 then raise exception 'CONTEXT_ITEM_REQUIRED'; end if;
 if p_context_type='RECEIPT' and (options->>'run_id') is distinct from p_data->>'run_id' then raise exception 'RECEIPT_CONTEXT_CHANGED'; end if;
 day:=(p_data->>'expires_on')::date;
 if day is null or day not between date '2000-01-01' and date '2200-01-01' then raise exception 'REMINDER_FIELDS_REQUIRED'; end if;
 select * into zone from public.count_zones where id=(p_data->>'zone_id')::uuid and store_id=p_store_id and is_active;
 if not found then raise exception 'ZONE_REQUIRED'; end if;
 reason:=case when p_context_type='RECEIPT' then '包裝效期' else p_data->>'attention_reason' end;
 if reason is null or reason not in ('包裝效期','保存期限短','使用速度慢','容易被遺忘','高單價食材（主管自訂）') then raise exception 'REMINDER_FIELDS_REQUIRED'; end if;
 eid:=nullif(p_data->>'expiry_id','')::uuid;
 if p_context_type='RECEIPT' then
  -- Independent of a request UUID, one identified receipt line reuses its reminder.
  perform pg_advisory_xact_lock(hashtextextended(p_context_id::text||(choice->>'key'),2));
  select * into existing from private.expiry_items where store_id=p_store_id and context_type='RECEIPT' and context_id=p_context_id and context_key=choice->>'key' for update;
  if existing.id is not null then
   if eid is not null and eid<>existing.id then raise exception 'EXPIRY_CONTEXT_MISMATCH'; end if;
   eid:=existing.id;
  elsif eid is not null then raise exception 'EXPIRY_CONTEXT_MISMATCH'; end if;
 elsif eid is not null then
  select * into existing from private.expiry_items where id=eid and store_id=p_store_id and product_id=(choice->>'product_id')::uuid for update;
  if not found then raise exception 'EXPIRY_CONTEXT_MISMATCH'; end if;
 end if;
 select organization_id into org from public.stores where id=p_store_id;
 if eid is not null then
  if exists(select 1 from private.expiry_resolutions where expiry_id=eid) then raise exception 'EXPIRY_ALREADY_COMPLETED'; end if;
  select * into effective from private.expiry_current where id=eid;
  -- A retry from another device with the same effective values is also a no-op.
  if effective.expires_on is distinct from day or effective.zone_id is distinct from zone.id or effective.attention_reason is distinct from reason then
   if (p_data->>'revision')::integer is distinct from effective.revision then raise exception 'EXPIRY_CHANGED'; end if;
   insert into private.expiry_item_revisions(expiry_id,revision,expires_on,zone_id,zone_name,attention_reason,context_type,context_id,context_key,created_by)
   values(eid,effective.revision+1,day,zone.id,zone.name,reason,p_context_type,p_context_id,choice->>'key',auth.uid());
  end if;
 else
  insert into private.expiry_items(organization_id,store_id,name,expires_on,zone_id,zone_name,attention_reason,source,product_id,unit,created_by,context_type,context_id,context_key,context_run_id)
  values(org,p_store_id,btrim(choice->>'name'),day,zone.id,zone.name,reason,case when p_context_type='RECEIPT' then 'RECEIPT' else 'FIELD' end,(choice->>'product_id')::uuid,choice->>'unit',auth.uid(),p_context_type,p_context_id,choice->>'key',(options->>'run_id')::uuid) returning id into eid;
 end if;
 result:=jsonb_build_object('id',eid,'type','REMINDER');
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
 values(org,'expiry_item',eid::text,'CONTEXT_REMINDER_SAVED',payload||result,auth.uid());
 insert into private.expiry_waste_requests(store_id,request_id,action,payload,result,created_by) values(p_store_id,p_request_id,'CONTEXT_REMINDER',payload,result,auth.uid());
 return result;
end $$;

create function public.get_pilot_context_expiry(p_store_id uuid,p_context_type text,p_context_id uuid,p_zone_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.context_expiry_options(p_store_id,p_context_type,p_context_id,p_zone_id) $$;
create function public.save_pilot_context_expiry(p_store_id uuid,p_request_id uuid,p_context_type text,p_context_id uuid,p_data jsonb,p_zone_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.context_expiry_save(p_store_id,p_request_id,p_context_type,p_context_id,p_zone_id,p_data) $$;
revoke all on function private.context_expiry_options(uuid,text,uuid,uuid),private.context_expiry_save(uuid,uuid,text,uuid,uuid,jsonb),public.get_pilot_context_expiry(uuid,text,uuid,uuid),public.save_pilot_context_expiry(uuid,uuid,text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.context_expiry_options(uuid,text,uuid,uuid),private.context_expiry_save(uuid,uuid,text,uuid,uuid,jsonb),public.get_pilot_context_expiry(uuid,text,uuid,uuid),public.save_pilot_context_expiry(uuid,uuid,text,uuid,jsonb,uuid) to authenticated;

-- Existing completion paths use the effective revision, retaining their atomic locks.
create or replace function private.expiry_waste_command(p_store_id uuid,p_request_id uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  -- A newly discovered expired item is recorded together with its outcome,
  -- never through a preliminary save or a second mandatory confirmation.
  if eid is null and jsonb_typeof(p_data->'new_expiry')='object' then
   select * into risk from private.expiry_risk_locations where id=(p_data->'new_expiry'->>'risk_id')::uuid and store_id=p_store_id and is_active;
   if not found then raise exception 'RISK_NOT_FOUND'; end if;
   select * into zone from public.count_zones where id=(p_data->'new_expiry'->>'zone_id')::uuid and store_id=p_store_id and is_active;
   if not found then raise exception 'ZONE_REQUIRED'; end if;
   item_name:=btrim(p_data->'new_expiry'->>'name'); day:=(p_data->'new_expiry'->>'expires_on')::date;
   if coalesce(length(item_name),0) not between 1 and 200 or day is null or day>today or day<date '2000-01-01' then raise exception 'REMINDER_FIELDS_REQUIRED'; end if;
   insert into private.expiry_items(organization_id,store_id,name,expires_on,zone_id,zone_name,attention_reason,source,created_by)
   values(org,p_store_id,item_name,day,zone.id,zone.name,'保存期限短','FIELD',auth.uid()) returning id into eid;
  end if;
  if eid is not null then
   select * into item from private.expiry_items where id=eid and store_id=p_store_id for update;
   if not found then raise exception 'EXPIRY_NOT_FOUND'; end if;
   select (jsonb_populate_record(null::private.expiry_items,to_jsonb(e))).* into item from private.expiry_current e where e.id=eid;
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

notify pgrst,'reload schema';

create or replace function private.expiry_waste_workspace(p_store_id uuid,p_from date,p_until date) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
   from private.expiry_current e where e.store_id=p_store_id and not exists(select 1 from private.expiry_resolutions r where r.expiry_id=e.id)
   and (e.expires_on<=today+3 or e.attention_reason in ('使用速度慢','容易被遺忘','高單價食材（主管自訂）'))),'[]'::jsonb),
  'zones',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by sort_order,id) from public.count_zones where store_id=p_store_id and is_active),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(to_jsonb(p) order by p.name,p.id) from (select distinct p.id,p.name,p.base_unit from public.products p join public.zone_products zp on zp.product_id=p.id join public.count_zones z on z.id=zp.zone_id where z.store_id=p_store_id and z.is_active and p.is_active) p),'[]'::jsonb),
  'risks',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('due',r.cadence='DAILY' or r.cadence=case extract(isodow from today) when 1 then 'MON' when 3 then 'WED' when 5 then 'FRI' else '' end) order by r.name,r.id) from private.expiry_risk_locations r where r.store_id=p_store_id and (r.is_active or manager or not field)),'[]'::jsonb),
  'waste',coalesce((select jsonb_agg((to_jsonb(w)-'delay_reason'-'reference_price'-'price_receipt_line_id')||
   jsonb_build_object('delay_reason',case when manager or not field then w.delay_reason end,'reference_price',case when not erp then w.reference_price end,'reference_amount',case when not erp then w.quantity*w.reference_price end,
   'erp_report',(select jsonb_build_object('actor_name',r.actor_name,'created_at',r.created_at) from private.waste_erp_reports r where r.store_id=p_store_id and w.id=any(r.waste_ids) limit 1)) order by w.created_at desc,w.id)
   from private.waste_records w where w.store_id=p_store_id and w.work_date between p_from and p_until),'[]'::jsonb),
  'used',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'zone_name',e.zone_name,'expires_on',e.expires_on,'actor_name',r.actor_name,'created_at',r.created_at) order by r.created_at desc)
   from private.expiry_resolutions r join private.expiry_current e on e.id=r.expiry_id where e.store_id=p_store_id and r.action='USED' and (r.created_at at time zone 'Asia/Taipei')::date between p_from and p_until),'[]'::jsonb),
  'issues',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from private.expiry_risk_events r where r.store_id=p_store_id and r.type<>'SETTINGS' and (r.created_at at time zone 'Asia/Taipei')::date between p_from and p_until),'[]'::jsonb),
  'erp_pending',case when erp and (manager or not field) then coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'quantity',w.quantity,'unit',w.unit,'reason',w.reason,'actor_name',w.actor_name,'created_at',w.created_at,'work_date',w.work_date) order by w.created_at,w.id) from private.waste_records w where w.store_id=p_store_id and w.erp_required and not exists(select 1 from private.waste_erp_reports r where r.store_id=p_store_id and w.id=any(r.waste_ids))),'[]'::jsonb) else '[]'::jsonb end,
  'erp_reminder_due',(now() at time zone 'Asia/Taipei')::time>=s.waste_erp_reminder_time
 );
end $$;


notify pgrst,'reload schema';
