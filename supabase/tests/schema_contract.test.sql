begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

select has_table('public', 'organizations', 'organizations table exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'stores', 'stores table exists');
select has_table('public', 'products', 'products table exists');
select has_table('public', 'suppliers', 'suppliers table exists');
select has_table('public', 'staff_identities', 'staff identities table exists');
select has_table('public', 'store_memberships', 'store memberships table exists');
select has_table('public', 'inventory_import_files', 'inventory import source files table exists');
select has_table('public', 'inventory_import_rows', 'inventory import source rows table exists');
select has_table('public', 'count_zones', 'count_zones table exists');
select has_table('public', 'inventory_count_sessions', 'inventory_count_sessions table exists');
select has_table('public', 'count_drafts', 'count_drafts table exists');
select has_table(
  'public',
  'inventory_count_discrepancies',
  'inventory_count_discrepancies table exists'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname = any(array[
        'organizations',
        'profiles',
        'stores',
        'products',
        'count_zones',
        'inventory_count_sessions',
        'count_drafts',
        'inventory_count_discrepancies'
      ])
      and not c.relrowsecurity
  $$,
  $$ values (0::bigint) $$,
  'every public table has row level security enabled'
);

select has_function(
  'public',
  'create_owner_business',
  array['text', 'text', 'text', 'text', 'text'],
  'stable owner onboarding RPC exists'
);
select has_function(
  'public',
  'create_pilot_zone',
  array['uuid', 'text'],
  'count-zone creation RPC exists'
);
select has_function(
  'public',
  'create_pilot_product',
  array['uuid', 'text', 'text', 'text', 'text', 'numeric'],
  'catalog import product RPC exists'
);
select has_function(
  'public',
  'assign_pilot_product_to_zone',
  array['uuid', 'uuid'],
  'product-to-zone assignment RPC exists'
);
select has_function(
  'public',
  'create_pilot_count_session',
  array['uuid'],
  'count-session creation RPC exists'
);
select has_function(
  'public',
  'complete_pilot_count_zone',
  array['uuid', 'uuid'],
  'blind-count completion RPC exists'
);
select has_function(
  'public',
  'get_app_schema_version',
  array[]::text[],
  'schema-version RPC exists'
);

select has_function(
  'public',
  'import_pilot_inventory',
  array['uuid', 'jsonb'],
  'idempotent store inventory import RPC exists'
);

select is(
  has_function_privilege('anon', 'public.import_pilot_inventory(uuid,jsonb)', 'EXECUTE'),
  false,
  'anonymous users cannot execute inventory import'
);

select is(
  has_function_privilege('authenticated', 'public.import_pilot_inventory(uuid,jsonb)', 'EXECUTE'),
  true,
  'authenticated users can execute inventory import subject to store authorization'
);

select is(
  has_function_privilege('authenticated', 'public.verify_staff_pin(text,text,text)', 'EXECUTE'),
  false,
  'signed-in clients cannot execute the PIN verifier directly'
);

select is(
  has_function_privilege('service_role', 'public.verify_staff_pin(text,text,text)', 'EXECUTE'),
  true,
  'only the server-side staff login function can execute the PIN verifier'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and policyname = any(array[
        'stores_member_select',
        'count_drafts_store_select',
        'count_drafts_store_insert',
        'discrepancies_store_manager_select'
      ])
  $$,
  $$ values (4::bigint) $$,
  'store membership, staff drafts, and manager-only discrepancies retain RLS policies'
);

select is(
  public.get_app_schema_version(),
  '20260906_merchant_beta_v6',
  'database schema version matches the merchant beta contract'
);

select has_column(
  'public',
  'products',
  'current_supplier_id',
  'products can retain the imported existing-supplier relationship'
);

select matches(
  pg_get_functiondef('public.import_pilot_inventory(uuid,jsonb)'::regprocedure),
  'supplier_name',
  'inventory import accepts and resolves a supplier name'
);

select matches(
  pg_get_functiondef('public.import_pilot_inventory(uuid,jsonb)'::regprocedure),
  'PILOT_INVENTORY_IMPORT_COMPLETED',
  'every database import run leaves an auditable aggregate result'
);

select matches(
  pg_get_functiondef('public.import_pilot_inventory(uuid,jsonb)'::regprocedure),
  'STORE_MANAGER_REQUIRED',
  'only a store manager may import inventory'
);

select matches(
  pg_get_constraintdef(
    (select oid from pg_constraint
     where conrelid = 'public.store_product_opening_balances'::regclass
       and conname = 'store_product_opening_balances_source_check')
  ),
  'FILE_IMPORT',
  'opening balance source accepts file imports'
);

select results_eq(
  $$ select public from storage.buckets where id = 'inventory-imports' $$,
  $$ values (false) $$,
  'inventory source files use a private storage bucket'
);

select results_eq(
  $$
    select count(*)::bigint from pg_catalog.pg_policies
    where schemaname = 'public'
      and policyname = any(array[
        'inventory_import_files_store_manager_select',
        'inventory_import_rows_store_manager_select'
      ])
  $$,
  $$ values (2::bigint) $$,
  'source evidence is visible only through store-manager RLS policies'
);

select matches(
  pg_get_functiondef('public.import_pilot_inventory(uuid,jsonb)'::regprocedure),
  'inventory_import_rows',
  'inventory import persists raw and normalized source-row evidence'
);

select matches(
  pg_get_functiondef('public.import_pilot_inventory(uuid,jsonb)'::regprocedure),
  'v_opening_quantity is not null',
  'missing opening quantities are not replaced with invented zero balances'
);

select matches(
  pg_get_functiondef('public.complete_pilot_count_zone(uuid,uuid)'::regprocedure),
  '''REVIEWING''::public\.count_session_status',
  'blind-count completion casts the final status to the enum type'
);

select * from finish();
rollback;
