create or replace function private.store_lifecycle(anchor uuid, action text, d jsonb, request uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare target uuid:=(d->>'id')::uuid;s public.stores;cached private.store_lifecycle_requests;refs jsonb;result jsonb;old jsonb;begin
 if request is null or target is null or auth.uid() is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,107));
 select * into cached from private.store_lifecycle_requests where request_id=request;
 select * into s from public.stores where id=target for update;
 if not found then
  if action='store.delete' and cached.actor_id=auth.uid() and cached.target_id=target and cached.action=action and cached.payload=d and private.can_manage_store_scope(anchor) then return cached.result;end if;
  raise exception 'STORE_NOT_FOUND' using errcode='P0002';
 end if;
 if not private.can_manage_store_scope(target) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if cached.request_id is not null then
  if cached.actor_id<>auth.uid() or cached.target_id<>target or cached.action<>action or cached.payload<>d then raise exception 'REQUEST_CONFLICT' using errcode='40001';end if;return cached.result;
 end if;
 if d->>'store_code' is distinct from s.store_code or d->>'name' is distinct from s.name or (d->>'updated_at')::timestamptz is distinct from s.updated_at then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 old:=to_jsonb(s);refs:=private.store_delete_blockers(target);
 if action='store.delete' then
  if refs<>'[]'::jsonb then raise exception 'STORE_REFERENCED_USE_DEACTIVATE' using errcode='23503';end if;
  delete from private.app_attempts where store_id=target;
  delete from private.app_devices where store_id=target;
  delete from private.app_session_access where store_id=target;
  delete from private.owner_setup_progress where store_id=target;
  delete from private.staff_activation_tokens where store_id=target;
  delete from private.staff_login_attempts where store_id=target;
  delete from private.trial_stores where store_id=target;
  delete from private.app_settings where store_id=target;
  delete from public.store_memberships where store_id=target;
  delete from public.audit_logs where store_id=target or (entity_type='store' and entity_id=target::text);
  delete from public.stores where id=target;
 elsif action in ('store.deactivate','store.restore') then
  update public.stores set is_active=(action='store.restore'),updated_at=now() where id=target;
 else raise exception 'INVALID_STORE_ACTION' using errcode='22023';end if;
 result:=jsonb_build_object('id',target,'action',action,'is_active',action='store.restore');
 insert into private.store_lifecycle_requests values(request,auth.uid(),target,action,d,result,now());
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
 values(s.organization_id,'store',target::text,action,old,result,auth.uid());
 return result;
end;
$$;