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
  v_product_id uuid;
  v_zone_id uuid;
  v_supplier_id uuid;
  v_existing_supplier_id uuid;
  v_supplier_matches integer;
  v_existing_name text;
  v_existing_specification text;
  v_existing_unit text;
  v_matched_by text;
  v_status text;
  v_sort integer;
  v_added_count integer := 0;
  v_existing_count integer := 0;
  v_failed_count integer := 0;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select organization_id
  into v_org
  from public.stores
  where id = p_store_id and is_active;

  if v_org is null
    or not private.has_active_store_role(p_store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
  then
    raise exception using errcode = '42501', message = 'STORE_MANAGER_REQUIRED';
  end if;

  if jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 500
  then
    raise exception using errcode = '22023', message = 'IMPORT_REQUIRES_1_TO_500_ROWS';
  end if;

  for v_row, v_ordinal in
    select value, ordinality
    from jsonb_array_elements(p_rows) with ordinality
  loop
    begin
      v_source_id := null;
      v_sheet_name := null;
      v_source_row := null;
      v_name := null;
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
      v_opening_quantity := coalesce(nullif(v_row->>'opening_quantity', '')::numeric, 0);
      v_missing_fields := case
        when jsonb_typeof(v_row->'missing_fields') = 'array' then v_row->'missing_fields'
        else '[]'::jsonb
      end;
      v_product_id := null;
      v_zone_id := null;
      v_supplier_id := null;
      v_existing_supplier_id := null;
      v_supplier_matches := 0;
      v_existing_name := null;
      v_existing_specification := null;
      v_existing_unit := null;
      v_matched_by := null;
      v_status := 'ADDED';

      if v_name is null then
        raise exception using errcode = '22023', message = 'PRODUCT_NAME_REQUIRED';
      end if;
      if v_opening_quantity < 0 then
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
        where organization_id = v_org
          and is_active
          and regexp_replace(lower(name), '\s+', '', 'g') = regexp_replace(lower(v_supplier_name), '\s+', '', 'g');

        if v_supplier_matches = 0 then
          raise exception using errcode = '22023', message = 'SUPPLIER_NOT_FOUND';
        elsif v_supplier_matches > 1 then
          raise exception using errcode = '22023', message = 'SUPPLIER_NAME_AMBIGUOUS';
        end if;
      end if;

      select id, name, coalesce(specification, ''), coalesce(count_unit, ''), current_supplier_id
      into v_product_id, v_existing_name, v_existing_specification, v_existing_unit, v_existing_supplier_id
      from public.products
      where organization_id = v_org
        and upper(product_code) = v_product_code
      limit 1;

      if v_product_id is not null then
        if regexp_replace(lower(v_existing_name), '\s+', '', 'g')
             <> regexp_replace(lower(v_name), '\s+', '', 'g')
        then
          raise exception using errcode = '23505', message = 'PRODUCT_CODE_ALREADY_USED_BY_ANOTHER_ITEM';
        end if;
        v_status := 'EXISTING';
        v_matched_by := 'product_code';
      else
        select id, name, coalesce(specification, ''), coalesce(count_unit, ''), current_supplier_id
        into v_product_id, v_existing_name, v_existing_specification, v_existing_unit, v_existing_supplier_id
        from public.products
        where organization_id = v_org
          and regexp_replace(lower(name), '\s+', '', 'g') = regexp_replace(lower(v_name), '\s+', '', 'g')
          and regexp_replace(lower(coalesce(specification, '')), '\s+', '', 'g') = regexp_replace(lower(v_specification), '\s+', '', 'g')
          and regexp_replace(lower(coalesce(count_unit, '')), '\s+', '', 'g') = regexp_replace(lower(v_count_unit), '\s+', '', 'g')
        order by created_at
        limit 1;

        if v_product_id is not null then
          v_status := 'EXISTING';
          v_matched_by := 'name_specification_unit';
        else
          insert into public.products(
            organization_id, product_code, name, specification, category, base_unit, count_unit, current_supplier_id
          ) values (
            v_org, v_product_code, v_name, v_specification, '其他', v_count_unit, v_count_unit, v_supplier_id
          )
          returning id, current_supplier_id into v_product_id, v_existing_supplier_id;

          insert into public.audit_logs(organization_id, entity_type, entity_id, action, new_value, user_id)
          values (
            v_org,
            'product',
            v_product_id,
            'PILOT_PRODUCT_IMPORTED',
            jsonb_build_object(
              'store_id', p_store_id,
              'source_id', v_source_id,
              'product_code', v_product_code,
              'opening_quantity', v_opening_quantity,
              'supplier_id', v_supplier_id
            ),
            v_user
          );
        end if;
      end if;

      if v_supplier_id is not null then
        if v_existing_supplier_id is not null and v_existing_supplier_id <> v_supplier_id then
          raise exception using errcode = '23505', message = 'PRODUCT_ALREADY_LINKED_TO_DIFFERENT_SUPPLIER';
        end if;

        if v_existing_supplier_id is null then
          update public.products
          set current_supplier_id = v_supplier_id,
              updated_at = now()
          where id = v_product_id and organization_id = v_org;
        end if;

        insert into public.product_supplier_history(
          organization_id, product_id, supplier_id, effective_from, is_current
        )
        select v_org, v_product_id, v_supplier_id, current_date, true
        where not exists (
          select 1
          from public.product_supplier_history
          where organization_id = v_org
            and product_id = v_product_id
            and supplier_id = v_supplier_id
            and is_current
        );
      end if;

      select id
      into v_zone_id
      from public.count_zones
      where organization_id = v_org
        and store_id = p_store_id
        and is_active
        and regexp_replace(lower(name), '\s+', '', 'g') = regexp_replace(lower(v_zone_name), '\s+', '', 'g')
      order by created_at
      limit 1;

      if v_zone_id is null then
        select coalesce(max(sort_order), -1) + 1
        into v_sort
        from public.count_zones
        where store_id = p_store_id;

        insert into public.count_zones(organization_id, store_id, name, sort_order)
        values (v_org, p_store_id, v_zone_name, v_sort)
        returning id into v_zone_id;
      end if;

      insert into public.store_product_opening_balances(
        organization_id, store_id, product_id, quantity, unit, source, created_by
      ) values (
        v_org, p_store_id, v_product_id, v_opening_quantity, v_count_unit, 'FILE_IMPORT', v_user
      )
      on conflict (store_id, product_id) do nothing;

      select coalesce(max(sort_order), -1) + 1
      into v_sort
      from public.zone_products
      where zone_id = v_zone_id;

      insert into public.zone_products(zone_id, product_id, sort_order, count_unit)
      values (v_zone_id, v_product_id, v_sort, v_count_unit)
      on conflict (zone_id, product_id) do nothing;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_id', v_source_id,
        'sheet_name', v_sheet_name,
        'source_row', v_source_row,
        'name', v_name,
        'product_code', v_product_code,
        'product_id', v_product_id,
        'supplier_name', v_supplier_name,
        'supplier_id', v_supplier_id,
        'status', v_status,
        'matched_by', v_matched_by,
        'missing_fields', v_missing_fields,
        'reason', case
          when v_status = 'ADDED' then '品項、期初數量及盤點區域已建立'
          when v_matched_by = 'product_code' then '既有品項：品項代碼相同'
          else '既有品項：品名、規格與單位相同'
        end
      ));
      if v_status = 'ADDED' then
        v_added_count := v_added_count + 1;
      else
        v_existing_count := v_existing_count + 1;
      end if;
    exception when others then
      v_failed_count := v_failed_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_id', coalesce(v_source_id, v_ordinal::text),
        'sheet_name', coalesce(v_sheet_name, 'Sheet'),
        'source_row', coalesce(v_source_row, v_ordinal::integer),
        'name', v_name,
        'supplier_name', v_supplier_name,
        'status', 'FAILED',
        'sqlstate', sqlstate,
        'reason', sqlerrm
      ));
    end;
  end loop;

  insert into public.audit_logs(organization_id, entity_type, entity_id, action, new_value, user_id)
  values (
    v_org,
    'store',
    p_store_id,
    'PILOT_INVENTORY_IMPORT_COMPLETED',
    jsonb_build_object(
      'submitted_rows', jsonb_array_length(p_rows),
      'added', v_added_count,
      'existing', v_existing_count,
      'failed', v_failed_count
    ),
    v_user
  );

  return v_results;
end;
$$;

revoke all on function public.import_pilot_inventory(uuid, jsonb) from public, anon;
grant execute on function public.import_pilot_inventory(uuid, jsonb) to authenticated;

comment on function public.import_pilot_inventory(uuid, jsonb) is
  'Idempotently imports parsed inventory rows, optionally links an unambiguous existing supplier, and returns one result per source row.';

create or replace function public.get_app_schema_version()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select '20260905_merchant_beta_v5'::text;
$$;

revoke all on function public.get_app_schema_version() from public;
grant execute on function public.get_app_schema_version() to anon, authenticated;
