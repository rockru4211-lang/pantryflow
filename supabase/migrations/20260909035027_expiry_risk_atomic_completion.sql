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
