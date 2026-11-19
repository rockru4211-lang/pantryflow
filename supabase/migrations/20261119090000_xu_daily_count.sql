-- Later store-role migrations replace the count builder and introduce delegated
-- inventory permissions. Rebind the existing daily count to those permissions.
create or replace function private.xu_count_access(p_store uuid) returns boolean
language sql stable set search_path='' as $$ select private.can_count_inline(p_store); $$;
create or replace function private.xu_order_review_access(p_store uuid) returns boolean
language sql stable set search_path='' as $$
  select coalesce(private.app_role(p_store)::text,'') in ('SUPERVISOR','OWNER','LOGISTICS');
$$;

-- Existing store lock in start_pilot_count serializes concurrent opens, including the daily job.
do $$
declare src text := pg_get_functiondef('public.start_pilot_count(uuid,jsonb)'::regprocedure);
  needle text := 'where store_id=p_store_id order by started_at desc limit 1;';
begin
  if strpos(src,needle)=0 then raise exception 'Unexpected count start definition'; end if;
  src := replace(src,needle,'where store_id=p_store_id and (v_type<>''CHAIN_RESTAURANT'' or (started_at at time zone ''Asia/Taipei'')::date=(now() at time zone ''Asia/Taipei'')::date) order by started_at desc limit 1;');
  src := replace(src,'v_old.status=''CLOSED''','v_old.status in (''REVIEWING'',''CLOSED'')');
  src := replace(src,'if not private.has_active_store_role(p_store_id,array[''ADMIN'',''SUPERVISOR'']::public.app_role[]) and not(', 'if not (v_type=''CHAIN_RESTAURANT'' and p_selection is null and private.can_count_inline(p_store_id)) and not private.has_active_store_role(p_store_id,array[''ADMIN'',''SUPERVISOR'']::public.app_role[]) and not(');
  if strpos(src,'v_snapshot,v_type=''CHAIN_RESTAURANT'') returning id')=0 then raise exception 'Unexpected paper flag definition'; end if;
  src := replace(src,'v_snapshot,v_type=''CHAIN_RESTAURANT'') returning id','v_snapshot,false) returning id');
  execute src;
end $$;

create or replace function public.ensure_pilot_daily_count(p_store_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not private.can_count_inline(p_store_id) then raise insufficient_privilege; end if;
  if not exists(select 1 from public.stores s join public.organizations o on o.id=s.organization_id
    where s.id=p_store_id and s.is_active and o.business_type='CHAIN_RESTAURANT') then return null; end if;
  return public.start_pilot_count(p_store_id,null);
exception when raise_exception then
  if sqlerrm='ZONE_PRODUCTS_REQUIRED' then return null; end if;
  raise;
end $$;
