-- Per-store physical positions, separate from immutable receipt/count evidence.
create table private.stock_settings (
 store_id uuid not null references public.stores(id),product_id uuid not null references public.products(id),
 thaw_enabled boolean not null default false,thaw_minutes integer check(thaw_minutes>0 and thaw_minutes<=43200),
 primary key(store_id,product_id),check(not thaw_enabled or thaw_minutes is not null)
);
create table private.stock_positions (
 id uuid primary key default gen_random_uuid(),store_id uuid not null references public.stores(id),product_id uuid not null references public.products(id),
 zone_id uuid not null references public.count_zones(id),unit text not null check(length(btrim(unit)) between 1 and 30),
 quantity numeric not null check(quantity>=0 and quantity<1000000000),state text not null check(state in ('READY','FROZEN','THAWING','UNCONFIRMED')),
 ready_at timestamptz,revision integer not null default 1,updated_at timestamptz not null default now(),check(state<>'THAWING' or ready_at is not null)
);
create index stock_positions_scope on private.stock_positions(store_id,product_id,unit);
create table private.stock_initialized (
 store_id uuid not null references public.stores(id),product_id uuid not null references public.products(id),unit text not null,
 initialized_at timestamptz not null default now(),primary key(store_id,product_id,unit)
);
create table private.stock_postings (
 source_type text not null,source_id uuid not null,store_id uuid not null references public.stores(id),product_id uuid not null references public.products(id),
 quantity numeric not null,unit text not null,created_at timestamptz not null default now(),primary key(source_type,source_id,store_id)
);
create table private.stock_unit_conversions (
 store_id uuid not null references public.stores(id),product_id uuid not null references public.products(id),from_unit text not null,to_unit text not null,
 multiplier numeric not null check(multiplier>0),primary key(store_id,product_id,from_unit,to_unit),check(from_unit<>to_unit)
);
create table private.store_units(store_id uuid not null references public.stores(id),unit text not null check(length(btrim(unit)) between 1 and 30),primary key(store_id,unit));
do $$ declare t text;begin foreach t in array array['stock_settings','stock_positions','stock_initialized','stock_postings','stock_unit_conversions','store_units'] loop
 execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated',t);end loop;end $$;

create function private.stock_unit_factor(s uuid,p uuid,u text,target text) returns numeric language sql stable set search_path='' as $$
 select case when u=target then 1 else (select multiplier from private.stock_unit_conversions where store_id=s and product_id=p and from_unit=u and to_unit=target) end
$$;
create function private.stock_default_zone(s uuid,p uuid) returns uuid language plpgsql set search_path='' as $$
declare z uuid;begin
 select cz.id into z from public.count_zones cz join public.zone_products zp on zp.zone_id=cz.id where cz.store_id=s and cz.is_active and zp.product_id=p order by cz.sort_order,cz.id limit 1;
 if z is null then
  select id into z from public.count_zones where store_id=s and name='未分類' and is_active order by id limit 1;
  if z is null then insert into public.count_zones(store_id,organization_id,name,sort_order) select id,organization_id,'未分類',0 from public.stores where id=s returning id into z;end if;
  insert into public.zone_products(zone_id,product_id,count_unit) select z,id,count_unit from public.products where id=p on conflict do nothing;
 end if;return z;
