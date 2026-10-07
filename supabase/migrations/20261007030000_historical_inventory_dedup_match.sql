-- Permanently prevent historical/current duplicate inventory rows.
-- When a historical row has no explicit product link, infer the product only
-- when normalized name + compatible count unit identify exactly one store item.
-- Ambiguous matches remain unlinked for manual review.

create or replace function private.historical_inventory_product_match(
  p_store uuid,
  p_name text,
  p_unit text
)
returns uuid
language sql
stable
set search_path=''
as $$
  with candidates as (
    select distinct p.id
    from public.stores s
    join public.products p on p.organization_id=s.organization_id and p.is_active
    where s.id=p_store
      and regexp_replace(lower(btrim(p.name)),'[[:space:][:punct:]]','','g')
          =regexp_replace(lower(btrim(coalesce(p_name,''))),'[[:space:][:punct:]]','','g')
      and private.recipe_unit(coalesce(nullif(p.count_unit,''),p.base_unit))
          =private.recipe_unit(coalesce(p_unit,''))
      and (
        exists(
          select 1
          from public.zone_products zp
          join public.count_zones z on z.id=zp.zone_id
          where z.store_id=p_store
            and zp.product_id=p.id
        )
        or exists(
          select 1
          from private.count_field_removed fr
          where fr.store_id=p_store and fr.product_id=p.id
        )
      )
  )
  select case when count(*)=1 then min(id::text)::uuid end
  from candidates
$$;

revoke all on function private.historical_inventory_product_match(uuid,text,text)
from public,anon,authenticated;

do $patch$
declare definition text; changed text;
begin
  definition:=pg_get_functiondef('private.historical_inventory_source(uuid,date,uuid)'::regprocedure);

  changed:=replace(
    definition,
    'select r.*,i.source_file,i.source_month,l.product_id,',
    'select r.*,i.source_file,i.source_month,coalesce(l.product_id,private.historical_inventory_product_match(p_store,r.data->>''name'',r.data->>''unit'')) product_id,'
  );

  if changed=definition then
    raise exception 'Historical inventory product match patch missing';
  end if;

  execute changed;
end
$patch$;

notify pgrst,'reload schema';
