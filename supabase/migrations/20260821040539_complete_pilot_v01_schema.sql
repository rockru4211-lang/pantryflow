begin;
do $cleanup$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where (schemaname = 'public' and tablename in (
        'organizations','profiles','suppliers','products','product_supplier_history',
        'count_zones','zone_products','inventory_count_sessions','count_zone_progress',
        'count_entries','count_drafts','inventory_count_discrepancies',
        'receipt_upload_batches','receipt_documents','receipt_ocr_fields',
        'receipt_review_corrections','receipt_product_mappings','goods_receipts',
        'receipt_lines','receipt_adjustments','audit_logs'
      ))
      or (schemaname = 'storage' and tablename = 'objects' and policyname in ('receipt_storage_select','receipt_storage_insert'))
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end
$cleanup$;
-- PantryFlow Pilot v0.1
-- Run in a new Supabase project with the SQL editor or Supabase CLI.
-- This migration intentionally keeps original count, OCR and receipt records append-only.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  display_name text not null,
  role text not null check (role in ('ADMIN', 'SUPERVISOR', 'STAFF')),
  store text not null default 'BeApe',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  supplier_code text not null,
  name text not null,
  tax_mode text not null default 'DETECT_FROM_DOCUMENT'
    check (tax_mode in ('NO_PRICE', 'EXCLUSIVE_TAX', 'INCLUSIVE_TAX', 'DETECT_FROM_DOCUMENT')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, supplier_code)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  product_code text not null,
  name text not null,
  specification text not null default '',
  category text not null check (category in (
    '海鮮', '牛肉', '豬肉', '雞肉', '乳製品', '蔬菜', '水果', '乾貨',
    '醬料／調味', '酒水', '包材／耗材', '其他'
  )),
  base_unit text not null,
  count_unit text not null,
  is_active boolean not null default true,
  current_supplier_id uuid references public.suppliers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_code)
);

create table if not exists public.product_supplier_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  product_id uuid not null references public.products(id),
  supplier_id uuid not null references public.suppliers(id),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.count_zones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.zone_products (
  zone_id uuid not null references public.count_zones(id),
  product_id uuid not null references public.products(id),
  sort_order integer not null default 0,
  count_unit text not null,
  created_at timestamptz not null default now(),
  primary key (zone_id, product_id)
);

create table if not exists public.inventory_count_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  started_by uuid not null references public.profiles(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'REVIEWING', 'CLOSED')),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.count_zone_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  session_id uuid not null references public.inventory_count_sessions(id),
  zone_id uuid not null references public.count_zones(id),
  status text not null default 'NOT_STARTED'
    check (status in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
  completed_by uuid references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, zone_id)
);

create table if not exists public.count_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  session_id uuid not null references public.inventory_count_sessions(id),
  zone_id uuid not null references public.count_zones(id),
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity >= 0),
  unit text not null,
  entered_by uuid not null references public.profiles(id),
  entered_at timestamptz not null default now(),
  entry_type text not null check (entry_type in ('INITIAL_COUNT', 'RECOUNT', 'CORRECTION')),
  parent_entry_id uuid references public.count_entries(id),
  created_at timestamptz not null default now()
);

-- Drafts are replaceable working state. Completing a zone converts them into
-- immutable INITIAL_COUNT records and then removes the drafts.
create table if not exists public.count_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  session_id uuid not null references public.inventory_count_sessions(id),
  zone_id uuid not null references public.count_zones(id),
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity >= 0),
  unit text not null,
  entered_by uuid not null references public.profiles(id),
  entered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, zone_id, product_id)
);

create index if not exists count_entries_session_product_idx
  on public.count_entries(session_id, zone_id, product_id, entered_at desc);

