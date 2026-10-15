-- Xu starts with automatic table grants disabled. Grant only the direct reads
-- used by the browser; writes remain behind the existing authorized RPCs.
-- Apply after all historical migrations, only to the separate Xu project.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

do $$
declare item text;
begin
  foreach item in array array[
    'profiles','products','count_zones','zone_products',
    'inventory_count_sessions','count_entries','count_zone_progress',
    'count_drafts','inventory_count_discrepancies',
    'inventory_import_files','inventory_import_rows'
  ] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=item and c.relrowsecurity) then
      raise exception 'RLS must be enabled before granting browser access: %',item;
    end if;
    execute format('grant select on public.%I to authenticated',item);
  end loop;
end $$;

-- Only trusted Edge Functions use service_role. New tables still need grants.
grant select,insert,update,delete on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
