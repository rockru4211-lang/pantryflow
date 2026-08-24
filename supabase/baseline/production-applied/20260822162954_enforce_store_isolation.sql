-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260822162954
-- Name: enforce_store_isolation
-- DO NOT apply to production; retained for blank-environment reconstruction only.

-- P0-A: store is the authorization boundary for every new Pilot operation.
-- Existing rows remain untouched with store_id = null and are intentionally
-- invisible to the new store-scoped policies.

create unique index if not exists stores_global_login_code_idx
  on public.stores (lower(store_code));

alter table public.count_zones add column if not exists store_id uuid;
alter table public.inventory_count_sessions add column if not exists store_id uuid;
alter table public.receipt_upload_batches add column if not exists store_id uuid;
alter table public.goods_receipts add column if not exists store_id uuid;
alter table public.inventory_lots add column if not exists store_id uuid;

alter table public.count_zones
  add constraint count_zones_store_organization_fkey
  foreign key (store_id, organization_id) references public.stores(id, organization_id) not valid;
alter table public.inventory_count_sessions
  add constraint count_sessions_store_organization_fkey
  foreign key (store_id, organization_id) references public.stores(id, organization_id) not valid;
alter table public.receipt_upload_batches
  add constraint receipt_batches_store_organization_fkey
  foreign key (store_id, organization_id) references public.stores(id, organization_id) not valid;
alter table public.goods_receipts
  add constraint goods_receipts_store_organization_fkey
  foreign key (store_id, organization_id) references public.stores(id, organization_id) not valid;
alter table public.inventory_lots
  add constraint inventory_lots_store_organization_fkey
  foreign key (store_id, organization_id) references public.stores(id, organization_id) not valid;

alter table public.count_zones validate constraint count_zones_store_organization_fkey;
alter table public.inventory_count_sessions validate constraint count_sessions_store_organization_fkey;
alter table public.receipt_upload_batches validate constraint receipt_batches_store_organization_fkey;
alter table public.goods_receipts validate constraint goods_receipts_store_organization_fkey;
alter table public.inventory_lots validate constraint inventory_lots_store_organization_fkey;

create index if not exists count_zones_store_sort_idx on public.count_zones(store_id, sort_order) where store_id is not null;
create index if not exists count_sessions_store_started_idx on public.inventory_count_sessions(store_id, started_at desc) where store_id is not null;
create index if not exists receipt_batches_store_work_date_idx on public.receipt_upload_batches(store_id, work_date desc) where store_id is not null;
create index if not exists goods_receipts_store_date_idx on public.goods_receipts(store_id, receipt_date desc) where store_id is not null;
create index if not exists inventory_lots_store_product_idx on public.inventory_lots(store_id, product_id) where store_id is not null;

create or replace function private.has_active_store_role(
  p_store_id uuid,
  p_roles public.app_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_memberships sm
    join public.stores s on s.id = sm.store_id and s.organization_id = sm.organization_id
    join public.organization_members om
      on om.organization_id = sm.organization_id and om.user_id = sm.user_id
    where sm.store_id = p_store_id
      and sm.user_id = (select auth.uid())
      and sm.is_active
      and om.is_active
      and s.is_active
      and (p_roles is null or sm.role = any(p_roles))
  )
$$;

revoke all on function private.has_active_store_role(uuid, public.app_role[]) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.has_active_store_role(uuid, public.app_role[]) to authenticated;

drop policy if exists stores_member_select on public.stores;
create policy stores_member_select on public.stores for select to authenticated
using (private.has_active_store_role(id, null));

drop policy if exists staff_identities_self_or_supervisor_select on public.staff_identities;
create policy staff_identities_self_or_store_manager_select on public.staff_identities for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.store_memberships target
    where target.user_id = staff_identities.user_id
      and target.organization_id = staff_identities.organization_id
      and target.is_active
      and private.has_active_store_role(target.store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
  )
);

drop policy if exists store_memberships_self_or_supervisor_select on public.store_memberships;
create policy store_memberships_self_or_store_manager_select on public.store_memberships for select to authenticated
using (
  user_id = (select auth.uid())
  or private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
);

drop policy if exists count_zones_org_select on public.count_zones;
drop policy if exists count_zones_admin_insert on public.count_zones;
drop policy if exists count_zones_admin_update on public.count_zones;
create policy count_zones_store_select on public.count_zones for select to authenticated
using (store_id is not null and private.has_active_store_role(store_id, null));
create policy count_zones_store_manager_insert on public.count_zones for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and store_id is not null
  and private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
);
create policy count_zones_store_manager_update on public.count_zones for update to authenticated
using (store_id is not null and private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[]))
with check (
  organization_id = public.current_organization_id()
  and store_id is not null
  and private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
);

