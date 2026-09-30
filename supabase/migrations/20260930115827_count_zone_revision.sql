-- Reopen only a zone in an unfinished count. Original entries stay immutable.
create table private.count_zone_revisions (
 session_id uuid not null references public.inventory_count_sessions(id),
 zone_id uuid not null references public.count_zones(id),
 completed_at timestamptz not null,
 reopened_by uuid not null references auth.users(id), reopened_at timestamptz not null default clock_timestamp(),
 primary key(session_id,zone_id,completed_at)
);
create table private.count_superseded_entries (
 entry_id uuid primary key references public.count_entries(id),
 session_id uuid not null, zone_id uuid not null, completed_at timestamptz not null,
 foreign key(session_id,zone_id,completed_at) references private.count_zone_revisions(session_id,zone_id,completed_at)
);
alter table private.count_zone_revisions enable row level security;
alter table private.count_superseded_entries enable row level security;
revoke all on private.count_zone_revisions,private.count_superseded_entries from public,anon,authenticated;
create view private.current_count_entries with (security_invoker=true) as
 select e.* from public.count_entries e where not exists(select 1 from private.count_superseded_entries r where r.entry_id=e.id);
revoke all on private.current_count_entries from public,anon,authenticated;

-- Only current-value consumers use the effective entries. Audit/history and
-- membership/deletion guards continue to see the full original record set.
do $$
declare signature text; src text; changed text;
begin
 foreach signature in array array[
 'private.assert_count_ready_for_close(uuid)', 'private.count_field_lifecycle(uuid,text,jsonb)',
 'private.count_inline_operation(uuid,text,jsonb)', 'private.count_store_revision(uuid)',
 'private.edit_count_product(uuid,jsonb)', 'private.inventory_month_source(uuid)',
 'private.inventory_month_state(uuid,date,uuid)', 'private.spot_check_command(uuid,text,jsonb)',
 'private.spot_check_source(uuid)', 'private.stock_count_completed()', 'private.stock_count_corrected()',
 'private.stock_initialize(uuid,uuid,text)', 'private.stock_snapshot(uuid,uuid,text)',
 'public.complete_pilot_count_zone(uuid,uuid)', 'public.get_baihuayuan_data_integrity(uuid)',
 'public.get_pilot_count_details(uuid)', 'public.get_pilot_count_results(uuid)',
 'public.resolve_pilot_count_discrepancy(uuid,text,text,numeric)', 'public.set_pilot_count_next_period(uuid,uuid,text)'
 ] loop
  src:=pg_get_functiondef(signature::regprocedure);
  changed:=regexp_replace(src,'(from|join)([[:space:]]+)public\.count_entries\y','\1\2private.current_count_entries','gi');
  if src=changed then raise exception 'COUNT_REVISION_READER_MISSING: %',signature;end if;
  if signature='public.complete_pilot_count_zone(uuid,uuid)' then
   changed:=replace(changed,'completed_by = v_user, completed_at = now()','completed_by = v_user, completed_at = clock_timestamp()');
  end if;
  execute changed;
 end loop;
end $$;

create function private.reopen_count_zone(p_session_id uuid,p_zone_id uuid,p_completed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.inventory_count_sessions; g public.count_zone_progress; original jsonb; restored integer;
begin
 if auth.uid() is null then raise exception 'STORE_COUNTER_REQUIRED' using errcode='42501';end if;
 select * into s from public.inventory_count_sessions where id=p_session_id for update;
 if not found or not private.can_count_inline(s.store_id) then raise exception 'STORE_COUNTER_REQUIRED' using errcode='42501';end if;
 perform private.assert_store_editable(s.store_id);
 select * into g from public.count_zone_progress where session_id=s.id and zone_id=p_zone_id for update;
 if not found then raise exception 'COUNT_ZONE_NOT_AVAILABLE' using errcode='22023';end if;
 -- Replaying an old reopen never reopens a newly completed revision.
 if exists(select 1 from private.count_zone_revisions r where r.session_id=s.id and r.zone_id=p_zone_id and r.completed_at=p_completed_at) then
  return jsonb_build_object('session_id',s.id,'zone_id',p_zone_id,'status',g.status,'replayed',true);
 end if;
 if s.status<>'IN_PROGRESS' then raise exception 'COUNT_SESSION_NOT_ACTIVE' using errcode='22023';end if;
 if g.status<>'COMPLETED' or p_completed_at is null or g.completed_at is distinct from p_completed_at then raise exception 'COUNT_ZONE_CHANGED' using errcode='40001';end if;
 if exists(select 1 from public.count_drafts where session_id=s.id and zone_id=p_zone_id)
  or exists(select 1 from private.current_count_entries where session_id=s.id and zone_id=p_zone_id and entry_type<>'INITIAL_COUNT')
  or exists(select 1 from public.inventory_count_discrepancies where session_id=s.id) then
  raise exception 'COUNT_ZONE_NOT_AVAILABLE' using errcode='22023';end if;
 select jsonb_agg(to_jsonb(e) order by e.id) into original from private.current_count_entries e where e.session_id=s.id and e.zone_id=p_zone_id;
 if original is null then raise exception 'COUNT_ZONE_NOT_AVAILABLE' using errcode='22023';end if;
 insert into private.count_zone_revisions(session_id,zone_id,completed_at,reopened_by) values(s.id,p_zone_id,p_completed_at,auth.uid());
 insert into public.count_drafts(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entered_at,updated_at,note)
 select organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entered_at,clock_timestamp(),note
 from private.current_count_entries where session_id=s.id and zone_id=p_zone_id;
 get diagnostics restored=row_count;
 insert into private.count_superseded_entries(entry_id,session_id,zone_id,completed_at)
 select id,s.id,p_zone_id,p_completed_at from private.current_count_entries where session_id=s.id and zone_id=p_zone_id;
 update public.count_zone_progress set status='IN_PROGRESS',completed_at=null,completed_by=null where session_id=s.id and zone_id=p_zone_id;
 insert into public.audit_logs(organization_id,store_id,user_id,entity_type,entity_id,action,old_value,new_value)
 values(s.organization_id,s.store_id,auth.uid(),'inventory_count_session',s.id::text,'COUNT_ZONE_REOPENED',
  jsonb_build_object('zone_id',p_zone_id,'completed_at',p_completed_at,'entries',original),jsonb_build_object('zone_id',p_zone_id,'status','IN_PROGRESS','restored',restored));
 return jsonb_build_object('session_id',s.id,'zone_id',p_zone_id,'status','IN_PROGRESS','restored',restored);
end $$;
revoke all on function private.reopen_count_zone(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.reopen_count_zone(uuid,uuid,timestamptz) to authenticated;
create function public.reopen_pilot_count_zone(p_session_id uuid,p_zone_id uuid,p_completed_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$
 select private.reopen_count_zone(p_session_id,p_zone_id,p_completed_at)
$$;
revoke all on function public.reopen_pilot_count_zone(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.reopen_pilot_count_zone(uuid,uuid,timestamptz) to authenticated;
notify pgrst,'reload schema';
