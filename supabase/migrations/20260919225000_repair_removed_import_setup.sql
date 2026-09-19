begin;

-- Repair previously removed import batches so their items are also removed from the
-- current store setup and any unfinished count. Historical completed records stay intact.
create temporary table tmp_removed_import_products on commit drop as
select distinct f.store_id,r.product_id
from public.inventory_import_files f
join public.inventory_import_rows r on r.import_file_id=f.id
where f.removed_at is not null
  and r.product_id is not null
  and not exists (
    select 1
    from public.inventory_import_rows r2
    join public.inventory_import_files f2 on f2.id=r2.import_file_id
    where f2.store_id=f.store_id
      and f2.removed_at is null
      and r2.product_id=r.product_id
      and r2.status in ('ADDED','EXISTING')
  );

-- Remove from unfinished count drafts / snapshots.
delete from public.count_drafts d
using public.inventory_count_sessions s,tmp_removed_import_products t
where d.session_id=s.id
  and s.store_id=t.store_id
  and s.status in ('DRAFT','IN_PROGRESS')
  and d.product_id=t.product_id;

delete from private.count_opening_snapshots os
using public.inventory_count_sessions s,tmp_removed_import_products t
where os.session_id=s.id
  and s.store_id=t.store_id
  and s.status in ('DRAFT','IN_PROGRESS')
  and os.product_id=t.product_id;

update public.inventory_count_sessions s
set snapshot=jsonb_set(
  s.snapshot,'{zones}',
  coalesce(
    (select jsonb_agg(item)
     from jsonb_array_elements(coalesce(s.snapshot->'zones','[]'::jsonb)) item
     where not exists (
       select 1
       from tmp_removed_import_products t
       where t.store_id=s.store_id
         and t.product_id::text=item->>'product_id'
     )),
    '[]'::jsonb
  ),
  true
)
where s.status in ('DRAFT','IN_PROGRESS')
  and exists(select 1 from tmp_removed_import_products t where t.store_id=s.store_id);

delete from public.count_zone_progress zp
using public.inventory_count_sessions s
where zp.session_id=s.id
  and s.status in ('DRAFT','IN_PROGRESS')
  and exists(select 1 from tmp_removed_import_products t where t.store_id=s.store_id)
  and not exists (
    select 1
    from jsonb_array_elements(coalesce(s.snapshot->'zones','[]'::jsonb)) item
    where item->>'zone_id'=zp.zone_id::text
  );

-- Remove the products from the current store setup.
delete from public.zone_products zp
using public.count_zones z,tmp_removed_import_products t
where zp.zone_id=z.id
  and z.store_id=t.store_id
  and zp.product_id=t.product_id;

-- If an unfinished count is now empty, discard that empty count shell.
delete from public.count_zone_progress zp
using public.inventory_count_sessions s
where zp.session_id=s.id
  and s.status in ('DRAFT','IN_PROGRESS')
  and jsonb_array_length(coalesce(s.snapshot->'zones','[]'::jsonb))=0;

delete from public.count_drafts d
using public.inventory_count_sessions s
where d.session_id=s.id
  and s.status in ('DRAFT','IN_PROGRESS')
  and jsonb_array_length(coalesce(s.snapshot->'zones','[]'::jsonb))=0;

delete from private.count_opening_snapshots os
using public.inventory_count_sessions s
where os.session_id=s.id
  and s.status in ('DRAFT','IN_PROGRESS')
  and jsonb_array_length(coalesce(s.snapshot->'zones','[]'::jsonb))=0;

delete from public.inventory_count_sessions s
where s.status in ('DRAFT','IN_PROGRESS')
  and jsonb_array_length(coalesce(s.snapshot->'zones','[]'::jsonb))=0;

-- Keep historical identities if referenced elsewhere, but hide them from all active
-- operational lists when they no longer belong to any active store setup.
update public.products p
set is_active=false,updated_at=now()
where exists(select 1 from tmp_removed_import_products t where t.product_id=p.id)
  and not exists(select 1 from public.zone_products zp where zp.product_id=p.id);

commit;