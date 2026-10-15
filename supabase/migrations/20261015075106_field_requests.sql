-- Store-scoped purchasing reminders; formal procurement remains external.
create table private.purchase_notes (
 id uuid primary key references private.administrative_documents(id),
 store_id uuid not null references public.stores(id),
 name text not null check(length(btrim(name)) between 1 and 160),
 quantity numeric check(quantity>0),unit text not null default '' check(length(unit)<=40),
 reason text not null default '' check(length(reason)<=8000),
 desired_date date,arrival_date date,reference text not null default '' check(length(reference)<=2000),
 note text not null default '' check(length(note)<=8000),
 status text not null default 'PENDING' check(status in ('PENDING','SENT','ARRIVED','CANCELLED')),
 actor_name text not null,handler_name text not null default '',
 revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index purchase_notes_store on private.purchase_notes(store_id,updated_at desc);
alter table private.purchase_notes enable row level security;
revoke all on private.purchase_notes from public,anon,authenticated;
create table private.purchase_note_events (
 id uuid primary key default gen_random_uuid(),note_id uuid not null references private.purchase_notes(id),
 status text not null,body text not null,actor_name text not null,created_at timestamptz not null default clock_timestamp()
);
create index purchase_note_events_note on private.purchase_note_events(note_id,created_at);
alter table private.purchase_note_events enable row level security;
revoke all on private.purchase_note_events from public,anon,authenticated;
create function private.purchase_notes_workflow(s uuid,action text,data jsonb,request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.purchase_notes; cached private.app_requests; rid uuid; org uuid; who text; result jsonb; before_value jsonb; state text;
begin
 if auth.uid() is null or not coalesce(private.feature_scope(s),false) or not coalesce(private.has_data_access(s,'EQUIPMENT',false),false) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if action='list' then
 return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (select n.*,
 (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') from private.purchase_note_events e where e.note_id=n.id) events
 from private.purchase_notes n where n.store_id=s) x),'[]'));
 end if;
 perform private.assert_store_editable(s);
 if not coalesce(private.has_data_access(s,'EQUIPMENT',true),false) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if action is null or action not in ('create','save') or request is null or jsonb_typeof(data) is distinct from 'object' or octet_length(data::text)>40000 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(s::text||':purchases',0));
 select * into cached from private.app_requests where store_id=s and request_id=request;
 if found then
 if cached.actor_id<>auth.uid() or cached.action<>'purchase.'||action or cached.payload<>data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
 return cached.result;
 end if;
 rid:=(data->>'id')::uuid;
 if rid is null or coalesce(length(btrim(data->>'name')),0) not between 1 and 160 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 select organization_id into org from public.stores where id=s;
 select coalesce(nullif(display_name,''),'現場人員') into who from public.profiles where id=auth.uid();who:=coalesce(who,'現場人員');
 if action='create' then
 if exists(select 1 from private.administrative_documents where id=rid) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 insert into private.administrative_documents(id,store_id,name,category,updated_by) values(rid,s,btrim(data->>'name'),'待購事項',auth.uid());
 insert into private.purchase_notes(id,store_id,name,quantity,unit,reason,desired_date,actor_name)
 values(rid,s,btrim(data->>'name'),nullif(data->>'quantity','')::numeric,coalesce(data->>'unit',''),coalesce(data->>'reason',''),nullif(data->>'desired_date','')::date,who) returning * into r;
 else
 select * into r from private.purchase_notes where id=rid and store_id=s for update;
 if not found then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if (data->>'revision')::integer is distinct from r.revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 before_value:=to_jsonb(r);state:=data->>'status';
 if state is null or state not in ('PENDING','SENT','ARRIVED','CANCELLED') then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 if state='CANCELLED' and nullif(btrim(data->>'note'),'') is null then raise exception 'CANCEL_REASON_REQUIRED' using errcode='22023';end if;
 update private.purchase_notes set name=btrim(data->>'name'),quantity=nullif(data->>'quantity','')::numeric,unit=coalesce(data->>'unit',''),reason=coalesce(data->>'reason',''),desired_date=nullif(data->>'desired_date','')::date,
 arrival_date=nullif(data->>'arrival_date','')::date,reference=coalesce(data->>'reference',''),note=coalesce(data->>'note',''),status=state,handler_name=who,revision=revision+1,updated_at=clock_timestamp() where id=rid returning * into r;
 update private.administrative_documents set name=r.name,updated_by=auth.uid(),updated_at=clock_timestamp(),revision=revision+1 where id=rid;
 end if;
 insert into private.purchase_note_events(note_id,status,body,actor_name) values(rid,r.status,case when action='create' then '建立待購事項' else r.note end,who);
 result:=jsonb_build_object('row',to_jsonb(r)||jsonb_build_object('events',(select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from private.purchase_note_events e where e.note_id=rid)));
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id) values(org,s,'purchase_note',rid::text,'purchase.'||action,before_value,to_jsonb(r),auth.uid());
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),'purchase.'||action,data,result);
 return result;