end $$;
-- Bootstrap exclusively from confirmed evidence. Missing quantities stay unknown.
create function private.stock_initialize(s uuid,p uuid,u text) returns void language plpgsql set search_path='' as $$
declare c uuid;cutoff timestamptz;row record;z uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('stock:'||s::text||p::text,0));
 if exists(select 1 from private.stock_initialized where store_id=s and product_id=p and unit=u) then return;end if;
 select cs.id,cs.completed_at into c,cutoff from public.inventory_count_sessions cs where cs.store_id=s and cs.status::text in ('CLOSED','REVIEWING') and exists(select 1 from public.count_entries e where e.session_id=cs.id and e.product_id=p and e.unit=u) order by cs.completed_at desc limit 1;
 for row in select distinct on(e.zone_id) e.* from public.count_entries e where e.session_id=c and e.product_id=p and e.unit=u and e.quantity is not null order by e.zone_id,e.entered_at desc,e.id desc loop
  insert into private.stock_positions(store_id,product_id,zone_id,unit,quantity,state) values(s,p,row.zone_id,u,row.quantity,'READY');
 end loop;
 z:=private.stock_default_zone(s,p);
 for row in select e.* from public.inventory_lot_events e join public.inventory_lots l on l.id=e.lot_id where l.store_id=s and l.product_id=p and e.unit=u and e.quantity is not null and e.event_type in ('RECEIVED','DISCARDED') and (cutoff is null or e.recorded_at>cutoff) order by e.recorded_at,e.id loop
  if row.event_type='RECEIVED' then insert into private.stock_positions(store_id,product_id,zone_id,unit,quantity,state) values(s,p,z,u,row.quantity,'READY');
  else perform private.stock_debit(s,p,u,row.quantity,false);end if;
 end loop;
 insert into private.stock_initialized(store_id,product_id,unit) values(s,p,u);
end $$;
-- Debit is strict for physical movement. Historical waste may exceed known stock;
-- it is never fabricated as a negative physical position.
create function private.stock_debit(s uuid,p uuid,u text,q numeric,strict_amount boolean default true) returns numeric language plpgsql set search_path='' as $$
declare pos private.stock_positions;remaining numeric:=q;take numeric;begin
 for pos in select * from private.stock_positions where store_id=s and product_id=p and unit=u and state='READY' and quantity>0 order by updated_at,id for update loop
  take:=least(pos.quantity,remaining);update private.stock_positions set quantity=quantity-take,revision=revision+1,updated_at=now() where id=pos.id;remaining:=remaining-take;exit when remaining=0;
 end loop;
 if strict_amount and remaining>0 then raise exception 'INSUFFICIENT_STOCK' using errcode='22023';end if;return q-remaining;
end $$;
create function private.stock_post(s uuid,p uuid,u text,q numeric,source text,source_id uuid,strict_debit boolean default true) returns void language plpgsql set search_path='' as $$
declare z uuid;state text;inserted integer;begin
 if p is null or q is null or q=0 then return;end if;
 perform private.stock_initialize(s,p,u);
 insert into private.stock_postings(source_type,source_id,store_id,product_id,quantity,unit) values(source,source_id,s,p,q,u) on conflict do nothing;get diagnostics inserted=row_count;if inserted=0 then return;end if;
 if q<0 then perform private.stock_debit(s,p,u,-q,strict_debit);
 else z:=private.stock_default_zone(s,p);select case when thaw_enabled then 'FROZEN' else 'READY' end into state from private.stock_settings where store_id=s and product_id=p;
 insert into private.stock_positions(store_id,product_id,zone_id,unit,quantity,state) values(s,p,z,u,q,coalesce(state,'READY'));end if;
end $$;

create function private.stock_snapshot(s uuid,p uuid,u text) returns jsonb language plpgsql stable set search_path='' as $$
declare total numeric;available numeric;c uuid;cutoff timestamptz;begin
 if exists(select 1 from private.stock_initialized where store_id=s and product_id=p and unit=u) then
 select sum(quantity*private.stock_unit_factor(s,p,unit,u)),sum(case when state='READY' then quantity*private.stock_unit_factor(s,p,unit,u) else 0 end) into total,available from private.stock_positions where store_id=s and product_id=p and private.stock_unit_factor(s,p,unit,u) is not null;
 else
 select cs.id,cs.completed_at into c,cutoff from public.inventory_count_sessions cs where cs.store_id=s and cs.status::text in ('CLOSED','REVIEWING') and exists(select 1 from public.count_entries e where e.session_id=cs.id and e.product_id=p and e.unit=u) order by cs.completed_at desc limit 1;
 select sum(x.quantity) into total from(select distinct on(zone_id) quantity from public.count_entries where session_id=c and product_id=p and unit=u order by zone_id,entered_at desc,id desc)x;
 select case when total is null and count(*)=0 then null else coalesce(total,0)+coalesce(sum(case when e.event_type='RECEIVED' then e.quantity else -e.quantity end),0) end into total from public.inventory_lot_events e join public.inventory_lots l on l.id=e.lot_id where l.store_id=s and l.product_id=p and e.unit=u and e.quantity is not null and e.event_type in ('RECEIVED','DISCARDED') and(cutoff is null or e.recorded_at>cutoff);
 total:=case when total is null then null else greatest(total,0) end;available:=total;
 end if;
 return jsonb_build_object('total',total,'available',available,'unit',u);