create table if not exists public.inventory_count_discrepancies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  session_id uuid not null references public.inventory_count_sessions(id),
  zone_id uuid not null references public.count_zones(id),
  product_id uuid not null references public.products(id),
  initial_entry_id uuid not null references public.count_entries(id),
  final_entry_id uuid references public.count_entries(id),
  previous_quantity numeric(14,3),
  previous_confirmed_at timestamptz,
  estimated_quantity numeric(14,3),
  difference numeric(14,3),
  reason text check (reason in (
    'INPUT_ERROR', 'MISSED_OR_WRONG_ZONE', 'WASTE_NOT_RECORDED',
    'TRANSFER_NOT_RECORDED', 'RECEIPT_NOT_RECORDED', 'OTHER'
  )),
  status text not null default 'PENDING' check (status in ('PENDING', 'ANSWERED', 'RESOLVED')),
  answered_by uuid references public.profiles(id),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, zone_id, product_id)
);

create table if not exists public.receipt_upload_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  batch_number text not null,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  status text not null default 'UPLOADED'
    check (status in ('UPLOADED', 'PROCESSING', 'READY_FOR_REVIEW', 'REVIEWING', 'COMPLETED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, batch_number)
);

create table if not exists public.receipt_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  batch_id uuid not null references public.receipt_upload_batches(id),
  storage_path text not null,
  original_filename text not null,
  mime_type text not null default 'image/jpeg',
  page_order integer not null,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (batch_id, page_order)
);

create table if not exists public.receipt_ocr_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  batch_id uuid not null references public.receipt_upload_batches(id),
  document_id uuid references public.receipt_documents(id),
  row_key text not null,
  field_name text not null,
  raw_value jsonb,
  normalized_value jsonb,
  confidence numeric(5,4) check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (batch_id, row_key, field_name)
);

create table if not exists public.receipt_review_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  batch_id uuid not null references public.receipt_upload_batches(id),
  ocr_field_id uuid not null references public.receipt_ocr_fields(id),
  old_value jsonb,
  new_value jsonb not null,
  modified_by uuid not null references public.profiles(id),
  modified_at timestamptz not null default now()
);

create table if not exists public.receipt_product_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  batch_id uuid not null references public.receipt_upload_batches(id),
  row_key text not null,
  product_id uuid not null references public.products(id),
  selected_by uuid not null references public.profiles(id),
  selected_at timestamptz not null default now(),
  unique (batch_id, row_key)
);

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  supplier_id uuid references public.suppliers(id),
  receipt_date date not null,
  document_number text,
  subtotal_ex_tax numeric(14,2),
  tax numeric(14,2),
  total_inc_tax numeric(14,2),
  reviewed_by uuid not null references public.profiles(id),
  reviewed_at timestamptz not null default now(),
  source_batch_id uuid not null unique references public.receipt_upload_batches(id),
  created_at timestamptz not null default now()
);

create table if not exists public.receipt_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  receipt_id uuid not null references public.goods_receipts(id),
  product_id uuid not null references public.products(id),
  supplier_id uuid references public.suppliers(id),
  specification text not null default '',
  quantity numeric(14,3) not null,
  unit text not null,
  unit_price_ex_tax numeric(14,4),
  line_subtotal_ex_tax numeric(14,2),
  tax_rate numeric(7,5),
  tax numeric(14,2),
  line_total_inc_tax numeric(14,2),
  batch_or_expiry text,
  storage_location text,
  created_at timestamptz not null default now()
);

create table if not exists public.receipt_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  receipt_id uuid not null references public.goods_receipts(id),
  reason text not null,
  old_value jsonb,
  new_value jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'organizations', 'profiles', 'suppliers', 'products', 'count_zones',
    'inventory_count_sessions', 'count_zone_progress', 'count_drafts',
    'inventory_count_discrepancies', 'receipt_upload_batches'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

create or replace function public.prevent_record_change()
returns trigger language plpgsql as $$
begin
  raise exception 'PantryFlow original records are append-only';
end;
$$;

drop trigger if exists immutable_count_entries on public.count_entries;
create trigger immutable_count_entries before update or delete on public.count_entries
for each row execute function public.prevent_record_change();

drop trigger if exists immutable_receipt_documents on public.receipt_documents;
create trigger immutable_receipt_documents before update or delete on public.receipt_documents
for each row execute function public.prevent_record_change();