drop policy if exists zone_products_org_select on public.zone_products;
drop policy if exists zone_products_admin_insert on public.zone_products;
drop policy if exists zone_products_admin_update on public.zone_products;
drop policy if exists zone_products_admin_delete on public.zone_products;
create policy zone_products_store_select on public.zone_products for select to authenticated
using (exists (
  select 1 from public.count_zones z
  where z.id = zone_id and z.store_id is not null and private.has_active_store_role(z.store_id, null)
));
create policy zone_products_store_manager_insert on public.zone_products for insert to authenticated
with check (exists (
  select 1 from public.count_zones z join public.products p on p.id = product_id
  where z.id = zone_id and z.organization_id = p.organization_id
    and private.has_active_store_role(z.store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
));
create policy zone_products_store_manager_update on public.zone_products for update to authenticated
using (exists (
  select 1 from public.count_zones z where z.id = zone_id
    and private.has_active_store_role(z.store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
))
with check (exists (
  select 1 from public.count_zones z join public.products p on p.id = product_id
  where z.id = zone_id and z.organization_id = p.organization_id
    and private.has_active_store_role(z.store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
));
create policy zone_products_store_manager_delete on public.zone_products for delete to authenticated
using (exists (
  select 1 from public.count_zones z where z.id = zone_id
    and private.has_active_store_role(z.store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
));

drop policy if exists inventory_count_sessions_org_select on public.inventory_count_sessions;
drop policy if exists count_sessions_insert on public.inventory_count_sessions;
drop policy if exists count_sessions_update on public.inventory_count_sessions;
create policy count_sessions_store_select on public.inventory_count_sessions for select to authenticated
using (store_id is not null and private.has_active_store_role(store_id, null));
create policy count_sessions_store_insert on public.inventory_count_sessions for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and store_id is not null
  and started_by = (select auth.uid())
  and private.has_active_store_role(store_id, null)
);
create policy count_sessions_store_update on public.inventory_count_sessions for update to authenticated
using (
  store_id is not null and (
    started_by = (select auth.uid())
    or private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
  )
)
with check (
  organization_id = public.current_organization_id()
  and store_id is not null
  and (
    started_by = (select auth.uid())
    or private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
  )
);

drop policy if exists count_zone_progress_org_select on public.count_zone_progress;
drop policy if exists count_zone_progress_insert on public.count_zone_progress;
drop policy if exists count_zone_progress_update on public.count_zone_progress;
create policy count_zone_progress_store_select on public.count_zone_progress for select to authenticated
using (exists (
  select 1 from public.inventory_count_sessions s where s.id = session_id
    and private.has_active_store_role(s.store_id, null)
));
create policy count_zone_progress_store_insert on public.count_zone_progress for insert to authenticated
with check (exists (
  select 1 from public.inventory_count_sessions s join public.count_zones z on z.id = zone_id
  where s.id = session_id and s.store_id = z.store_id
    and private.has_active_store_role(s.store_id, null)
));
create policy count_zone_progress_store_update on public.count_zone_progress for update to authenticated
using (exists (
  select 1 from public.inventory_count_sessions s where s.id = session_id
    and private.has_active_store_role(s.store_id, null)
))
with check (exists (
  select 1 from public.inventory_count_sessions s join public.count_zones z on z.id = zone_id
  where s.id = session_id and s.store_id = z.store_id
    and private.has_active_store_role(s.store_id, null)
));

drop policy if exists count_drafts_org_select on public.count_drafts;
drop policy if exists count_drafts_insert on public.count_drafts;
drop policy if exists count_drafts_update on public.count_drafts;
drop policy if exists count_drafts_delete on public.count_drafts;
create policy count_drafts_store_select on public.count_drafts for select to authenticated
using (exists (
  select 1 from public.inventory_count_sessions s where s.id = session_id
    and private.has_active_store_role(s.store_id, null)
    and (entered_by = (select auth.uid()) or private.has_active_store_role(s.store_id, array['ADMIN','SUPERVISOR']::public.app_role[]))
));
create policy count_drafts_store_insert on public.count_drafts for insert to authenticated
with check (
  entered_by = (select auth.uid()) and exists (
    select 1 from public.inventory_count_sessions s join public.count_zones z on z.id = zone_id
    join public.products p on p.id = product_id
    where s.id = session_id and s.store_id = z.store_id and s.organization_id = p.organization_id
      and private.has_active_store_role(s.store_id, null)
  )
);
create policy count_drafts_store_update on public.count_drafts for update to authenticated
using (entered_by = (select auth.uid()) and exists (
  select 1 from public.inventory_count_sessions s where s.id = session_id
    and private.has_active_store_role(s.store_id, null)
))
with check (entered_by = (select auth.uid()) and exists (
  select 1 from public.inventory_count_sessions s join public.count_zones z on z.id = zone_id
  where s.id = session_id and s.store_id = z.store_id
    and private.has_active_store_role(s.store_id, null)
));
create policy count_drafts_store_delete on public.count_drafts for delete to authenticated
using (entered_by = (select auth.uid()) and exists (
  select 1 from public.inventory_count_sessions s where s.id = session_id
    and private.has_active_store_role(s.store_id, null)
));

drop policy if exists count_entries_org_select on public.count_entries;
drop policy if exists count_entries_insert on public.count_entries;
create policy count_entries_store_select on public.count_entries for select to authenticated
using (exists (
  select 1 from public.inventory_count_sessions s where s.id = session_id
    and private.has_active_store_role(s.store_id, null)
    and (entered_by = (select auth.uid()) or private.has_active_store_role(s.store_id, array['ADMIN','SUPERVISOR']::public.app_role[]))
));
create policy count_entries_store_insert on public.count_entries for insert to authenticated
with check (
  entered_by = (select auth.uid()) and exists (
    select 1 from public.inventory_count_sessions s join public.count_zones z on z.id = zone_id
    join public.products p on p.id = product_id
    where s.id = session_id and s.store_id = z.store_id and s.organization_id = p.organization_id
      and private.has_active_store_role(s.store_id, null)
  )
);

drop policy if exists inventory_count_discrepancies_org_select on public.inventory_count_discrepancies;
drop policy if exists discrepancies_insert on public.inventory_count_discrepancies;
drop policy if exists discrepancies_update on public.inventory_count_discrepancies;
create policy discrepancies_store_manager_select on public.inventory_count_discrepancies for select to authenticated
using (exists (
  select 1 from public.inventory_count_sessions s where s.id = session_id
    and private.has_active_store_role(s.store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
));
create policy discrepancies_store_manager_insert on public.inventory_count_discrepancies for insert to authenticated
with check (exists (
  select 1 from public.inventory_count_sessions s where s.id = session_id
    and private.has_active_store_role(s.store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
));
create policy discrepancies_store_manager_update on public.inventory_count_discrepancies for update to authenticated
using (exists (
  select 1 from public.inventory_count_sessions s where s.id = session_id
    and private.has_active_store_role(s.store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
))
with check (exists (
  select 1 from public.inventory_count_sessions s where s.id = session_id
    and private.has_active_store_role(s.store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
));

drop policy if exists receipt_batches_role_select on public.receipt_upload_batches;
drop policy if exists receipt_batches_insert on public.receipt_upload_batches;
drop policy if exists receipt_batches_admin_update on public.receipt_upload_batches;
create policy receipt_batches_store_select on public.receipt_upload_batches for select to authenticated
using (
  store_id is not null and private.has_active_store_role(store_id, null)
  and (uploaded_by = (select auth.uid()) or private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[]))
);
create policy receipt_batches_store_insert on public.receipt_upload_batches for insert to authenticated
with check (
  organization_id = public.current_organization_id() and store_id is not null
  and uploaded_by = (select auth.uid()) and private.has_active_store_role(store_id, null)
);
create policy receipt_batches_store_manager_update on public.receipt_upload_batches for update to authenticated
using (store_id is not null and private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[]))
with check (organization_id = public.current_organization_id() and store_id is not null
  and private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[]));

drop policy if exists receipt_documents_role_select on public.receipt_documents;
drop policy if exists receipt_documents_insert on public.receipt_documents;
create policy receipt_documents_store_select on public.receipt_documents for select to authenticated
using (exists (
  select 1 from public.receipt_upload_batches b where b.id = batch_id
    and private.has_active_store_role(b.store_id, null)
    and (b.uploaded_by = (select auth.uid()) or private.has_active_store_role(b.store_id, array['ADMIN','SUPERVISOR']::public.app_role[]))
));
create policy receipt_documents_store_insert on public.receipt_documents for insert to authenticated
with check (uploaded_by = (select auth.uid()) and exists (
  select 1 from public.receipt_upload_batches b where b.id = batch_id
    and b.uploaded_by = (select auth.uid()) and private.has_active_store_role(b.store_id, null)
));

comment on column public.count_zones.store_id is 'Required for all new Pilot zones; null identifies legacy rows excluded from Pilot.';
comment on column public.inventory_count_sessions.store_id is 'Required for all new Pilot count sessions; null legacy sessions are not inherited.';
comment on column public.receipt_upload_batches.store_id is 'Required for all new Pilot receipt batches; null legacy batches are not inherited.';

notify pgrst, 'reload schema';

