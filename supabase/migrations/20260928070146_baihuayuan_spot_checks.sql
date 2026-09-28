-- Spot checks are independent, immutable-baseline follow-ups to CLOSED counts.
-- No statement below updates count entries, inventory lots or stock balances.
create table private.spot_checks (
 id uuid primary key, store_id uuid not null references public.stores(id),
 organization_id uuid not null references public.organizations(id),
 source_id uuid not null references public.inventory_count_sessions(id),
 source_month date not null, source_completed_at timestamptz not null,
 status text not null default 'DRAFT' check(status in ('DRAFT','OPEN','REVIEWING','CLOSED')),
 assignee_id uuid not null references auth.users(id), assignee_name text not null,
 created_by uuid not null references auth.users(id), created_name text not null,
 created_at timestamptz not null default now(), submitted_at timestamptz,
 submitted_by uuid references auth.users(id), submitted_name text,
 closed_at timestamptz, revision integer not null default 1
);
create index spot_checks_store_month on private.spot_checks(store_id,source_month,created_at desc);
create table private.spot_check_items (
 check_id uuid not null references private.spot_checks(id),
 entry_id uuid not null references public.count_entries(id),
 product_id uuid not null, zone_id uuid not null, name text not null,
 zone text not null, unit text not null, specification text not null default '',
 original_quantity numeric(14,3) not null, original_entered_at timestamptz not null,
 baseline_note text not null default '', quantity numeric(14,3),
 review_status text not null default 'UNCHECKED' check(review_status in ('UNCHECKED','SAME','PENDING','REVIEWED','CLOSED')),
 recheck_quantity numeric(14,3), reason text, note text not null default '',
 reviewed_by uuid references auth.users(id), reviewed_name text, reviewed_at timestamptz,
 confirmed_by uuid references auth.users(id), confirmed_name text, confirmed_at timestamptz,
 final_quantity numeric(14,3), return_note text not null default '',
 primary key(check_id,entry_id),
 check(quantity is null or (quantity>=0 and quantity<100000000000)),
 check(recheck_quantity is null or (recheck_quantity>=0 and recheck_quantity<100000000000)),
 check(reason is null or reason in ('USED','MOVEMENT','ORIGINAL_ERROR','CHECK_ERROR','OTHER','UNKNOWN')),
 check(length(note)<=1000 and length(return_note)<=1000)
);
create table private.spot_check_events (
 id uuid primary key default gen_random_uuid(), check_id uuid not null references private.spot_checks(id),
 entry_id uuid, action text not null, actor_id uuid not null references auth.users(id),
 actor_name text not null, at timestamptz not null default now(), payload jsonb not null default '{}'
);
create index spot_check_events_check on private.spot_check_events(check_id,at,id);
create table private.spot_check_requests (
 request_id uuid primary key, store_id uuid not null, actor_id uuid not null,
 action text not null, payload jsonb not null, check_id uuid not null references private.spot_checks(id),
 created_at timestamptz not null default now()
);
alter table private.spot_checks enable row level security;
alter table private.spot_check_items enable row level security;
alter table private.spot_check_events enable row level security;
alter table private.spot_check_requests enable row level security;
revoke all on private.spot_checks,private.spot_check_items,private.spot_check_events,private.spot_check_requests from public,anon,authenticated;

create function private.spot_check_caps(p_store uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with actor as (
 select private.app_role(p_store) as role,private.can_edit_store(p_store) as editable,
 exists(select 1 from public.staff_identities si join public.stores s on s.organization_id=si.organization_id
 where s.id=p_store and si.user_id=auth.uid() and si.job_title='財務') as finance
 ) select jsonb_build_object('plan',editable and not finance and role in ('SUPERVISOR','LOGISTICS','OWNER'),
 'operate',editable and not finance,'review',editable and not finance and role in ('SUPERVISOR','OWNER'),
 'close',editable and not finance and role in ('LOGISTICS','OWNER'),
 'export',private.has_app_feature(p_store,'DATA_EXPORT')) from actor
$$;

create function private.spot_check_detail(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select to_jsonb(c)||jsonb_build_object('caps',private.spot_check_caps(c.store_id),
 'items',coalesce((select jsonb_agg(
   (to_jsonb(i)-'original_quantity')||case when c.submitted_at is not null then
     jsonb_build_object('original_quantity',i.original_quantity) else '{}'::jsonb end
   order by i.zone,i.name,i.entry_id) from private.spot_check_items i where i.check_id=c.id),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.at,e.id) from private.spot_check_events e where e.check_id=c.id),'[]'::jsonb))
 from private.spot_checks c where c.id=p_id