drop trigger if exists immutable_ocr_fields on public.receipt_ocr_fields;
create trigger immutable_ocr_fields before update or delete on public.receipt_ocr_fields
for each row execute function public.prevent_record_change();

drop trigger if exists immutable_receipt_corrections on public.receipt_review_corrections;
create trigger immutable_receipt_corrections before update or delete on public.receipt_review_corrections
for each row execute function public.prevent_record_change();

drop trigger if exists immutable_goods_receipts on public.goods_receipts;
create trigger immutable_goods_receipts before update or delete on public.goods_receipts
for each row execute function public.prevent_record_change();

drop trigger if exists immutable_receipt_lines on public.receipt_lines;
create trigger immutable_receipt_lines before update or delete on public.receipt_lines
for each row execute function public.prevent_record_change();

drop trigger if exists immutable_receipt_adjustments on public.receipt_adjustments;
create trigger immutable_receipt_adjustments before update or delete on public.receipt_adjustments
for each row execute function public.prevent_record_change();

drop trigger if exists immutable_audit_logs on public.audit_logs;
create trigger immutable_audit_logs before update or delete on public.audit_logs
for each row execute function public.prevent_record_change();

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() = 'ADMIN', false)
$$;

create or replace function public.can_supervise()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() in ('ADMIN', 'SUPERVISOR'), false)
$$;

-- 完成收貨必須是單一交易：正式表頭、明細、批次狀態與稽核紀錄一起成功或一起失敗。
create or replace function public.finalize_goods_receipt(
  p_batch_id uuid,
  p_supplier_id uuid,
  p_receipt_date date,
  p_document_number text,
  p_subtotal_ex_tax numeric,
  p_tax numeric,
  p_total_inc_tax numeric,
  p_lines jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org_id uuid := public.current_organization_id();
  v_receipt_id uuid;
  v_line jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only ADMIN can finalize a goods receipt';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one receipt line is required';
  end if;
  if not exists (
    select 1 from public.receipt_upload_batches
    where id = p_batch_id and organization_id = v_org_id and status <> 'COMPLETED'
  ) then
    raise exception 'Receipt upload batch is missing or already completed';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = p_supplier_id and organization_id = v_org_id
  ) then
    raise exception 'Supplier does not belong to this organization';
  end if;

  insert into public.goods_receipts (
    organization_id, supplier_id, receipt_date, document_number,
    subtotal_ex_tax, tax, total_inc_tax, reviewed_by, source_batch_id
  ) values (
    v_org_id, p_supplier_id, p_receipt_date, nullif(p_document_number, ''),
    p_subtotal_ex_tax, p_tax, p_total_inc_tax, auth.uid(), p_batch_id
  ) returning id into v_receipt_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if not exists (
      select 1 from public.products
      where id = (v_line->>'product_id')::uuid and organization_id = v_org_id
    ) then
      raise exception 'Receipt product does not belong to this organization';
    end if;
    if nullif(v_line->>'supplier_id', '') is not null and not exists (
      select 1 from public.suppliers
      where id = (v_line->>'supplier_id')::uuid and organization_id = v_org_id
    ) then
      raise exception 'Receipt line supplier does not belong to this organization';
    end if;
    insert into public.receipt_lines (
      organization_id, receipt_id, product_id, supplier_id, specification,
      quantity, unit, unit_price_ex_tax, line_subtotal_ex_tax, tax_rate,
      tax, line_total_inc_tax, batch_or_expiry, storage_location
    ) values (
      v_org_id,
      v_receipt_id,
      (v_line->>'product_id')::uuid,
      coalesce(nullif(v_line->>'supplier_id', '')::uuid, p_supplier_id),
      coalesce(v_line->>'specification', ''),
      (v_line->>'quantity')::numeric,
      v_line->>'unit',
      nullif(v_line->>'unit_price_ex_tax', '')::numeric,
      nullif(v_line->>'line_subtotal_ex_tax', '')::numeric,
      nullif(v_line->>'tax_rate', '')::numeric,
      nullif(v_line->>'tax', '')::numeric,
      nullif(v_line->>'line_total_inc_tax', '')::numeric,
      nullif(v_line->>'batch_or_expiry', ''),
      nullif(v_line->>'storage_location', '')
    );
  end loop;

  update public.receipt_upload_batches
  set status = 'COMPLETED'
  where id = p_batch_id and organization_id = v_org_id;

  insert into public.audit_logs (
    organization_id, entity_type, entity_id, action, old_value, new_value, user_id
  ) values (
    v_org_id, 'goods_receipt', v_receipt_id, 'RECEIPT_FINALIZED', null,
    jsonb_build_object(
      'batch_id', p_batch_id,
      'subtotal_ex_tax', p_subtotal_ex_tax,
      'tax', p_tax,
      'total_inc_tax', p_total_inc_tax
    ),
    auth.uid()
  );

  return v_receipt_id;
