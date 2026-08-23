-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260820155238
-- Name: pilot_v01_core_schema
-- DO NOT apply to production; retained for blank-environment reconstruction only.

create extension if not exists pgcrypto;

create type public.app_role as enum ('ADMIN','SUPERVISOR','STAFF');
create type public.count_session_status as enum ('DRAFT','IN_PROGRESS','COMPLETED','REVIEWING','CLOSED');
create type public.count_entry_type as enum ('INITIAL_COUNT','RECOUNT','CORRECTION');
create type public.receipt_batch_status as enum ('UPLOADED','PROCESSING','READY_FOR_REVIEW','REVIEWING','COMPLETED');
create type public.tax_mode as enum ('NO_PRICE','EXCLUSIVE_TAX','INCLUSIVE_TAX','DETECT_FROM_DOCUMENT');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'STAFF',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_code text,
  name text not null,
  tax_mode public.tax_mode not null default 'DETECT_FROM_DOCUMENT',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_code text,
  name text not null,
  category text,
  base_unit text,
  count_unit text,
  current_supplier_id uuid references public.suppliers(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_code)
);

create table public.product_supplier_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  effective_from date not null default current_date,
  effective_to date,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.count_zones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.zone_products (
  zone_id uuid not null references public.count_zones(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sort_order integer not null default 0,
  count_unit text,
  primary key (zone_id, product_id)
);

create table public.inventory_count_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  started_by uuid not null references auth.users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status public.count_session_status not null default 'DRAFT',
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.count_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.inventory_count_sessions(id) on delete cascade,
  zone_id uuid not null references public.count_zones(id),
  product_id uuid not null references public.products(id),
  quantity numeric not null,
  unit text not null,
  entered_by uuid not null references auth.users(id),
  entered_at timestamptz not null default now(),
  entry_type public.count_entry_type not null default 'INITIAL_COUNT',
  parent_entry_id uuid references public.count_entries(id),
  conversion_snapshot jsonb not null default '{}'::jsonb
);

create table public.discrepancy_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.inventory_count_sessions(id) on delete cascade,
  product_id uuid not null references public.products(id),
  zone_id uuid references public.count_zones(id),
  reason_code text,
  note text,
  status text not null default 'PENDING',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.receipt_upload_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now(),
  status public.receipt_batch_status not null default 'UPLOADED'
);

create table public.receipt_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null references public.receipt_upload_batches(id) on delete cascade,
  storage_path text not null,
  original_filename text,
  page_order integer not null default 0,
  ocr_raw jsonb,
  ocr_normalized jsonb,
  ocr_confidence jsonb,
  created_at timestamptz not null default now()
);

create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid references public.suppliers(id),
  receipt_date date not null default current_date,
  document_number text,
  subtotal_ex_tax numeric,
  tax numeric,
  total_inc_tax numeric,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  source_batch_id uuid references public.receipt_upload_batches(id),
  created_at timestamptz not null default now()
);

create table public.receipt_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  product_id uuid references public.products(id),
  supplier_id uuid references public.suppliers(id),
  quantity numeric,
  unit text,
  unit_price_ex_tax numeric,
  line_subtotal_ex_tax numeric,
  tax_rate numeric,
  tax numeric,
  line_total_inc_tax numeric,
  ai_original jsonb,
  human_correction jsonb,
  modified_by uuid references auth.users(id),
  modified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create or replace function public.is_org_member(org_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.is_active = true
  );
$$;

create or replace function public.has_org_role(org_id uuid, roles public.app_role[])
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and m.role = any(roles)
  );
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.product_supplier_history enable row level security;
alter table public.count_zones enable row level security;
alter table public.zone_products enable row level security;
alter table public.inventory_count_sessions enable row level security;
alter table public.count_entries enable row level security;
alter table public.discrepancy_reviews enable row level security;
alter table public.receipt_upload_batches enable row level security;
alter table public.receipt_documents enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.receipt_lines enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles_self_select" on public.profiles for select using (id = auth.uid());
create policy "profiles_self_update" on public.profiles for update using (id = auth.uid());

create policy "org_member_select_org" on public.organizations for select using (public.is_org_member(id));
create policy "member_select_same_org" on public.organization_members for select using (public.is_org_member(organization_id));

create policy "supplier_member_select" on public.suppliers for select using (public.is_org_member(organization_id));
create policy "supplier_admin_write" on public.suppliers for all using (public.has_org_role(organization_id, array['ADMIN']::public.app_role[])) with check (public.has_org_role(organization_id, array['ADMIN']::public.app_role[]));