$$;

-- Only INITIAL_COUNT zone entries are selectable: corrections at product-total
-- level cannot safely be distributed back across zones. Flag those baselines.
create function private.spot_check_source(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('entry_id',e.id,'product_id',e.product_id,'zone_id',e.zone_id,
 'name',coalesce(snap.item->>'product_name',p.name),'zone',coalesce(snap.item->>'zone_name',z.name),
 'unit',e.unit,'specification',coalesce(snap.item->>'specification',p.specification,''),
 'original_quantity',e.quantity,'original_entered_at',e.entered_at,
 'baseline_note',case when exists(select 1 from public.inventory_count_discrepancies d where d.session_id=e.session_id
 and d.product_id=e.product_id and d.status='RESOLVED') then '原盤點另有主管更正；此處以分區原始紀錄比對。' else '' end)
 order by z.name,p.name,e.id),'[]'::jsonb)
 from public.count_entries e join public.inventory_count_sessions s on s.id=e.session_id
 join public.products p on p.id=e.product_id join public.count_zones z on z.id=e.zone_id
 left join lateral(select item from jsonb_array_elements(coalesce(s.snapshot->'zones','[]')) a(item)
 where item->>'zone_id'=e.zone_id::text and item->>'product_id'=e.product_id::text limit 1) snap on true
 where e.session_id=p_id and e.entry_type='INITIAL_COUNT'
$$;

