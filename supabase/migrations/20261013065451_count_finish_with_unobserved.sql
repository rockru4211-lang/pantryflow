-- Explicitly unobserved rows are evidence, never manufactured zero counts.
create table private.count_unobserved (
 session_id uuid not null references public.inventory_count_sessions(id),
 zone_id uuid not null references public.count_zones(id),
 product_id uuid not null references public.products(id),
 recorded_by uuid not null references auth.users(id), recorded_at timestamptz not null default now(),
 primary key(session_id,zone_id,product_id)
);
alter table private.count_unobserved enable row level security;
revoke all on private.count_unobserved from public,anon,authenticated;

create function private.count_finish_preview(p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.inventory_count_sessions; missing jsonb;
begin
 select * into s from public.inventory_count_sessions where id=p_session;
 if auth.uid() is null or s.id is null or not private.has_active_store_role(s.store_id,null) then
  raise exception 'STORE_MEMBERSHIP_REQUIRED' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('zone_id',x->>'zone_id','product_id',x->>'product_id',
  'name',coalesce(x->>'product_name',p.name),'zone',coalesce(x->>'zone_name',z.name),'unit',x->>'unit') order by z.name,p.name),'[]') into missing
 from jsonb_array_elements(coalesce(s.snapshot->'zones','[]')||coalesce(s.snapshot->'removed_zones','[]'))x
 join public.products p on p.id=(x->>'product_id')::uuid join public.count_zones z on z.id=(x->>'zone_id')::uuid
 where not exists(select 1 from private.current_count_entries e where e.session_id=s.id and e.zone_id=z.id and e.product_id=p.id and e.entry_type='INITIAL_COUNT')
 and not exists(select 1 from public.count_drafts d where d.session_id=s.id and d.zone_id=z.id and d.product_id=p.id and d.quantity is not null);
 return jsonb_build_object('missing',missing,'revision',private.count_store_revision(s.store_id),'status',s.status);