end;
$$;

revoke execute on function public.finalize_goods_receipt(uuid, uuid, date, text, numeric, numeric, numeric, jsonb) from public, anon;
grant execute on function public.finalize_goods_receipt(uuid, uuid, date, text, numeric, numeric, numeric, jsonb) to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.product_supplier_history enable row level security;
alter table public.count_zones enable row level security;
alter table public.zone_products enable row level security;
alter table public.inventory_count_sessions enable row level security;
alter table public.count_zone_progress enable row level security;
alter table public.count_entries enable row level security;
alter table public.count_drafts enable row level security;
alter table public.inventory_count_discrepancies enable row level security;
alter table public.receipt_upload_batches enable row level security;
alter table public.receipt_documents enable row level security;
alter table public.receipt_ocr_fields enable row level security;
alter table public.receipt_review_corrections enable row level security;
alter table public.receipt_product_mappings enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.receipt_lines enable row level security;
alter table public.receipt_adjustments enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_select on public.organizations for select
  using (id = public.current_organization_id());
create policy profiles_select on public.profiles for select
  using (organization_id = public.current_organization_id());
create policy profiles_admin_update on public.profiles for update
  using (organization_id = public.current_organization_id() and public.is_admin())
  with check (organization_id = public.current_organization_id() and public.is_admin());

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'suppliers', 'products', 'product_supplier_history', 'count_zones',
    'inventory_count_sessions', 'count_zone_progress', 'count_entries', 'count_drafts',
    'inventory_count_discrepancies'
  ] loop
    execute format('create policy %I_org_select on public.%I for select using (organization_id = public.current_organization_id())', table_name, table_name);
  end loop;
end $$;

-- 第一線只能讀取自己上傳的批次與原圖；正式核對資料只給 ADMIN。
create policy receipt_batches_role_select on public.receipt_upload_batches for select
  using (
    organization_id = public.current_organization_id()
    and (uploaded_by = auth.uid() or public.is_admin())
  );
create policy receipt_documents_role_select on public.receipt_documents for select
  using (
    organization_id = public.current_organization_id()
    and (
      public.is_admin()
      or exists (
        select 1 from public.receipt_upload_batches b
        where b.id = batch_id and b.uploaded_by = auth.uid()
      )
    )
  );
create policy receipt_ocr_admin_select on public.receipt_ocr_fields for select
  using (organization_id = public.current_organization_id() and public.is_admin());
create policy receipt_corrections_admin_select on public.receipt_review_corrections for select
  using (organization_id = public.current_organization_id() and public.is_admin());
create policy receipt_mappings_admin_select on public.receipt_product_mappings for select
  using (organization_id = public.current_organization_id() and public.is_admin());
create policy goods_receipts_admin_select on public.goods_receipts for select
  using (organization_id = public.current_organization_id() and public.is_admin());
create policy receipt_lines_admin_select on public.receipt_lines for select
  using (organization_id = public.current_organization_id() and public.is_admin());
create policy receipt_adjustments_admin_select on public.receipt_adjustments for select
  using (organization_id = public.current_organization_id() and public.is_admin());