end $$;

create function private.stock_operation(s uuid,action text,d jsonb) returns jsonb language plpgsql set search_path='' as $$
declare p uuid:=nullif(d->>'product_id','')::uuid;org uuid;pos private.stock_positions;dest uuid;q numeric;newstate text;eta timestamptz;minutes integer;enabled boolean;result jsonb;begin
 if not private.app_session_valid(s) or private.app_role(s) is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into org from public.stores where id=s;
 if action='stock.move' then select * into pos from private.stock_positions where id=(d->>'position_id')::uuid and store_id=s;p:=pos.product_id;end if;
 if p is null or not exists(select 1 from public.products where id=p and organization_id=org and is_active) then raise exception 'INVALID_PRODUCT' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('stock:'||s::text||p::text,0));
 if action='stock.settings' then
  if not private.can_import_inventory(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  enabled:=coalesce((d->>'thaw_enabled')::boolean,false);minutes:=nullif(d->>'thaw_minutes','')::integer;
  if enabled and(minutes is null or minutes<=0 or minutes>43200) then raise exception 'THAW_DURATION_REQUIRED';end if;
  if not enabled and exists(select 1 from private.stock_positions where store_id=s and product_id=p and state<>'READY' and quantity>0) then raise exception 'STOCK_STATE_PENDING';end if;
  insert into private.stock_settings(store_id,product_id,thaw_enabled,thaw_minutes) values(s,p,enabled,minutes) on conflict(store_id,product_id) do update set thaw_enabled=excluded.thaw_enabled,thaw_minutes=excluded.thaw_minutes;
  return jsonb_build_object('product_id',p,'thaw_enabled',enabled,'thaw_minutes',minutes);
 elsif action='stock.open' then
  perform private.stock_initialize(s,p,(select base_unit from public.products where id=p));return jsonb_build_object('product_id',p);
 elsif action='stock.move' then
  if private.app_role(s) not in ('STAFF','SUPERVISOR') then raise exception 'FIELD_ROLE_REQUIRED' using errcode='42501';end if;
  if pos.id is null or pos.revision is distinct from (d->>'revision')::int then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  q:=(d->>'quantity')::numeric;dest:=(d->>'zone_id')::uuid;newstate:=d->>'state';
  select * into pos from private.stock_positions where id=pos.id and store_id=s for update;
  if pos.revision is distinct from (d->>'revision')::int then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  if q is null or q<=0 or q>pos.quantity then raise exception 'INSUFFICIENT_STOCK';end if;
  if not exists(select 1 from public.count_zones where id=dest and store_id=s and is_active) then raise exception 'INVALID_ZONE';end if;
  if newstate not in ('READY','FROZEN','THAWING') then raise exception 'INVALID_STOCK_STATE';end if;
  select thaw_enabled,thaw_minutes into enabled,minutes from private.stock_settings where store_id=s and product_id=p;
  if newstate<>'READY' and not coalesce(enabled,false) then raise exception 'THAW_NOT_ENABLED';end if;
  if newstate='THAWING' then if minutes is null then raise exception 'THAW_DURATION_REQUIRED';end if;eta:=case when pos.state='THAWING' then pos.ready_at else now()+make_interval(mins=>minutes) end;end if;
  if newstate='READY' and pos.state='THAWING' and pos.ready_at>now() then raise exception 'THAW_NOT_DUE';end if;
  update private.stock_positions set quantity=quantity-q,revision=revision+1,updated_at=now() where id=pos.id;
  insert into private.stock_positions(store_id,product_id,zone_id,unit,quantity,state,ready_at) values(s,p,dest,pos.unit,q,newstate,eta) returning to_jsonb(stock_positions) into result;
  insert into public.zone_products(zone_id,product_id,count_unit) values(dest,p,pos.unit) on conflict do nothing;
  return result;
 end if;raise exception 'INVALID_APP_ACTION';
end $$;

create function private.product_lifecycle(s uuid,d jsonb) returns jsonb language plpgsql set search_path='' as $$
declare org uuid;p uuid;mode text:=d->>'mode';row record;referenced boolean;any_reference boolean;results jsonb:='[]';begin
 if not private.can_import_inventory(s) then raise exception 'CATALOG_ROLE_REQUIRED' using errcode='42501';end if;
 select organization_id into org from public.stores where id=s;
 if mode not in ('DISABLE','RESTORE','DELETE') or jsonb_typeof(d->'ids')<>'array' or jsonb_array_length(d->'ids') not between 1 and 200 then raise exception 'INVALID_APP_INPUT';end if;
 for p in select distinct value::uuid from jsonb_array_elements_text(d->'ids') order by 1 loop
  perform 1 from public.products where id=p and organization_id=org for update;if not found then raise exception 'INVALID_PRODUCT';end if;
  any_reference:=false;
  if mode='DELETE' then
   -- Metadata is removable; source/operational/zone references always keep identity.
   for row in select n.nspname,c.relname,a.attname from pg_constraint fk join pg_class c on c.oid=fk.conrelid join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=any(fk.conkey)
    where fk.contype='f' and fk.confrelid='public.products'::regclass and c.relname not in ('product_details','stock_settings') loop
    execute format('select exists(select 1 from %I.%I where %I=$1)',row.nspname,row.relname,row.attname) into referenced using p;any_reference:=any_reference or referenced;
   end loop;
   any_reference:=any_reference or exists(select 1 from public.inventory_count_sessions where snapshot::text like '%'||p::text||'%');
   if not any_reference then delete from private.product_details where product_id=p;delete from private.stock_settings where product_id=p;delete from public.products where id=p;end if;
  end if;
  if mode<>'DELETE' or any_reference then update public.products set is_active=(mode='RESTORE'),updated_at=now() where id=p;end if;
  results:=results||jsonb_build_array(jsonb_build_object('id',p,'status',case when mode='RESTORE' then 'RESTORED' when mode='DELETE' and not any_reference then 'DELETED' else 'DISABLED' end,'reason',case when any_reference then '保留來源或作業關聯，已改為停用' else '' end));
 end loop;return jsonb_build_object('results',results);
end $$;

-- Extend the existing transaction/idempotency/audit dispatcher, not a second API.
do $$ declare src text;begin
 select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src;
 src:=replace(src,$needle$ if p_action='record.create' then$needle$, $patch$ if p_action like 'stock.%' then v_result:=private.stock_operation(p_store,p_action,p_data);$patch$||chr(10)||$patch$ elsif p_action='product.lifecycle' then v_result:=private.product_lifecycle(p_store,p_data);$patch$||chr(10)||$patch$ elsif p_action='record.create' then$patch$);
 src:=replace(src,'  v_id:=v_move.id; v_result:=to_jsonb(v_move);',
 '  v_id:=v_move.id; v_result:=to_jsonb(v_move);'||chr(10)||
 '  insert into private.store_units(store_id,unit) values(p_store,v_unit) on conflict do nothing;'||chr(10)||
 '  if p_action=''movement.create'' and v_target is not null then'||chr(10)||
 '   if v_kind=''loan'' then perform private.stock_post(p_store,v_target,v_unit,v_qty,''MOVEMENT'',v_id);'||chr(10)||
 '   else perform private.stock_post(p_store,v_target,v_unit,-v_qty,''MOVEMENT'',v_id);end if;'||chr(10)||
 '  elsif p_action=''movement.return'' and v_move.product_id is not null then'||chr(10)||
 '   perform private.stock_post(p_store,v_move.product_id,v_unit,case when p_store=v_move.to_store_id then -v_qty else v_qty end,''RETURN'',p_request);'||chr(10)||
 '  end if;');
 -- Only the actor store is posted; registering another store cannot grant write access.
 execute src;
end $$;

-- Internal helpers never become additional authenticated/public endpoints.
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'stock_%' or p.proname='product_lifecycle') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);end loop;end $$;
create function private.stock_receipt_event() returns trigger language plpgsql security definer set search_path='' as $$
declare s uuid;p uuid;begin
 select store_id,product_id into s,p from public.inventory_lots where id=new.lot_id;
 if s is not null and p is not null and new.quantity is not null and new.event_type in ('RECEIVED','DISCARDED') and exists(select 1 from private.stock_initialized where store_id=s and product_id=p and unit=new.unit) then
 perform private.stock_post(s,p,new.unit,case when new.event_type='RECEIVED' then new.quantity else -new.quantity end,'LOT_EVENT',new.id,false);end if;
 return new;
