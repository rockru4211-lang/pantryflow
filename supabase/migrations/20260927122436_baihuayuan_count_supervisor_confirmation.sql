-- Future electronic counts wait for supervisor review even when no discrepancy
-- is found. Existing CLOSED sessions and their historical totals are untouched.
do $review$
declare src text;needle text;
begin
 select pg_get_functiondef('public.complete_pilot_count_zone(uuid,uuid)'::regprocedure) into src;
 needle:=$old$status = case
        when exists (
          select 1
          from public.inventory_count_discrepancies
          where session_id = p_session_id
        ) then 'REVIEWING'::public.count_session_status
        else 'CLOSED'::public.count_session_status
      end$old$;
 if position(needle in src)=0 then raise exception 'COUNT_REVIEW_PATCH_TARGET_CHANGED';end if;
 execute replace(src,needle,'status = ''REVIEWING''::public.count_session_status');
end $review$;

create function private.assert_count_ready_for_close(p_session uuid)
returns void language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb;
begin
 select s.snapshot into snapshot from public.inventory_count_sessions s where s.id=p_session;
 if coalesce(jsonb_array_length(snapshot->'zones'),0)=0
  or not exists(select 1 from public.count_zone_progress where session_id=p_session)
  or exists(select 1 from public.count_zone_progress where session_id=p_session and status<>'COMPLETED')
  or exists(select 1 from jsonb_array_elements(snapshot->'zones') item where
   not exists(select 1 from public.count_zone_progress progress where progress.session_id=p_session
    and progress.zone_id=(item->>'zone_id')::uuid and progress.status='COMPLETED')
   or not exists(select 1 from public.count_entries entry where entry.session_id=p_session
    and entry.zone_id=(item->>'zone_id')::uuid and entry.product_id=(item->>'product_id')::uuid
    and entry.quantity is not null)) then
  raise exception 'COUNT_ZONES_INCOMPLETE' using errcode='22023';
 end if;
 if exists(select 1 from public.inventory_count_discrepancies where session_id=p_session and status='PENDING') then
  raise exception 'COUNT_DISCREPANCIES_PENDING' using errcode='22023';
 end if;
end $$;

create function public.confirm_pilot_count_session(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare session public.inventory_count_sessions;
begin
 select * into session from public.inventory_count_sessions where id=p_session_id for update;
 if not found then raise exception 'COUNT_NOT_FOUND' using errcode='P0002';end if;
 perform private.assert_store_editable(session.store_id);
 if coalesce(private.app_role(session.store_id),'') not in ('SUPERVISOR','OWNER') then
  raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501';
 end if;
 if session.status='CLOSED' then return jsonb_build_object('id',session.id,'status','CLOSED','confirmed',true);end if;
 if session.status<>'REVIEWING' then raise exception 'COUNT_NOT_READY' using errcode='22023';end if;
 perform private.assert_count_ready_for_close(session.id);
 -- completed_at stays the actual end of counting; the audit timestamp records
 -- the separate supervisor confirmation. REVIEWING -> CLOSED does not repost
 -- stock because stock_count_completed already ignores this transition.
 update public.inventory_count_sessions set status='CLOSED' where id=session.id;
 insert into public.audit_logs(organization_id,store_id,user_id,entity_type,entity_id,action,old_value,new_value)
 values(session.organization_id,session.store_id,auth.uid(),'inventory_count_session',session.id::text,
  'COUNT_SUPERVISOR_CONFIRMED','{"status":"REVIEWING"}',jsonb_build_object('status','CLOSED','confirmed_by',auth.uid()));
 return jsonb_build_object('id',session.id,'status','CLOSED','confirmed',true);
end $$;

-- Table updates must not bypass the RPC's final-review rules. Administrative
-- migrations/service-role maintenance without a user session remain possible;
-- authenticated writes and the existing discrepancy-resolution RPC are checked.
create function private.enforce_count_supervisor_close()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='CLOSED' and old.status is distinct from new.status and auth.uid() is not null then
  perform private.assert_store_editable(new.store_id);
  if coalesce(private.app_role(new.store_id),'') not in ('SUPERVISOR','OWNER') then
   raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501';
  end if;
  perform private.assert_count_ready_for_close(new.id);
 end if;
 return new;
end $$;
create trigger count_supervisor_close before update of status on public.inventory_count_sessions
 for each row execute function private.enforce_count_supervisor_close();

revoke all on function private.assert_count_ready_for_close(uuid),private.enforce_count_supervisor_close() from public,anon,authenticated;
revoke all on function public.confirm_pilot_count_session(uuid) from public,anon;
grant execute on function public.confirm_pilot_count_session(uuid) to authenticated;
notify pgrst,'reload schema';