create policy audit_logs_admin_select on public.audit_logs for select
  using (organization_id = public.current_organization_id() and public.is_admin());

create policy zone_products_org_select on public.zone_products for select
  using (
    exists (
      select 1 from public.count_zones z
      where z.id = zone_id and z.organization_id = public.current_organization_id()
    )
  );

create policy suppliers_admin_insert on public.suppliers for insert
  with check (organization_id = public.current_organization_id() and public.is_admin());
create policy suppliers_admin_update on public.suppliers for update
  using (organization_id = public.current_organization_id() and public.is_admin())
  with check (organization_id = public.current_organization_id() and public.is_admin());
create policy products_admin_insert on public.products for insert
  with check (
    organization_id = public.current_organization_id() and public.is_admin()
    and (current_supplier_id is null or exists (select 1 from public.suppliers s where s.id = current_supplier_id and s.organization_id = public.current_organization_id()))
  );
create policy products_admin_update on public.products for update
  using (organization_id = public.current_organization_id() and public.is_admin())
  with check (
    organization_id = public.current_organization_id() and public.is_admin()
    and (current_supplier_id is null or exists (select 1 from public.suppliers s where s.id = current_supplier_id and s.organization_id = public.current_organization_id()))
  );
create policy product_supplier_history_admin_insert on public.product_supplier_history for insert
  with check (
    organization_id = public.current_organization_id() and public.is_admin()
    and exists (select 1 from public.products p where p.id = product_id and p.organization_id = public.current_organization_id())
    and exists (select 1 from public.suppliers s where s.id = supplier_id and s.organization_id = public.current_organization_id())
    and (created_by is null or created_by = auth.uid())
  );
create policy count_zones_admin_insert on public.count_zones for insert
  with check (organization_id = public.current_organization_id() and public.is_admin());
create policy count_zones_admin_update on public.count_zones for update
  using (organization_id = public.current_organization_id() and public.is_admin())
  with check (organization_id = public.current_organization_id() and public.is_admin());
create policy zone_products_admin_insert on public.zone_products for insert
  with check (
    public.is_admin()
    and exists (select 1 from public.count_zones z where z.id = zone_id and z.organization_id = public.current_organization_id())
    and exists (select 1 from public.products p where p.id = product_id and p.organization_id = public.current_organization_id())
  );
create policy zone_products_admin_update on public.zone_products for update
  using (
    public.is_admin()
    and exists (select 1 from public.count_zones z where z.id = zone_id and z.organization_id = public.current_organization_id())
    and exists (select 1 from public.products p where p.id = product_id and p.organization_id = public.current_organization_id())
  )
  with check (
    public.is_admin()
    and exists (select 1 from public.count_zones z where z.id = zone_id and z.organization_id = public.current_organization_id())
    and exists (select 1 from public.products p where p.id = product_id and p.organization_id = public.current_organization_id())
  );
create policy zone_products_admin_delete on public.zone_products for delete
  using (exists (select 1 from public.count_zones z where z.id = zone_id and z.organization_id = public.current_organization_id()) and public.is_admin());

create policy count_sessions_insert on public.inventory_count_sessions for insert
  with check (organization_id = public.current_organization_id() and started_by = auth.uid());
create policy count_sessions_update on public.inventory_count_sessions for update
  using (
    organization_id = public.current_organization_id()
    and (started_by = auth.uid() or public.can_supervise())
  )
  with check (
    organization_id = public.current_organization_id()
    and (started_by = auth.uid() or public.can_supervise())
  );
create policy count_zone_progress_insert on public.count_zone_progress for insert
  with check (
    organization_id = public.current_organization_id()
    and exists (select 1 from public.inventory_count_sessions s where s.id = session_id and s.organization_id = public.current_organization_id())
    and exists (select 1 from public.count_zones z where z.id = zone_id and z.organization_id = public.current_organization_id())
  );
