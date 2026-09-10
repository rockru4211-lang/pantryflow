-- Add authorization checks and wire existing settings without rewriting history.
create or replace function private.app_role(p_store uuid) returns text language sql stable security definer set search_path='' as $$
 select case when om.is_owner or o.owner_user_id=auth.uid() or sm.role='OWNER' then 'OWNER'
 when sm.role='ADMIN' then 'SUPERVISOR'
 when sm.role='STAFF' and exists(select 1 from private.app_delegations d where d.store_id=sm.store_id and d.user_id=sm.user_id and d.revoked_at is null and now()>=d.starts_at and now()<d.ends_at) then 'SUPERVISOR' else sm.role::text end
 from public.store_memberships sm join public.stores s on s.id=sm.store_id and s.organization_id=sm.organization_id
 join public.organizations o on o.id=s.organization_id
 join public.organization_members om on om.organization_id=sm.organization_id and om.user_id=sm.user_id
 join public.staff_identities si on si.organization_id=sm.organization_id and si.user_id=sm.user_id
 join auth.users u on u.id=sm.user_id
 where sm.store_id=p_store and sm.user_id=auth.uid() and sm.is_active and om.is_active and si.is_active and s.is_active
 and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
$$;

create function private.app_member_workspace(p_store uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text:=private.app_role(p_store);v_org uuid;
begin
 if v_role not in ('OWNER','SUPERVISOR') or v_role is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into v_org from public.stores where id=p_store;
 return jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object(
 'user_id',sm.user_id,'role',sm.role,'login_identifier',sm.login_identifier,'is_active',sm.is_active,
 'display_name',si.display_name,'is_owner',om.is_owner or o.owner_user_id=sm.user_id,'updated_at',sm.updated_at,
 'email',case when u.email not like '%@staff.pantryflow.local' and u.email not like '%@staff.pantryflow.internal' then u.email end,
 'uses_pin',exists(select 1 from private.staff_pin_credentials c where c.user_id=sm.user_id) or exists(select 1 from private.staff_activation_tokens t where t.user_id=sm.user_id),
 'pending_count',(select count(*) from private.app_records r where r.store_id=p_store and r.responsible_id=sm.user_id and r.status<>'COMPLETE')
 ) order by si.display_name),'[]'::jsonb) from public.store_memberships sm join public.staff_identities si on si.user_id=sm.user_id and si.organization_id=sm.organization_id join public.organization_members om on om.user_id=sm.user_id and om.organization_id=sm.organization_id join public.organizations o on o.id=sm.organization_id join auth.users u on u.id=sm.user_id where sm.store_id=p_store),
 'candidates',case when v_role='OWNER' then (select coalesce(jsonb_agg(jsonb_build_object('user_id',si.user_id,'display_name',si.display_name) order by si.display_name),'[]'::jsonb) from public.staff_identities si join public.organization_members om on om.user_id=si.user_id and om.organization_id=si.organization_id where si.organization_id=v_org and si.is_active and om.is_active and not exists(select 1 from public.store_memberships sm where sm.store_id=p_store and sm.user_id=si.user_id)) else '[]'::jsonb end,
 'delegations',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('display_name',p.display_name)),'[]'::jsonb) from private.app_delegations d left join public.profiles p on p.id=d.user_id where d.store_id=p_store));
end $$;
revoke all on function private.app_member_workspace(uuid) from public,anon,authenticated;

create function private.app_member_operation(p_store uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role text:=private.app_role(p_store);v_org uuid;v_target uuid:=(p_data->>'user_id')::uuid;
 v_member public.store_memberships;v_next uuid:=nullif(p_data->>'handoff_to','')::uuid;v_old jsonb;v_result jsonb;
begin
 if v_role not in ('OWNER','SUPERVISOR') or v_role is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into v_org from public.stores where id=p_store;
 if v_target=auth.uid() or exists(select 1 from public.organization_members om join public.organizations o on o.id=om.organization_id where om.organization_id=v_org and om.user_id=v_target and (om.is_owner or o.owner_user_id=v_target)) then raise exception 'CANNOT_CHANGE_OWNER_OR_SELF' using errcode='42501';end if;
 select * into v_member from public.store_memberships where store_id=p_store and user_id=v_target for update;
 if p_action<>'member.assign' and not found then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002';end if;
 if v_role='SUPERVISOR' and (v_member.role<>'STAFF' or p_action='member.assign' or coalesce(p_data->>'role','STAFF')<>'STAFF') then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if v_member.user_id is not null and (p_data->>'updated_at')::timestamptz is distinct from v_member.updated_at then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 v_old:=to_jsonb(v_member);
 if p_action='member.offboard' then
  if not v_member.is_active then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002';end if;
  if v_next is not null and (v_next=v_target or not exists(select 1 from public.store_memberships sm join public.organization_members om on om.user_id=sm.user_id and om.organization_id=sm.organization_id where sm.store_id=p_store and sm.user_id=v_next and sm.is_active and om.is_active)) then raise exception 'INVALID_RESPONSIBLE' using errcode='22023';end if;
  if v_next is null and exists(select 1 from private.app_records where store_id=p_store and responsible_id=v_target and status<>'COMPLETE') then raise exception 'HANDOFF_REQUIRED' using errcode='22023';end if;
  insert into private.app_record_events(record_id,actor_id,action,note,snapshot) select id,auth.uid(),'HANDOFF','離職交接',jsonb_build_object('previous_responsible',v_target,'responsible_id',v_next) from private.app_records where store_id=p_store and responsible_id=v_target and status<>'COMPLETE';
  update private.app_records set responsible_id=v_next,revision=revision+1,updated_at=now() where store_id=p_store and responsible_id=v_target and status<>'COMPLETE';
  update public.store_memberships set is_active=false,updated_at=now() where store_id=p_store and user_id=v_target returning to_jsonb(public.store_memberships.*) into v_result;
  update private.app_delegations set revoked_at=now() where store_id=p_store and user_id=v_target and revoked_at is null;
 else
  if p_data->>'role' not in ('STAFF','SUPERVISOR','LOGISTICS','OWNER') or length(btrim(coalesce(p_data->>'login_identifier',''))) not between 1 and 64 then raise exception 'INVALID_MEMBER' using errcode='22023';end if;
  if not exists(select 1 from public.organization_members where organization_id=v_org and user_id=v_target and is_active) then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002';end if;
  if coalesce((p_data->>'is_active')::boolean,true)=false and exists(select 1 from private.app_records where store_id=p_store and responsible_id=v_target and status<>'COMPLETE') then raise exception 'HANDOFF_REQUIRED' using errcode='22023';end if;
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,is_active,assigned_by)
  values(p_store,v_org,v_target,btrim(p_data->>'login_identifier'),(p_data->>'role')::public.app_role,coalesce((p_data->>'is_active')::boolean,true),auth.uid())
  on conflict(store_id,user_id) do update set login_identifier=excluded.login_identifier,role=excluded.role,is_active=excluded.is_active,assigned_by=excluded.assigned_by,updated_at=now() returning to_jsonb(public.store_memberships.*) into v_result;
  if length(btrim(coalesce(p_data->>'display_name','')))>0 then
   update public.staff_identities set display_name=btrim(p_data->>'display_name'),updated_at=now() where user_id=v_target and organization_id=v_org;
   update public.profiles set display_name=btrim(p_data->>'display_name') where id=v_target;
  end if;
 end if;
 return jsonb_build_object('id',v_target,'value',v_result,'previous',v_old);
