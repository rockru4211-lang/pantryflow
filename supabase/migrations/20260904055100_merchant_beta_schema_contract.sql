create or replace function public.get_app_schema_version()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select '20260904_merchant_beta_v1'::text
$$;

revoke all on function public.get_app_schema_version() from public;
grant execute on function public.get_app_schema_version() to anon, authenticated;
comment on function public.get_app_schema_version() is
  'Build-time compatibility contract for the 序 merchant beta application.';

notify pgrst, 'reload schema';
