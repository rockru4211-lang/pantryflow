create table private.directory_attachments(
 id uuid primary key,store_id uuid not null references public.stores(id),
 document_id uuid references private.administrative_documents(id),supplier_id uuid references public.suppliers(id),
 filename text not null check(length(filename) between 1 and 240),mime text not null,byte_size bigint not null check(byte_size between 1 and 20971520),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),storage_path text not null unique,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),ready_at timestamptz,removed_at timestamptz,
 check(num_nonnulls(document_id,supplier_id)=1)
);
alter table private.directory_attachments enable row level security;
revoke all on private.directory_attachments from public,anon,authenticated;
create index directory_attachment_document on private.directory_attachments(document_id) where removed_at is null;
create index directory_attachment_supplier on private.directory_attachments(supplier_id) where removed_at is null;
create index directory_attachment_store on private.directory_attachments(store_id);
create index directory_attachment_actor on private.directory_attachments(created_by);

create function private.directory_attachment_access(s uuid,k text,t uuid,editing boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.stores st where st.id=s and st.is_active and private.app_role(s) is not null
 and (not editing or private.can_edit_store(s)) and case when k='supplier' then
 private.office_data_access(s) and private.has_data_access(s,'SUPPLIERS',editing) and exists(select 1 from public.suppliers x where x.id=t and x.organization_id=st.organization_id and (not editing or not x.is_removed))
 when k='document' then exists(select 1 from private.administrative_documents d where d.id=t and d.store_id=s and (not editing or not d.is_removed)
 and case when d.category ~ '(設備|維修|報修|保養)' then private.has_data_access(s,'EQUIPMENT',editing) else private.office_data_access(s) end)
 else false end)
$$;
revoke all on function private.directory_attachment_access(uuid,text,uuid,boolean) from public,anon,authenticated;

create function private.directory_attachment_storage(path text,writing boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from private.directory_attachments a where a.storage_path=path and a.removed_at is null
 and (not writing or a.ready_at is null and a.created_by=auth.uid()) and
 case when a.document_id is not null then private.directory_attachment_access(a.store_id,'document',a.document_id,writing)
 else exists(select 1 from public.stores s join public.suppliers sp on sp.organization_id=s.organization_id where sp.id=a.supplier_id
 and private.directory_attachment_access(s.id,'supplier',a.supplier_id,writing)) end)