end $$;
create trigger stock_receipt_event after insert on public.inventory_lot_events for each row execute function private.stock_receipt_event();
revoke all on function private.stock_receipt_event() from public,anon,authenticated;
create function private.stock_count_completed() returns trigger language plpgsql security definer set search_path='' as $$
declare e record;total numeric;enabled boolean;begin
 if new.status::text not in ('CLOSED','REVIEWING') or old.status::text in ('CLOSED','REVIEWING') then return new;end if;
 for e in select distinct on(ce.product_id,ce.zone_id) ce.* from public.count_entries ce where ce.session_id=new.id and ce.quantity is not null order by ce.product_id,ce.zone_id,ce.entered_at desc,ce.id desc loop
  perform pg_advisory_xact_lock(hashtextextended('stock:'||new.store_id::text||e.product_id::text,0));
  if not exists(select 1 from private.stock_initialized where store_id=new.store_id and product_id=e.product_id and unit=e.unit) then continue;end if;
  select sum(quantity) into total from private.stock_positions where store_id=new.store_id and product_id=e.product_id and zone_id=e.zone_id and unit=e.unit;
  if total is not distinct from e.quantity then continue;end if;
  select thaw_enabled into enabled from private.stock_settings where store_id=new.store_id and product_id=e.product_id;
  update private.stock_positions set quantity=0,revision=revision+1,updated_at=now() where store_id=new.store_id and product_id=e.product_id and zone_id=e.zone_id and unit=e.unit;
  insert into private.stock_positions(store_id,product_id,zone_id,unit,quantity,state) values(new.store_id,e.product_id,e.zone_id,e.unit,e.quantity,case when coalesce(enabled,false) then 'UNCONFIRMED' else 'READY' end);
 end loop;return new;
