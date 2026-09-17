create or replace function public.exclude_product_from_active_count(p_store_id uuid,p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_session uuid;
  v_has_quantity boolean;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  if not private.can_import_inventory(p_store_id) then raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED'; end if;

  select id into v_session from public.inventory_count_sessions
  where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS')
  order by started_at desc limit 1;
  if v_session is null then return jsonb_build_object('excluded',false,'reason','NO_ACTIVE_COUNT'); end if;

  select exists(select 1 from public.count_drafts where session_id=v_session and product_id=p_product_id and quantity is not null)
  into v_has_quantity;
  if v_has_quantity then raise exception using errcode='22023',message='PRODUCT_ALREADY_COUNTED'; end if;

  delete from public.count_drafts where session_id=v_session and product_id=p_product_id;
  delete from private.count_opening_snapshots where session_id=v_session and product_id=p_product_id;

  update public.inventory_count_sessions s
  set snapshot=jsonb_set(
    s.snapshot,'{zones}',
    coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(s.snapshot->'zones','[]'::jsonb)) item where item->>'product_id'<>p_product_id::text),'[]'::jsonb),true)
  where s.id=v_session;

  delete from public.count_zone_progress zp
  where zp.session_id=v_session and not exists(
    select 1 from jsonb_array_elements((select snapshot->'zones' from public.inventory_count_sessions where id=v_session)) item
    where item->>'zone_id'=zp.zone_id::text
  );

  return jsonb_build_object('excluded',true,'session_id',v_session,'product_id',p_product_id);
end;
$$;
revoke all on function public.exclude_product_from_active_count(uuid,uuid) from public,anon;
grant execute on function public.exclude_product_from_active_count(uuid,uuid) to authenticated;
