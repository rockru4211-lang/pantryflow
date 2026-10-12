-- Additive, store-scoped metadata; old clients preserve fields they do not send.
alter table private.administrative_documents
 add column contract_start date,
 add column contract_end date,
 add column repair_date date,
 add column repair_reason text not null default '' check(length(repair_reason)<=8000),
 add column repair_result text not null default '' check(length(repair_result)<=8000),
 add constraint contract_date_order check(contract_start is null or contract_end is null or contract_end>=contract_start);

create table private.contract_reminders (
 document_id uuid not null references private.administrative_documents(id),
 contract_end date not null,
 notified_at timestamptz not null default now(),
 primary key(document_id,contract_end)
);
alter table private.contract_reminders enable row level security;
revoke all on private.contract_reminders from public,anon,authenticated;

-- Called only by postgres cron or the protected administrative write trigger.
create function private.enqueue_contract_reminders() returns void
language sql security definer set search_path='' as $$
 insert into private.contract_reminders(document_id,contract_end)
 select d.id,d.contract_end from private.administrative_documents d
 join public.stores s on s.id=d.store_id
 where s.is_active and not d.archived and d.category ~ '合約|合同|契約'
 and d.contract_end is not null
 and (d.contract_end-interval '3 months')::date <= (now() at time zone 'Asia/Taipei')::date
 on conflict(document_id,contract_end) do nothing;
$$;
revoke all on function private.enqueue_contract_reminders() from public,anon,authenticated;

create function private.enqueue_saved_contract_reminder() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not new.archived and new.category ~ '合約|合同|契約' and new.contract_end is not null
 and (new.contract_end-interval '3 months')::date <= (now() at time zone 'Asia/Taipei')::date then
  insert into private.contract_reminders(document_id,contract_end) values(new.id,new.contract_end)
  on conflict(document_id,contract_end) do nothing;
 end if;
 return new;
end $$;
revoke all on function private.enqueue_saved_contract_reminder() from public,anon,authenticated;
create trigger administrative_contract_reminder after insert or update of contract_end,category,archived
 on private.administrative_documents for each row execute function private.enqueue_saved_contract_reminder();

create or replace function private.administrative_workspace(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.administrative_access(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('notified_at',n.notified_at) order by d.name,d.id)
 from private.administrative_documents d left join private.contract_reminders n on n.document_id=d.id and n.contract_end=d.contract_end
 where d.store_id=p_store),'[]'::jsonb));
end $$;
revoke all on function private.administrative_workspace(uuid) from public,anon;
grant execute on function private.administrative_workspace(uuid) to authenticated;

create or replace function private.administrative_save(p_store uuid,p_data jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached private.app_requests; item jsonb; oldrow private.administrative_documents;
 saved private.administrative_documents; result jsonb:='[]'; rid uuid; org uuid;
begin
 if not private.administrative_access(p_store) or p_request is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if jsonb_typeof(p_data->'rows') is distinct from 'array' or jsonb_array_length(p_data->'rows') not between 1 and 500
 or octet_length(p_data::text)>2000000 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||':administrative',0));
 select * into cached from private.app_requests where store_id=p_store and request_id=p_request;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'administrative.save' or cached.payload<>p_data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return cached.result;
 end if;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_data->'rows')) then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 select organization_id into org from public.stores where id=p_store;
 for item in select value from jsonb_array_elements(p_data->'rows') loop
  rid:=(item->>'id')::uuid;
  select * into oldrow from private.administrative_documents where id=rid for update;
  if found then
   if oldrow.store_id<>p_store then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
   if (item->>'revision')::integer is distinct from oldrow.revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  elsif coalesce((item->>'revision')::integer,0)<>0 then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  insert into private.administrative_documents(id,store_id,name,category,summary,link,note,archived,revision,updated_by,contract_start,contract_end,repair_date,repair_reason,repair_result)
  values(rid,p_store,btrim(item->>'name'),coalesce(item->>'category',''),coalesce(item->>'summary',''),coalesce(item->>'link',''),coalesce(item->>'note',''),coalesce((item->>'archived')::boolean,false),coalesce(oldrow.revision,0)+1,auth.uid(),case when item?'contract_start' then nullif(item->>'contract_start','')::date else oldrow.contract_start end,case when item?'contract_end' then nullif(item->>'contract_end','')::date else oldrow.contract_end end,case when item?'repair_date' then nullif(item->>'repair_date','')::date else oldrow.repair_date end,coalesce(item->>'repair_reason',oldrow.repair_reason,''),coalesce(item->>'repair_result',oldrow.repair_result,''))
  on conflict(id) do update set name=excluded.name,category=excluded.category,summary=excluded.summary,link=excluded.link,note=excluded.note,
   contract_start=excluded.contract_start,contract_end=excluded.contract_end,repair_date=excluded.repair_date,repair_reason=excluded.repair_reason,repair_result=excluded.repair_result,archived=excluded.archived,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=clock_timestamp() returning * into saved;
  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
  values(org,p_store,'administrative_document',rid::text,'administrative.save',case when oldrow.id is null then null else to_jsonb(oldrow) end,to_jsonb(saved),auth.uid());
  result:=result||jsonb_build_array(to_jsonb(saved)||jsonb_build_object('notified_at',(select n.notified_at from private.contract_reminders n where n.document_id=saved.id and n.contract_end=saved.contract_end))); 
 end loop;
 result:=jsonb_build_object('rows',result);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result)
 values(p_store,p_request,auth.uid(),'administrative.save',p_data,result);
 return result;
end $$;
revoke all on function private.administrative_save(uuid,jsonb,uuid) from public,anon;
grant execute on function private.administrative_save(uuid,jsonb,uuid) to authenticated;


-- Hourly catch-up; still one durable in-app notification per contract/end date.
select cron.schedule('beape-contract-three-month-reminders','0 * * * *','select private.enqueue_contract_reminders()');
select private.enqueue_contract_reminders();
notify pgrst,'reload schema';