end $$;
create function public.get_count_finish_preview(p_session_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.count_finish_preview(p_session_id) $$;

create function private.finish_count(p_session uuid,p_revision text,p_allow_unobserved boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.inventory_count_sessions; missing integer;
begin
 select * into s from public.inventory_count_sessions where id=p_session for update;
 if auth.uid() is null or s.id is null or not private.can_count_inline(s.store_id) or not private.feature_scope(s.store_id) then
  raise exception 'STORE_COUNTER_REQUIRED' using errcode='42501';end if;
 perform private.assert_store_editable(s.store_id);
 if s.status in ('REVIEWING','CLOSED') then return jsonb_build_object('status',s.status,'replayed',true);end if;
 if s.status<>'IN_PROGRESS' then raise exception 'COUNT_SESSION_NOT_ACTIVE' using errcode='22023';end if;
 if p_revision is distinct from private.count_store_revision(s.store_id) then raise exception 'COUNT_CHANGED' using errcode='40001';end if;
 if jsonb_array_length(coalesce(s.snapshot->'zones','[]')||coalesce(s.snapshot->'removed_zones','[]'))=0 then raise exception 'COUNT_EMPTY' using errcode='22023';end if;
 insert into private.count_unobserved(session_id,zone_id,product_id,recorded_by)
 select s.id,(x->>'zone_id')::uuid,(x->>'product_id')::uuid,auth.uid()
 from jsonb_array_elements(coalesce(s.snapshot->'zones','[]')||coalesce(s.snapshot->'removed_zones','[]'))x
 where not exists(select 1 from private.current_count_entries e where e.session_id=s.id and e.zone_id::text=x->>'zone_id' and e.product_id::text=x->>'product_id' and e.entry_type='INITIAL_COUNT')
 and not exists(select 1 from public.count_drafts d where d.session_id=s.id and d.zone_id::text=x->>'zone_id' and d.product_id::text=x->>'product_id' and d.quantity is not null);
 get diagnostics missing=row_count;
 if missing>0 and not coalesce(p_allow_unobserved,false) then raise exception 'COUNT_UNOBSERVED_CONFIRM_REQUIRED' using errcode='22023';end if;
 insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,note)
 select d.organization_id,d.session_id,d.zone_id,d.product_id,d.quantity,d.unit,d.entered_by,'INITIAL_COUNT',d.note
 from public.count_drafts d where d.session_id=s.id and d.quantity is not null
 and exists(select 1 from jsonb_array_elements(coalesce(s.snapshot->'zones','[]')||coalesce(s.snapshot->'removed_zones','[]'))x where x->>'zone_id'=d.zone_id::text and x->>'product_id'=d.product_id::text)
 and not exists(select 1 from private.current_count_entries e where e.session_id=s.id and e.zone_id=d.zone_id and e.product_id=d.product_id and e.entry_type='INITIAL_COUNT');
 delete from public.count_drafts where session_id=s.id and quantity is not null;
 update public.count_zone_progress set status='COMPLETED',completed_by=auth.uid(),completed_at=clock_timestamp() where session_id=s.id and status<>'COMPLETED';
 -- A partial multi-zone observation must never become a whole-store discrepancy.
 insert into public.inventory_count_discrepancies(organization_id,session_id,zone_id,product_id,initial_entry_id,previous_quantity,previous_confirmed_at,estimated_quantity,difference,status)
 select s.organization_id,s.id,(array_agg(e.zone_id order by e.entered_at))[1],e.product_id,(array_agg(e.id order by e.entered_at))[1],b.quantity,b.confirmed_at,sum(e.quantity),sum(e.quantity)-b.quantity,'PENDING'
 from private.current_count_entries e join private.count_opening_snapshots b on b.session_id=s.id and b.product_id=e.product_id
 where e.session_id=s.id and e.entry_type='INITIAL_COUNT' and b.quantity is not null
 and not exists(select 1 from private.count_unobserved u where u.session_id=s.id and u.product_id=e.product_id)
 group by e.product_id,b.quantity,b.confirmed_at having sum(e.quantity)<>b.quantity
 on conflict(session_id,zone_id,product_id) do nothing;
 update public.inventory_count_sessions set status='REVIEWING',completed_at=now() where id=s.id;
 insert into public.audit_logs(organization_id,store_id,user_id,entity_type,entity_id,action,new_value)
 values(s.organization_id,s.store_id,auth.uid(),'inventory_count_session',s.id::text,'COUNT_FINISHED',jsonb_build_object('unobserved',missing));
 return jsonb_build_object('status','REVIEWING','unobserved',missing);
end $$;
create function public.finish_pilot_count(p_session_id uuid,p_revision text,p_allow_unobserved boolean default false) returns jsonb
language sql security invoker set search_path='' as $$ select private.finish_count(p_session_id,p_revision,p_allow_unobserved) $$;

-- Existing consumers retain numeric observations; add missing rows to the monthly
-- source so its existing completeness/NULL aggregation never treats a partial total as complete.
do $$declare src text;old text;begin
 src:=pg_get_functiondef('private.inventory_month_source(uuid)'::regprocedure);
 old:='s.status in (''DRAFT'',''IN_PROGRESS'') and not exists';
 if strpos(src,old)=0 then raise exception 'MONTH_SOURCE_ANCHOR';end if;
 src:=replace(src,old,'(s.status in (''DRAFT'',''IN_PROGRESS'') or exists(select 1 from private.count_unobserved u where u.session_id=s.id and u.zone_id::text=x->>''zone_id'' and u.product_id::text=x->>''product_id'')) and not exists');
 src:=replace(src,'''original_quantity'',g.original_quantity','''quantity_pending'',g.original_quantity is null,''original_quantity'',g.original_quantity');
 execute src;
 -- Supervisor closure accepts explicit unobserved evidence, not arbitrary missing entries.
 src:=pg_get_functiondef('private.assert_count_ready_for_close(uuid)'::regprocedure);
 old:='and entry.quantity is not null))';
 if strpos(src,old)=0 then raise exception 'CLOSE_ANCHOR';end if;
 execute replace(src,old,'and entry.quantity is not null) and not exists(select 1 from private.count_unobserved u where u.session_id=p_session and u.zone_id::text=item->>''zone_id'' and u.product_id::text=item->>''product_id''))');
 -- Keep the whole product's previous stock if any of its areas were not observed.
 src:=pg_get_functiondef('private.stock_count_completed()'::regprocedure);
 old:='ce.session_id=new.id and ce.quantity is not null';
 if strpos(src,old)=0 then raise exception 'STOCK_TRIGGER_ANCHOR';end if;
 execute replace(src,old,old||' and not exists(select 1 from private.count_unobserved u where u.session_id=new.id and u.product_id=ce.product_id)');
end $$;
do $$declare signature text;src text;old text;begin
 foreach signature in array array['private.stock_initialize(uuid,uuid,text)','private.stock_snapshot(uuid,uuid,text)'] loop
  src:=pg_get_functiondef(signature::regprocedure);old:='cs.store_id=s and cs.status::text';
  if strpos(src,old)=0 then raise exception 'STOCK_READ_ANCHOR';end if;
  execute replace(src,old,'cs.store_id=s and not exists(select 1 from private.count_unobserved missing where missing.session_id=cs.id and missing.product_id=p) and cs.status::text');
 end loop;
end $$;
revoke all on function private.count_finish_preview(uuid),private.finish_count(uuid,text,boolean),public.get_count_finish_preview(uuid),public.finish_pilot_count(uuid,text,boolean) from public,anon;
grant execute on function private.count_finish_preview(uuid),private.finish_count(uuid,text,boolean),public.get_count_finish_preview(uuid),public.finish_pilot_count(uuid,text,boolean) to authenticated;
notify pgrst,'reload schema';
