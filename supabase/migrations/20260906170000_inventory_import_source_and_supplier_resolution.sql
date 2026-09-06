-- Inventory import v6: retain source evidence, resolve suppliers safely, and never
-- invent an opening balance from an empty or semantically ambiguous source cell.

create table public.inventory_import_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null,
  original_filename text not null,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null,
  sheet_names jsonb not null default '[]'::jsonb,
  row_count integer not null default 0,
  added_count integer not null default 0,
  existing_count integer not null default 0,
  failed_count integer not null default 0,
  imported_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  last_imported_at timestamptz not null default now(),
  foreign key (store_id, organization_id) references public.stores(id, organization_id),
  unique (store_id, file_sha256)
);

create table public.inventory_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_file_id uuid not null references public.inventory_import_files(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null,
  source_id text not null,
  sheet_name text not null,
  source_row integer not null,
  raw_values jsonb not null default '{}'::jsonb,
  merged_ranges jsonb not null default '[]'::jsonb,
  normalized_values jsonb not null default '{}'::jsonb,
  status text not null check (status in ('ADDED','EXISTING','PENDING','FAILED','SKIPPED')),
  reason text not null,
  product_id uuid references public.products(id),
  supplier_id uuid references public.suppliers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (store_id, organization_id) references public.stores(id, organization_id),
  unique (import_file_id, source_id)
);

create index inventory_import_files_store_created_idx
  on public.inventory_import_files(store_id, created_at desc);
create index inventory_import_rows_file_order_idx
  on public.inventory_import_rows(import_file_id, sheet_name, source_row);

alter table public.inventory_import_files enable row level security;
alter table public.inventory_import_rows enable row level security;

create policy inventory_import_files_store_manager_select
on public.inventory_import_files for select to authenticated
using (private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[]));

create policy inventory_import_rows_store_manager_select
on public.inventory_import_rows for select to authenticated
using (private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[]));

grant select on public.inventory_import_files, public.inventory_import_rows to authenticated;
revoke insert, update, delete on public.inventory_import_files, public.inventory_import_rows from anon, authenticated;

insert into storage.buckets(id, name, public)
values ('inventory-imports', 'inventory-imports', false)
on conflict (id) do update set public = false;

create or replace function private.inventory_import_storage_store_id(p_name text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  return (storage.foldername(p_name))[2]::uuid;
exception when others then
  return null;
end;
$$;

revoke all on function private.inventory_import_storage_store_id(text) from public, anon;
grant execute on function private.inventory_import_storage_store_id(text) to authenticated;

create policy inventory_import_storage_manager_read
on storage.objects for select to authenticated
using (
  bucket_id = 'inventory-imports'
  and private.has_active_store_role(
    private.inventory_import_storage_store_id(name),
    array['ADMIN','SUPERVISOR']::public.app_role[]
  )
);

create policy inventory_import_storage_manager_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'inventory-imports'
  and private.has_active_store_role(
    private.inventory_import_storage_store_id(name),
    array['ADMIN','SUPERVISOR']::public.app_role[]
  )
);