create policy "product_member_select" on public.products for select using (public.is_org_member(organization_id));
create policy "product_admin_write" on public.products for all using (public.has_org_role(organization_id, array['ADMIN']::public.app_role[])) with check (public.has_org_role(organization_id, array['ADMIN']::public.app_role[]));

create policy "product_supplier_history_select" on public.product_supplier_history for select using (public.is_org_member(organization_id));
create policy "product_supplier_history_admin" on public.product_supplier_history for all using (public.has_org_role(organization_id, array['ADMIN']::public.app_role[])) with check (public.has_org_role(organization_id, array['ADMIN']::public.app_role[]));

create policy "count_zones_member_select" on public.count_zones for select using (public.is_org_member(organization_id));
create policy "count_zones_admin_write" on public.count_zones for all using (public.has_org_role(organization_id, array['ADMIN']::public.app_role[])) with check (public.has_org_role(organization_id, array['ADMIN']::public.app_role[]));

create policy "zone_products_member_select" on public.zone_products for select using (exists (select 1 from public.count_zones z where z.id = zone_id and public.is_org_member(z.organization_id)));
create policy "zone_products_admin_write" on public.zone_products for all using (exists (select 1 from public.count_zones z where z.id = zone_id and public.has_org_role(z.organization_id, array['ADMIN']::public.app_role[]))) with check (exists (select 1 from public.count_zones z where z.id = zone_id and public.has_org_role(z.organization_id, array['ADMIN']::public.app_role[])));

create policy "count_sessions_member_select" on public.inventory_count_sessions for select using (public.is_org_member(organization_id));
create policy "count_sessions_member_insert" on public.inventory_count_sessions for insert with check (public.is_org_member(organization_id) and started_by = auth.uid());
create policy "count_sessions_supervisor_update" on public.inventory_count_sessions for update using (public.has_org_role(organization_id, array['ADMIN','SUPERVISOR']::public.app_role[]));

create policy "count_entries_member_select" on public.count_entries for select using (public.is_org_member(organization_id));
create policy "count_entries_member_insert" on public.count_entries for insert with check (public.is_org_member(organization_id) and entered_by = auth.uid());

create policy "discrepancy_member_select" on public.discrepancy_reviews for select using (public.is_org_member(organization_id));
create policy "discrepancy_supervisor_write" on public.discrepancy_reviews for all using (public.has_org_role(organization_id, array['ADMIN','SUPERVISOR']::public.app_role[])) with check (public.has_org_role(organization_id, array['ADMIN','SUPERVISOR']::public.app_role[]));

create policy "receipt_batch_member_select" on public.receipt_upload_batches for select using (public.is_org_member(organization_id));
create policy "receipt_batch_member_insert" on public.receipt_upload_batches for insert with check (public.is_org_member(organization_id) and uploaded_by = auth.uid());
create policy "receipt_batch_reviewer_update" on public.receipt_upload_batches for update using (public.has_org_role(organization_id, array['ADMIN','SUPERVISOR']::public.app_role[]));

create policy "receipt_documents_member_select" on public.receipt_documents for select using (public.is_org_member(organization_id));
create policy "receipt_documents_member_insert" on public.receipt_documents for insert with check (public.is_org_member(organization_id));

create policy "goods_receipts_member_select" on public.goods_receipts for select using (public.is_org_member(organization_id));
create policy "goods_receipts_reviewer_write" on public.goods_receipts for all using (public.has_org_role(organization_id, array['ADMIN','SUPERVISOR']::public.app_role[])) with check (public.has_org_role(organization_id, array['ADMIN','SUPERVISOR']::public.app_role[]));

create policy "receipt_lines_member_select" on public.receipt_lines for select using (public.is_org_member(organization_id));
create policy "receipt_lines_reviewer_write" on public.receipt_lines for all using (public.has_org_role(organization_id, array['ADMIN','SUPERVISOR']::public.app_role[])) with check (public.has_org_role(organization_id, array['ADMIN','SUPERVISOR']::public.app_role[]));

create policy "audit_admin_select" on public.audit_logs for select using (public.has_org_role(organization_id, array['ADMIN']::public.app_role[]));
create policy "audit_member_insert" on public.audit_logs for insert with check (public.is_org_member(organization_id) and user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipt-documents','receipt-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "receipt_storage_read" on storage.objects for select using (
  bucket_id = 'receipt-documents'
  and exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid()
      and m.is_active = true
      and (storage.foldername(name))[1] = m.organization_id::text
  )
);

create policy "receipt_storage_insert" on storage.objects for insert with check (
  bucket_id = 'receipt-documents'
  and exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid()
      and m.is_active = true
      and (storage.foldername(name))[1] = m.organization_id::text
  )
);

