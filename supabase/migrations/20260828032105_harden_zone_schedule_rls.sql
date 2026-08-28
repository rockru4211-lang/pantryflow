-- Harden the store and organization relationship checks created by
-- zone_schedule_onsite_receiving. Explicit outer qualification prevents
-- PostgreSQL from resolving both sides of a comparison to the inner alias.

drop policy if exists store_workflow_settings_manager_insert on public.store_workflow_settings;
create policy store_workflow_settings_manager_insert
on public.store_workflow_settings for insert to authenticated
with check (
  store_workflow_settings.updated_by = (select auth.uid())
  and private.has_active_store_role(
    store_workflow_settings.store_id,
    array['ADMIN','SUPERVISOR']::public.app_role[]
  )
  and exists (
    select 1 from public.stores s
    where s.id = store_workflow_settings.store_id
      and s.organization_id = store_workflow_settings.organization_id
      and s.is_active
  )
);

drop policy if exists store_workflow_settings_manager_update on public.store_workflow_settings;
create policy store_workflow_settings_manager_update
on public.store_workflow_settings for update to authenticated
using (
  private.has_active_store_role(
    store_workflow_settings.store_id,
    array['ADMIN','SUPERVISOR']::public.app_role[]
  )
)
with check (
  store_workflow_settings.updated_by = (select auth.uid())
  and private.has_active_store_role(
    store_workflow_settings.store_id,
    array['ADMIN','SUPERVISOR']::public.app_role[]
  )
  and exists (
    select 1 from public.stores s
    where s.id = store_workflow_settings.store_id
      and s.organization_id = store_workflow_settings.organization_id
      and s.is_active
  )
);

drop policy if exists receipt_site_check_events_member_insert on public.receipt_site_check_events;
create policy receipt_site_check_events_member_insert
on public.receipt_site_check_events for insert to authenticated
with check (
  receipt_site_check_events.confirmed_by = (select auth.uid())
  and private.has_active_store_role(
    receipt_site_check_events.store_id,
    array['STAFF','ADMIN','SUPERVISOR']::public.app_role[]
  )
  and exists (
    select 1 from public.receipt_upload_batches b
    where b.id = receipt_site_check_events.batch_id
      and b.store_id = receipt_site_check_events.store_id
      and b.organization_id = receipt_site_check_events.organization_id
  )
  and (
    receipt_site_check_events.ocr_run_id is null
    or exists (
      select 1 from public.receipt_ocr_runs r
      where r.id = receipt_site_check_events.ocr_run_id
        and r.batch_id = receipt_site_check_events.batch_id
        and r.organization_id = receipt_site_check_events.organization_id
    )
  )
);

notify pgrst,'reload schema';
