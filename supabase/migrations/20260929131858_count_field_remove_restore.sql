-- Reversible, store-local field exclusions. Configuration, prices and evidence stay intact.
create table private.count_field_removed (
 store_id uuid not null references public.stores(id), product_id uuid not null references public.products(id),
 removed_at timestamptz not null default clock_timestamp(), removed_by uuid not null references auth.users(id),
 primary key(store_id,product_id)
);
alter table private.count_field_removed enable row level security;
revoke all on private.count_field_removed from public,anon,authenticated;

create function private.count_field_lifecycle(s uuid,a text,d jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cs public.inventory_count_sessions; pid uuid:=(d->>'product_id')::uuid; old private.count_field_removed;
 items jsonb; versions jsonb; org uuid; added jsonb;
begin
 if not private.can_count_inline(s) then raise exception 'STORE_COUNTER_REQUIRED' using errcode='42501';end if;
 if a='count.removed-list' then
  return coalesce((select jsonb_agg(jsonb_build_object('product_id',r.product_id,'name',p.name,'removed_at',r.removed_at,'removed_by',coalesce(si.display_name,'現場人員')) order by r.removed_at desc)
   from private.count_field_removed r join public.products p on p.id=r.product_id
   left join public.staff_identities si on si.organization_id=p.organization_id and si.user_id=r.removed_by where r.store_id=s),'[]');
 end if;
 perform private.assert_store_editable(s);
 select organization_id into org from public.stores where id=s for update;
 select * into cs from public.inventory_count_sessions where store_id=s and status in ('DRAFT','IN_PROGRESS') order by started_at desc limit 1 for update;
 select * into old from private.count_field_removed where store_id=s and product_id=pid for update;
 if a='count.field-remove' then
  if cs.id is null or cs.id::text is distinct from d->>'session_id' then raise exception 'COUNT_SESSION_NOT_ACTIVE';end if;
  if old.product_id is not null then raise exception 'COUNT_FIELD_CHANGED' using errcode='40001';end if;
  select jsonb_agg(x) into items from jsonb_array_elements(cs.snapshot->'zones')x where x->>'product_id'=pid::text;
  if items is null then raise exception 'PRODUCT_NOT_IN_COUNT' using errcode='42501';end if;
  select coalesce(jsonb_object_agg(zone_id::text,updated_at),'{}') into versions from public.count_drafts where session_id=cs.id and product_id=pid;
  if versions is distinct from d->'versions' then raise exception 'COUNT_FIELD_CHANGED' using errcode='40001';end if;
  -- Explicit zero is required in every current area; never erase nonzero stock or turn blanks into zero.
  if exists(select 1 from jsonb_array_elements(items)x where not exists(
    select 1 from public.count_drafts q where q.session_id=cs.id and q.product_id=pid and q.zone_id=(x->>'zone_id')::uuid and q.quantity=0
    union all select 1 from public.count_entries e where e.session_id=cs.id and e.product_id=pid and e.zone_id=(x->>'zone_id')::uuid and e.entry_type='INITIAL_COUNT' and e.quantity=0))
   or exists(select 1 from public.count_entries where session_id=cs.id and product_id=pid and quantity<>0)
   then raise exception 'COUNT_FIELD_ZERO_REQUIRED' using errcode='22023';end if;
  insert into private.count_field_removed(store_id,product_id,removed_by) values(s,pid,auth.uid());
  update public.inventory_count_sessions set snapshot=jsonb_set(jsonb_set(snapshot,'{zones}',coalesce((select jsonb_agg(x) from jsonb_array_elements(snapshot->'zones')x where x->>'product_id'<>pid::text),'[]')),'{removed_zones}',coalesce(snapshot->'removed_zones','[]')||items) where id=cs.id;
 elsif a='count.field-restore' then
  if old.product_id is null or old.removed_at is distinct from (d->>'removed_at')::timestamptz then raise exception 'COUNT_FIELD_CHANGED' using errcode='40001';end if;
  if not exists(select 1 from public.products where id=pid and organization_id=org and is_active)
   or exists(select 1 from private.count_catalog_removed where store_id=s and product_id=pid) then raise exception 'COUNT_FIELD_CATALOG_REMOVED';end if;
  if cs.id is not null then
   select coalesce(jsonb_agg(x),'[]') into added from jsonb_array_elements(coalesce(cs.snapshot->'removed_zones','[]'))x where x->>'product_id'=pid::text;
   if added='[]' then
    select coalesce(jsonb_agg(jsonb_build_object('zone_id',z.id,'zone_name',z.name,'product_id',p.id,'product_name',p.name,'unit',zp.count_unit,'specification',p.specification,'supplier',sp.name)),'[]') into added
    from public.zone_products zp join public.count_zones z on z.id=zp.zone_id join public.products p on p.id=zp.product_id left join public.suppliers sp on sp.id=p.current_supplier_id
    where z.store_id=s and z.is_active and p.id=pid and not exists(select 1 from public.count_zone_progress g where g.session_id=cs.id and g.zone_id=z.id and g.status='COMPLETED');
   end if;
   -- Never add a missing entry into a completed area.
   if exists(select 1 from jsonb_array_elements(added)x join public.count_zone_progress g on g.session_id=cs.id and g.zone_id=(x->>'zone_id')::uuid and g.status='COMPLETED' where not exists(select 1 from public.count_entries e where e.session_id=cs.id and e.zone_id=g.zone_id and e.product_id=pid)) then raise exception 'COUNT_ZONE_NOT_AVAILABLE';end if;
   update public.inventory_count_sessions set snapshot=jsonb_set(jsonb_set(snapshot,'{zones}',coalesce(snapshot->'zones','[]')||added),'{removed_zones}',coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(snapshot->'removed_zones','[]'))x where x->>'product_id'<>pid::text),'[]')) where id=cs.id;
   insert into public.count_zone_progress(organization_id,session_id,zone_id,status) select distinct org,cs.id,(x->>'zone_id')::uuid,'NOT_STARTED' from jsonb_array_elements(added)x on conflict(session_id,zone_id) do nothing;
   perform private.capture_count_prices(cs.id);
  end if;
  delete from private.count_field_removed where store_id=s and product_id=pid;
 else raise exception 'INVALID_APP_ACTION';end if;
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
 values(org,s,'product',pid::text,case when a='count.field-remove' then 'COUNT_FIELD_REMOVED' else 'COUNT_FIELD_RESTORED' end,jsonb_build_object('session_id',cs.id,'product_id',pid,'evidence_preserved',true),auth.uid());
 return jsonb_build_object('product_id',pid,'removed_at',(select removed_at from private.count_field_removed where store_id=s and product_id=pid),'restored_in_current',coalesce(jsonb_array_length(added),0)>0);
