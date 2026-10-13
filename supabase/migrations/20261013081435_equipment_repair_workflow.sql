-- Additive workflow. Existing equipment, repair documents and attachments remain intact.
create table private.equipment_jobs (
 id uuid primary key references private.administrative_documents(id),
 store_id uuid not null references public.stores(id),
 name text not null check(length(name) between 1 and 160),
 problem text not null default '' check(length(problem)<=8000),
 vendor text not null default '' check(length(vendor)<=160),
 scheduled_at timestamptz,
 status text not null default 'PENDING' check(status in ('PENDING','QUOTE','OTHER','DONE')),
 last_report text not null default '' check(length(last_report)<=8000),
 report_date date,
 reporter_name text not null default '',
 revision integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index equipment_jobs_store on private.equipment_jobs(store_id,status,updated_at desc);
create table private.equipment_job_events (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references private.equipment_jobs(id),
 action text not null check(action in ('create','plan','report')),
 status text not null,
 body text not null,
 reported_on date,
 actor_id uuid not null references auth.users(id),
 actor_name text not null,
 created_at timestamptz not null default clock_timestamp()
);
create index equipment_job_events_job on private.equipment_job_events(job_id,created_at);
alter table private.equipment_jobs enable row level security;
alter table private.equipment_job_events enable row level security;
revoke all on private.equipment_jobs,private.equipment_job_events from public,anon,authenticated;

create function private.equipment_workflow(p_store uuid,p_action text,p_data jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.equipment_jobs; old_value jsonb; cached private.app_requests; result jsonb;
 rid uuid; who text; org uuid; state text; body text; report_day date; event_body text;
begin
 if auth.uid() is null or not private.feature_scope(p_store) or not private.has_data_access(p_store,'EQUIPMENT',false) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_action='list' then
  return jsonb_build_object('jobs',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
   select job.*,(select coalesce(jsonb_agg(to_jsonb(e)-'actor_id' order by e.created_at,e.id),'[]') from private.equipment_job_events e where e.job_id=job.id) events
   from private.equipment_jobs job join private.administrative_documents d on d.id=job.id where job.store_id=p_store and not d.archived and not d.is_removed
  ) x),'[]'));
 end if;
 if p_action is null or p_action not in ('create','plan','report') or p_request is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>40000 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 perform private.assert_store_editable(p_store);
 if not private.has_data_access(p_store,'EQUIPMENT',true) or (p_action in ('create','plan') and not private.administrative_access(p_store)) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||':administrative',0));
 select * into cached from private.app_requests where store_id=p_store and request_id=p_request;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'equipment.'||p_action or cached.payload<>p_data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return cached.result;
 end if;
 select organization_id into org from public.stores where id=p_store;
 select coalesce(nullif(display_name,''),'現場人員') into who from public.profiles where id=auth.uid();who:=coalesce(who,'現場人員');
 rid:=nullif(p_data->>'id','')::uuid;
 if rid is null then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 if p_action='create' then
  if nullif(btrim(p_data->>'name'),'') is null or length(p_data->>'name')>160 or length(coalesce(p_data->>'problem',''))>8000 or length(coalesce(p_data->>'vendor',''))>160 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
  if exists(select 1 from private.administrative_documents where id=rid) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  perform private.administrative_save(p_store,jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',rid,'revision',0,'name',btrim(p_data->>'name'),'category','報修項目','repair_reason',coalesce(p_data->>'problem',''),'summary','維修廠商：'||coalesce(p_data->>'vendor','')))),gen_random_uuid());
  insert into private.equipment_jobs(id,store_id,name,problem,vendor,scheduled_at)
   values(rid,p_store,btrim(p_data->>'name'),coalesce(p_data->>'problem',''),coalesce(p_data->>'vendor',''),nullif(p_data->>'scheduled_at','')::timestamptz) returning * into j;
  event_body:='建立維修項目';
 else
  select * into j from private.equipment_jobs where id=rid and store_id=p_store for update;
  if not found or not exists(select 1 from private.administrative_documents where id=rid and not archived and not is_removed) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  if (p_data->>'revision')::integer is distinct from j.revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  old_value:=to_jsonb(j);
  if p_action='plan' then
   if length(coalesce(p_data->>'vendor',''))>160 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
   update private.equipment_jobs set vendor=coalesce(p_data->>'vendor',''),scheduled_at=nullif(p_data->>'scheduled_at','')::timestamptz,status='PENDING',revision=revision+1,updated_at=clock_timestamp() where id=rid returning * into j;
   event_body:='安排維修・'||coalesce(nullif(j.vendor,''),'廠商待確認')||'・'||coalesce(to_char(j.scheduled_at at time zone 'Asia/Taipei','YYYY/MM/DD HH24:MI'),'時間待確認');
  else
   state:=p_data->>'status';body:=btrim(p_data->>'body');report_day:=nullif(p_data->>'report_date','')::date;
   if state is null or state not in ('QUOTE','OTHER','DONE') or body is null or length(body) not between 1 and 8000 or report_day is null then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
   if j.status='DONE' then raise exception 'REPAIR_ALREADY_COMPLETED' using errcode='40001';end if;
   update private.equipment_jobs set status=state,last_report=body,report_date=report_day,reporter_name=who,revision=revision+1,updated_at=clock_timestamp() where id=rid returning * into j;
   event_body:=body;
  end if;
  -- Keep the existing document/attachment identity; never replace the original fault.
  update private.administrative_documents set summary='維修廠商：'||j.vendor,
   repair_result=case j.status when 'DONE' then '已完成維修' when 'QUOTE' then '等待報價' when 'OTHER' then '其他未完成' else '待維修' end||case when j.last_report<>'' then E'\n'||j.last_report else '' end,
   repair_date=case when p_action='report' then j.report_date else repair_date end,revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=rid;
 end if;
 insert into private.equipment_job_events(job_id,action,status,body,reported_on,actor_id,actor_name)
 values(rid,p_action,j.status,event_body,case when p_action='report' then j.report_date else null end,auth.uid(),who);
 result:=jsonb_build_object('job',to_jsonb(j)||jsonb_build_object('events',(select jsonb_agg(to_jsonb(e)-'actor_id' order by e.created_at,e.id) from private.equipment_job_events e where e.job_id=rid)));
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
 values(org,p_store,'equipment_job',rid::text,'equipment.'||p_action,old_value,to_jsonb(j),auth.uid());
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store,p_request,auth.uid(),'equipment.'||p_action,p_data,result);
 return result;
