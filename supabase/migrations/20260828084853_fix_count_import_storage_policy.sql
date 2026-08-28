create or replace function private.can_access_count_import_object(
  p_object_name text,
  p_roles public.app_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.stores s
    where s.id::text = (storage.foldername(p_object_name))[2]
      and s.organization_id::text = (storage.foldername(p_object_name))[1]
      and private.has_active_store_role(s.id, p_roles)
  );
$$;

revoke all on function private.can_access_count_import_object(text,public.app_role[]) from public;
grant execute on function private.can_access_count_import_object(text,public.app_role[]) to authenticated;

drop policy if exists count_import_storage_select on storage.objects;
create policy count_import_storage_select
on storage.objects for select to authenticated
using (
  bucket_id='count-imports'
  and private.can_access_count_import_object(name, null)
);

drop policy if exists count_import_storage_insert on storage.objects;
create policy count_import_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='count-imports'
  and private.can_access_count_import_object(
    name,
    array['ADMIN','SUPERVISOR']::public.app_role[]
  )
);
