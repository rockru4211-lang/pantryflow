begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select has_table('public', 'organizations', 'organizations table exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'stores', 'stores table exists');
select has_table('public', 'products', 'products table exists');
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

select is(
  public.get_app_schema_version(),
  '20260904_merchant_beta_v1',
  'database schema version matches the merchant beta contract'
);

select * from finish();
rollback;