end $$;
revoke all on function private.purchase_notes_workflow(uuid,text,jsonb,uuid) from public,anon,authenticated;
-- Reuse the authenticated operation gateway, without exposing private tables.
do $$declare src text;anchor text:=' if p_action=''directory.attachments''';begin
 src:=pg_get_functiondef('public.app_operation(uuid,text,jsonb,uuid)'::regprocedure);
 if strpos(src,anchor)=0 then raise exception 'PURCHASE_ROUTE_MISSING';end if;
 execute replace(src,anchor,' if p_action=''purchase.notes'' then return private.purchase_notes_workflow(p_store_id,p_data->>''operation'',p_data,p_request_id);end if;'||E'\n'||anchor);
end $$;
-- Permit field staff to create repair requests; planning remains office-only.
do $$declare src text; old text;begin
 src:=pg_get_functiondef('private.equipment_workflow(uuid,text,jsonb,uuid)'::regprocedure);
 src:=replace(src,'p_action in (''create'',''plan'')', 'p_action=''plan''');
 old:=$old$perform private.administrative_save(p_store,jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',rid,'revision',0,'name',btrim(p_data->>'name'),'category','報修項目','repair_reason',coalesce(p_data->>'problem',''),'summary','維修廠商：'||coalesce(p_data->>'vendor','')))),gen_random_uuid());$old$;
 if strpos(src,old)=0 then raise exception 'REPAIR_CREATE_ANCHOR_MISSING';end if;
 src:=replace(src,old,$new$insert into private.administrative_documents(id,store_id,name,category,repair_reason,summary,updated_by) values(rid,p_store,btrim(p_data->>'name'),'報修項目',coalesce(p_data->>'problem',''),'維修廠商：'||coalesce(p_data->>'vendor',''),auth.uid());$new$);
 execute src;
end $$;
-- Attachment access for purchasing is the same basic store-scoped access as repairs.
do $$declare src text;anchor text:='case when d.category ~';begin
 src:=pg_get_functiondef('private.directory_attachment_access(uuid,text,uuid,boolean)'::regprocedure);
 if strpos(src,anchor)=0 then raise exception 'ATTACHMENT_ACCESS_ANCHOR_MISSING';end if;
 execute replace(src,anchor,'case when d.category=''待購事項'' then private.feature_scope(s) and private.has_data_access(s,''EQUIPMENT'',editing) when d.category ~');
end $$;
-- Preserve document invariants: purchase state is only changed through its workflow.
do $$declare src text;anchor text;begin
 src:=pg_get_functiondef('private.administrative_save(uuid,jsonb,uuid)'::regprocedure);
 anchor:='perform pg_advisory_xact_lock(hashtextextended(p_store::text||'':administrative'',0));';
 if strpos(src,anchor)=0 then raise exception 'PURCHASE_GUARD_ANCHOR_MISSING';end if;
 execute replace(src,anchor,anchor||E'\n'||' if exists(select 1 from jsonb_array_elements(p_data->''rows'') i join private.purchase_notes n on n.id=(i->>''id'')::uuid) or exists(select 1 from jsonb_array_elements(p_data->''rows'') i where i->>''category''=''待購事項'') then raise exception ''PURCHASE_USE_WORKFLOW'' using errcode=''42501'';end if;');
end $$;
-- Video uploads: private bucket, exact MIME allow-list and 50 MB hard cap.
alter table private.directory_attachments drop constraint directory_attachments_byte_size_check;
alter table private.directory_attachments add constraint directory_attachments_byte_size_check check(byte_size between 1 and 52428800);
update storage.buckets set file_size_limit=52428800,allowed_mime_types=allowed_mime_types||array['video/mp4','video/quicktime','video/webm'] where id='directory-attachments';
do $$declare src text;begin
 src:=pg_get_functiondef('private.directory_attachment_operation(uuid,jsonb,uuid)'::regprocedure);
 if strpos(src,'20971520')=0 then raise exception 'ATTACHMENT_SIZE_ANCHOR_MISSING';end if;
 src:=replace(src,'20971520','52428800');
 src:=replace(src,'array[''image/jpeg''','array[''video/mp4'',''video/quicktime'',''video/webm'',''image/jpeg''');
 src:=replace(src,'case data->>''mime'' when','case data->>''mime'' when ''video/mp4'' then ''mp4'' when ''video/quicktime'' then ''mov'' when ''video/webm'' then ''webm'' when');
 execute src;
end $$;
notify pgrst,'reload schema';
