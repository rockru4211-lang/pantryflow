-- Anchor a count to its first real observation, not a later administrative finish.
create function private.inventory_count_date(p_session uuid) returns date
language sql stable set search_path='' as $$
 select (coalesce((select min(t) from (
  select e.entered_at t from public.count_entries e where e.session_id=s.id and e.entry_type='INITIAL_COUNT'
  union all select d.updated_at from public.count_drafts d where d.session_id=s.id and d.quantity is not null
 ) observed),s.started_at) at time zone 'Asia/Taipei')::date
 from public.inventory_count_sessions s where s.id=p_session
$$;
create function private.inventory_count_has_data(p_session uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.count_entries where session_id=p_session and entry_type='INITIAL_COUNT')
 or exists(select 1 from public.count_drafts where session_id=p_session and quantity is not null)
$$;
revoke all on function private.inventory_count_date(uuid),private.inventory_count_has_data(uuid) from public,anon,authenticated;

create function public.baihuayuan_latest_inventory(p_store_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or coalesce(private.app_role(p_store_id),'') not in ('LOGISTICS','OWNER')
 or not private.has_active_store_role(p_store_id,null) then raise exception 'INVENTORY_ADMIN_REQUIRED' using errcode='42501';end if;
 select jsonb_build_object('session_id',s.id,'count_date',private.inventory_count_date(s.id),'month',date_trunc('month',private.inventory_count_date(s.id))::date)
 into result from public.inventory_count_sessions s where s.store_id=p_store_id and s.status in ('DRAFT','IN_PROGRESS','REVIEWING','CLOSED') and private.inventory_count_has_data(s.id)
 order by private.inventory_count_date(s.id) desc,s.started_at desc,s.id limit 1;
 return result;
end $$;
revoke all on function public.baihuayuan_latest_inventory(uuid) from public,anon;
grant execute on function public.baihuayuan_latest_inventory(uuid) to authenticated;

-- Monthly unit corrections are separate from immutable physical count evidence.
alter table private.inventory_month_reviews add column report_unit text check(length(report_unit) between 1 and 40);

do $patch$
declare src text;old text;new text;
begin
 src:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
 old:='coalesce(s.completed_at,s.started_at)>=p_month::timestamp at time zone ''Asia/Taipei''';
 if position(old in src)=0 then raise exception 'count period start patch missing';end if;
 src:=replace(src,old,'private.inventory_count_date(s.id)>=p_month');
 old:='coalesce(s.completed_at,s.started_at)<(p_month+interval ''1 month'')::timestamp at time zone ''Asia/Taipei''';
 if position(old in src)=0 then raise exception 'count period end patch missing';end if;
 src:=replace(src,old,'private.inventory_count_date(s.id)<(p_month+interval ''1 month'')::date');
 src:=replace(src,'order by (s.status in (''DRAFT'',''IN_PROGRESS'')) desc,coalesce(s.completed_at,s.started_at) desc,s.id','order by private.inventory_count_has_data(s.id) desc,(s.status in (''DRAFT'',''IN_PROGRESS'')) desc,private.inventory_count_date(s.id) desc,s.started_at desc,s.id');
 src:=replace(src,'to_char(s.completed_at at time zone ''Asia/Taipei'',''YYYY/MM/DD HH24:MI'')||'' 完成''','to_char(private.inventory_count_date(s.id),''YYYY/MM/DD'')||'' 盤點''');
 src:=replace(src,'s.completed_at>=previous_month::timestamp at time zone ''Asia/Taipei'' and s.completed_at<p_month::timestamp at time zone ''Asia/Taipei''','private.inventory_count_date(s.id)>=previous_month and private.inventory_count_date(s.id)<p_month');
 src:=replace(src,'''completed_at'',source.completed_at,''source_complete''','''completed_at'',source.completed_at,''count_date'',private.inventory_count_date(source.id),''source_complete''');
 old:='select x.*,r.price_set,r.acknowledged,r.note,r.reviewed_by,';
 if position(old in src)=0 then raise exception 'report unit review patch missing';end if;
 src:=replace(src,old,'select x.*,r.report_unit,r.price_set,r.acknowledged,r.note,r.reviewed_by,');
 old:='''unit'',coalesce(v.c,v.p)->>''unit'',''supplier''';
 if position(old in src)=0 then raise exception 'report unit display patch missing';end if;
 src:=replace(src,old,'''unit'',coalesce(v.report_unit,coalesce(v.c,v.p)->>''unit''),''source_unit'',coalesce(v.c,v.p)->>''unit'',''supplier''');
 -- Quantities in different units cannot form a numeric month-on-month difference.
 src:=replace(src,'(x.p->>''quantity'')::numeric as previous_qty,','case when r.report_unit is not null and r.report_unit is distinct from x.p->>''unit'' then null else (x.p->>''quantity'')::numeric end as previous_qty,');
 src:=replace(src,'case when coalesce((x.p->>''quantity_pending'')::boolean,false) then ''PENDING_BASELINE''','case when r.report_unit is not null and x.p is not null and r.report_unit is distinct from x.p->>''unit'' then ''UNIT_CHANGED'' when coalesce((x.p->>''quantity_pending'')::boolean,false) then ''PENDING_BASELINE''');
 execute src;
 -- Retain draft observation timestamps when a session is completed later.
 src:=pg_get_functiondef('private.finish_count(uuid,text,boolean)'::regprocedure);
 old:='insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,note)';
 if position(old in src)=0 then raise exception 'finish observation patch missing';end if;
 src:=replace(src,old,'insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,note,entered_at)');
 src:=replace(src,'''INITIAL_COUNT'',d.note','''INITIAL_COUNT'',d.note,d.updated_at');
 execute src;
end $patch$;

create function public.save_baihuayuan_inventory_inline_v3(
 p_store_id uuid,p_month date,p_session_id uuid,p_row_key text,p_expected jsonb,
 p_name text,p_unit text,p_quantity numeric,p_unit_price numeric,p_note text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare state jsonb;r jsonb;current_values jsonb;desired jsonb;result jsonb;
begin
 perform private.assert_store_editable(p_store_id);
 if auth.uid() is null or coalesce(private.app_role(p_store_id),'') not in ('LOGISTICS','OWNER')
 or not private.has_active_store_role(p_store_id,null) or not private.can_import_inventory(p_store_id)
 then raise exception 'INVENTORY_ADMIN_REQUIRED' using errcode='42501';end if;
 if length(btrim(coalesce(p_unit,''))) not between 1 and 40 or p_expected is null or jsonb_typeof(p_expected)<>'object'
 then raise exception 'INVALID_INVENTORY_INLINE_EDIT' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_month::text,819));
 perform 1 from public.inventory_count_sessions where id=p_session_id and store_id=p_store_id for update;
 if not found then raise exception 'INVENTORY_SOURCE_REQUIRED' using errcode='22023';end if;
 state:=private.baihuayuan_inventory_month(p_store_id,p_month,'read',jsonb_build_object('session_id',p_session_id));
 if coalesce((state->>'closed')::boolean,false) then raise exception 'INVENTORY_MONTH_CLOSED' using errcode='22023';end if;
 select x into r from jsonb_array_elements(state->'rows')x where x->>'row_key'=p_row_key;
 if r is null or r->>'source_quantity' is null then raise exception 'INVENTORY_ROW_NOT_FOUND' using errcode='P0002';end if;
 current_values:=jsonb_build_object('name',r->'name','unit',r->'unit','quantity',r->'current_quantity','price',r->'unit_price','note',r->'review_note');
 desired:=jsonb_build_object('name',btrim(p_name),'unit',btrim(p_unit),'quantity',p_quantity,'price',p_unit_price,'note',btrim(coalesce(p_note,'')));
 -- Identical retries have no extra writes; changed rows require a fresh read.
 if current_values=desired then return jsonb_build_object('saved',true,'replayed',true);end if;
 if current_values is distinct from p_expected->'values' or r->>'source_signature' is distinct from p_expected->>'source_signature'
 then raise exception 'INVENTORY_REVISION_CHANGED' using errcode='40001';end if;
 result:=public.save_baihuayuan_inventory_inline_v2(p_store_id,p_month,p_session_id,p_row_key,r->>'source_signature',(r->>'source_quantity')::numeric,p_name,p_quantity,p_unit_price,p_note);
 -- Name edits update this session's snapshot; bind the saved review to its new signature.
 state:=private.inventory_month_state(p_store_id,p_month,p_session_id);
 select x into r from jsonb_array_elements(state->'rows')x where x->>'row_key'=p_row_key;
 update private.inventory_month_reviews set report_unit=nullif(btrim(p_unit),r->>'source_unit'),source_signature=r->>'source_signature'
 where store_id=p_store_id and month=p_month and session_id=p_session_id and row_key=p_row_key;
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
 select organization_id,p_store_id,'inventory_month',p_session_id::text,'INVENTORY_REPORT_UNIT_EDIT',current_values,desired,auth.uid() from public.stores where id=p_store_id;
 return result||jsonb_build_object('unit',btrim(p_unit));
end $$;
revoke all on function public.save_baihuayuan_inventory_inline_v3(uuid,date,uuid,text,jsonb,text,text,numeric,numeric,text) from public,anon;
grant execute on function public.save_baihuayuan_inventory_inline_v3(uuid,date,uuid,text,jsonb,text,text,numeric,numeric,text) to authenticated;
notify pgrst,'reload schema';
