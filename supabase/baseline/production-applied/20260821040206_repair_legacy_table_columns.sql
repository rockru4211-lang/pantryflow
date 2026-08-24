-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260821040206
-- Name: repair_legacy_table_columns
-- DO NOT apply to production; retained for blank-environment reconstruction only.

-- PantryFlow Pilot v0.1 legacy schema compatibility repair.
-- Safe to run more than once: only missing columns are added.

begin;

alter table public.organizations
  add column if not exists updated_at timestamptz not null default now();

alter table public.profiles
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists role text,
  add column if not exists store text not null default 'BeApe';

alter table public.suppliers
  add column if not exists tax_mode text not null default 'DETECT_FROM_DOCUMENT',
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

alter table public.products
  add column if not exists specification text,
  add column if not exists category text,
  add column if not exists base_unit text,
  add column if not exists count_unit text,
  add column if not exists is_active boolean not null default true,
  add column if not exists current_supplier_id uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.count_zones
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_active boolean not null default true;

alter table public.zone_products
  add column if not exists sort_order integer not null default 0,
  add column if not exists count_unit text,
  add column if not exists created_at timestamptz not null default now();

alter table public.product_supplier_history
  add column if not exists valid_from timestamptz not null default now(),
  add column if not exists valid_to timestamptz,
  add column if not exists created_by uuid references public.profiles(id);

alter table public.inventory_count_sessions
  add column if not exists updated_at timestamptz not null default now();

alter table public.count_entries
  add column if not exists created_at timestamptz not null default now();

alter table public.receipt_upload_batches
  add column if not exists batch_number text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.receipt_documents
  add column if not exists mime_type text not null default 'image/jpeg',
  add column if not exists uploaded_by uuid references public.profiles(id);

alter table public.receipt_lines
  add column if not exists specification text not null default '',
  add column if not exists batch_or_expiry text,
  add column if not exists storage_location text;

commit;

