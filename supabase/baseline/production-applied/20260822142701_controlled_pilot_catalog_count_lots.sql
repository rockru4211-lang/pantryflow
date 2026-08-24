-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260822142701
-- Name: controlled_pilot_catalog_count_lots
-- DO NOT apply to production; retained for blank-environment reconstruction only.

-- PantryFlow controlled Pilot: transactional catalog import, explicit blank
-- count observations, and immutable lot/state events.

alter table public.count_drafts alter column quantity drop not null;
alter table public.count_entries alter column quantity drop not null;
alter table public.count_drafts drop constraint if exists count_drafts_quantity_check;
alter table public.count_entries drop constraint if exists count_entries_quantity_check;
alter table public.count_drafts add column if not exists observation_state text not null default 'COUNTED';
alter table public.count_entries add column if not exists observation_state text not null default 'COUNTED';
alter table public.count_drafts add constraint count_drafts_observation_check
  check ((observation_state = 'COUNTED' and quantity is not null and quantity >= 0)
    or (observation_state = 'BLANK' and quantity is null));
alter table public.count_entries add constraint count_entries_observation_check
  check ((observation_state = 'COUNTED' and quantity is not null and quantity >= 0)
    or (observation_state = 'BLANK' and quantity is null));

create table public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_name text not null,
  zone_id uuid references public.count_zones(id),
  product_id uuid not null references public.products(id),
  lot_code text,
  original_expiry_date date,
  source_type text not null check (source_type in ('GOODS_RECEIPT', 'MANUAL_OPENING_BALANCE')),
  source_id uuid,
  parent_lot_id uuid references public.inventory_lots(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.inventory_lot_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  lot_id uuid not null references public.inventory_lots(id),
  event_type text not null check (event_type in ('RECEIVED', 'THAWED_UNOPENED', 'OPENED')),
  preservation_state text not null check (preservation_state in ('ORIGINAL_EXPIRY', 'THAWED_UNOPENED', 'OPENED')),
  quantity numeric(14,3) check (quantity is null or quantity >= 0),
  unit text,
  occurred_on date not null,
  source_type text not null check (source_type in ('GOODS_RECEIPT', 'MANUAL')),
  source_id uuid,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  note text
);

create index inventory_lots_workbench_idx
  on public.inventory_lots (organization_id, store_name, product_id, original_expiry_date);
create index inventory_lot_events_latest_idx
  on public.inventory_lot_events (lot_id, occurred_on desc, recorded_at desc);

create or replace function public.protect_inventory_lot_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Inventory lot identities and events are append-only';
end;
$$;

create trigger immutable_inventory_lots before update or delete on public.inventory_lots
for each row execute function public.protect_inventory_lot_history();
create trigger immutable_inventory_lot_events before update or delete on public.inventory_lot_events
for each row execute function public.protect_inventory_lot_history();

alter table public.inventory_lots enable row level security;
alter table public.inventory_lot_events enable row level security;
grant select, insert on public.inventory_lots to authenticated;
grant select, insert on public.inventory_lot_events to authenticated;
grant all on public.inventory_lots, public.inventory_lot_events to service_role;

create policy inventory_lots_org_select on public.inventory_lots for select to authenticated
using (organization_id = public.current_organization_id());
create policy inventory_lots_admin_insert on public.inventory_lots for insert to authenticated
with check (
  organization_id = public.current_organization_id() and public.is_admin()
  and created_by = (select auth.uid())
  and exists (select 1 from public.products p where p.id = product_id and p.organization_id = public.current_organization_id())
  and (zone_id is null or exists (select 1 from public.count_zones z where z.id = zone_id and z.organization_id = public.current_organization_id()))
);
create policy inventory_lot_events_org_select on public.inventory_lot_events for select to authenticated
using (organization_id = public.current_organization_id());
create policy inventory_lot_events_admin_insert on public.inventory_lot_events for insert to authenticated
with check (
  organization_id = public.current_organization_id() and public.is_admin()
  and recorded_by = (select auth.uid())
  and exists (select 1 from public.inventory_lots l where l.id = lot_id and l.organization_id = public.current_organization_id())
);

create or replace function public.create_lot_from_receipt_line()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_receipt public.goods_receipts;
  v_store text;
  v_lot_id uuid;
  v_expiry date;
