create function private.can_import_inventory(p_store uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.app_role(p_store) in ('OWNER','SUPERVISOR') or
 (private.app_role(p_store)='LOGISTICS' and exists(select 1 from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store and o.business_type='SINGLE_RESTAURANT')),false)
$$;
revoke all on function private.can_import_inventory(uuid) from public,anon;
grant execute on function private.can_import_inventory(uuid) to authenticated;
alter policy inventory_import_storage_manager_insert on storage.objects with check (
 bucket_id='inventory-imports' and private.can_import_inventory(private.inventory_import_storage_store_id(name))
);
do $migration$
declare source text;next text;
begin
 select pg_get_functiondef('public.import_pilot_inventory(uuid,jsonb)'::regprocedure) into source;
 next:=replace(source,'private.has_active_store_role(p_store_id, array[''ADMIN'',''SUPERVISOR'']::public.app_role[])','private.can_import_inventory(p_store_id)');
 if source=next then raise exception 'Import source mismatch';end if;execute next;
 select pg_get_functiondef('private.app_member_workspace(uuid)'::regprocedure) into source;
 next:=replace(source,'u.email not like ''%@staff.pantryflow.local'' and u.email not like ''%@staff.pantryflow.internal''','u.email not like ''%@auth.pantryflow.invalid''');execute next;
 select pg_get_functiondef('public.reset_staff_activation(uuid,text,uuid,uuid)'::regprocedure) into source;
 next:=replace(source,' delete from private.staff_pin_credentials where user_id=p_user_id;',
 ' if not exists(select 1 from private.staff_pin_credentials where user_id=p_user_id) and not exists(select 1 from private.staff_activation_tokens where user_id=p_user_id) then raise exception ''PIN_ACCOUNT_REQUIRED'';end if;'||chr(10)||' delete from private.staff_pin_credentials where user_id=p_user_id;');
 if source=next then raise exception 'PIN activation source mismatch';end if;execute next;
 select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into source;
 next:=replace(source,'v_kind:=p_data->>''kind'';',
 'v_kind:=p_data->>''kind''; if v_kind=''bulletin'' and p_data ? ''audience'' and (jsonb_typeof(p_data->''audience'')<>''array'' or jsonb_array_length(p_data->''audience'')=0 or exists(select 1 from jsonb_array_elements_text(p_data->''audience'') a where a not in (''STAFF'',''SUPERVISOR'',''LOGISTICS'',''OWNER''))) then raise exception ''INVALID_AUDIENCE'' using errcode=''22023'';end if;');execute next;
end $migration$;
notify pgrst,'reload schema';
