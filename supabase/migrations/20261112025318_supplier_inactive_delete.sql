-- Suppliers are shared at organization scope. Check the same history for the
-- directory's eligibility flag and for the locked, authorized delete operation.
create function private.supplier_directory_has_history(p_supplier public.suppliers)
returns boolean language plpgsql stable set search_path='' as $$
declare
 ref record;
 used boolean;
 name_keys text[];
begin
 for ref in
  select c.conrelid,a.attname
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
  where c.contype='f' and c.confrelid='public.suppliers'::regclass
    and c.conrelid<>'private.supplier_details'::regclass
 loop
  execute format('select exists(select 1 from %s where %I=$1)',ref.conrelid::regclass,ref.attname)
   into used using p_supplier.id;
  if used then return true;end if;
 end loop;

 select array_agg(distinct private.history_key(name))
 into name_keys
 from unnest(array_prepend(p_supplier.name,private.supplier_display_aliases(p_supplier.id))) as names(name)
 where private.history_key(name)<>'';

 -- Some confirmed receipt and ingredient records identify suppliers by name.
 return exists (
  select 1 from private.receipt_account_edits e
  join public.receipt_upload_batches b on b.id=e.batch_id
  where b.organization_id=p_supplier.organization_id and private.history_key(e.header->>'supplier_name')=any(name_keys)
  union all
  select 1 from private.receipt_entry_items e
  join public.receipt_upload_batches b on b.id=e.batch_id
  where b.organization_id=p_supplier.organization_id and private.history_key(e.supplier_name)=any(name_keys)
  union all
  select 1 from private.receipt_manual_rows e
  join public.receipt_upload_batches b on b.id=e.batch_id
  where b.organization_id=p_supplier.organization_id and private.history_key(e.supplier_name)=any(name_keys)
  union all
  select 1 from private.custody_reminders r join public.stores s on s.id=r.store_id
  where s.organization_id=p_supplier.organization_id and private.history_key(r.supplier)=any(name_keys)
  union all
  select 1 from private.receipt_ingredient_bindings r join public.stores s on s.id=r.store_id
  where s.organization_id=p_supplier.organization_id and private.history_key(r.supplier)=any(name_keys)
  union all
  select 1 from private.ingredient_supply_state r join public.stores s on s.id=r.store_id
  where s.organization_id=p_supplier.organization_id and (r.supplier_key='id:'||p_supplier.id or private.history_key(r.supplier_name)=any(name_keys))
  union all
  select 1 from private.ingredient_supply_events r join public.stores s on s.id=r.store_id
  where s.organization_id=p_supplier.organization_id and (r.supplier_key='id:'||p_supplier.id or private.history_key(r.supplier_name)=any(name_keys))
  union all
  select 1 from private.recipe_price_entries r join public.stores s on s.id=r.store_id
  where s.organization_id=p_supplier.organization_id
    and (r.source_ref->>'supplier_id'=p_supplier.id::text or private.history_key(r.source_ref->>'supplier_name')=any(name_keys))
  union all
  select 1 from private.ingredient_standard_versions r join public.stores s on s.id=r.store_id
  where s.organization_id=p_supplier.organization_id
    and ('id:'||p_supplier.id in (r.supplier_key,r.previous_supplier_key) or private.history_key(r.supplier_name)=any(name_keys))
 );
end $$;
revoke all on function private.supplier_directory_has_history(public.suppliers) from public,anon,authenticated;

do $migration$
declare
 definition text;
 anchor text;
begin
 definition:=pg_get_functiondef('private.directory_lifecycle(uuid,jsonb,uuid)'::regprocedure);
 anchor:=$old$(act in ('restore','delete') and not removed)$old$;
 if strpos(definition,anchor)=0 then raise exception 'Supplier lifecycle state check missing';end if;
 definition:=replace(definition,anchor,$new$(act='restore' and not removed)
 or (act='delete' and not removed and (kind<>'supplier' or not inactive))$new$);

 anchor:=$old$  -- Every foreign-key dependency blocks deletion, including future relations.
  for ref in select c.conrelid,a.attname from pg_catalog.pg_constraint c join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
   where c.contype='f' and c.confrelid=case when kind='supplier' then 'public.suppliers'::regclass else 'private.administrative_documents'::regclass end
   and c.conrelid<>'private.supplier_details'::regclass loop$old$;
 if strpos(definition,anchor)=0 then raise exception 'Supplier lifecycle history check missing';end if;
 definition:=replace(definition,anchor,$new$  if kind='supplier' and private.supplier_directory_has_history(s) then
   raise exception 'DIRECTORY_HAS_HISTORY' using errcode='23503';
  end if;
  -- Every foreign-key dependency blocks administrative document deletion.
  for ref in select c.conrelid,a.attname from pg_catalog.pg_constraint c join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
   where kind<>'supplier' and c.contype='f' and c.confrelid='private.administrative_documents'::regclass loop$new$);
 execute definition;

 definition:=pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure);
 anchor:=$old$'aliases',private.supplier_display_aliases(s.id),$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'Supplier workspace history field anchor missing or ambiguous';
 end if;
 definition:=replace(definition,anchor,anchor||$new$
    'can_delete',case when p_filter->'include_delete_eligibility'='true'::jsonb
      and not s.is_active and private.office_data_access(p_store)
      and private.has_data_access(p_store,'SUPPLIERS',true)
      then not private.supplier_directory_has_history(s) else false end,$new$);
 execute definition;
end;
$migration$;
