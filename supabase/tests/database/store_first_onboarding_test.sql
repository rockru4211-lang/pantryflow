begin;

select plan(14);

select ok(to_regprocedure('public.create_owner_business(text,text,text,text,text)') is not null,
  'public create_owner_business compatibility RPC exists');
select ok(to_regprocedure('private.create_owner_business_internal(text,text,text,text,text)') is not null,
  'private owner onboarding implementation exists');
select ok(to_regprocedure('public.set_staff_pin(uuid,text)') is not null,
  'set_staff_pin exists');
select ok(to_regprocedure('public.verify_staff_pin(text,text,text)') is not null,
  'verify_staff_pin exists');
select ok(to_regclass('public.stores') is not null, 'stores table exists');
select ok(to_regclass('public.store_memberships') is not null, 'store memberships table exists');
select ok(to_regclass('private.staff_pin_credentials') is not null, 'private PIN credentials table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.stores'::regclass),
  'stores RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.store_memberships'::regclass),
  'store memberships RLS is enabled');
select ok(has_function_privilege('authenticated', 'public.create_owner_business(text,text,text,text,text)', 'EXECUTE'),
  'authenticated may execute owner onboarding RPC');
select ok(not has_function_privilege('anon', 'public.create_owner_business(text,text,text,text,text)', 'EXECUTE'),
  'anon cannot execute owner onboarding RPC');
select ok(not has_table_privilege('authenticated', 'private.staff_pin_credentials', 'SELECT'),
  'authenticated cannot read PIN credentials');
select ok(position('raw_user_meta_data' in pg_get_functiondef('private.create_owner_business_internal(text,text,text,text,text)'::regprocedure)) = 0,
  'owner authorization does not use raw user metadata');
select ok(position('user_metadata' in pg_get_functiondef('private.create_owner_business_internal(text,text,text,text,text)'::regprocedure)) = 0,
  'owner authorization does not use user metadata');

select * from finish();
rollback;
