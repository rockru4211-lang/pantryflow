-- Adjust known stock after a confirmed waste event or appended count correction.
-- When physical state cannot be attributed safely, preserve the remaining total
-- as UNCONFIRMED instead of claiming it is immediately available.
create function private.stock_adjust_zone(s uuid,p uuid,u text,z uuid,delta numeric) returns void
language plpgsql set search_path='' as $$
declare total numeric; pending boolean; target uuid; enabled boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('stock:'||s::text||p::text,0));
 select sum(quantity),bool_or(state<>'READY') into total,pending from private.stock_positions
 where store_id=s and product_id=p and unit=u and (z is null or zone_id=z);
 if total is null then return;end if;
 select thaw_enabled into enabled from private.stock_settings where store_id=s and product_id=p;
 target:=coalesce(z,private.stock_default_zone(s,p));
 update private.stock_positions set quantity=0,revision=revision+1,updated_at=now()
 where store_id=s and product_id=p and unit=u and (z is null or zone_id=z);
 insert into private.stock_positions(store_id,product_id,zone_id,unit,quantity,state)
 values(s,p,target,u,greatest(0,total+delta),case when coalesce(pending,false) or coalesce(enabled,false) then 'UNCONFIRMED' else 'READY' end);
end $$;
revoke all on function private.stock_adjust_zone(uuid,uuid,text,uuid,numeric) from public,anon,authenticated;

create or replace function private.stock_receipt_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare s uuid;p uuid;z uuid;inserted integer;
begin
 select store_id,product_id,zone_id into s,p,z from public.inventory_lots where id=new.lot_id;
 if s is null or p is null or new.quantity is null or new.event_type not in ('RECEIVED','DISCARDED') then return new;end if;
 if not exists(select 1 from private.stock_initialized where store_id=s and product_id=p) then return new;end if;
 -- If this unit has not yet been initialized, bootstrap includes this event.
 if not exists(select 1 from private.stock_initialized where store_id=s and product_id=p and unit=new.unit) then
  perform private.stock_initialize(s,p,new.unit);return new;
 end if;
 if new.event_type='RECEIVED' then
  perform private.stock_post(s,p,new.unit,new.quantity,'LOT_EVENT',new.id,false);
 else
  insert into private.stock_postings(source_type,source_id,store_id,product_id,quantity,unit)
  values('LOT_EVENT',new.id,s,p,-new.quantity,new.unit) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=1 then perform private.stock_adjust_zone(s,p,new.unit,z,-new.quantity);end if;
 end if;
 return new;
end $$;

-- Append-only correction evidence stays intact; apply only the difference from
-- the preceding count for this zone, and never replace a newer completed count.
create function private.stock_count_corrected() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.inventory_count_sessions; previous numeric;
begin
 if new.entry_type::text not in ('RECOUNT','CORRECTION') or new.quantity is null then return new;end if;
 select * into c from public.inventory_count_sessions where id=new.session_id;
 if c.status::text not in ('CLOSED','REVIEWING') or not exists(select 1 from private.stock_initialized where store_id=c.store_id and product_id=new.product_id and unit=new.unit) then return new;end if;
 if exists(select 1 from public.inventory_count_sessions later join public.count_entries e on e.session_id=later.id where later.store_id=c.store_id and later.completed_at>c.completed_at and later.status::text in ('CLOSED','REVIEWING') and e.product_id=new.product_id and e.unit=new.unit) then return new;end if;
 select quantity into previous from public.count_entries where session_id=new.session_id and product_id=new.product_id and zone_id=new.zone_id and unit=new.unit and id<>new.id order by entered_at desc,id desc limit 1;
 if previous is not null and previous<>new.quantity then perform private.stock_adjust_zone(c.store_id,new.product_id,new.unit,new.zone_id,new.quantity-previous);end if;
 return new;
end $$;
create trigger stock_count_corrected after insert on public.count_entries for each row execute function private.stock_count_corrected();
revoke all on function private.stock_count_corrected() from public,anon,authenticated;

create function private.stock_manual_waste() returns trigger language plpgsql security definer set search_path='' as $$
declare z uuid;begin
 if new.lot_id is not null or new.product_id is null then return new;end if;
 if not exists(select 1 from private.stock_initialized where store_id=new.store_id and product_id=new.product_id and unit=new.unit) then return new;end if;
 select id into z from public.count_zones where store_id=new.store_id and name=new.zone_name order by id limit 1;
 perform private.stock_adjust_zone(new.store_id,new.product_id,new.unit,z,-new.quantity);
 return new;
end $$;
create trigger stock_manual_waste after insert on private.waste_records for each row execute function private.stock_manual_waste();
revoke all on function private.stock_manual_waste() from public,anon,authenticated;