create function private.spot_check_command(p_store uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<spot_command>>
declare
 v_role text; v_org uuid; caps jsonb; actor_name text; month_start date;
 c private.spot_checks; item private.spot_check_items; source public.inventory_count_sessions;
 prior private.spot_check_requests; request_id uuid; check_id uuid; source_rows jsonb;
 selected jsonb; row_data jsonb; assignee uuid; assignee_name text; event_data jsonb:='{}';
 qty numeric; final_review boolean; changed_count integer; is_read boolean;
begin
 v_role:=private.app_role(p_store);
 if auth.uid() is null or coalesce(v_role,'') not in ('SUPERVISOR','LOGISTICS','OWNER') then
  raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into v_org from public.stores where id=p_store;
 caps:=private.spot_check_caps(p_store);
 select coalesce(si.display_name,p.display_name,'未提供') into actor_name
 from public.profiles p left join public.staff_identities si on si.user_id=p.id and si.organization_id=v_org where p.id=auth.uid();
 actor_name:=coalesce(actor_name,'未提供');
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'SPOT_INVALID_INPUT' using errcode='22023';end if;
 if p_action in ('catalog','list','export') then
  if coalesce(p_data->>'month','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'SPOT_INVALID_MONTH' using errcode='22023';end if;
  month_start:=((p_data->>'month')||'-01')::date;
 end if;
 if p_action='catalog' then
  if p_data->>'source_id' is not null then
   select * into source from public.inventory_count_sessions where id=(p_data->>'source_id')::uuid and store_id=p_store and status='CLOSED';
   if not found then raise exception 'SPOT_SOURCE_NOT_CLOSED' using errcode='22023';end if;
   source_rows:=private.spot_check_source(source.id);
  end if;
  return jsonb_build_object('caps',caps,'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'completed_at',s.completed_at,'started_at',s.started_at) order by s.completed_at desc)
   from public.inventory_count_sessions s where s.store_id=p_store and s.status='CLOSED'
   and s.completed_at>=month_start::timestamp at time zone 'Asia/Taipei'
   and s.completed_at<(month_start+interval '1 month')::timestamp at time zone 'Asia/Taipei'),'[]'::jsonb),
   'items',coalesce((select jsonb_agg(a-'original_quantity' order by a->>'zone',a->>'name',a->>'entry_id') from jsonb_array_elements(coalesce(source_rows,'[]')) a),'[]'::jsonb),
   'assignees',coalesce((select jsonb_agg(jsonb_build_object('id',sm.user_id,'name',coalesce(si.display_name,pr.display_name,'未提供')) order by coalesce(si.display_name,pr.display_name))
    from public.store_memberships sm join public.profiles pr on pr.id=sm.user_id
    left join public.staff_identities si on si.user_id=sm.user_id and si.organization_id=v_org
    where sm.store_id=p_store and sm.is_active and sm.access_mode='EDIT' and private.member_active(p_store,sm.user_id)
    and coalesce(sm.work_role,sm.role)::text in ('SUPERVISOR','ADMIN','LOGISTICS','OWNER') and coalesce(si.job_title,'')<>'財務'),'[]'::jsonb));
 end if;
 if p_action='list' then
  return jsonb_build_object('caps',caps,'checks',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc) from (
   select sc.*, (select count(*) from private.spot_check_items i where i.check_id=sc.id) as total,
    (select count(*) from private.spot_check_items i where i.check_id=sc.id and i.review_status='PENDING') as pending_review,
    (select count(*) from private.spot_check_items i where i.check_id=sc.id and i.review_status='REVIEWED') as pending_close
   from private.spot_checks sc where sc.store_id=p_store and (sc.source_month=month_start or coalesce((p_data->>'pending')::boolean,false) and sc.status<>'CLOSED')
  ) s),'[]'::jsonb));
 end if;
 if p_action='export' then
  if not (caps->>'export')::boolean then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  return jsonb_build_object('month',month_start,'store_id',p_store,'checks',coalesce((select jsonb_agg(private.spot_check_detail(sc.id) order by sc.created_at)
   from private.spot_checks sc where sc.store_id=p_store and sc.source_month=month_start and sc.submitted_at is not null),'[]'::jsonb));
 end if;
 check_id:=nullif(p_data->>'id','')::uuid;
 if check_id is null then raise exception 'SPOT_INVALID_INPUT' using errcode='22023';end if;
 if p_action='detail' then
  if not exists(select 1 from private.spot_checks where id=check_id and store_id=p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  return private.spot_check_detail(check_id);
 end if;
 if p_action not in ('create','plan','save_entries','submit','review','close','return') then raise exception 'SPOT_INVALID_ACTION' using errcode='22023';end if;
 if not coalesce((caps->>'operate')::boolean,false) then raise exception 'STORE_READ_ONLY' using errcode='42501';end if;
 if p_action in ('create','plan') and not (caps->>'plan')::boolean
  or p_action='review' and not (caps->>'review')::boolean
  or p_action in ('close','return') and not (caps->>'close')::boolean then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 request_id:=nullif(p_data->>'request_id','')::uuid;
 if request_id is null then raise exception 'SPOT_REQUEST_REQUIRED' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(check_id::text,2809));
 select * into c from private.spot_checks where id=check_id and store_id=p_store for update;
 if p_action<>'create' and c.id is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_action in ('save_entries','submit') and c.assignee_id<>auth.uid() then raise exception 'SPOT_ASSIGNEE_REQUIRED' using errcode='42501';end if;
 select * into prior from private.spot_check_requests where spot_check_requests.request_id=spot_command.request_id;
 if found then
  if prior.store_id<>p_store or prior.actor_id<>auth.uid() or prior.action<>p_action or prior.payload is distinct from p_data then
   raise exception 'SPOT_REQUEST_MISMATCH' using errcode='22023';end if;
  return private.spot_check_detail(prior.check_id);
 end if;
 if p_action='create' and exists(select 1 from private.spot_checks where id=check_id) then raise exception 'SPOT_CHANGED' using errcode='40001';end if;
 if p_action<>'create' and (p_data->>'revision')::integer is distinct from c.revision then raise exception 'SPOT_CHANGED' using errcode='40001';end if;
 if p_action in ('create','plan') then
  if p_action='plan' and c.status<>'DRAFT' then raise exception 'SPOT_LOCKED' using errcode='22023';end if;
  select * into source from public.inventory_count_sessions where id=coalesce(c.source_id,(p_data->>'source_id')::uuid) and store_id=p_store and status='CLOSED' for share;
  if not found or source.completed_at is null then raise exception 'SPOT_SOURCE_NOT_CLOSED' using errcode='22023';end if;
  selected:=p_data->'entries';assignee:=(p_data->>'assignee_id')::uuid;
  if selected is null or jsonb_typeof(selected)<>'array' or jsonb_array_length(selected) not between 1 and 3000
   or (select count(*) from jsonb_array_elements_text(selected))<>(select count(distinct value) from jsonb_array_elements_text(selected)) then raise exception 'SPOT_SELECT_ITEMS' using errcode='22023';end if;
  select coalesce(si.display_name,pr.display_name,'未提供') into assignee_name from public.store_memberships sm
  join public.profiles pr on pr.id=sm.user_id left join public.staff_identities si on si.user_id=sm.user_id and si.organization_id=v_org
  where sm.store_id=p_store and sm.user_id=assignee and sm.is_active and sm.access_mode='EDIT' and private.member_active(p_store,assignee)
  and coalesce(sm.work_role,sm.role)::text in ('SUPERVISOR','ADMIN','LOGISTICS','OWNER') and coalesce(si.job_title,'')<>'財務';
  if not found then raise exception 'SPOT_INVALID_ASSIGNEE' using errcode='22023';end if;
  source_rows:=private.spot_check_source(source.id);
  if exists(select 1 from jsonb_array_elements_text(selected) chosen where not exists(select 1 from jsonb_array_elements(source_rows) r where r->>'entry_id'=chosen.value)) then raise exception 'SPOT_ITEM_OUT_OF_SCOPE' using errcode='42501';end if;
  if p_action='create' then
   insert into private.spot_checks(id,store_id,organization_id,source_id,source_month,source_completed_at,assignee_id,assignee_name,created_by,created_name)
   values(check_id,p_store,v_org,source.id,date_trunc('month',source.completed_at at time zone 'Asia/Taipei')::date,source.completed_at,assignee,assignee_name,auth.uid(),actor_name);
  else delete from private.spot_check_items where spot_check_items.check_id=spot_command.check_id;end if;
  insert into private.spot_check_items(check_id,entry_id,product_id,zone_id,name,zone,unit,specification,original_quantity,original_entered_at,baseline_note)
  select check_id,(r->>'entry_id')::uuid,(r->>'product_id')::uuid,(r->>'zone_id')::uuid,r->>'name',r->>'zone',r->>'unit',r->>'specification',
   (r->>'original_quantity')::numeric,(r->>'original_entered_at')::timestamptz,r->>'baseline_note'
  from jsonb_array_elements(source_rows) r where selected ? (r->>'entry_id');
  update private.spot_checks set assignee_id=assignee,assignee_name=spot_command.assignee_name,
   status=case when coalesce((p_data->>'publish')::boolean,false) then 'OPEN' else 'DRAFT' end where id=check_id;
  event_data:=jsonb_build_object('entries',selected,'assignee_name',assignee_name,'published',coalesce((p_data->>'publish')::boolean,false));
 elsif p_action='save_entries' then
  if c.status<>'OPEN' then raise exception 'SPOT_LOCKED' using errcode='22023';end if;
  selected:=p_data->'entries';
  if selected is null or jsonb_typeof(selected)<>'array' or jsonb_array_length(selected) not between 1 and 3000
   or (select count(*) from jsonb_array_elements(selected))<>(select count(distinct value->>'entry_id') from jsonb_array_elements(selected)) then raise exception 'SPOT_INVALID_INPUT' using errcode='22023';end if;
  for row_data in select value from jsonb_array_elements(selected) loop
   if not(row_data ? 'quantity') then raise exception 'SPOT_INVALID_QUANTITY' using errcode='22023';end if;
   qty:=(row_data->>'quantity')::numeric;
   if qty is not null and (qty<0 or qty>=100000000000 or qty<>round(qty,3)) then raise exception 'SPOT_INVALID_QUANTITY' using errcode='22023';end if;
   update private.spot_check_items set quantity=qty where spot_check_items.check_id=c.id and entry_id=(row_data->>'entry_id')::uuid;
   get diagnostics changed_count=row_count;
   if changed_count<>1 then raise exception 'SPOT_ITEM_OUT_OF_SCOPE' using errcode='42501';end if;
  end loop;
 elsif p_action='submit' then
  if c.status<>'OPEN' then raise exception 'SPOT_LOCKED' using errcode='22023';end if;
  if not exists(select 1 from private.spot_check_items where spot_check_items.check_id=c.id)
   or exists(select 1 from private.spot_check_items where spot_check_items.check_id=c.id and quantity is null) then raise exception 'SPOT_INCOMPLETE' using errcode='22023';end if;
  update private.spot_check_items set review_status=case when quantity=original_quantity then 'SAME' else 'PENDING' end,
   final_quantity=case when quantity=original_quantity then quantity end where spot_check_items.check_id=c.id;
  update private.spot_checks set submitted_at=now(),submitted_by=auth.uid(),submitted_name=actor_name,
   status=case when exists(select 1 from private.spot_check_items where spot_check_items.check_id=c.id and review_status='PENDING') then 'REVIEWING' else 'CLOSED' end,
   closed_at=case when not exists(select 1 from private.spot_check_items where spot_check_items.check_id=c.id and review_status='PENDING') then now() end where id=c.id;
  select jsonb_build_object('items',jsonb_agg(jsonb_build_object('entry_id',entry_id,'quantity',quantity,'original_quantity',original_quantity))) into event_data from private.spot_check_items where spot_check_items.check_id=c.id;
 else
  if c.status<>'REVIEWING' then raise exception 'SPOT_LOCKED' using errcode='22023';end if;
  select * into item from private.spot_check_items where spot_check_items.check_id=c.id and entry_id=(p_data->>'entry_id')::uuid for update;
  if not found then raise exception 'SPOT_ITEM_OUT_OF_SCOPE' using errcode='42501';end if;
  if p_action='review' then
   if item.review_status<>'PENDING' then raise exception 'SPOT_LOCKED' using errcode='22023';end if;
   qty:=(p_data->>'quantity')::numeric;final_review:=coalesce((p_data->>'final')::boolean,false);
   if qty is not null and (qty<0 or qty>=100000000000 or qty<>round(qty,3)) then raise exception 'SPOT_INVALID_QUANTITY' using errcode='22023';end if;
   if length(coalesce(p_data->>'note',''))>1000 then raise exception 'SPOT_INVALID_INPUT' using errcode='22023';end if;
   if coalesce(p_data->>'reason','') not in ('USED','MOVEMENT','ORIGINAL_ERROR','CHECK_ERROR','OTHER','UNKNOWN') then raise exception 'SPOT_REASON_REQUIRED' using errcode='22023';end if;
   if final_review and (qty is null or p_data->>'reason'='UNKNOWN' or (p_data->>'reason'='OTHER' and btrim(coalesce(p_data->>'note',''))='')) then raise exception 'SPOT_REASON_REQUIRED' using errcode='22023';end if;
   update private.spot_check_items set recheck_quantity=qty,reason=p_data->>'reason',note=coalesce(p_data->>'note',''),
    reviewed_by=auth.uid(),reviewed_name=actor_name,reviewed_at=now(),review_status=case when final_review then 'REVIEWED' else 'PENDING' end where spot_check_items.check_id=c.id and entry_id=item.entry_id;
  elsif p_action='return' then
   if item.review_status<>'REVIEWED' then raise exception 'SPOT_LOCKED' using errcode='22023';end if;
   if btrim(coalesce(p_data->>'note',''))='' or length(p_data->>'note')>1000 then raise exception 'SPOT_REASON_REQUIRED' using errcode='22023';end if;
   update private.spot_check_items set review_status='PENDING',return_note=p_data->>'note' where spot_check_items.check_id=c.id and entry_id=item.entry_id;
  else
   if item.review_status<>'REVIEWED' or item.recheck_quantity is null or item.reason='UNKNOWN' then raise exception 'SPOT_REVIEW_REQUIRED' using errcode='22023';end if;
   update private.spot_check_items set review_status='CLOSED',final_quantity=recheck_quantity,confirmed_by=auth.uid(),confirmed_name=actor_name,confirmed_at=now() where spot_check_items.check_id=c.id and entry_id=item.entry_id;
   if not exists(select 1 from private.spot_check_items where spot_check_items.check_id=c.id and review_status in ('PENDING','REVIEWED')) then
    update private.spot_checks set status='CLOSED',closed_at=now() where id=c.id;end if;
  end if;
  select jsonb_build_object('before',to_jsonb(item),'after',to_jsonb(i)) into event_data from private.spot_check_items i where i.check_id=c.id and i.entry_id=item.entry_id;
 end if;
 if p_action<>'create' then update private.spot_checks set revision=revision+1 where id=check_id;end if;
 insert into private.spot_check_requests(request_id,store_id,actor_id,action,payload,check_id) values(request_id,p_store,auth.uid(),p_action,p_data,check_id);
 if p_action<>'save_entries' then
  insert into private.spot_check_events(check_id,entry_id,action,actor_id,actor_name,payload) values(check_id,item.entry_id,p_action,auth.uid(),actor_name,event_data);
  insert into public.audit_logs(organization_id,store_id,user_id,entity_type,entity_id,action,new_value)
   values(v_org,p_store,auth.uid(),'spot_check',check_id::text,'SPOT_CHECK_'||upper(p_action),jsonb_build_object('entry_id',item.entry_id));
 end if;
 return private.spot_check_detail(check_id);
end $$;
revoke all on function private.spot_check_caps(uuid),private.spot_check_detail(uuid),private.spot_check_source(uuid),private.spot_check_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.spot_check_command(uuid,text,jsonb) to authenticated;
create function public.baihuayuan_spot_check(p_store_id uuid,p_action text,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select private.spot_check_command(p_store_id,p_action,p_data) $$;
revoke all on function public.baihuayuan_spot_check(uuid,text,jsonb) from public,anon;
grant execute on function public.baihuayuan_spot_check(uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
