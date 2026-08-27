-- Functional Pilot repairs: store-scoped count zones, auditable count imports,
-- and store-scoped access to immutable receipt OCR evidence.

drop index if exists public.count_zones_organization_name_uidx;
create unique index if not exists count_zones_store_name_uidx
  on public.count_zones (store_id, lower(btrim(name)))
  where store_id is not null and is_active;

create table if not exists public.count_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  source_filename text not null,
  source_mime_type text not null,
  source_storage_path text,
  source_sheet text not null,
  template_version text not null default 'PF-COUNT-IMPORT-V1',
  headers jsonb not null default '[]'::jsonb,
  status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED')),
  imported_by uuid not null references public.profiles(id),
  imported_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists public.count_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.count_import_batches(id),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  source_sheet text not null,
  source_row integer not null check (source_row > 0),
  source_values jsonb not null,
  quantity_column integer not null check (quantity_column > 0),
  zone_name text not null,
  product_code text not null,
  product_name text not null,
  count_unit text not null,
  product_id uuid not null references public.products(id),
  zone_id uuid not null references public.count_zones(id),
  created_at timestamptz not null default now(),
  unique (batch_id, source_sheet, source_row)
);

alter table public.zone_products
  add column if not exists source_import_batch_id uuid references public.count_import_batches(id),
  add column if not exists source_sheet text,
  add column if not exists source_row integer,
  add column if not exists source_quantity_column integer,
  add column if not exists source_values jsonb;

create index if not exists count_import_batches_store_idx
  on public.count_import_batches (store_id, imported_at desc);
create index if not exists count_import_rows_batch_idx
  on public.count_import_rows (batch_id, source_sheet, source_row);

alter table public.count_import_batches enable row level security;
alter table public.count_import_rows enable row level security;

create or replace function private.protect_count_import_history()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='count_import_rows' then raise exception 'COUNT_IMPORT_ROWS_ARE_IMMUTABLE'; end if;
  if tg_op='DELETE' or old.status='PUBLISHED' then raise exception 'PUBLISHED_COUNT_IMPORT_IS_IMMUTABLE'; end if;
  if new.id<>old.id or new.organization_id<>old.organization_id or new.store_id<>old.store_id
    or new.source_filename<>old.source_filename or new.source_storage_path is distinct from old.source_storage_path
    or new.imported_by<>old.imported_by or new.imported_at<>old.imported_at then
    raise exception 'COUNT_IMPORT_IDENTITY_IS_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists immutable_count_import_batches on public.count_import_batches;
create trigger immutable_count_import_batches before update or delete on public.count_import_batches
for each row execute function private.protect_count_import_history();
drop trigger if exists immutable_count_import_rows on public.count_import_rows;
create trigger immutable_count_import_rows before update or delete on public.count_import_rows
for each row execute function private.protect_count_import_history();

create policy count_import_batches_manager_select
on public.count_import_batches for select to authenticated
using (private.has_active_store_role(store_id,array['ADMIN','SUPERVISOR']::public.app_role[]));

create policy count_import_batches_manager_insert
on public.count_import_batches for insert to authenticated
with check (
  organization_id=public.current_organization_id()
  and imported_by=(select auth.uid())
  and status='DRAFT'
  and private.has_active_store_role(store_id,array['ADMIN','SUPERVISOR']::public.app_role[])
);

create policy count_import_rows_store_select
on public.count_import_rows for select to authenticated
using (private.has_active_store_role(store_id,null));

