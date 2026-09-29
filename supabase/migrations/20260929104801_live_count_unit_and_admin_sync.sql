-- Current-count edits are explicit; completed evidence is never relabelled.
alter function private.edit_count_product(uuid,jsonb) rename to edit_count_product_before_live;
revoke all on function private.edit_count_product_before_live(uuid,jsonb) from public,anon,authenticated;
create function private.edit_count_product(s uuid,d jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cs public.inventory_count_sessions; pid uuid:=(d->>'id')::uuid; result jsonb; old_rows jsonb; new_unit text:=btrim(d->>'unit');
begin
 perform private.assert_store_editable(s);
 if auth.uid() is null or not private.can_import_inventory(s) then raise exception 'PRODUCT_EDIT_REQUIRED' using errcode='42501';end if;
 if nullif(d->>'count_session_id','') is not null then
  select * into cs from public.inventory_count_sessions where id=(d->>'count_session_id')::uuid and store_id=s for update;
  if cs.id is null or cs.status not in ('DRAFT','IN_PROGRESS') then raise exception 'COUNT_SESSION_NOT_EDITABLE';end if;
  select jsonb_agg(x) into old_rows from jsonb_array_elements(cs.snapshot->'zones')x where x->>'product_id'=pid::text;
  if old_rows is null or exists(select 1 from jsonb_array_elements(old_rows)x where x->>'unit' is distinct from d->>'expected_count_unit') then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  if new_unit is distinct from d->>'expected_count_unit' and exists(select 1 from public.count_entries where session_id=cs.id and product_id=pid) then raise exception 'COUNT_UNIT_COMPLETED_REVIEW_REQUIRED';end if;
 end if;
 result:=private.edit_count_product_before_live(s,d);
 if cs.id is not null then
  update public.inventory_count_sessions set snapshot=jsonb_set(snapshot,'{zones}',(select jsonb_agg(case when x->>'product_id'=pid::text then x||jsonb_build_object('unit',new_unit,'product_name',result->>'name','specification',result->>'specification') else x end order by n) from jsonb_array_elements(snapshot->'zones') with ordinality a(x,n))) where id=cs.id;
  if new_unit is distinct from d->>'expected_count_unit' then
   update public.count_drafts set unit=new_unit,updated_at=clock_timestamp() where session_id=cs.id and product_id=pid;
   insert into private.count_price_snapshots(session_id,product_id,unit,unit_price) values(cs.id,pid,new_unit,nullif(d->>'unit_price','')::numeric)
   on conflict(session_id,product_id,unit) do update set unit_price=excluded.unit_price;
   insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id,store_id)
   values(cs.organization_id,'inventory_count_session',cs.id::text,'COUNT_CURRENT_UNIT_CORRECTED',old_rows,jsonb_build_object('product_id',pid,'unit',new_unit,'quantity_preserved',true),auth.uid(),s);
  end if;
 end if;
 return result;
end $$;
revoke all on function private.edit_count_product(uuid,jsonb) from public,anon,authenticated;

-- Include current drafts (including genuine zero and notes), never duplicate a completed zone.
do $$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.inventory_month_source(uuid)'::regprocedure);
 anchor:='with entries as (';
 if strpos(src,anchor)=0 then raise exception 'LIVE_SOURCE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$patch$with live_entries as (
 select e.id::text,e.session_id,e.zone_id,e.product_id,e.quantity,e.unit,e.entered_by,e.entered_at,e.note,e.entry_type::text
 from public.count_entries e where e.session_id=p_session and e.entry_type='INITIAL_COUNT'
 union all
 select coalesce(d.id::text,(x->>'zone_id')||':'||(x->>'product_id')),s.id,(x->>'zone_id')::uuid,(x->>'product_id')::uuid,d.quantity,x->>'unit',d.entered_by,d.entered_at,d.note,'INITIAL_COUNT'
 from public.inventory_count_sessions s cross join lateral jsonb_array_elements(s.snapshot->'zones')x
 left join public.count_drafts d on d.session_id=s.id and d.zone_id=(x->>'zone_id')::uuid and d.product_id=(x->>'product_id')::uuid
 where s.id=p_session and s.status in ('DRAFT','IN_PROGRESS') and not exists(select 1 from public.count_entries e where e.session_id=s.id and e.zone_id=(x->>'zone_id')::uuid and e.product_id=(x->>'product_id')::uuid and e.entry_type='INITIAL_COUNT')
 ), entries as ($patch$);
 src:=replace(src,'from public.count_entries e join public.inventory_count_sessions s','from live_entries e join public.inventory_count_sessions s');
 src:=replace(src,'sum(quantity) as original_quantity','case when count(quantity)=count(*) then sum(quantity) end as original_quantity');
 execute src;
 src:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
 anchor:=$old$select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'completed_at',s.completed_at,'status',s.status) order by s.completed_at desc,s.id),'[]') into choices
 from public.inventory_count_sessions s where s.store_id=p_store and s.status in ('REVIEWING','CLOSED')
 and s.completed_at>=p_month::timestamp at time zone 'Asia/Taipei'
 and s.completed_at<(p_month+interval '1 month')::timestamp at time zone 'Asia/Taipei';$old$;
 if strpos(src,anchor)=0 then raise exception 'LIVE_CHOICES_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$patch$select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'completed_at',s.completed_at,'status',s.status,'label',case when s.status in ('DRAFT','IN_PROGRESS') then '進行中・最新現場盤點' else to_char(s.completed_at at time zone 'Asia/Taipei','YYYY/MM/DD HH24:MI')||' 完成' end) order by (s.status in ('DRAFT','IN_PROGRESS')) desc,coalesce(s.completed_at,s.started_at) desc,s.id),'[]') into choices
 from public.inventory_count_sessions s where s.store_id=p_store and s.status in ('DRAFT','IN_PROGRESS','REVIEWING','CLOSED')
 and coalesce(s.completed_at,s.started_at)>=p_month::timestamp at time zone 'Asia/Taipei'
 and coalesce(s.completed_at,s.started_at)<(p_month+interval '1 month')::timestamp at time zone 'Asia/Taipei';$patch$);
 src:=replace(src,'complete:=jsonb_array_length','complete:=source.status in (''REVIEWING'',''CLOSED'') and jsonb_array_length');
 src:=replace(src,'''source_id'',source.id,''completed_at''','''source_status'',source.status,''source_id'',source.id,''completed_at''');
 execute src;
end $$;
notify pgrst,'reload schema';
