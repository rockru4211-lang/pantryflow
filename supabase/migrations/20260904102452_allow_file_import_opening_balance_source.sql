alter table public.store_product_opening_balances
  drop constraint store_product_opening_balances_source_check;

alter table public.store_product_opening_balances
  add constraint store_product_opening_balances_source_check
  check (source in ('ADMIN_OPENING_COUNT', 'FILE_IMPORT'));

create or replace function public.get_app_schema_version()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select '20260904_merchant_beta_v4'::text;
$$;

revoke all on function public.get_app_schema_version() from public;
grant execute on function public.get_app_schema_version() to anon, authenticated;
