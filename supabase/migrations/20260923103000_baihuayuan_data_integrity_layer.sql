
create table if not exists private.baihuayuan_count_save_requests (
  session_id uuid not null references public.inventory_count_sessions(id) on delete cascade,
  request_id uuid not null,
  store_id uuid not null references public.stores(id),
  actor_id uuid not null references auth.users(id),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(session_id,request_id)
);

create index if not exists baihuayuan_count_save_requests_store_created
  on private.baihuayuan_count_save_requests(store_id,created_at desc);

create or replace function public.save_pilot_count_drafts_v2(
  p_session_id uuid,
  p_request_id uuid,
  p_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_store uuid;
  v_org uuid;
  v_saved private.baihuayuan_count_save_requests;
  v_result jsonb;
begin
  if auth.uid() is null or p_request_id is null then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;

  select s.store_id,s.organization_id into v_store,v_org
  from public.inventory_count_sessions s
  where s.id=p_session_id
  for update;

  if v_store is null or not private.can_count_inline(v_store) then
    raise exception 'STORE_COUNTER_REQUIRED' using errcode='42501';
  end if;

  if not exists(
    select 1 from public.stores s
    where s.id=v_store and s.name in ('BeApe','Gras')
  ) then
    return public.save_pilot_count_drafts(p_session_id,p_entries);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text||p_request_id::text,0));

  select * into v_saved
  from private.baihuayuan_count_save_requests
  where session_id=p_session_id and request_id=p_request_id;

  if found then
    if v_saved.payload is distinct from p_entries then
      raise exception 'REQUEST_REUSED' using errcode='22023';
    end if;
    return v_saved.result;
  end if;

  v_result:=public.save_pilot_count_drafts(p_session_id,p_entries);

  insert into private.baihuayuan_count_save_requests(
    session_id,request_id,store_id,actor_id,payload,result
  )
  values(p_session_id,p_request_id,v_store,auth.uid(),p_entries,v_result);

  insert into public.audit_logs(
    organization_id,entity_type,entity_id,action,new_value,user_id,attempt_id,store_id
  )
  values(
    v_org,'count_session',p_session_id::text,'count.draft-save',
    jsonb_build_object(
      'store_id',v_store,
      'request_id',p_request_id,
      'entry_count',jsonb_array_length(p_entries)
    ),
    auth.uid(),p_request_id,v_store
  );

  return v_result;
end;
$$;

revoke all on function public.save_pilot_count_drafts_v2(uuid,uuid,jsonb) from public;
grant execute on function public.save_pilot_count_drafts_v2(uuid,uuid,jsonb) to authenticated;

create or replace function private.baihuayuan_receipt_batch_audit()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.store_name not in ('BeApe','Gras') then return new; end if;
  insert into public.audit_logs(
    organization_id,entity_type,entity_id,action,new_value,user_id,attempt_id,store_id
  )
  values(
    new.organization_id,'receipt_upload_batch',new.id::text,'receipt.upload-received',
    jsonb_build_object(
      'store_id',new.store_id,
      'work_date',new.work_date,
      'batch_number',new.batch_number,
      'fingerprint',new.upload_fingerprint
    ),
    new.uploaded_by,new.id,new.store_id
  );
  return new;
end;
$$;

drop trigger if exists baihuayuan_receipt_batch_audit on public.receipt_upload_batches;
create trigger baihuayuan_receipt_batch_audit
after insert on public.receipt_upload_batches
for each row execute function private.baihuayuan_receipt_batch_audit();

do $patch$
declare
  src text;
  original text;
begin
  select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src;
  original:=src;
  src:=replace(
    src,
    'insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)'||
    chr(10)||
    '  values(v_org,''app_operation'',coalesce(v_id,p_store)::text,p_action,v_old,v_result||jsonb_build_object(''store_id'',p_store),auth.uid());',
    'insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id,attempt_id,store_id)'||
    chr(10)||
    '  values(v_org,''app_operation'',coalesce(v_id,p_store)::text,p_action,v_old,v_result||jsonb_build_object(''store_id'',p_store,''request_id'',p_request),auth.uid(),p_request,p_store);'
  );
  if src<>original then execute src; end if;

  select pg_get_functiondef('private.expiry_waste_command(uuid,uuid,text,jsonb)'::regprocedure) into src;
  if position('expiry_waste.' in src)=0 then
    original:=src;
    src:=replace(
      src,
      'insert into private.expiry_waste_requests(store_id,request_id,action,payload,result,created_by) values(p_store_id,p_request_id,p_action,p_data,result,auth.uid());'||
      chr(10)||
      ' return result;',
      'insert into private.expiry_waste_requests(store_id,request_id,action,payload,result,created_by) values(p_store_id,p_request_id,p_action,p_data,result,auth.uid());'||
      chr(10)||
      ' insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id,attempt_id,store_id)'||
      chr(10)||
      ' values(org,''expiry_waste'',coalesce(result->>''id'',p_store_id::text),''expiry_waste.''||lower(p_action),result||jsonb_build_object(''store_id'',p_store_id,''request_id'',p_request_id),auth.uid(),p_request_id,p_store_id);'||
      chr(10)||
      ' return result;'
    );
    if src=original then raise exception 'EXPIRY_WASTE_AUDIT_PATCH_MISSING'; end if;
    execute src;
  end if;