end $$;
revoke all on function private.equipment_workflow(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.equipment_workflow(uuid,text,jsonb,uuid) to authenticated;
create function public.equipment_workflow(p_store_id uuid,p_action text default 'list',p_data jsonb default '{}',p_request_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.equipment_workflow(p_store_id,p_action,p_data,p_request_id) $$;
revoke all on function public.equipment_workflow(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.equipment_workflow(uuid,text,jsonb,uuid) to authenticated;

-- A field report can never rewrite the office's original request via an old form.
do $$ declare src text; anchor text; begin
 src:=pg_get_functiondef('private.administrative_save(uuid,jsonb,uuid)'::regprocedure);
 anchor:='perform pg_advisory_xact_lock(hashtextextended(p_store::text||'':administrative'',0));';
 if strpos(src,anchor)=0 then raise exception 'administrative save anchor missing';end if;
 src:=replace(src,anchor,anchor||E'\n if exists(select 1 from jsonb_array_elements(p_data->''rows'') i join private.equipment_jobs j on j.id=(i->>''id'')::uuid) then raise exception ''REPAIR_USE_WORKFLOW'' using errcode=''42501'';end if;');execute src;
 src:=pg_get_functiondef('private.directory_lifecycle(uuid,jsonb,uuid)'::regprocedure);
 anchor:='perform private.assert_store_editable(p_store);';
 if strpos(src,anchor)=0 then raise exception 'directory lifecycle anchor missing';end if;
 src:=replace(src,anchor,anchor||E'\n if exists(select 1 from private.equipment_jobs where id=rid) and not private.administrative_access(p_store) then raise exception ''APP_FORBIDDEN'' using errcode=''42501'';end if;');execute src;
end $$;
notify pgrst,'reload schema';

-- Isolated synthetic regression; all fixture rows are rolled back.
do $test$
declare owner_id uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 s uuid:=gen_random_uuid(); other_s uuid:=gen_random_uuid(); item_id uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid();
 payload jsonb; result jsonb; before_count bigint;
begin
 select count(*) into before_count from private.administrative_documents;
 begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
   select u,u||'@equipment-basic-test.invalid',now(),now(),now() from unnest(array[owner_id,staff]) u;
  insert into public.profiles(id,display_name) select u,'設備基本權限測試' from unnest(array[owner_id,staff]) u on conflict(id) do nothing;
  insert into public.organizations(id,name,business_type) values(org,'設備基本權限測試','SINGLE_RESTAURANT');
  insert into public.stores(id,organization_id,name,store_code,created_by)
   values(s,org,'BeApe','EB'||substr(s::text,1,8),owner_id),(other_s,org,'Gras','EB'||substr(other_s::text,1,8),owner_id);
  insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
   values(org,owner_id,'OWNER',true,true),(org,staff,'STAFF',false,false);
  insert into public.staff_identities(organization_id,user_id,display_name,created_by)
   select org,u,'設備基本權限測試',owner_id from unnest(array[owner_id,staff]) u;
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
   values(s,org,owner_id,'eb-owner','OWNER','OWNER',owner_id,true),(s,org,staff,'eb-staff','STAFF','STAFF',owner_id,false);
  insert into private.person_data_access(organization_id,user_id,permissions,updated_by)
   values(org,staff,'{"EQUIPMENT":{"view":false,"edit":false}}',owner_id);

 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform private.administrative_save(s,jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',legacy,'name','舊紀錄','category','維修紀錄','revision',0,'repair_reason','保留舊原因'))),gen_random_uuid());
 payload:=jsonb_build_object('id',item_id,'name','測試冰箱','problem','原故障','vendor','測試廠商');
 result:=public.equipment_workflow(s,'create',payload,req);
 assert public.equipment_workflow(s,'create',payload,req)=result;
 assert (select count(*) from private.equipment_job_events where job_id=item_id)=1;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 assert jsonb_array_length(public.equipment_workflow(s)->'jobs')=1;
 begin perform public.equipment_workflow(s,'create',payload,gen_random_uuid());raise exception 'field create allowed';exception when sqlstate '42501' then null;end;
 begin perform public.equipment_workflow(s,'plan',jsonb_build_object('id',item_id,'revision',1),gen_random_uuid());raise exception 'field plan allowed';exception when sqlstate '42501' then null;end;
 begin perform public.equipment_workflow(other_s);raise exception 'cross store allowed';exception when sqlstate '42501' then null;end;
 payload:=jsonb_build_object('id',item_id,'revision',1,'status','QUOTE','body','等待廠商報價','report_date',current_date);req:=gen_random_uuid();
 result:=public.equipment_workflow(s,'report',payload,req);
 assert result->'job'->>'status'='QUOTE';
 assert public.equipment_workflow(s,'report',payload,req)=result;
 assert (select count(*) from private.equipment_job_events where job_id=item_id)=2;
 assert (select repair_reason from private.administrative_documents where id=item_id)='原故障';
 begin perform public.equipment_workflow(s,'report',payload,gen_random_uuid());raise exception 'stale revision allowed';exception when sqlstate '40001' then null;end;
 begin perform public.equipment_workflow(s,'report',payload||'{"body":"changed"}',req);raise exception 'request changed allowed';exception when sqlstate '23505' then null;end;
 begin perform private.administrative_save(s,jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',item_id,'name','改寫','category','維修紀錄','revision',2))),gen_random_uuid());raise exception 'legacy rewrite allowed';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 result:=public.equipment_workflow(s,'plan',jsonb_build_object('id',item_id,'revision',2,'vendor','新廠商'),gen_random_uuid());
 assert result->'job'->>'status'='PENDING';
 perform set_config('request.jwt.claim.sub',staff::text,true);
 payload:=jsonb_build_object('id',item_id,'revision',3,'status','DONE','body','已更換零件並試機','report_date',current_date);req:=gen_random_uuid();
 result:=public.equipment_workflow(s,'report',payload,req);
 assert result->'job'->>'status'='DONE';
 assert public.equipment_workflow(s,'report',payload,req)=result;
 assert jsonb_array_length(result->'job'->'events')=4;
 assert (select repair_reason from private.administrative_documents where id=legacy)='保留舊原因';
 update public.store_memberships set access_mode='VIEW' where store_id=s and user_id=staff;
 begin perform public.equipment_workflow(s,'report',payload,req);raise exception 'readonly retry allowed';exception when sqlstate '42501' then null;end;
 update public.store_memberships set is_active=false where store_id=s and user_id=staff;
 begin perform public.equipment_workflow(s);raise exception 'disabled read allowed';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.equipment_workflow(s);raise exception 'anon read allowed';exception when sqlstate '42501' then null;end;
 assert not has_function_privilege('anon','public.equipment_workflow(uuid,text,jsonb,uuid)','EXECUTE');
 assert not has_table_privilege('authenticated','private.equipment_jobs','SELECT');
 raise exception using errcode='ZX001',message='rollback repair fixtures';
 exception when sqlstate 'ZX001' then null;end;
 assert (select count(*) from private.administrative_documents)=before_count,'fixtures rolled back';
end $test$;