create or replace function public.import_pilot_inventory(
  p_store_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_rows jsonb;
  v_file jsonb;
  v_import_file_id uuid;
  v_row jsonb;
  v_ordinal bigint;
  v_results jsonb := '[]'::jsonb;
  v_source_id text;
  v_sheet_name text;
  v_source_row integer;
  v_product_code text;
  v_generated_code boolean;
  v_name text;
  v_specification text;
  v_count_unit text;
  v_supplier_name text;
  v_zone_name text;
  v_opening_quantity numeric;
  v_missing_fields jsonb;
  v_raw_values jsonb;
  v_merged_ranges jsonb;
  v_product_id uuid;
  v_zone_id uuid;
  v_supplier_id uuid;
  v_existing_supplier_id uuid;
  v_supplier_matches integer;
  v_existing_name text;
  v_matched_by text;
  v_status text;
  v_reason text;
  v_warning text;
  v_sort integer;
  v_added_count integer := 0;
  v_existing_count integer := 0;
  v_failed_count integer := 0;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select organization_id into v_org
  from public.stores
  where id = p_store_id and is_active;

  if v_org is null
    or not private.has_active_store_role(p_store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
  then
    raise exception using errcode = '42501', message = 'STORE_MANAGER_REQUIRED';
  end if;

  if jsonb_typeof(p_rows) = 'array' then
    v_rows := p_rows;
    v_file := null;
  elsif jsonb_typeof(p_rows) = 'object' then
    v_rows := p_rows->'rows';
    v_file := p_rows->'file';
  else
    raise exception using errcode = '22023', message = 'IMPORT_PAYLOAD_INVALID';
  end if;

  if jsonb_typeof(v_rows) <> 'array'
    or jsonb_array_length(v_rows) = 0
    or jsonb_array_length(v_rows) > 500
  then
    raise exception using errcode = '22023', message = 'IMPORT_REQUIRES_1_TO_500_ROWS';
  end if;

  if v_file is not null then
    if coalesce(v_file->>'original_filename', '') = ''
      or coalesce(v_file->>'file_sha256', '') !~ '^[0-9a-f]{64}$'
      or coalesce(v_file->>'storage_path', '') = ''
    then
      raise exception using errcode = '22023', message = 'IMPORT_FILE_METADATA_INVALID';
    end if;

    insert into public.inventory_import_files(
      organization_id, store_id, original_filename, file_sha256, storage_path,
      sheet_names, row_count, imported_by
    ) values (
      v_org, p_store_id, v_file->>'original_filename', v_file->>'file_sha256',
      v_file->>'storage_path', coalesce(v_file->'sheet_names', '[]'::jsonb),
      jsonb_array_length(v_rows), v_user
    )
    on conflict (store_id, file_sha256) do update set
      last_imported_at = now(),
      row_count = excluded.row_count
    returning id into v_import_file_id;
  end if;

  for v_row, v_ordinal in
    select value, ordinality from jsonb_array_elements(v_rows) with ordinality
  loop
    begin
      v_source_id := coalesce(nullif(btrim(v_row->>'source_id'), ''), v_ordinal::text);
      v_sheet_name := coalesce(nullif(btrim(v_row->>'sheet_name'), ''), 'Sheet');
      v_source_row := coalesce(nullif(v_row->>'source_row', '')::integer, v_ordinal::integer);
      v_product_code := upper(nullif(btrim(v_row->>'product_code'), ''));
      v_generated_code := coalesce((v_row->>'generated_code')::boolean, false);
      v_name := nullif(btrim(v_row->>'name'), '');
      v_specification := coalesce(btrim(v_row->>'specification'), '');
      v_count_unit := coalesce(nullif(btrim(v_row->>'count_unit'), ''), '待補單位');
      v_supplier_name := nullif(btrim(v_row->>'supplier_name'), '');
      v_zone_name := coalesce(nullif(btrim(v_row->>'zone_name'), ''), '未分類');
      v_opening_quantity := nullif(v_row->>'opening_quantity', '')::numeric;
      v_missing_fields := case when jsonb_typeof(v_row->'missing_fields') = 'array' then v_row->'missing_fields' else '[]'::jsonb end;
      v_raw_values := case when jsonb_typeof(v_row->'raw_values') = 'object' then v_row->'raw_values' else '{}'::jsonb end;
      v_merged_ranges := case when jsonb_typeof(v_row->'merged_ranges') = 'array' then v_row->'merged_ranges' else '[]'::jsonb end;
      v_product_id := null;
      v_supplier_id := null;
      v_existing_supplier_id := null;
      v_warning := null;
      v_status := 'ADDED';

      if v_name is null then
        raise exception using errcode = '22023', message = 'PRODUCT_NAME_REQUIRED';
      end if;
      if v_opening_quantity is not null and v_opening_quantity < 0 then
        raise exception using errcode = '22023', message = 'OPENING_QUANTITY_MUST_BE_NON_NEGATIVE';
      end if;
      if v_product_code is null then
        v_product_code := 'SEQ-' || upper(substr(md5(lower(v_name || '|' || v_specification || '|' || v_count_unit)), 1, 16));
        v_generated_code := true;
      end if;

      if v_supplier_name is not null then
        select (array_agg(id order by created_at, id))[1], count(*)::integer
        into v_supplier_id, v_supplier_matches
        from public.suppliers
        where organization_id = v_org and is_active
          and regexp_replace(lower(name), '\s+', '', 'g') = regexp_replace(lower(v_supplier_name), '\s+', '', 'g');

        if v_supplier_matches = 0 then
          insert into public.suppliers(organization_id, supplier_code, name)
          values (v_org, 'IMP-' || upper(substr(md5(v_org::text || lower(v_supplier_name)), 1, 12)), v_supplier_name)
          on conflict (organization_id, supplier_code) do nothing
          returning id into v_supplier_id;
          if v_supplier_id is null then
            select id into v_supplier_id from public.suppliers
            where organization_id = v_org
              and supplier_code = 'IMP-' || upper(substr(md5(v_org::text || lower(v_supplier_name)), 1, 12));
          end if;
        elsif v_supplier_matches > 1 then
          v_supplier_id := null;
          v_warning := '供應商名稱有多筆相符，保留來源並待主管確認';
        end if;
      end if;

      select id, name, current_supplier_id
      into v_product_id, v_existing_name, v_existing_supplier_id
      from public.products
      where organization_id = v_org and upper(product_code) = v_product_code
      limit 1;

      if v_product_id is not null then
        if regexp_replace(lower(v_existing_name), '\s+', '', 'g') <> regexp_replace(lower(v_name), '\s+', '', 'g') then
          raise exception using errcode = '23505', message = 'PRODUCT_CODE_ALREADY_USED_BY_ANOTHER_ITEM';
        end if;
        v_status := 'EXISTING';
        v_matched_by := 'product_code';
      else
        select id, name, current_supplier_id
        into v_product_id, v_existing_name, v_existing_supplier_id
        from public.products
        where organization_id = v_org
          and regexp_replace(lower(name), '\s+', '', 'g') = regexp_replace(lower(v_name), '\s+', '', 'g')
          and regexp_replace(lower(coalesce(specification, '')), '\s+', '', 'g') = regexp_replace(lower(v_specification), '\s+', '', 'g')
          and regexp_replace(lower(coalesce(count_unit, '')), '\s+', '', 'g') = regexp_replace(lower(v_count_unit), '\s+', '', 'g')
        order by created_at limit 1;

        if v_product_id is not null then
          v_status := 'EXISTING';
          v_matched_by := 'name_specification_unit';
        else
          insert into public.products(
            organization_id, product_code, name, specification, category, base_unit, count_unit, current_supplier_id
          ) values (
            v_org, v_product_code, v_name, v_specification, '其他', v_count_unit, v_count_unit, v_supplier_id
          ) returning id, current_supplier_id into v_product_id, v_existing_supplier_id;
        end if;
      end if;

      if v_supplier_id is not null then
        if v_existing_supplier_id is not null and v_existing_supplier_id <> v_supplier_id then
          v_warning := concat_ws('；', v_warning, '既有品項已連結其他供應商，未覆寫並待主管確認');
          v_supplier_id := v_existing_supplier_id;
        elsif v_existing_supplier_id is null then
          update public.products set current_supplier_id = v_supplier_id, updated_at = now()
          where id = v_product_id and organization_id = v_org;
        end if;
        insert into public.product_supplier_history(organization_id, product_id, supplier_id, effective_from, is_current)
        select v_org, v_product_id, v_supplier_id, current_date, true
        where not exists (
          select 1 from public.product_supplier_history
          where organization_id = v_org and product_id = v_product_id and supplier_id = v_supplier_id and is_current
        );
      end if;

      select id into v_zone_id from public.count_zones
      where organization_id = v_org and store_id = p_store_id and is_active
        and regexp_replace(lower(name), '\s+', '', 'g') = regexp_replace(lower(v_zone_name), '\s+', '', 'g')
      order by created_at limit 1;
      if v_zone_id is null then
        select coalesce(max(sort_order), -1) + 1 into v_sort from public.count_zones where store_id = p_store_id;
        insert into public.count_zones(organization_id, store_id, name, sort_order)
        values (v_org, p_store_id, v_zone_name, v_sort) returning id into v_zone_id;
      end if;

      if v_opening_quantity is not null then
        insert into public.store_product_opening_balances(
          organization_id, store_id, product_id, quantity, unit, source, created_by
        ) values (v_org, p_store_id, v_product_id, v_opening_quantity, v_count_unit, 'FILE_IMPORT', v_user)
        on conflict (store_id, product_id) do nothing;
      end if;

      select coalesce(max(sort_order), -1) + 1 into v_sort from public.zone_products where zone_id = v_zone_id;
      insert into public.zone_products(zone_id, product_id, sort_order, count_unit)
      values (v_zone_id, v_product_id, v_sort, v_count_unit)
      on conflict (zone_id, product_id) do nothing;

      v_reason := case
        when v_status = 'ADDED' then '品項與盤點區域已建立'
        when v_matched_by = 'product_code' then '既有品項：品項代碼相同'
        else '既有品項：品名、規格與單位相同'
      end;
      if v_opening_quantity is null then v_warning := concat_ws('；', v_warning, '未提供明確期初數量，未建立期初餘額'); end if;
      if v_warning is not null then v_reason := v_reason || '；' || v_warning; end if;

      if v_import_file_id is not null then
        insert into public.inventory_import_rows(
          import_file_id, organization_id, store_id, source_id, sheet_name, source_row,
          raw_values, merged_ranges, normalized_values, status, reason, product_id, supplier_id
        ) values (
          v_import_file_id, v_org, p_store_id, v_source_id, v_sheet_name, v_source_row,
          v_raw_values, v_merged_ranges,
          jsonb_build_object('name',v_name,'specification',v_specification,'unit',v_count_unit,'supplier',v_supplier_name,'zone',v_zone_name,'product_code',v_product_code,'opening_quantity',v_opening_quantity),
          case when v_warning is null then v_status else 'PENDING' end, v_reason, v_product_id, v_supplier_id
        ) on conflict (import_file_id, source_id) do update set
          raw_values = excluded.raw_values, merged_ranges = excluded.merged_ranges,
          normalized_values = excluded.normalized_values, status = excluded.status,
          reason = excluded.reason, product_id = excluded.product_id, supplier_id = excluded.supplier_id,
          updated_at = now();
      end if;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_id',v_source_id,'sheet_name',v_sheet_name,'source_row',v_source_row,
        'name',v_name,'product_code',v_product_code,'product_id',v_product_id,
        'supplier_name',v_supplier_name,'supplier_id',v_supplier_id,'status',v_status,
        'matched_by',v_matched_by,'missing_fields',v_missing_fields,'reason',v_reason
      ));
      if v_status = 'ADDED' then v_added_count := v_added_count + 1;
      else v_existing_count := v_existing_count + 1; end if;
    exception when others then
      v_failed_count := v_failed_count + 1;
      v_reason := sqlerrm;
      if v_import_file_id is not null then
        insert into public.inventory_import_rows(
          import_file_id, organization_id, store_id, source_id, sheet_name, source_row,
          raw_values, merged_ranges, normalized_values, status, reason
        ) values (
          v_import_file_id, v_org, p_store_id, coalesce(v_source_id,v_ordinal::text),
          coalesce(v_sheet_name,'Sheet'), coalesce(v_source_row,v_ordinal::integer),
          coalesce(v_raw_values,'{}'::jsonb), coalesce(v_merged_ranges,'[]'::jsonb),
          coalesce(v_row,'{}'::jsonb), 'FAILED', v_reason
        ) on conflict (import_file_id, source_id) do update set
          raw_values = excluded.raw_values, merged_ranges = excluded.merged_ranges,
          normalized_values = excluded.normalized_values, status = 'FAILED',
          reason = excluded.reason, updated_at = now();
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_id',coalesce(v_source_id,v_ordinal::text),'sheet_name',coalesce(v_sheet_name,'Sheet'),
        'source_row',coalesce(v_source_row,v_ordinal::integer),'name',v_name,
        'supplier_name',v_supplier_name,'status','FAILED','sqlstate',sqlstate,'reason',v_reason
      ));
    end;
  end loop;

  if v_import_file_id is not null then
    update public.inventory_import_files set
      added_count = v_added_count, existing_count = v_existing_count,
      failed_count = v_failed_count, last_imported_at = now()
    where id = v_import_file_id;
  end if;

  insert into public.audit_logs(organization_id, entity_type, entity_id, action, new_value, user_id)
  values (v_org, 'store', p_store_id, 'PILOT_INVENTORY_IMPORT_COMPLETED',
    jsonb_build_object('import_file_id',v_import_file_id,'submitted_rows',jsonb_array_length(v_rows),
      'added',v_added_count,'existing',v_existing_count,'failed',v_failed_count), v_user);
  return v_results;
end;
$$;

revoke all on function public.import_pilot_inventory(uuid, jsonb) from public, anon;
grant execute on function public.import_pilot_inventory(uuid, jsonb) to authenticated;

create or replace function public.get_app_schema_version()
returns text language sql stable security invoker set search_path = ''
as $$ select '20260906_merchant_beta_v6'::text $$;

revoke all on function public.get_app_schema_version() from public;
grant execute on function public.get_app_schema_version() to anon, authenticated;

comment on table public.inventory_import_files is 'Private evidence for each store inventory import; duplicate file hashes are idempotent per store.';
comment on table public.inventory_import_rows is 'Manager-visible source row evidence with raw and normalized values; never exposed to frontline staff.';
comment on function public.import_pilot_inventory(uuid, jsonb) is 'Idempotently imports store products, resolves suppliers, retains source evidence, and never invents missing opening balances.';

notify pgrst, 'reload schema';
