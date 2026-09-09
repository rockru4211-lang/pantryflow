-- One receipt line can contain multiple actual package batches. Existing IDs and request
-- IDs identify retries; a user explicitly choosing another batch must not overwrite one.
drop index private.expiry_receipt_context;
create index expiry_receipt_context on private.expiry_items(store_id,context_id,context_key) where context_type='RECEIPT';
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
  perform pg_advisory_xact_lock(hashtextextended(p_context_id::text||(choice->>'key'),2));
  if eid is not null then
   select * into existing from private.expiry_items where id=eid and store_id=p_store_id and context_type='RECEIPT' and context_id=p_context_id and context_key=choice->>'key' for update;
   if not found then raise exception 'EXPIRY_CONTEXT_MISMATCH'; end if;
  elsif not coalesce((p_data->>'new_batch')::boolean,false) then
   -- Older callers reuse a uniquely identified line; explicit new batches stay separate.
   if (select count(*) from private.expiry_items where store_id=p_store_id and context_type='RECEIPT' and context_id=p_context_id and context_key=choice->>'key')>1 then raise exception 'EXPIRY_CONTEXT_MISMATCH'; end if;
   select * into existing from private.expiry_items where store_id=p_store_id and context_type='RECEIPT' and context_id=p_context_id and context_key=choice->>'key' for update;
   eid:=existing.id;
  end if;
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