create policy count_zone_progress_update on public.count_zone_progress for update
  using (
    organization_id = public.current_organization_id()
    and exists (select 1 from public.inventory_count_sessions s where s.id = session_id and s.organization_id = public.current_organization_id())
  )
  with check (
    organization_id = public.current_organization_id()
    and exists (select 1 from public.inventory_count_sessions s where s.id = session_id and s.organization_id = public.current_organization_id())
    and exists (select 1 from public.count_zones z where z.id = zone_id and z.organization_id = public.current_organization_id())
  );
create policy count_entries_insert on public.count_entries for insert
  with check (
    organization_id = public.current_organization_id() and entered_by = auth.uid()
    and exists (select 1 from public.inventory_count_sessions s where s.id = session_id and s.organization_id = public.current_organization_id())
    and exists (select 1 from public.count_zones z where z.id = zone_id and z.organization_id = public.current_organization_id())
    and exists (select 1 from public.products p where p.id = product_id and p.organization_id = public.current_organization_id())
    and (
      (entry_type = 'INITIAL_COUNT' and parent_entry_id is null)
      or (
        entry_type in ('RECOUNT', 'CORRECTION')
        and exists (
          select 1 from public.count_entries e
          where e.id = parent_entry_id and e.organization_id = public.current_organization_id()
            and e.session_id = session_id and e.zone_id = zone_id and e.product_id = product_id
        )
      )
    )
  );
create policy count_drafts_insert on public.count_drafts for insert
  with check (
    organization_id = public.current_organization_id() and entered_by = auth.uid()
    and exists (select 1 from public.inventory_count_sessions s where s.id = session_id and s.organization_id = public.current_organization_id())
    and exists (select 1 from public.count_zones z where z.id = zone_id and z.organization_id = public.current_organization_id())
    and exists (select 1 from public.products p where p.id = product_id and p.organization_id = public.current_organization_id())
  );
create policy count_drafts_update on public.count_drafts for update
  using (organization_id = public.current_organization_id())
  with check (
    organization_id = public.current_organization_id() and entered_by = auth.uid()
    and exists (select 1 from public.inventory_count_sessions s where s.id = session_id and s.organization_id = public.current_organization_id())
    and exists (select 1 from public.count_zones z where z.id = zone_id and z.organization_id = public.current_organization_id())
    and exists (select 1 from public.products p where p.id = product_id and p.organization_id = public.current_organization_id())
  );
create policy count_drafts_delete on public.count_drafts for delete
  using (organization_id = public.current_organization_id());
create policy discrepancies_insert on public.inventory_count_discrepancies for insert
  with check (
    organization_id = public.current_organization_id() and public.can_supervise()
    and exists (select 1 from public.inventory_count_sessions s where s.id = session_id and s.organization_id = public.current_organization_id())
    and exists (select 1 from public.count_zones z where z.id = zone_id and z.organization_id = public.current_organization_id())
    and exists (select 1 from public.products p where p.id = product_id and p.organization_id = public.current_organization_id())
    and exists (select 1 from public.count_entries e where e.id = initial_entry_id and e.organization_id = public.current_organization_id())
  );
create policy discrepancies_update on public.inventory_count_discrepancies for update
  using (organization_id = public.current_organization_id() and public.can_supervise())
  with check (
    organization_id = public.current_organization_id() and public.can_supervise()
    and (final_entry_id is null or exists (
      select 1 from public.count_entries e
      where e.id = final_entry_id and e.organization_id = public.current_organization_id()
        and e.session_id = session_id and e.zone_id = zone_id and e.product_id = product_id
    ))
  );

create policy receipt_batches_insert on public.receipt_upload_batches for insert
  with check (organization_id = public.current_organization_id() and uploaded_by = auth.uid());
create policy receipt_batches_admin_update on public.receipt_upload_batches for update
  using (organization_id = public.current_organization_id() and public.is_admin())
  with check (organization_id = public.current_organization_id());
create policy receipt_documents_insert on public.receipt_documents for insert
  with check (
    organization_id = public.current_organization_id() and uploaded_by = auth.uid()
    and exists (
      select 1 from public.receipt_upload_batches b
      where b.id = batch_id and b.organization_id = public.current_organization_id() and b.uploaded_by = auth.uid()
    )
  );
