-- Repair the uniqueness rules required by the idempotent BeApe seed.
--
-- The Pilot migration uses CREATE TABLE IF NOT EXISTS. If an older version of
-- a table already existed, PostgreSQL kept that table without adding the newer
-- UNIQUE constraints. These indexes let ON CONFLICT identify an existing row
-- without deleting or replacing any source data.

create unique index if not exists suppliers_organization_supplier_code_uidx
  on public.suppliers (organization_id, supplier_code);

create unique index if not exists products_organization_product_code_uidx
  on public.products (organization_id, product_code);

create unique index if not exists count_zones_organization_name_uidx
  on public.count_zones (organization_id, name);

create unique index if not exists zone_products_zone_product_uidx
  on public.zone_products (zone_id, product_id);
