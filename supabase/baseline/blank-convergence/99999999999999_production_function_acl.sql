-- Blank-environment convergence captured from current production function ACLs.
-- The retained production migration ledger does not reproduce these grants completely.
-- DO NOT apply to production. This file is only for blank baseline verification.

create or replace function public.rls_auto_enable()
 returns event_trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

grant execute on function public.assign_pilot_product_to_zone(uuid, uuid) to service_role;
grant execute on function public.can_supervise() to service_role;
grant execute on function public.complete_pilot_count_zone(uuid, uuid) to service_role;
grant execute on function public.create_lot_from_receipt_line() to service_role;
revoke execute on function public.create_my_organization(text) from authenticated;
grant execute on function public.create_my_organization(text) to service_role;
grant execute on function public.create_owner_business(text, text, text, text, text) to service_role;
grant execute on function public.create_pilot_count_session(uuid) to service_role;
grant execute on function public.create_pilot_product(uuid, text, text, text, text, numeric) to service_role;
grant execute on function public.create_pilot_zone(uuid, text) to service_role;
grant execute on function public.current_organization_id() to service_role;
grant execute on function public.current_role() to service_role;
grant execute on function public.enqueue_receipt_ocr(uuid) to service_role;
grant execute on function public.finalize_goods_receipt(uuid, uuid, date, text, numeric, numeric, numeric, jsonb) to service_role;
grant execute on function public.handle_new_pilot_user() to service_role;
grant execute on function public.import_catalog_products(jsonb) to service_role;
grant execute on function public.is_admin() to service_role;
grant execute on function public.resolve_pilot_count_discrepancy(uuid, text, text, numeric) to service_role;
grant execute on function public.rls_auto_enable() to service_role;
grant execute on function public.sync_receipt_batch_work_date() to service_role;

grant execute on function public.prevent_record_change() to public, postgres, anon, authenticated, service_role;
grant execute on function public.protect_inventory_lot_history() to public, postgres, anon, authenticated, service_role;
grant execute on function public.protect_receipt_ocr_run() to public, postgres, anon, authenticated, service_role;
grant execute on function public.set_updated_at() to public, postgres, anon, authenticated, service_role;