grant select,insert on public.count_import_batches to authenticated;
grant select on public.count_import_rows to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('count-imports','count-imports',false,10485760,array[
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy count_import_storage_select
on storage.objects for select to authenticated
using (
  bucket_id='count-imports' and exists(
    select 1 from public.stores s
    where s.id::text=(storage.foldername(name))[2]
      and s.organization_id::text=(storage.foldername(name))[1]
      and private.has_active_store_role(s.id,null)
  )
);

create policy count_import_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='count-imports' and exists(
    select 1 from public.stores s
    where s.id::text=(storage.foldername(name))[2]
      and s.organization_id::text=(storage.foldername(name))[1]
      and private.has_active_store_role(s.id,array['ADMIN','SUPERVISOR']::public.app_role[])
  )
);

create or replace function public.rename_pilot_zone(p_zone_id uuid,p_name text)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid := (select auth.uid()); v_org uuid; v_store uuid; v_old text;
begin
  select organization_id,store_id,name into v_org,v_store,v_old from public.count_zones
  where id=p_zone_id and is_active for update;
  if v_store is null or not private.has_active_store_role(v_store,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if btrim(coalesce(p_name,''))='' then raise exception using errcode='22023',message='ZONE_NAME_REQUIRED'; end if;
  update public.count_zones set name=btrim(p_name),updated_at=now() where id=p_zone_id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
  values(v_org,'count_zone',p_zone_id,'PILOT_ZONE_RENAMED',jsonb_build_object('name',v_old),jsonb_build_object('name',btrim(p_name)),v_user);
end;
$$;

create or replace function public.set_pilot_zone_active(p_zone_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid := (select auth.uid()); v_org uuid; v_store uuid;
begin
  select organization_id,store_id into v_org,v_store from public.count_zones where id=p_zone_id for update;
  if v_store is null or not private.has_active_store_role(v_store,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  update public.count_zones set is_active=p_active,updated_at=now() where id=p_zone_id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'count_zone',p_zone_id,'PILOT_ZONE_ACTIVE_CHANGED',jsonb_build_object('is_active',p_active),v_user);
end;
$$;

create or replace function public.reorder_pilot_zones(p_store_id uuid,p_zone_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid := (select auth.uid()); v_org uuid; v_count integer;
begin
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_org is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  select count(*) into v_count from public.count_zones where store_id=p_store_id and is_active;
  if coalesce(array_length(p_zone_ids,1),0)<>v_count or exists(
    select 1 from unnest(p_zone_ids) z(id) left join public.count_zones cz on cz.id=z.id and cz.store_id=p_store_id and cz.is_active where cz.id is null
  ) then raise exception using errcode='22023',message='INVALID_ZONE_ORDER'; end if;
  update public.count_zones z set sort_order=o.ordinality-1,updated_at=now()
  from unnest(p_zone_ids) with ordinality o(id,ordinality) where z.id=o.id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'store',p_store_id,'PILOT_ZONES_REORDERED',to_jsonb(p_zone_ids),v_user);
end;
$$;

create or replace function public.unassign_pilot_product_from_zone(p_zone_id uuid,p_product_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid := (select auth.uid()); v_org uuid; v_store uuid;
begin
  select organization_id,store_id into v_org,v_store from public.count_zones where id=p_zone_id and is_active;
  if v_store is null or not private.has_active_store_role(v_store,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  delete from public.zone_products where zone_id=p_zone_id and product_id=p_product_id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'count_zone',p_zone_id,'PRODUCT_UNASSIGNED_FROM_ZONE',jsonb_build_object('product_id',p_product_id),v_user);
end;
$$;

create or replace function public.publish_pilot_count_import(p_batch_id uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := (select auth.uid()); v_org uuid; v_store uuid; v_row jsonb;
  v_zone uuid; v_product uuid; v_sort integer; v_total integer := 0;
  v_code text; v_name text; v_unit text; v_purchase text; v_zone_name text;
begin
  select organization_id,store_id into v_org,v_store from public.count_import_batches
  where id=p_batch_id and status='DRAFT' and imported_by=v_user for update;
  if v_store is null or not private.has_active_store_role(v_store,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='COUNT_IMPORT_MANAGER_REQUIRED';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then
    raise exception using errcode='22023',message='COUNT_IMPORT_ROWS_REQUIRED';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_code:=upper(btrim(coalesce(v_row->>'productCode','')));
    v_name:=btrim(coalesce(v_row->>'productName',''));
    v_unit:=btrim(coalesce(v_row->>'unit',''));
    v_purchase:=btrim(coalesce(v_row->>'purchaseUnit',v_unit));
    v_zone_name:=btrim(coalesce(v_row->>'zoneName',''));
    if v_code='' or v_name='' or v_unit='' or v_zone_name='' or coalesce((v_row->>'sourceRow')::integer,0)<1 then
      raise exception using errcode='22023',message='COUNT_IMPORT_INVALID_ROW';
    end if;

    select id into v_zone from public.count_zones
    where store_id=v_store and lower(btrim(name))=lower(v_zone_name) and is_active limit 1;
    if v_zone is null then
      select coalesce(max(sort_order),-1)+1 into v_sort from public.count_zones where store_id=v_store;
      insert into public.count_zones(organization_id,store_id,name,sort_order)
      values(v_org,v_store,v_zone_name,v_sort) returning id into v_zone;
    end if;

    select id into v_product from public.products
    where organization_id=v_org and upper(btrim(product_code))=v_code limit 1;
    if v_product is null then
      insert into public.products(organization_id,product_code,name,category,base_unit,count_unit)
      values(v_org,v_code,v_name,'其他',coalesce(nullif(v_purchase,''),v_unit),v_unit)
      returning id into v_product;
    end if;
    insert into public.store_product_opening_balances(organization_id,store_id,product_id,quantity,unit,created_by)
    values(v_org,v_store,v_product,0,v_unit,v_user) on conflict(store_id,product_id) do nothing;

    select coalesce(max(sort_order),-1)+1 into v_sort from public.zone_products where zone_id=v_zone;
    insert into public.zone_products(zone_id,product_id,sort_order,count_unit,source_import_batch_id,source_sheet,source_row,source_quantity_column,source_values)
    values(v_zone,v_product,v_sort,v_unit,p_batch_id,coalesce(v_row->>'sheet','工作表1'),(v_row->>'sourceRow')::integer,
      coalesce((v_row->>'quantityColumn')::integer,1),coalesce(v_row->'sourceValues','[]'::jsonb))
    on conflict(zone_id,product_id) do update set count_unit=excluded.count_unit,
      source_import_batch_id=excluded.source_import_batch_id,source_sheet=excluded.source_sheet,
      source_row=excluded.source_row,source_quantity_column=excluded.source_quantity_column,source_values=excluded.source_values;

    insert into public.count_import_rows(batch_id,organization_id,store_id,source_sheet,source_row,source_values,quantity_column,
      zone_name,product_code,product_name,count_unit,product_id,zone_id)
    values(p_batch_id,v_org,v_store,coalesce(v_row->>'sheet','工作表1'),(v_row->>'sourceRow')::integer,
      coalesce(v_row->'sourceValues','[]'::jsonb),coalesce((v_row->>'quantityColumn')::integer,1),v_zone_name,v_code,v_name,v_unit,v_product,v_zone);
    v_total:=v_total+1;
  end loop;
  update public.count_import_batches set status='PUBLISHED',published_at=now() where id=p_batch_id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'count_import_batch',p_batch_id,'COUNT_IMPORT_PUBLISHED',jsonb_build_object('store_id',v_store,'row_count',v_total),v_user);
  return v_total;
end;
$$;

revoke all on function public.rename_pilot_zone(uuid,text) from public,anon;
revoke all on function public.set_pilot_zone_active(uuid,boolean) from public,anon;
revoke all on function public.reorder_pilot_zones(uuid,uuid[]) from public,anon;
revoke all on function public.unassign_pilot_product_from_zone(uuid,uuid) from public,anon;
revoke all on function public.publish_pilot_count_import(uuid,jsonb) from public,anon;
grant execute on function public.rename_pilot_zone(uuid,text) to authenticated;
grant execute on function public.set_pilot_zone_active(uuid,boolean) to authenticated;
grant execute on function public.reorder_pilot_zones(uuid,uuid[]) to authenticated;
grant execute on function public.unassign_pilot_product_from_zone(uuid,uuid) to authenticated;
grant execute on function public.publish_pilot_count_import(uuid,jsonb) to authenticated;

drop policy if exists receipt_ocr_runs_store_select on public.receipt_ocr_runs;
create policy receipt_ocr_runs_store_select on public.receipt_ocr_runs for select to authenticated
using (exists(select 1 from public.receipt_upload_batches b where b.id=batch_id
  and private.has_active_store_role(b.store_id,null)
  and (b.uploaded_by=(select auth.uid()) or private.has_active_store_role(b.store_id,array['ADMIN','SUPERVISOR']::public.app_role[]))));

drop policy if exists receipt_ocr_fields_store_select on public.receipt_ocr_fields;
create policy receipt_ocr_fields_store_select on public.receipt_ocr_fields for select to authenticated
using (exists(select 1 from public.receipt_upload_batches b where b.id=batch_id
  and private.has_active_store_role(b.store_id,null)
  and (b.uploaded_by=(select auth.uid()) or private.has_active_store_role(b.store_id,array['ADMIN','SUPERVISOR']::public.app_role[]))));

drop policy if exists receipt_corrections_store_manager_select on public.receipt_review_corrections;
create policy receipt_corrections_store_manager_select on public.receipt_review_corrections for select to authenticated
using (exists(select 1 from public.receipt_upload_batches b where b.id=batch_id
  and private.has_active_store_role(b.store_id,array['ADMIN','SUPERVISOR']::public.app_role[])));

drop policy if exists receipt_corrections_store_manager_insert on public.receipt_review_corrections;
create policy receipt_corrections_store_manager_insert on public.receipt_review_corrections for insert to authenticated
with check (modified_by=(select auth.uid()) and organization_id=public.current_organization_id()
  and exists(select 1 from public.receipt_upload_batches b where b.id=batch_id
    and private.has_active_store_role(b.store_id,array['ADMIN','SUPERVISOR']::public.app_role[]))
  and exists(select 1 from public.receipt_ocr_fields f where f.id=ocr_field_id and f.batch_id=batch_id));

notify pgrst,'reload schema';
