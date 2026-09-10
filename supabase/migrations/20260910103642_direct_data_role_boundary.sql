-- The approved client reads these records through store-authorized RPCs.
-- Historical organization-wide table grants must not bypass those RPC checks.
revoke all on public.inventory_lots,public.inventory_lot_events,
 public.discrepancy_reviews,public.product_supplier_history,
 public.organization_members,public.audit_logs from anon,authenticated;

-- Browser roles do not administer relational structure, including on future tables.
revoke truncate,references,trigger on all tables in schema public from anon,authenticated;
alter default privileges for role postgres in schema public revoke truncate,references,trigger on tables from anon,authenticated;

-- The client reads its own profile; authorized staff lists use the existing RPC/identity scope.
alter policy profiles_self_or_org_select on public.profiles using (id=(select auth.uid()));

-- Preserve original blind-count entries and progress queries. Administrative
-- corrections are available only through the existing management authorization.
alter policy count_entries_store_select on public.count_entries using (
 exists(select 1 from public.inventory_count_sessions s where s.id=count_entries.session_id
  and private.has_active_store_role(s.store_id,null)
  and (count_entries.entry_type='INITIAL_COUNT' or private.can_read_count_management(s.store_id)))
);
