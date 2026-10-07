-- Administrative reference records are private and store-scoped. No source/demo data seeded.
create table private.administrative_documents (
 id uuid primary key,
 store_id uuid not null references public.stores(id),
 name text not null check(length(btrim(name)) between 1 and 160),
 category text not null default '' check(length(category)<=80),
 summary text not null default '' check(length(summary)<=8000),
 link text not null default '' check(length(link)<=2000 and (link='' or link ~* '^https?://[^[:space:]]+$')),
 note text not null default '' check(length(note)<=8000),
 archived boolean not null default false,
 revision integer not null default 1,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
create index administrative_documents_store on private.administrative_documents(store_id,archived);
alter table private.administrative_documents enable row level security;
revoke all on private.administrative_documents from public,anon,authenticated;

create function private.administrative_access(p_store uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(auth.uid() is not null and private.app_role(p_store) in ('OWNER','LOGISTICS')
 and private.can_edit_store(p_store) and exists(select 1 from public.stores s
 join public.organizations o on o.id=s.organization_id where s.id=p_store and s.is_active
 and o.business_type::text='SINGLE_RESTAURANT'
 and (private.app_role(p_store)='OWNER' or 'OFFICE'=any(private.person_work_functions(s.organization_id,auth.uid())))),false)
$$;
revoke all on function private.administrative_access(uuid) from public,anon,authenticated;

create function private.administrative_workspace(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.administrative_access(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(d) order by d.name,d.id)
 from private.administrative_documents d where d.store_id=p_store),'[]'::jsonb));
end $$;
revoke all on function private.administrative_workspace(uuid) from public,anon;
grant execute on function private.administrative_workspace(uuid) to authenticated;

create function private.administrative_save(p_store uuid,p_data jsonb,p_request uuid) returns jsonb
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
  insert into private.administrative_documents(id,store_id,name,category,summary,link,note,archived,revision,updated_by)
  values(rid,p_store,btrim(item->>'name'),coalesce(item->>'category',''),coalesce(item->>'summary',''),coalesce(item->>'link',''),coalesce(item->>'note',''),coalesce((item->>'archived')::boolean,false),coalesce(oldrow.revision,0)+1,auth.uid())
  on conflict(id) do update set name=excluded.name,category=excluded.category,summary=excluded.summary,link=excluded.link,note=excluded.note,
   archived=excluded.archived,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=clock_timestamp() returning * into saved;
  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
  values(org,p_store,'administrative_document',rid::text,'administrative.save',case when oldrow.id is null then null else to_jsonb(oldrow) end,to_jsonb(saved),auth.uid());
  result:=result||jsonb_build_array(to_jsonb(saved));
 end loop;
 result:=jsonb_build_object('rows',result);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result)
 values(p_store,p_request,auth.uid(),'administrative.save',p_data,result);
 return result;
end $$;
revoke all on function private.administrative_save(uuid,jsonb,uuid) from public,anon;
grant execute on function private.administrative_save(uuid,jsonb,uuid) to authenticated;

-- Extend the existing invoker routing without replacing its other operations.
do $$ declare source text; begin
 select pg_get_functiondef('public.app_workspace(uuid,text,jsonb)'::regprocedure) into source;
 if strpos(source,'select case when')=0 then raise exception 'WORKSPACE_ROUTING_CHANGED';end if;
 source:=replace(source,'select case when','select case when p_section=''administrative'' then private.administrative_workspace(p_store_id) when');execute source;
 select pg_get_functiondef('public.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into source;
 if strpos(source,'select case when')=0 then raise exception 'OPERATION_ROUTING_CHANGED';end if;
 source:=replace(source,'select case when','select case when p_action=''administrative.save'' then private.administrative_save(p_store_id,p_data,p_request_id) when');execute source;
end $$;
notify pgrst,'reload schema';