end $$;
revoke all on function private.app_member_operation(uuid,text,jsonb) from public,anon,authenticated;

do $migration$
declare source text;next text;
begin
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into source;
 next:=regexp_replace(source,'return jsonb_build_object\(''members''.*?elsif p_section=''business'' then','return private.app_member_workspace(p_store);'||chr(10)||'  elsif p_section=''business'' then','s');
 if next=source then raise exception 'Member workspace source mismatch';end if;
 next:=replace(next,'''read_at'',rd.read_at,','''read_at'',rd.read_at,''readers'',case when v_role in (''OWNER'',''SUPERVISOR'',''LOGISTICS'') then (select coalesce(jsonb_agg(jsonb_build_object(''display_name'',rp.display_name,''read_at'',rr.read_at)),''[]''::jsonb) from private.app_record_reads rr left join public.profiles rp on rp.id=rr.user_id where rr.record_id=r.id) else ''[]''::jsonb end,');
 execute next;
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 next:=replace(source,'if p_action in (''product.save'',''supplier.save'') then','if p_action in (''member.save'',''member.assign'',''member.offboard'') then return private.app_member_operation(p_store,p_action,p_data);'||chr(10)||' elsif p_action in (''product.save'',''supplier.save'') then');
 next:=replace(next,'select * into v_settings from private.app_settings where store_id=p_store for update;',
 'if (p_data->''settings'' ? ''count_cadence'') and p_data->''settings''->>''count_cadence'' not in (''DAILY'',''MONTHLY'',''MANUAL'') then raise exception ''INVALID_SETTINGS'' using errcode=''22023'';end if;'||chr(10)||
 'select * into v_settings from private.app_settings where store_id=p_store for update;');
 if next=source then raise exception 'Management source mismatch';end if;
 execute next;
 -- Only new receipts/counts use changed policy. Historical snapshots stay intact.
 select pg_get_functiondef('public.begin_pilot_receipt_upload(uuid,text,jsonb,text)'::regprocedure) into source;
 next:=replace(source,'select business_type=''CHAIN_RESTAURANT'' into v_erp from public.organizations where id=s.organization_id;',
 'select has_erp and coalesce((select (settings->>''erp_receiving'')::boolean from private.app_settings where store_id=s.id),true) into v_erp from public.organizations where id=s.organization_id;');
 if next=source then raise exception 'Receipt policy source mismatch';end if;
 execute next;
 select pg_get_functiondef('public.start_pilot_count(uuid,jsonb)'::regprocedure) into source;
 next:=replace(source,'v_type=''CHAIN_RESTAURANT'' and (v_old.started_at','coalesce((select settings->>''count_cadence'' from private.app_settings where store_id=p_store_id),case when v_type=''CHAIN_RESTAURANT'' then ''DAILY'' else ''MONTHLY'' end)=''DAILY'' and (v_old.started_at');
 next:=replace(next,'v_snapshot,v_type=''CHAIN_RESTAURANT'')','v_snapshot,coalesce((select (settings->>''paper_required'')::boolean from private.app_settings where store_id=p_store_id),v_type=''CHAIN_RESTAURANT''))');
 if next=source then raise exception 'Count policy source mismatch';end if;
 execute next;
 select pg_get_functiondef('public.ensure_pilot_daily_count(uuid)'::regprocedure) into source;
 next:=replace(source,'o.business_type=''CHAIN_RESTAURANT''','coalesce((select settings->>''count_cadence'' from private.app_settings where store_id=s.id),case when o.business_type=''CHAIN_RESTAURANT'' then ''DAILY'' else ''MONTHLY'' end)=''DAILY''');
 execute next;
end $migration$;
notify pgrst,'reload schema';