end $$;
create trigger stock_count_completed after update of status on public.inventory_count_sessions for each row execute function private.stock_count_completed();
revoke all on function private.stock_count_completed() from public,anon,authenticated;

-- Read-only endpoints expose operational availability within existing store scope.
do $$ declare src text;begin
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into src;
 src:=replace(src,$needle$ if p_section in ('incidents'$needle$,$patch$
 if p_section='stock' then
  return jsonb_build_object('products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit,'thaw_enabled',coalesce(ss.thaw_enabled,false),'thaw_minutes',ss.thaw_minutes,'stock',private.stock_snapshot(p_store,p.id,p.base_unit)) order by p.name),'[]') from public.products p left join private.stock_settings ss on ss.store_id=p_store and ss.product_id=p.id where p.organization_id=v_org and p.is_active),
  'zones',(select coalesce(jsonb_agg(jsonb_build_object('id',z.id,'name',z.name) order by z.sort_order),'[]') from public.count_zones z where z.store_id=p_store and z.is_active),
  'positions',(select coalesce(jsonb_agg(to_jsonb(sp)||jsonb_build_object('zone_name',z.name) order by z.sort_order,sp.updated_at),'[]') from private.stock_positions sp join public.count_zones z on z.id=sp.zone_id where sp.store_id=p_store and sp.quantity>0));
 elsif p_section in ('incidents'$patch$);
 src:=replace(src,$needle$'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit)$needle$,
 $patch$'units',(select coalesce(jsonb_agg(unit order by unit),'[]') from private.store_units where store_id=p_store),'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit)$patch$);
 -- Keep the existing minimal cross-store search but include availability/state.
 src:=replace(src,'select s.id,s.name,max(cs.completed_at) updated_at', $patch$select s.id,s.name,max(cs.completed_at) updated_at,
 (select coalesce(jsonb_agg(jsonb_build_object('name',pr.name,'unit',pr.base_unit,'stock',private.stock_snapshot(s.id,pr.id,pr.base_unit),'states',(select coalesce(jsonb_agg(jsonb_build_object('state',sp.state,'quantity',sp.quantity,'unit',sp.unit,'ready_at',sp.ready_at)),'[]') from private.stock_positions sp where sp.store_id=s.id and sp.product_id=pr.id and sp.quantity>0))),'[]') from public.products pr where pr.organization_id=v_org and pr.is_active and pr.name ilike '%'||(p_filter->>'search')||'%') products$patch$);
 execute src;
 select pg_get_functiondef('private.app_dashboard(uuid)'::regprocedure) into src;
 -- Replace only shortage projection; other verified dashboard fields stay intact.
 src:=regexp_replace(src,$re$'shortages',\(select[\s\S]*?q.quantity<d.safety_quantity\)$re$,$patch$'shortages',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit,'remaining',d.safety_quantity-(stock->>'available')::numeric,'total',stock->'total','available',stock->'available','updated_at',now()) order by p.name),'[]') from public.products p join private.product_details d on d.product_id=p.id cross join lateral(select private.stock_snapshot(p_store,p.id,p.base_unit) stock) a where p.organization_id=s.organization_id and p.is_active and d.safety_quantity is not null and (stock->>'available')::numeric<d.safety_quantity)$patch$);
 src:=replace(src,$needle$  'count',(select$needle$,$patch$
  'expiry_upcoming',(select count(*) from private.expiry_current e where e.store_id=p_store and e.expires_on>today and e.expires_on<=today+3 and not exists(select 1 from private.expiry_resolutions er where er.expiry_id=e.id)),
  'thaw_due',(select count(*) from private.stock_positions sp where sp.store_id=p_store and sp.state='THAWING' and sp.quantity>0 and sp.ready_at<=now()),
  'reminder_priorities',jsonb_build_object('shortages',jsonb_build_array('immediate'),'expiry',case when exists(select 1 from private.expiry_current e where e.store_id=p_store and e.expires_on<=today and not exists(select 1 from private.expiry_resolutions er where er.expiry_id=e.id)) then jsonb_build_array('immediate') else jsonb_build_array('soon') end,'tasks',case when exists(select 1 from private.app_records a where a.store_id=p_store and a.status<>'COMPLETE' and a.due_at<=now()) then jsonb_build_array('immediate') when exists(select 1 from private.app_records a where a.store_id=p_store and a.status<>'COMPLETE' and a.due_at<=now()+interval '3 days') then jsonb_build_array('soon') else jsonb_build_array('normal') end),
  'count',(select$patch$);
 execute src;
end $$;
