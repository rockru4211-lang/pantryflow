-- Delivery facts are independent of OCR values, upload time, inventory and ERP.
create table private.receipt_delivery (
 batch_id uuid primary key references public.receipt_upload_batches(id),
 arrived_on date,
 arrived_time time,
 issues jsonb not null default '[]'::jsonb check(jsonb_typeof(issues)='array'),
 revision integer not null default 0,
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now(),
 check(arrived_time is null or arrived_on is not null)
);
alter table private.receipt_delivery enable row level security;
revoke all on private.receipt_delivery from public,anon,authenticated;

create function private.receipt_delivery_json(p_batch uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('arrived_on',d.arrived_on,'arrived_time',d.arrived_time,'revision',d.revision,'issues',d.issues) from private.receipt_delivery d where d.batch_id=p_batch),jsonb_build_object('arrived_on',null,'arrived_time',null,'revision',0,'issues','[]'::jsonb));
$$;

create function private.receipt_delivery_operation(p_store uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; d private.receipt_delivery; issue jsonb; old_issue jsonb; ids uuid[]; target uuid;
begin
 if auth.uid() is null or private.app_role(p_store) not in ('STAFF','SUPERVISOR') or private.app_role(p_store) is null then raise exception 'FIELD_ROLE_REQUIRED' using errcode='42501';end if;
 if p_action='receipt.erp-bulk' then
  if jsonb_typeof(p_data->'batch_ids') is distinct from 'array' or jsonb_array_length(p_data->'batch_ids') not between 1 and 100 then raise exception 'INVALID_RECEIPTS';end if;
  select array_agg(distinct value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p_data->'batch_ids');
  -- Validate every selected document before completing any. Ordered locks avoid deadlocks.
  foreach target in array ids loop
   select * into b from public.receipt_upload_batches where id=target and store_id=p_store for update;
   if not found or not private.can_read_receipt(target) or not b.erp_required then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';end if;
   if not exists(select 1 from public.receipt_ocr_jobs where batch_id=target) then raise exception 'ORIGINAL_UPLOAD_INCOMPLETE';end if;
  end loop;
  foreach target in array ids loop perform public.complete_pilot_receipt_erp(target);end loop;
  return jsonb_build_object('saved',true,'count',cardinality(ids));
 end if;
 if p_action<>'receipt.delivery' then raise exception 'INVALID_ACTION';end if;
 select * into b from public.receipt_upload_batches where id=(p_data->>'batch_id')::uuid and store_id=p_store for update;
 if not found or not private.can_read_receipt(b.id) then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';end if;
 if jsonb_typeof(p_data->'issues') is distinct from 'array' or jsonb_array_length(p_data->'issues')>100 then raise exception 'INVALID_ISSUES';end if;
 select * into d from private.receipt_delivery where batch_id=b.id;
 if (p_data->>'revision')::integer is distinct from coalesce(d.revision,0) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 if nullif(p_data->>'arrived_time','') is not null and nullif(p_data->>'arrived_on','') is null then raise exception 'INVALID_ARRIVAL';end if;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_data->'issues')) then raise exception 'INVALID_ISSUES';end if;
 for issue in select value from jsonb_array_elements(p_data->'issues') loop
  perform (issue->>'id')::uuid;
  if issue->>'id' is null or coalesce(length(btrim(issue->>'name')),0) not between 1 and 160
   or coalesce(issue->>'reason','') not in ('未收到','少收貨','多收貨','效期太短','其他')
   or coalesce(issue->>'status','') not in ('OPEN','COMPLETE')
   or coalesce(length(issue->>'unit'),0)>30 or coalesce(length(issue->>'note'),0)>1000
   or ((issue->>'status'='COMPLETE' or issue->>'reason'='其他') and coalesce(length(btrim(issue->>'note')),0)=0)
   then raise exception 'INVALID_ISSUES';end if;
  if issue->'quantity' is not null and issue->'quantity'<>'null'::jsonb then
   if jsonb_typeof(issue->'quantity')<>'number' or (issue->>'quantity')::numeric<0 or (issue->>'quantity')::numeric>=1000000000 or coalesce(length(btrim(issue->>'unit')),0)=0 then raise exception 'INVALID_QUANTITY';end if;
  end if;
 end loop;
 -- Existing issues cannot disappear when a stale or incomplete form is saved.
 for old_issue in select value from jsonb_array_elements(coalesce(d.issues,'[]'::jsonb)) loop
  if not exists(select 1 from jsonb_array_elements(p_data->'issues') n where n->>'id'=old_issue->>'id') then raise exception 'INVALID_ISSUE_REMOVAL';end if;
 end loop;
 insert into private.receipt_delivery(batch_id,arrived_on,arrived_time,issues,revision,updated_by)
 values(b.id,nullif(p_data->>'arrived_on','')::date,nullif(p_data->>'arrived_time','')::time,p_data->'issues',1,auth.uid())
 on conflict(batch_id) do update set arrived_on=excluded.arrived_on,arrived_time=excluded.arrived_time,issues=excluded.issues,revision=receipt_delivery.revision+1,updated_by=auth.uid(),updated_at=now();
 return private.receipt_delivery_json(b.id);
