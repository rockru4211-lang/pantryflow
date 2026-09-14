-- Store original rows before building products; retries cannot replace source bytes.
create function private.inventory_import_review(s uuid,f jsonb,rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid;file_id uuid;r jsonb;begin
 if not private.app_session_valid(s) or not private.can_import_inventory(s) then raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501';end if;
 select organization_id into org from public.stores where id=s and is_active;
 if f->>'file_sha256' !~ '^[0-9a-f]{64}$' or f->>'storage_path' not like org::text||'/'||s::text||'/%' or jsonb_typeof(rows)<>'array' or jsonb_array_length(rows)>5000 then raise exception 'IMPORT_PAYLOAD_INVALID';end if;
 insert into public.inventory_import_files(organization_id,store_id,original_filename,file_sha256,storage_path,sheet_names,row_count,imported_by)
 values(org,s,f->>'original_filename',f->>'file_sha256',f->>'storage_path',f->'sheet_names',jsonb_array_length(rows),auth.uid())
 on conflict(store_id,file_sha256) do update set last_imported_at=now(),sheet_names=case when inventory_import_files.sheet_names='[]'::jsonb then excluded.sheet_names else inventory_import_files.sheet_names end,row_count=greatest(inventory_import_files.row_count,excluded.row_count) returning id into file_id;
 for r in select value from jsonb_array_elements(rows) loop
  insert into public.inventory_import_rows(import_file_id,organization_id,store_id,source_id,sheet_name,source_row,raw_values,merged_ranges,normalized_values,status,reason)
  values(file_id,org,s,r->>'source_id',r->>'sheet_name',(r->>'source_row')::integer,coalesce(r->'raw_values','{}'),coalesce(r->'merged_ranges','[]'),coalesce(r->'normalized_values','{}'),case when r->>'status'='SKIPPED' then 'SKIPPED' else 'PENDING' end,coalesce(r->>'reason','等待確認建立'))
  on conflict(import_file_id,source_id) do update set normalized_values=excluded.normalized_values,status=excluded.status,reason=excluded.reason,updated_at=now() where inventory_import_rows.product_id is null;
 end loop;
 return jsonb_build_object('id',file_id);
end $$;
create function public.save_inventory_import_review(p_store_id uuid,p_file jsonb,p_rows jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.inventory_import_review(p_store_id,p_file,p_rows)$$;
revoke all on function private.inventory_import_review(uuid,jsonb,jsonb),public.save_inventory_import_review(uuid,jsonb,jsonb) from public,anon;
grant execute on function private.inventory_import_review(uuid,jsonb,jsonb),public.save_inventory_import_review(uuid,jsonb,jsonb) to authenticated;

do $$ declare src text;begin
 select pg_get_functiondef('public.import_pilot_inventory(uuid,jsonb)'::regprocedure) into src;
 src:=replace(src,'  for v_row, v_ordinal in','  perform pg_advisory_xact_lock(hashtextextended(''import:''||p_store_id::text,0));'||chr(10)||'  for v_row, v_ordinal in');
 src:=replace(src,'      if v_name is null then',$patch$
      if v_import_file_id is not null then
        select product_id into v_product_id from public.inventory_import_rows where import_file_id=v_import_file_id and source_id=v_source_id and product_id is not null;
        if v_product_id is not null then
          v_results:=v_results||jsonb_build_array(jsonb_build_object('source_id',v_source_id,'sheet_name',v_sheet_name,'source_row',v_source_row,'name',v_name,'product_id',v_product_id,'status','EXISTING','reason','此來源列已建檔，保留既有品項與歷史'));
          v_existing_count:=v_existing_count+1;continue;
        end if;
      end if;
      if v_name is null then$patch$);
 src:=replace(src,$needle$      if v_opening_quantity is not null and v_opening_quantity < 0 then$needle$,$patch$
      if v_count_unit in ('','待補單位') or v_count_unit is null then raise exception using errcode='22023',message='UNIT_CONFIRMATION_REQUIRED';end if;
      if v_opening_quantity is not null and v_opening_quantity < 0 then$patch$);
 src:=replace(src,'raw_values = excluded.raw_values, merged_ranges = excluded.merged_ranges,','raw_values = inventory_import_rows.raw_values, merged_ranges = inventory_import_rows.merged_ranges,');
 src:=replace(src,$needle$if v_opening_quantity is null then v_warning := concat_ws('；', v_warning, '未提供明確期初數量，未建立期初餘額'); end if;$needle$,$patch$if v_opening_quantity is null then v_reason:=v_reason||'；期初未提供';end if;
      if not (select is_active from public.products where id=v_product_id) then v_reason:=v_reason||'；既有停用品項，維持停用';end if;$patch$);
 execute src;
end $$;
-- Extend only accepted MIME types; existing source access policies stay unchanged.
update storage.buckets set allowed_mime_types=case when allowed_mime_types is null then null else array(select distinct unnest(allowed_mime_types||array['application/pdf'])) end where id='inventory-imports';