create policy receipt_ocr_admin_insert on public.receipt_ocr_fields for insert
  with check (
    organization_id = public.current_organization_id() and public.is_admin()
    and exists (select 1 from public.receipt_upload_batches b where b.id = batch_id and b.organization_id = public.current_organization_id())
    and (document_id is null or exists (select 1 from public.receipt_documents d where d.id = document_id and d.organization_id = public.current_organization_id() and d.batch_id = batch_id))
  );
create policy receipt_corrections_admin_insert on public.receipt_review_corrections for insert
  with check (
    organization_id = public.current_organization_id() and modified_by = auth.uid() and public.is_admin()
    and exists (select 1 from public.receipt_upload_batches b where b.id = batch_id and b.organization_id = public.current_organization_id())
    and exists (select 1 from public.receipt_ocr_fields f where f.id = ocr_field_id and f.organization_id = public.current_organization_id() and f.batch_id = batch_id)
  );
create policy receipt_mappings_admin_insert on public.receipt_product_mappings for insert
  with check (
    organization_id = public.current_organization_id() and selected_by = auth.uid() and public.is_admin()
    and exists (select 1 from public.receipt_upload_batches b where b.id = batch_id and b.organization_id = public.current_organization_id())
    and exists (select 1 from public.products p where p.id = product_id and p.organization_id = public.current_organization_id())
  );
create policy receipt_mappings_admin_update on public.receipt_product_mappings for update
  using (organization_id = public.current_organization_id() and public.is_admin())
  with check (
    organization_id = public.current_organization_id() and selected_by = auth.uid() and public.is_admin()
    and exists (select 1 from public.receipt_upload_batches b where b.id = batch_id and b.organization_id = public.current_organization_id())
    and exists (select 1 from public.products p where p.id = product_id and p.organization_id = public.current_organization_id())
  );
create policy goods_receipts_admin_insert on public.goods_receipts for insert
  with check (
    organization_id = public.current_organization_id() and reviewed_by = auth.uid() and public.is_admin()
    and exists (select 1 from public.receipt_upload_batches b where b.id = source_batch_id and b.organization_id = public.current_organization_id())
    and (supplier_id is null or exists (select 1 from public.suppliers s where s.id = supplier_id and s.organization_id = public.current_organization_id()))
  );
create policy receipt_lines_admin_insert on public.receipt_lines for insert
  with check (
    organization_id = public.current_organization_id() and public.is_admin()
    and exists (select 1 from public.goods_receipts r where r.id = receipt_id and r.organization_id = public.current_organization_id())
    and exists (select 1 from public.products p where p.id = product_id and p.organization_id = public.current_organization_id())
    and (supplier_id is null or exists (select 1 from public.suppliers s where s.id = supplier_id and s.organization_id = public.current_organization_id()))
  );
create policy receipt_adjustments_admin_insert on public.receipt_adjustments for insert
  with check (
    organization_id = public.current_organization_id() and created_by = auth.uid() and public.is_admin()
    and exists (select 1 from public.goods_receipts r where r.id = receipt_id and r.organization_id = public.current_organization_id())
  );
create policy audit_logs_insert on public.audit_logs for insert
  with check (organization_id = public.current_organization_id() and user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipt-documents', 'receipt-documents', false, 15728640,
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update set public = false;

-- Object path must be {organization_id}/{batch_id}/{immutable filename}.
create policy receipt_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'receipt-documents'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and (
      public.is_admin()
      or exists (
        select 1 from public.receipt_documents d
        join public.receipt_upload_batches b on b.id = d.batch_id
        where d.storage_path = name and b.uploaded_by = auth.uid()
      )
    )
  );
create policy receipt_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipt-documents'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and exists (
      select 1 from public.receipt_upload_batches b
      where b.id::text = (storage.foldername(name))[2]
        and b.organization_id = public.current_organization_id()
        and b.uploaded_by = auth.uid()
    )
  );
-- Deliberately no UPDATE or DELETE policy for receipt originals.

commit;
