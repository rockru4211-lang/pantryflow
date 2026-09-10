-- Existing stores need not create zones before an optional receipt reminder.
alter table private.expiry_item_revisions alter column zone_id drop not null;
create or replace function private.context_expiry_options(p_store_id uuid,p_context_type text,p_context_id uuid,p_zone_id uuid)
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

create or replace function private.context_expiry_save(p_store_id uuid,p_request_id uuid,p_context_type text,p_context_id uuid,p_zone_id uuid,p_data jsonb)
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
 if nullif(p_data->>'zone_id','') is null then
  zone.id:=null; zone.name:='未分類';
 else
  select * into zone from public.count_zones where id=(p_data->>'zone_id')::uuid and store_id=p_store_id and is_active;
  if not found then raise exception 'ZONE_REQUIRED'; end if;
 end if;
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


notify pgrst,'reload schema';
