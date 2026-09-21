-- Approved count cards: optional notes, and a narrow unclassified -> real area
-- move. General area reconfiguration stays locked once a count has work.
alter table public.count_drafts add column note text check (length(note)<=2000);
alter table public.count_entries add column note text check (length(note)<=2000);

create function private.can_count_inline(p_store uuid) returns boolean
language sql stable set search_path='' as $$
 select auth.uid() is not null and (
   private.has_active_store_role(p_store,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[])
   or private.can_import_inventory(p_store))
$$;
revoke all on function private.can_count_inline(uuid) from public,anon,authenticated;

-- A note entered before a quantity is still work; catalogue refresh must retain it.
create or replace function private.count_has_work(s uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.count_drafts where session_id=s and (quantity is not null or nullif(btrim(note),'') is not null))
 or exists(select 1 from public.count_entries where session_id=s)
 or exists(select 1 from public.count_zone_progress where session_id=s and status='COMPLETED')
$$;

-- Version tokens must advance even for multiple edits in one transaction.
create function private.touch_count_edit_version() returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 return new;
end $$;
revoke all on function private.touch_count_edit_version() from public,anon,authenticated;
drop trigger set_count_drafts_updated_at on public.count_drafts;
create trigger set_count_drafts_updated_at before update on public.count_drafts
for each row execute function private.touch_count_edit_version();
drop trigger set_count_zones_updated_at on public.count_zones;
create trigger set_count_zones_updated_at before update on public.count_zones
for each row execute function private.touch_count_edit_version();

-- Internal only. Callers provide exactly the fields being edited; omitted fields
-- retain their value, whereas explicit JSON null clears a quantity or a note.
create function private.save_count_card(p_session uuid,p_entry jsonb) returns timestamptz
language plpgsql set search_path='' as $$
declare s public.inventory_count_sessions; d public.count_drafts; zone uuid; product uuid;
 expected timestamptz; unit_name text; qty numeric; memo text; stamp timestamptz;
begin
 select * into s from public.inventory_count_sessions where id=p_session for update;
 if not found or not private.can_count_inline(s.store_id) then raise exception 'STORE_COUNTER_REQUIRED' using errcode='42501'; end if;
 if jsonb_typeof(p_entry) is distinct from 'object' or not (p_entry ? 'quantity' or p_entry ? 'note') then
   raise exception 'INVALID_DRAFT_BATCH' using errcode='22023';
 end if;
 zone:=(p_entry->>'zone_id')::uuid; product:=(p_entry->>'product_id')::uuid;
 expected:=(p_entry->>'expected_updated_at')::timestamptz;
 if s.status<>'IN_PROGRESS' or not exists(select 1 from public.count_zone_progress where session_id=s.id and zone_id=zone and status<>'COMPLETED') then
   raise exception 'COUNT_ZONE_NOT_AVAILABLE' using errcode='22023';
 end if;
 select item->>'unit' into unit_name from jsonb_array_elements(s.snapshot->'zones') item
 where item->>'zone_id'=zone::text and item->>'product_id'=product::text;
 if unit_name is null then raise exception 'PRODUCT_NOT_IN_COUNT' using errcode='42501'; end if;
 select * into d from public.count_drafts where session_id=s.id and zone_id=zone and product_id=product;
 if p_entry ? 'quantity' and jsonb_typeof(p_entry->'quantity') not in ('number','null') then raise exception 'INVALID_QUANTITY' using errcode='22023'; end if;
 qty:=case when p_entry ? 'quantity' then (p_entry->>'quantity')::numeric else d.quantity end;
 if qty<0 or qty::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_QUANTITY' using errcode='22023'; end if;
 if p_entry ? 'note' and jsonb_typeof(p_entry->'note') not in ('string','null') then raise exception 'INVALID_COUNT_NOTE' using errcode='22023'; end if;
 memo:=case when p_entry ? 'note' then nullif(btrim(p_entry->>'note'),'') else d.note end;
 if length(memo)>2000 then raise exception 'COUNT_NOTE_TOO_LONG' using errcode='22023'; end if;
 if d.updated_at is distinct from expected then
   -- A retry acknowledges only the fields it actually supplied. It never erases
   -- a concurrent note because an older client submits quantity alone.
   if d.id is not null and d.quantity is not distinct from qty and d.note is not distinct from memo then return d.updated_at; end if;
   raise exception 'COUNT_DRAFT_CHANGED' using errcode='40001';
 end if;
 insert into public.count_drafts(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,updated_at,observation_state,note)
 values(s.organization_id,s.id,zone,product,qty,unit_name,auth.uid(),clock_timestamp(),case when qty is null then 'BLANK' else 'COUNTED' end,memo)
 on conflict(session_id,zone_id,product_id) do update set quantity=excluded.quantity,note=excluded.note,
 entered_by=case when count_drafts.quantity is not distinct from excluded.quantity then count_drafts.entered_by else excluded.entered_by end,
 unit=excluded.unit,observation_state=excluded.observation_state
 returning updated_at into stamp;
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
 values(s.organization_id,s.store_id,'count_draft',s.id,'COUNT_DRAFT_SAVED',
 jsonb_build_object('quantity',d.quantity,'note',d.note,'entered_by',d.entered_by),
 jsonb_build_object('zone_id',zone,'product_id',product,'quantity',qty,'note',memo),auth.uid());
 return stamp;