end
$patch$;

create or replace function public.get_baihuayuan_data_integrity(p_store_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_role text;
  v_day date:=(now() at time zone 'Asia/Taipei')::date;
  v_start timestamptz;
  v_end timestamptz;
  v_stores jsonb;
  v_anomalies jsonb;
  v_totals jsonb;
begin
  if auth.uid() is null then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;

  select s.organization_id,private.app_role(s.id)
  into v_org,v_role
  from public.stores s
  where s.id=p_store_id and s.is_active and s.name in ('BeApe','Gras');

  if v_org is null or not (
    v_role in ('LOGISTICS','OWNER')
    or private.can_manage_business(p_store_id)
  ) then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;

  v_start:=v_day::timestamp at time zone 'Asia/Taipei';
  v_end:=(v_day+1)::timestamp at time zone 'Asia/Taipei';

  with scoped_stores as (
    select s.id,s.name
    from public.stores s
    where s.organization_id=v_org and s.is_active and s.name in ('BeApe','Gras')
  ),
  count_activity as (
    select x.store_id,count(*)::int as records
    from (
      select cs.store_id,cd.session_id,cd.zone_id,cd.product_id
      from public.count_drafts cd
      join public.inventory_count_sessions cs on cs.id=cd.session_id
      where cs.organization_id=v_org and cd.updated_at>=v_start and cd.updated_at<v_end
      union
      select cs.store_id,ce.session_id,ce.zone_id,ce.product_id
      from public.count_entries ce
      join public.inventory_count_sessions cs on cs.id=ce.session_id
      where cs.organization_id=v_org and ce.created_at>=v_start and ce.created_at<v_end
    ) x
    group by x.store_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,
    'name',s.name,
    'receipts',(select count(*) from public.receipt_upload_batches b where b.store_id=s.id and b.uploaded_at>=v_start and b.uploaded_at<v_end),
    'count_records',coalesce(ca.records,0),
    'movements',(select count(*) from private.store_movements m where (m.from_store_id=s.id or m.to_store_id=s.id) and m.created_at>=v_start and m.created_at<v_end),
    'waste',(select count(*) from private.waste_records w where w.store_id=s.id and w.created_at>=v_start and w.created_at<v_end)
  ) order by case s.name when 'BeApe' then 1 when 'Gras' then 2 else 9 end),'[]'::jsonb)
  into v_stores
  from scoped_stores s
  left join count_activity ca on ca.store_id=s.id;

  with scoped_stores as (
    select s.id,s.name
    from public.stores s
    where s.organization_id=v_org and s.is_active and s.name in ('BeApe','Gras')
  ),
  anomaly_rows as (
    select
      'RECEIPT_FILE_MISSING'::text type,
      s.id store_id,s.name store_name,
      d.batch_id::text entity_id,
      '貨單原始檔缺失'::text title,
      '貨單已建立收件紀錄，但原始檔案未出現在檔案儲存區。'::text detail,
      d.created_at
    from public.receipt_documents d
    join public.receipt_upload_batches b on b.id=d.batch_id
    join scoped_stores s on s.id=b.store_id
    left join storage.objects o on o.bucket_id='receipt-documents' and o.name=d.storage_path
    where d.created_at>=v_start and d.created_at<v_end and o.id is null

    union all
    select
      'RECEIPT_UPLOAD_STUCK',s.id,s.name,b.id::text,
      '貨單上傳未完成',
      '收件紀錄已建立超過 10 分鐘，但檔案上傳仍未完成。',
      b.uploaded_at
    from public.receipt_upload_batches b
    join scoped_stores s on s.id=b.store_id
    where b.uploaded_at>=v_start and b.uploaded_at<v_end
      and b.upload_completed_at is null
      and b.uploaded_at < now()-interval '10 minutes'

    union all
    select
      'RECEIPT_PROCESSING_STUCK',s.id,s.name,b.id::text,
      '貨單處理逾時',
      '貨單已收到超過 30 分鐘，但尚未進入待核對或完成狀態。',
      b.uploaded_at
    from public.receipt_upload_batches b
    join scoped_stores s on s.id=b.store_id
    where b.uploaded_at>=v_start and b.uploaded_at<v_end
      and b.status::text not in ('READY_FOR_REVIEW','COMPLETED')
      and b.uploaded_at < now()-interval '30 minutes'

    union all
    select
      'RECEIPT_COMPLETED_WITHOUT_LEDGER',s.id,s.name,b.id::text,
      '已完成貨單缺少進貨主檔',
      '貨單狀態已完成，但行政進貨主檔不存在。',
      b.updated_at
    from public.receipt_upload_batches b
    join scoped_stores s on s.id=b.store_id
    where b.updated_at>=v_start and b.updated_at<v_end
      and b.status::text='COMPLETED'
      and not exists(select 1 from public.goods_receipts g where g.source_batch_id=b.id)

    union all
    select
      'COUNT_COMPLETED_INCOMPLETE',s.id,s.name,cs.id::text,
      '完成盤點缺少品項紀錄',
      '盤點已完成，但正式盤點品項筆數少於本次盤點快照。',
      cs.completed_at
    from public.inventory_count_sessions cs
    join scoped_stores s on s.id=cs.store_id
    where cs.completed_at>=v_start and cs.completed_at<v_end
      and cs.status::text in ('CLOSED','REVIEWING')
      and jsonb_typeof(cs.snapshot->'zones')='array'
      and (
        select count(distinct (ce.zone_id,ce.product_id))
        from public.count_entries ce
        where ce.session_id=cs.id
      ) < jsonb_array_length(cs.snapshot->'zones')

    union all
    select
      'MOVEMENT_EVENT_MISSING',s.id,s.name,m.id::text,
      '調撥／借貸缺少建立紀錄',
      '調撥或借貸主檔存在，但沒有對應的建立事件。',
      m.created_at
    from private.store_movements m
    join scoped_stores s on s.id=m.from_store_id
    where m.created_at>=v_start and m.created_at<v_end
      and not exists(
        select 1 from private.store_movement_events e
        where e.movement_id=m.id and e.action='CREATE'
      )

    union all
    select
      'MOVEMENT_REQUEST_ORPHAN',s.id,s.name,r.request_id::text,
      '調撥／借貸請求缺少主檔',
      '系統已收到操作請求，但找不到對應的調撥／借貸主檔。',
      r.created_at
    from private.app_requests r
    join scoped_stores s on s.id=r.store_id
    where r.created_at>=v_start and r.created_at<v_end
      and r.action in ('movement.create','movement.transfer-create')
      and nullif(r.result->>'id','') is not null
      and not exists(
        select 1 from private.store_movements m
        where m.id=(r.result->>'id')::uuid
      )

    union all
    select
      'WASTE_REQUEST_ORPHAN',s.id,s.name,r.request_id::text,
      '廢棄請求缺少廢棄主檔',
      '系統已收到廢棄操作，但找不到對應的廢棄紀錄。',
      r.created_at
    from private.expiry_waste_requests r
    join scoped_stores s on s.id=r.store_id
    where r.created_at>=v_start and r.created_at<v_end
      and r.action='WASTE'
      and nullif(r.result->>'id','') is not null
      and not exists(
        select 1 from private.waste_records w
        where w.id=(r.result->>'id')::uuid
      )

    union all
    select
      'WASTE_RECEIPT_MISSING',s.id,s.name,w.id::text,
      '廢棄紀錄缺少收件請求',
      '廢棄主檔已存在，但找不到同一筆現場送出的收件請求。',
      w.created_at
    from private.waste_records w
    join scoped_stores s on s.id=w.store_id
    where w.created_at>=v_start and w.created_at<v_end
      and not exists(
        select 1 from private.expiry_waste_requests r
        where r.store_id=w.store_id and r.action='WASTE' and r.result->>'id'=w.id::text
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'type',type,'store_id',store_id,'store_name',store_name,'entity_id',entity_id,
    'title',title,'detail',detail,'created_at',created_at
  ) order by created_at desc),'[]'::jsonb)
  into v_anomalies
  from anomaly_rows;

  select jsonb_build_object(
    'receipts',(select count(*) from public.receipt_upload_batches b join public.stores s on s.id=b.store_id where s.organization_id=v_org and s.name in ('BeApe','Gras') and b.uploaded_at>=v_start and b.uploaded_at<v_end),
    'count_records',(select count(*) from (
      select cd.session_id,cd.zone_id,cd.product_id
      from public.count_drafts cd join public.inventory_count_sessions cs on cs.id=cd.session_id
      join public.stores s on s.id=cs.store_id
      where s.organization_id=v_org and s.name in ('BeApe','Gras') and cd.updated_at>=v_start and cd.updated_at<v_end
      union
      select ce.session_id,ce.zone_id,ce.product_id
      from public.count_entries ce join public.inventory_count_sessions cs on cs.id=ce.session_id
      join public.stores s on s.id=cs.store_id
      where s.organization_id=v_org and s.name in ('BeApe','Gras') and ce.created_at>=v_start and ce.created_at<v_end
    ) q),
    'movements',(select count(*) from private.store_movements m where m.organization_id=v_org and m.created_at>=v_start and m.created_at<v_end),
    'waste',(select count(*) from private.waste_records w where w.organization_id=v_org and w.store_name in ('BeApe','Gras') and w.created_at>=v_start and w.created_at<v_end),
    'anomalies',jsonb_array_length(v_anomalies)
  )
  into v_totals;

  return jsonb_build_object(
    'generated_at',now(),
    'day',v_day,
    'totals',v_totals,
    'stores',v_stores,
    'anomalies',v_anomalies
  );
end;
$$;

revoke all on function public.get_baihuayuan_data_integrity(uuid) from public;
grant execute on function public.get_baihuayuan_data_integrity(uuid) to authenticated;