$$;
revoke all on function private.directory_attachment_storage(text,boolean) from public,anon,authenticated;
grant execute on function private.directory_attachment_storage(text,boolean) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('directory-attachments','directory-attachments',false,20971520,
 array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create policy directory_attachment_read on storage.objects for select to authenticated using(bucket_id='directory-attachments' and private.directory_attachment_storage(name,false));
create policy directory_attachment_upload on storage.objects for insert to authenticated with check(bucket_id='directory-attachments' and private.directory_attachment_storage(name,true));

create function private.directory_attachment_operation(s uuid,data jsonb,request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k text:=data->>'kind';t uuid:=(data->>'target')::uuid;act text:=data->>'operation';a private.directory_attachments;result jsonb;org uuid;editing boolean:=coalesce(act not in ('list','counts'),true);ext text;
begin
 if auth.uid() is null or k is null or k not in ('document','supplier') or act is null or act not in ('counts','list','prepare','complete','remove') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if act='counts' then
  if private.app_role(s) is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  return (select coalesce(jsonb_object_agg(target,n),'{}') from (select coalesce(x.document_id,x.supplier_id)::text target,count(*) n from private.directory_attachments x where x.ready_at is not null and x.removed_at is null
  and (case when k='document' then x.document_id is not null and x.store_id=s else x.supplier_id is not null end)
  and private.directory_attachment_access(s,k,coalesce(x.document_id,x.supplier_id),false) group by coalesce(x.document_id,x.supplier_id)) counts);
 end if;
 if not private.directory_attachment_access(s,k,t,editing) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into org from public.stores where id=s;
 if act='list' then return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]') from private.directory_attachments x where (case when k='document' then x.document_id=t else x.supplier_id=t end) and x.ready_at is not null and x.removed_at is null);end if;
 perform private.assert_store_editable(s);
 perform pg_advisory_xact_lock(hashtextextended('directory-attachments:'||k||':'||t::text,0));
 -- Serialize against removal/deletion of the parent and recheck its current state.
 if k='document' then perform 1 from private.administrative_documents where id=t for update;else perform 1 from public.suppliers where id=t for update;end if;
 if not private.directory_attachment_access(s,k,t,true) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if act='prepare' then
  if request is null or length(coalesce(data->>'name','')) not between 1 and 240 or coalesce(data->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce((data->>'size')::bigint,0) not between 1 and 20971520
   or not coalesce(data->>'mime'=any(array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),false) then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
  select * into a from private.directory_attachments where id=request;
  if found and (coalesce(a.document_id,a.supplier_id)<>t or (k='document')<>(a.document_id is not null) or a.sha256<>data->>'sha256' or a.byte_size<>(data->>'size')::bigint or a.mime<>data->>'mime' or a.removed_at is not null) then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  if not found then
   select * into a from private.directory_attachments x where (case when k='document' then x.document_id=t else x.supplier_id=t end) and x.sha256=data->>'sha256' and x.byte_size=(data->>'size')::bigint and x.removed_at is null and (x.ready_at is not null or x.created_by=auth.uid()) order by x.ready_at nulls last limit 1;
  end if;
  if a.id is null then
   ext:=case data->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/heic' then 'heic' when 'image/heif' then 'heif' when 'application/pdf' then 'pdf' when 'application/msword' then 'doc' when 'application/vnd.ms-excel' then 'xls' when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx' else 'xlsx' end;
   insert into private.directory_attachments(id,store_id,document_id,supplier_id,filename,mime,byte_size,sha256,storage_path,created_by)
   values(request,s,case when k='document' then t end,case when k='supplier' then t end,data->>'name',data->>'mime',(data->>'size')::bigint,data->>'sha256',s::text||'/'||request::text||'/file.'||ext,auth.uid()) returning * into a;
  end if;
  return to_jsonb(a)||jsonb_build_object('stored',exists(select 1 from storage.objects o where o.bucket_id='directory-attachments' and o.name=a.storage_path and (o.metadata->>'size')::bigint=a.byte_size));
 end if;
 select * into a from private.directory_attachments x where x.id=(data->>'id')::uuid and (case when k='document' then x.document_id=t else x.supplier_id=t end) for update;
 if not found then raise exception 'DIRECTORY_NOT_FOUND' using errcode='P0002';end if;
 if act='complete' then
  if a.removed_at is not null then raise exception 'DIRECTORY_REMOVED' using errcode='22023';end if;
  if a.ready_at is not null then return to_jsonb(a);end if;
  if a.created_by<>auth.uid() then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='directory-attachments' and o.name=a.storage_path and (o.metadata->>'size')::bigint=a.byte_size and o.metadata->>'mimetype'=a.mime) then raise exception 'ORIGINAL_UPLOAD_INCOMPLETE' using errcode='22023';end if;
  update private.directory_attachments set ready_at=clock_timestamp() where id=a.id returning * into a;
 else
  if a.removed_at is not null then return to_jsonb(a);end if;
  update private.directory_attachments set removed_at=clock_timestamp() where id=a.id returning * into a;
 end if;
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id) values(org,s,'directory_attachment',a.id::text,'attachment.'||act,to_jsonb(a),auth.uid());
 return to_jsonb(a);
end $$;
revoke all on function private.directory_attachment_operation(uuid,jsonb,uuid) from public,anon,authenticated;
do $$declare def text;anchor text:=' return private.app_operation_before_data_access';begin
 def:=pg_get_functiondef('public.app_operation(uuid,text,jsonb,uuid)'::regprocedure);
 if strpos(def,anchor)=0 then raise exception 'ATTACHMENT_ROUTE_MISSING';end if;
 execute replace(def,anchor,$new$ if p_action='directory.attachments' then return private.directory_attachment_operation(p_store_id,p_data,p_request_id);end if;
 return private.app_operation_before_data_access$new$);
end $$;
notify pgrst,'reload schema';