begin
  select * into v_receipt from public.goods_receipts where id = new.receipt_id;
  select b.store_name into v_store from public.receipt_upload_batches b where b.id = v_receipt.source_batch_id;
  if nullif(new.batch_or_expiry, '') ~ '^\d{4}-\d{2}-\d{2}$' then v_expiry := new.batch_or_expiry::date; end if;
  insert into public.inventory_lots (
    organization_id, store_name, product_id, lot_code, original_expiry_date,
    source_type, source_id, created_by
  ) values (
    new.organization_id, coalesce(v_store, '未指定門市'), new.product_id,
    nullif(new.batch_or_expiry, ''), v_expiry, 'GOODS_RECEIPT', new.id, v_receipt.reviewed_by
  ) returning id into v_lot_id;
  insert into public.inventory_lot_events (
    organization_id, lot_id, event_type, preservation_state, quantity, unit,
    occurred_on, source_type, source_id, recorded_by
  ) values (
    new.organization_id, v_lot_id, 'RECEIVED', 'ORIGINAL_EXPIRY', new.quantity, new.unit,
    v_receipt.receipt_date, 'GOODS_RECEIPT', new.id, v_receipt.reviewed_by
  );
  return new;
end;
$$;

drop trigger if exists create_inventory_lot_after_receipt_line on public.receipt_lines;
create trigger create_inventory_lot_after_receipt_line
after insert on public.receipt_lines
for each row execute function public.create_lot_from_receipt_line();
revoke execute on function public.create_lot_from_receipt_line() from public, anon, authenticated;

create or replace function public.import_catalog_products(p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_org_id uuid := public.current_organization_id();
  v_row jsonb;
  v_results jsonb := '[]'::jsonb;
  v_index integer := 1;
  v_code text;
  v_existing uuid;
  v_product_id uuid;
begin
  if not public.is_admin() then raise exception 'Only ADMIN can import products'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Import requires 1 to 500 rows';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_code := nullif(btrim(v_row->>'product_code'), '');
    if nullif(btrim(v_row->>'name'), '') is null
      or nullif(btrim(v_row->>'base_unit'), '') is null
      or nullif(btrim(v_row->>'count_unit'), '') is null then
      v_results := v_results || jsonb_build_array(jsonb_build_object('row', v_index, 'status', 'ERROR', 'message', '缺少必填欄位'));
    else
      select id into v_existing from public.products
      where organization_id = v_org_id and (
        (v_code is not null and product_code = v_code)
        or (lower(name) = lower(btrim(v_row->>'name')) and lower(specification) = lower(coalesce(btrim(v_row->>'specification'), '')))
      ) limit 1;
      if v_existing is not null then
        v_results := v_results || jsonb_build_array(jsonb_build_object('row', v_index, 'status', 'DUPLICATE', 'product_id', v_existing));
      else
        insert into public.products (
          organization_id, product_code, name, specification, category, base_unit, count_unit, current_supplier_id
        ) values (
          v_org_id, coalesce(v_code, 'PF-' || upper(substr(gen_random_uuid()::text, 1, 8))),
          btrim(v_row->>'name'), coalesce(btrim(v_row->>'specification'), ''),
          case when v_row->>'category' in ('海鮮','牛肉','豬肉','雞肉','乳製品','蔬菜','水果','乾貨','醬料／調味','酒水','包材／耗材','其他') then v_row->>'category' else '其他' end,
          btrim(v_row->>'base_unit'), btrim(v_row->>'count_unit'),
          (select s.id from public.suppliers s where s.organization_id = v_org_id and s.supplier_code = nullif(btrim(v_row->>'supplier_code'), '') limit 1)
        ) returning id into v_product_id;
        insert into public.audit_logs (organization_id, entity_type, entity_id, action, old_value, new_value, user_id)
        values (v_org_id, 'product', v_product_id, 'PRODUCT_IMPORTED', null, v_row, (select auth.uid()));
        v_results := v_results || jsonb_build_array(jsonb_build_object('row', v_index, 'status', 'IMPORTED', 'product_id', v_product_id));
      end if;
    end if;
    v_index := v_index + 1;
    v_existing := null;
  end loop;
  return v_results;
end;
$$;

revoke execute on function public.import_catalog_products(jsonb) from public, anon;
grant execute on function public.import_catalog_products(jsonb) to authenticated;

comment on table public.inventory_lots is 'Immutable lot identity and source; state changes are separate events.';
comment on table public.inventory_lot_events is 'Append-only received, thawed-unopened, and opened history.';