end $$;
revoke all on function private.receipt_delivery_json(uuid),private.receipt_delivery_operation(uuid,text,jsonb) from public,anon,authenticated;

-- Keep existing read and write authorization, retries, history and response contracts.
do $$ declare src text; prior text; begin
 select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src; prior:=src;
 src:=replace(src,'if p_action=''receipt.edit-card'' and', 'if p_action in (''receipt.delivery'',''receipt.erp-bulk'') and (auth.uid() is null or coalesce(private.app_role(p_store),'''') not in (''STAFF'',''SUPERVISOR'')) then raise exception ''FIELD_ROLE_REQUIRED'' using errcode=''42501'';end if;'||chr(10)||' if p_action=''receipt.edit-card'' and');
 src:=replace(src,'elsif p_action=''receipt.edit-card'' then','elsif p_action in (''receipt.delivery'',''receipt.erp-bulk'') then v_result:=private.receipt_delivery_operation(p_store,p_action,p_data);'||chr(10)||' elsif p_action=''receipt.edit-card'' then');
 if src=prior then raise exception 'DELIVERY_DISPATCH_PATCH_MISSING';end if;execute src;
 select pg_get_functiondef('public.get_pilot_receipts(uuid)'::regprocedure) into src;prior:=src;
 src:=replace(src,'''id'',b.id,''batch_number''','''delivery'',private.receipt_delivery_json(b.id),''id'',b.id,''batch_number''');
 if src=prior then raise exception 'DELIVERY_LIST_PATCH_MISSING';end if;execute src;
 select pg_get_functiondef('public.get_pilot_receipt(uuid)'::regprocedure) into src;prior:=src;
 src:=replace(src,'''batch'',to_jsonb(b)-''upload_fingerprint''','''batch'',(to_jsonb(b)-''upload_fingerprint'')||jsonb_build_object(''delivery'',private.receipt_delivery_json(b.id))');
 if src=prior then raise exception 'DELIVERY_DETAIL_PATCH_MISSING';end if;execute src;
end $$;

-- Home and the receipt list use the same unresolved delivery issues.
do $$ declare src text; old text; replacement text; begin
 select pg_get_functiondef('private.app_dashboard(uuid)'::regprocedure) into src;
 old:='''receipt_issues'',(select count(*) from public.receipt_upload_batches b where b.store_id=p_store and b.status::text<>''COMPLETED'' and private.can_read_receipt(b.id) and exists(select 1 from public.receipt_ocr_jobs j where j.batch_id=b.id and j.status in (''FAILED'',''RETRY'')))';
 replacement:='''receipt_issues'',(select count(*) from public.receipt_upload_batches b join private.receipt_delivery d on d.batch_id=b.id cross join lateral jsonb_array_elements(d.issues) i where b.store_id=p_store and private.can_read_receipt(b.id) and i->>''status''=''OPEN'')';
 if position(old in src)=0 then raise exception 'DELIVERY_DASHBOARD_PATCH_MISSING';end if;
 execute replace(src,old,replacement);
end $$;