end $$;
revoke all on function private.save_count_card(uuid,jsonb) from public,anon,authenticated;

create or replace function public.save_pilot_count_draft(p_session_id uuid,p_zone_id uuid,p_product_id uuid,p_quantity numeric,p_expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
begin
 return private.save_count_card(p_session_id,jsonb_build_object('zone_id',p_zone_id,'product_id',p_product_id,'quantity',p_quantity,'expected_updated_at',p_expected_updated_at));
end $$;

create or replace function public.save_pilot_count_drafts(p_session_id uuid,p_entries jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; stamp timestamptz; result jsonb:='[]'; store uuid;
begin
 select store_id into store from public.inventory_count_sessions where id=p_session_id for update;
 if store is null or not private.can_count_inline(store) then raise exception 'STORE_COUNTER_REQUIRED' using errcode='42501'; end if;
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)>1000 then raise exception 'INVALID_DRAFT_BATCH' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_entries) loop
   stamp:=private.save_count_card(p_session_id,item);
   result:=result||jsonb_build_array(jsonb_build_object('zone_id',item->>'zone_id','product_id',item->>'product_id','updated_at',stamp));
 end loop;
 return result;
end $$;

-- Existing app_operation supplies authenticated store checks, request replay
-- validation and an audit record around these narrowly scoped operations.
create function private.count_inline_operation(p_store uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare org uuid; s public.inventory_count_sessions; source public.count_zones; target public.count_zones;
 draft public.count_drafts; product uuid; expected timestamptz; unit_name text; items jsonb; selection jsonb;
 name_text text; names text[]; result jsonb; snapshot_item jsonb;
begin
 if not private.can_count_inline(p_store) then raise exception 'STORE_COUNTER_REQUIRED' using errcode='42501'; end if;
 select organization_id into org from public.stores where id=p_store and is_active for update;
 if org is null then raise exception 'STORE_MEMBERSHIP_REQUIRED' using errcode='42501'; end if;
 if p_action='count.zone-rename' then
   if not private.can_import_inventory(p_store) then raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501'; end if;
   select * into target from public.count_zones where store_id=p_store and id=(p_data->>'id')::uuid and is_active for update;
   if not found then raise exception 'ZONE_NOT_FOUND' using errcode='42501'; end if;
   if regexp_replace(target.name,'[[:space:]]+','','g')='未分類' then raise exception 'UNCLASSIFIED_ZONE_RESERVED' using errcode='22023'; end if;
   if (p_data->>'updated_at')::timestamptz is distinct from target.updated_at then raise exception 'ZONE_CONFIGURATION_CHANGED' using errcode='40001'; end if;
   name_text:=btrim(p_data->>'name');
   if coalesce(length(name_text),0) not between 1 and 80 then raise exception 'ZONE_NAME_REQUIRED' using errcode='22023'; end if;
   if regexp_replace(name_text,'[[:space:]]+','','g')='未分類' then raise exception 'UNCLASSIFIED_ZONE_RESERVED' using errcode='22023'; end if;
   if exists(select 1 from public.count_zones z where z.store_id=p_store and z.id<>target.id
     and regexp_replace(lower(z.name),'[[:space:]]+','','g')=regexp_replace(lower(name_text),'[[:space:]]+','','g')) then
     raise exception 'ZONE_NAME_EXISTS' using errcode='23505';
   end if;
   -- No change to assignments, progress, entries, or any count snapshot.
   update public.count_zones set name=name_text where id=target.id returning * into target;
   return jsonb_build_object('id',target.id,'name',target.name,'updated_at',target.updated_at);
 elsif p_action in ('count.ensure-zones','count.zone-create') then
   if p_action='count.ensure-zones' then
     if exists(select 1 from public.count_zones z where z.store_id=p_store and z.is_active and regexp_replace(z.name,'[[:space:]]+','','g')<>'未分類') then
       names:='{}';
     else names:=array['冷藏區','冷凍區','常溫區']; end if;
   else
     name_text:=btrim(p_data->>'name');
     if coalesce(length(name_text),0) not between 1 and 80 then raise exception 'ZONE_NAME_REQUIRED' using errcode='22023'; end if;
     if regexp_replace(name_text,'[[:space:]]+','','g')='未分類' then raise exception 'UNCLASSIFIED_ZONE_RESERVED' using errcode='22023'; end if;
     names:=array[name_text];
   end if;
   foreach name_text in array names loop
     select * into target from public.count_zones z where z.store_id=p_store
       and regexp_replace(lower(z.name),'[[:space:]]+','','g')=regexp_replace(lower(name_text),'[[:space:]]+','','g') limit 1;
     if target.id is not null and not target.is_active then
       -- Never reactivate an area the user explicitly removed.
       if p_action='count.zone-create' then raise exception 'ZONE_NAME_EXISTS' using errcode='23505'; end if;
       continue;
     end if;
     if target.id is null then
       insert into public.count_zones(organization_id,store_id,name,sort_order)
       values(org,p_store,name_text,(select coalesce(max(sort_order),-1)+1 from public.count_zones where store_id=p_store)) returning * into target;
     end if;
     result:=jsonb_build_object('id',target.id,'name',target.name,'updated_at',target.updated_at);
   end loop;
   if p_action='count.zone-create' then return result; end if;
   return jsonb_build_object('zones',(select coalesce(jsonb_agg(jsonb_build_object('id',z.id,'name',z.name,'updated_at',z.updated_at) order by z.sort_order,z.id),'[]') from public.count_zones z where z.store_id=p_store and z.is_active));
 elsif p_action<>'count.assign-zone' then raise exception 'INVALID_APP_ACTION' using errcode='22023';
 end if;

 select * into s from public.inventory_count_sessions where id=(p_data->>'session_id')::uuid and store_id=p_store for update;
 if not found then raise exception 'COUNT_NOT_IN_STORE' using errcode='42501'; end if;
 if s.status<>'IN_PROGRESS' then raise exception 'COUNT_SESSION_NOT_ACTIVE' using errcode='22023'; end if;
 select * into source from public.count_zones where id=(p_data->>'source_zone_id')::uuid and store_id=p_store and is_active;
 select * into target from public.count_zones where id=(p_data->>'target_zone_id')::uuid and store_id=p_store and is_active;
 if source.id is null or target.id is null then raise exception 'ZONE_NOT_IN_STORE' using errcode='42501'; end if;
 if regexp_replace(source.name,'[[:space:]]+','','g')<>'未分類' or source.id=target.id
   or regexp_replace(target.name,'[[:space:]]+','','g')='未分類' then raise exception 'UNCLASSIFIED_SOURCE_REQUIRED' using errcode='22023'; end if;
 product:=(p_data->>'product_id')::uuid;
 if not exists(select 1 from public.count_zone_progress where session_id=s.id and zone_id=source.id and status<>'COMPLETED')
   or exists(select 1 from public.count_zone_progress where session_id=s.id and zone_id=target.id and status='COMPLETED')
   or exists(select 1 from public.count_entries where session_id=s.id and zone_id=source.id and product_id=product) then
   raise exception 'COUNT_ZONE_NOT_AVAILABLE' using errcode='22023';
 end if;
 select item into snapshot_item from jsonb_array_elements(s.snapshot->'zones') item where item->>'zone_id'=source.id::text and item->>'product_id'=product::text;
 if snapshot_item is null then raise exception 'PRODUCT_NOT_IN_COUNT' using errcode='42501'; end if;
 if exists(select 1 from jsonb_array_elements(s.snapshot->'zones') item where item->>'zone_id'=target.id::text and item->>'product_id'=product::text)
   or exists(select 1 from public.zone_products where zone_id=target.id and product_id=product)
   or exists(select 1 from public.count_drafts where session_id=s.id and zone_id=target.id and product_id=product)
   or exists(select 1 from public.count_entries where session_id=s.id and zone_id=target.id and product_id=product) then
   raise exception 'COUNT_TARGET_ALREADY_HAS_PRODUCT' using errcode='22023';
 end if;
 select zp.count_unit into unit_name from public.zone_products zp join public.products p on p.id=zp.product_id
 where zp.zone_id=source.id and zp.product_id=product and p.is_active
   and not exists(select 1 from private.count_catalog_removed cr where cr.store_id=p_store and cr.product_id=product);
 if unit_name is null then raise exception 'PRODUCT_NOT_IN_STORE' using errcode='42501'; end if;
 select * into draft from public.count_drafts where session_id=s.id and zone_id=source.id and product_id=product;
 expected:=(p_data->>'expected_updated_at')::timestamptz;
 if draft.updated_at is distinct from expected then raise exception 'COUNT_DRAFT_CHANGED' using errcode='40001'; end if;

 -- Move only this unclassified card. Other areas, historical sessions, valuation
 -- snapshots, original quantity, memo, actor, and unit remain intact.
 select jsonb_agg(case when item->>'zone_id'=source.id::text and item->>'product_id'=product::text
   then item||jsonb_build_object('zone_id',target.id,'zone_name',target.name) else item end order by ord)
 into items from jsonb_array_elements(s.snapshot->'zones') with ordinality a(item,ord);
 selection:=s.snapshot->'selection';
 if jsonb_typeof(selection)='array' then
   select jsonb_agg(case when item->>'zone_id'=source.id::text and item->>'product_id'=product::text
     then item||jsonb_build_object('zone_id',target.id) else item end order by ord)
   into selection from jsonb_array_elements(selection) with ordinality a(item,ord);
 end if;
 update public.inventory_count_sessions set snapshot=jsonb_set(snapshot,'{zones}',items)||jsonb_build_object('selection',selection) where id=s.id;
 insert into public.zone_products(zone_id,product_id,sort_order,count_unit)
 values(target.id,product,(select coalesce(max(sort_order),-1)+1 from public.zone_products where zone_id=target.id),unit_name);
 delete from public.zone_products where zone_id=source.id and product_id=product;
 if draft.id is not null then update public.count_drafts set zone_id=target.id where id=draft.id returning * into draft; end if;
 insert into public.count_zone_progress(organization_id,session_id,zone_id,status) values(org,s.id,target.id,'NOT_STARTED') on conflict(session_id,zone_id) do nothing;
 if not exists(select 1 from jsonb_array_elements(items) item where item->>'zone_id'=source.id::text) then
   delete from public.count_zone_progress where session_id=s.id and zone_id=source.id and status<>'COMPLETED';
 end if;
 return jsonb_build_object('zone_id',target.id,'product_id',product,'updated_at',draft.updated_at,'quantity',draft.quantity,'note',draft.note);
end $$;
revoke all on function private.count_inline_operation(uuid,text,jsonb) from public,anon,authenticated;

-- Keep the existing dispatcher's authorization before the idempotency cache.
do $migration$
declare src text; needle text; replacement text;
begin
 select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src;
 needle:='if v_role is null or p_request is null then';
 if position(needle in src)=0 then raise exception 'count inline dispatcher permission source mismatch'; end if;
 replacement:=$patch$if p_action in ('count.assign-zone','count.ensure-zones','count.zone-create','count.zone-rename') and not private.can_count_inline(p_store) then raise exception 'STORE_COUNTER_REQUIRED' using errcode='42501'; end if;
 if p_action='count.zone-rename' and not private.can_import_inventory(p_store) then raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501'; end if;
 if v_role is null or p_request is null then$patch$;
 src:=replace(src,needle,replacement);
 needle:='if p_action in (''count.prepare'',''count.catalog-edit'',''count.catalog-lifecycle'') then';
 if position(needle in src)=0 then raise exception 'count inline dispatcher action source mismatch'; end if;
 src:=replace(src,needle,$patch$if p_action in ('count.assign-zone','count.ensure-zones','count.zone-create','count.zone-rename') then v_result:=private.count_inline_operation(p_store,p_action,p_data);
 elsif p_action in ('count.prepare','count.catalog-edit','count.catalog-lifecycle') then$patch$);
 execute src;

 -- Carry memos across finalization, preserving the existing completion/retry and
 -- discrepancy behavior. Add only note to each existing result whitelist.
 select pg_get_functiondef('public.complete_pilot_count_zone(uuid,uuid)'::regprocedure) into src;
 needle:='    entry_type'||chr(10)||'  )';
 if position(needle in src)=0 then raise exception 'count completion columns source mismatch'; end if;
 src:=replace(src,needle,'    entry_type,'||chr(10)||'    note'||chr(10)||'  )');
 needle:='select organization_id, session_id, zone_id, product_id, quantity, unit, entered_by, ''INITIAL_COUNT''';
 if position(needle in src)=0 then raise exception 'count completion values source mismatch'; end if;
 src:=replace(src,needle,needle||', note');
 needle:='private.has_active_store_role(v_store, array[''ADMIN'',''SUPERVISOR'',''STAFF'']::public.app_role[])';
 if position(needle in src)=0 then raise exception 'count completion permission source mismatch'; end if;
 src:=replace(src,needle,'private.can_count_inline(v_store)');
 execute src;
 select pg_get_functiondef('public.get_pilot_count_results(uuid)'::regprocedure) into src;
 needle:='''quantity'',e.quantity';
 if position(needle in src)=0 then raise exception 'count results note source mismatch'; end if;
 execute replace(src,needle,needle||',''note'',e.note');
 select pg_get_functiondef('public.get_pilot_count_details(uuid)'::regprocedure) into src;
 if position(needle in src)=0 then raise exception 'count details note source mismatch'; end if;
 execute replace(src,needle,needle||',''note'',e.note');

 -- The legacy "exclude from current count" RPC may still be used by an old
 -- client. It cannot discard a memo merely because quantity has not been typed.
 select pg_get_functiondef('public.set_pilot_count_next_period(uuid,uuid,text)'::regprocedure) into src;
 needle:='order by started_at desc limit 1;';
 if position(needle in src)=0 then raise exception 'count exclusion session lock source mismatch'; end if;
 src:=replace(src,needle,'order by started_at desc limit 1 for update;');
 needle:='where session_id=v_session and product_id=p_product_id and quantity is not null';
 if position(needle in src)=0 then raise exception 'count exclusion note guard source mismatch'; end if;
 src:=replace(src,needle,'where session_id=v_session and product_id=p_product_id and (quantity is not null or nullif(btrim(note),'''') is not null)');
 needle:='      ) into v_has_quantity;';
 if position(needle in src)=0 then raise exception 'count exclusion completed-entry guard source mismatch'; end if;
 src:=replace(src,needle,'      ) or exists(select 1 from public.count_entries where session_id=v_session and product_id=p_product_id) into v_has_quantity;');
 execute src;
end $migration$;

revoke all on function public.save_pilot_count_draft(uuid,uuid,uuid,numeric,timestamptz),public.save_pilot_count_drafts(uuid,jsonb) from public,anon;
grant execute on function public.save_pilot_count_draft(uuid,uuid,uuid,numeric,timestamptz),public.save_pilot_count_drafts(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