end $$;
revoke all on function private.count_field_lifecycle(uuid,text,jsonb) from public,anon,authenticated;

do $$
declare src text; sig text; needle text;
begin
 src:=pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure);
 needle:='if v_role is null or p_request is null then';
 if strpos(src,needle)=0 then raise exception 'FIELD_AUTH_ANCHOR';end if;
 src:=replace(src,needle,'if p_action in (''count.field-remove'',''count.field-restore'',''count.removed-list'') and not private.can_count_inline(p_store) then raise exception ''STORE_COUNTER_REQUIRED'' using errcode=''42501'';end if; '||needle);
 needle:='if p_action in (''count.assign-zone''';
 -- Insert dispatch immediately before the existing count inline dispatch, not its authorization check.
 needle:='then v_result:=private.count_inline_operation(p_store,p_action,p_data);';
 if strpos(src,needle)=0 then raise exception 'FIELD_DISPATCH_ANCHOR';end if;
 src:=replace(src,needle,'then v_result:=private.count_inline_operation(p_store,p_action,p_data); elsif p_action in (''count.field-remove'',''count.field-restore'',''count.removed-list'') then v_result:=private.count_field_lifecycle(p_store,p_action,p_data);');
 execute src;
 -- Future counts and import refresh omit field-excluded items without changing source configuration.
 foreach sig in array array['private.refresh_unstarted_count(uuid)','public.start_pilot_count(uuid,jsonb)','public.sync_active_count_after_import(uuid)'] loop
  src:=pg_get_functiondef(sig::regprocedure);
  needle:='not exists(select 1 from private.count_catalog_removed cr where cr.store_id=p_store_id and cr.product_id=p.id)';
  if strpos(src,needle)=0 then raise exception 'FIELD_FUTURE_ANCHOR %',sig;end if;
  execute replace(src,needle,needle||' and not exists(select 1 from private.count_field_removed fr where fr.store_id=p_store_id and fr.product_id=p.id)');
 end loop;
 -- Explicit-zero removed cards are still finalized as evidence in this count.
 src:=pg_get_functiondef('public.complete_pilot_count_zone(uuid,uuid)'::regprocedure);
 needle:='jsonb_array_elements(s.snapshot->''zones'')';
 if strpos(src,needle)=0 then raise exception 'FIELD_COMPLETE_ANCHOR';end if;
 execute replace(src,needle,'jsonb_array_elements(coalesce(s.snapshot->''zones'',''[]'')||coalesce(s.snapshot->''removed_zones'',''[]''))');
 src:=pg_get_functiondef('private.assert_count_ready_for_close(uuid)'::regprocedure);
 src:=replace(src,'jsonb_array_length(snapshot->''zones'')','jsonb_array_length(coalesce(snapshot->''zones'',''[]'')||coalesce(snapshot->''removed_zones'',''[]''))');
 src:=replace(src,'jsonb_array_elements(snapshot->''zones'')','jsonb_array_elements(coalesce(snapshot->''zones'',''[]'')||coalesce(snapshot->''removed_zones'',''[]''))');execute src;
 -- Administrative totals continue to contain the original zero and notes.
 src:=pg_get_functiondef('private.inventory_month_source(uuid)'::regprocedure);
 needle:='jsonb_array_elements(s.snapshot->''zones'')x';
 if strpos(src,needle)=0 then raise exception 'FIELD_ADMIN_ANCHOR';end if;
 src:=replace(src,needle,'jsonb_array_elements(coalesce(s.snapshot->''zones'',''[]'')||coalesce(s.snapshot->''removed_zones'',''[]''))x');execute src;
 src:=pg_get_functiondef('private.count_store_revision(uuid)'::regprocedure);
 needle:='''removed'',(select';
 if strpos(src,needle)=0 then raise exception 'FIELD_REVISION_ANCHOR';end if;
 execute replace(src,needle,'''field_removed'',(select jsonb_agg(to_jsonb(fr) order by fr.product_id) from private.count_field_removed fr where fr.store_id=p_store_id), '||needle);
end $$;
create function private.get_count_field_removed(s uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.count_field_lifecycle(s,'count.removed-list','{}')
$$;
revoke all on function private.get_count_field_removed(uuid) from public,anon;
grant execute on function private.get_count_field_removed(uuid) to authenticated;
create function public.get_count_field_removed(p_store_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select private.get_count_field_removed(p_store_id)
$$;
revoke all on function public.get_count_field_removed(uuid) from public,anon;
grant execute on function public.get_count_field_removed(uuid) to authenticated;
notify pgrst,'reload schema';
