-- Distinguish removal from deactivation; existing history and inactive states stay intact.
alter table public.suppliers add column is_removed boolean not null default false,
 add constraint supplier_removed_inactive check(not is_removed or not is_active);
alter table private.administrative_documents add column is_removed boolean not null default false,
 add constraint administrative_removed_inactive check(not is_removed or archived);

create function private.directory_lifecycle(p_store uuid,p_data jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare kind text:=p_data->>'kind'; act text:=p_data->>'operation'; rid uuid:=(p_data->>'id')::uuid;
 org uuid; cached private.app_requests; d private.administrative_documents; s public.suppliers;
 before_value jsonb; after_value jsonb; result jsonb; removed boolean; inactive boolean; ref record; used boolean;
begin
 if auth.uid() is null or p_request is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 perform private.assert_store_editable(p_store);
 if kind is null or kind not in ('supplier','equipment','contract') or act is null or act not in ('deactivate','activate','remove','restore','delete') or rid is null
 or length(coalesce(p_data->>'reason',''))>2000 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 if kind='supplier' then
  if not private.office_data_access(p_store) or not private.has_data_access(p_store,'SUPPLIERS',true) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 elsif kind='equipment' then
  if not private.has_data_access(p_store,'EQUIPMENT',true) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 elsif not private.administrative_access(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if act='delete' and not private.office_data_access(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into org from public.stores where id=p_store and is_active;
 if org is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||':directory-lifecycle',0));
 select * into cached from private.app_requests where store_id=p_store and request_id=p_request;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'directory.lifecycle' or cached.payload<>p_data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return cached.result;
 end if;
 if kind='supplier' then
  select * into s from public.suppliers where id=rid and organization_id=org for update;
  if not found then raise exception 'DIRECTORY_NOT_FOUND' using errcode='P0002';end if;
  if (p_data->>'updated_at')::timestamptz is distinct from s.updated_at then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  removed:=s.is_removed;inactive:=not s.is_active;before_value:=to_jsonb(s)||jsonb_build_object('details',(select to_jsonb(x) from private.supplier_details x where x.supplier_id=rid));
 else
  perform pg_advisory_xact_lock(hashtextextended(p_store::text||':administrative',0));
  select * into d from private.administrative_documents where id=rid and store_id=p_store for update;
  if not found then raise exception 'DIRECTORY_NOT_FOUND' using errcode='P0002';end if;
  if (kind='equipment' and d.category !~ '(設備|維修|報修|保養)') or (kind='contract' and d.category !~ '(合約|合同|契約)') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  if (p_data->>'revision')::integer is distinct from d.revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  removed:=d.is_removed;inactive:=d.archived;before_value:=to_jsonb(d);
 end if;
 if (act in ('restore','delete') and not removed) or (act in ('deactivate','activate','remove') and removed)
 or (act='activate' and not inactive) or (act='deactivate' and inactive) then raise exception 'DIRECTORY_STATE_CHANGED' using errcode='40001';end if;
 if act='delete' then
  -- Every foreign-key dependency blocks deletion, including future relations.
  for ref in select c.conrelid,a.attname from pg_catalog.pg_constraint c join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
   where c.contype='f' and c.confrelid=case when kind='supplier' then 'public.suppliers'::regclass else 'private.administrative_documents'::regclass end
   and c.conrelid<>'private.supplier_details'::regclass loop
   execute format('select exists(select 1 from %s where %I=$1)',ref.conrelid::regclass,ref.attname) into used using rid;
   if used then raise exception 'DIRECTORY_HAS_HISTORY' using errcode='23503';end if;
  end loop;
  if kind<>'supplier' and (d.category ~ '(維修|報修|保養)' or d.repair_date is not null or d.repair_reason<>'' or d.repair_result<>''
   or exists(select 1 from private.administrative_documents history where history.store_id=p_store and history.id<>rid and history.category ~ '(維修|報修|保養)'
    and exists(select 1 from (select d.name name union select a.old_value->>'name' from public.audit_logs a where a.entity_id=rid::text and a.organization_id=org) names
     where length(btrim(names.name))>0 and strpos(lower(history.name||' '||history.summary||' '||history.repair_reason||' '||history.repair_result),lower(names.name))>0))) then
   raise exception 'DIRECTORY_HAS_HISTORY' using errcode='23503';
  end if;
  if kind='supplier' then delete from private.supplier_details where supplier_id=rid;delete from public.suppliers where id=rid;
  else delete from private.administrative_documents where id=rid;end if;
  after_value:=null;
 else
  if kind='supplier' then
   update public.suppliers set is_removed=(act='remove'),is_active=(act='activate'),updated_at=clock_timestamp() where id=rid returning to_jsonb(public.suppliers.*) into after_value;
  else
   update private.administrative_documents set is_removed=(act='remove'),archived=(act<>'activate'),revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=rid returning to_jsonb(private.administrative_documents.*) into after_value;
  end if;
 end if;
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
 values(org,p_store,case when kind='supplier' then 'supplier' else 'administrative_document' end,rid::text,'directory.'||act,before_value,
 case when after_value is null then jsonb_build_object('deleted',true,'reason',coalesce(p_data->>'reason','')) else after_value||jsonb_build_object('reason',coalesce(p_data->>'reason','')) end,auth.uid());
 result:=jsonb_build_object('id',rid,'deleted',act='delete','status',case when act='delete' then 'DELETED' when act='remove' then 'REMOVED' when act='activate' then 'ACTIVE' else 'INACTIVE' end);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store,p_request,auth.uid(),'directory.lifecycle',p_data,result);
 return result;
end $$;
revoke all on function private.directory_lifecycle(uuid,jsonb,uuid) from public,anon,authenticated;

-- Keep the established entry point, feature checks, version conflicts and retry contract.
do $$declare def text;anchor text;begin
 def:=pg_get_functiondef('public.app_operation(uuid,text,jsonb,uuid)'::regprocedure);
 anchor:=' return private.app_operation_before_data_access';
 if strpos(def,anchor)=0 then raise exception 'LIFECYCLE_ROUTE_ANCHOR_MISSING';end if;
 def:=replace(def,anchor,$new$ if p_action='directory.lifecycle' then return private.directory_lifecycle(p_store_id,p_data,p_request_id);end if;
 return private.app_operation_before_data_access$new$);execute def;
 def:=pg_get_functiondef('private.administrative_save(uuid,jsonb,uuid)'::regprocedure);
 anchor:='if oldrow.store_id<>p_store then';
 if strpos(def,anchor)=0 then raise exception 'LIFECYCLE_ADMIN_ANCHOR_MISSING';end if;
 def:=replace(def,anchor,$new$if oldrow.is_removed then raise exception 'DIRECTORY_REMOVED' using errcode='22023';end if;
   if oldrow.store_id<>p_store then$new$);execute def;
 def:=pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure);
 anchor:='if not found then raise exception ''SUPPLIER_NOT_FOUND'' using errcode=''P0002''; end if;';
 if strpos(def,anchor)=0 then raise exception 'LIFECYCLE_SUPPLIER_ANCHOR_MISSING';end if;
 def:=replace(def,anchor,anchor||$new$
    if v_supplier.is_removed then raise exception 'DIRECTORY_REMOVED' using errcode='22023';end if;$new$);execute def;
end $$;
notify pgrst,'reload schema';
