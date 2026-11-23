-- A reviewed register feeds existing ingredient identities and keeps unmatched rows out of the catalog.
create table private.reviewed_ingredient_items (
 organization_id uuid not null references public.organizations(id),
 review_code text not null check (review_code ~ '^P[0-9]{4}$'),
 formal_name text not null check (length(formal_name) between 1 and 160),
 receipt_name text not null check (length(receipt_name) between 1 and 2000),
 supplier_name text not null,
 unit text not null,
 specification text not null,
 category text not null,
 status text not null check (status in ('MATCHED','PENDING','SERVICE')),
 reason text not null,
 ingredient_id uuid references private.ingredient_masters(id),
 count_product_ids uuid[] not null default '{}',
 source_names text[] not null default '{}',
 latest_date date not null,
 imported_at timestamptz not null default now(),
 primary key (organization_id,review_code),
 check ((status='MATCHED')=(ingredient_id is not null))
);
alter table private.reviewed_ingredient_items enable row level security;
revoke all on private.reviewed_ingredient_items from public,anon,authenticated;
create index reviewed_ingredient_item_identity on private.reviewed_ingredient_items(ingredient_id) where status='MATCHED';
create index reviewed_ingredient_count_products on private.reviewed_ingredient_items using gin(count_product_ids);

create function private.reviewed_ingredient_name(i uuid)
returns text language sql stable set search_path='' as $$
 select case when count(distinct r.formal_name)=1 then min(r.formal_name) end
 from private.reviewed_ingredient_items r
 left join private.ingredient_usage_names n on n.ingredient_id=r.ingredient_id
 where r.ingredient_id=i and r.status='MATCHED' and (n.updated_at is null or n.updated_at<=r.imported_at)
$$;
revoke all on function private.reviewed_ingredient_name(uuid) from public,anon,authenticated;

create or replace function private.shared_ingredient_name(i uuid) returns text
language sql stable set search_path='' as $$
 select coalesce(private.reviewed_ingredient_name(m.id),n.formal_name,m.name)
 from private.ingredient_masters m
 left join private.ingredient_usage_names n on n.ingredient_id=m.id
 where m.id=private.shared_ingredient_id(i)
$$;

create or replace function private.ingredient_usage_rows(s uuid, rows jsonb) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(r.value||jsonb_build_object(
 'name',coalesce(private.shared_ingredient_name(m.id),n.formal_name,r.value->>'name'),
 'original_name',r.value->>'name','shared_ingredient_id',identity.id,
 'shared_name',case when exists(select 1 from private.ingredient_code_links l where l.target_id=identity.id) then private.shared_ingredient_name(m.id) end,
 'reviewed_name',private.reviewed_ingredient_name(identity.id),
 'archived',coalesce((select c.archived from private.ingredient_sheet_classifications c
  where c.store_id=s and c.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)),false),
 'category',coalesce((select case when count(distinct i.category)=1 then min(i.category) end
  from private.reviewed_ingredient_items i where i.ingredient_id=identity.id and i.status='MATCHED'
   and i.category in ('食材','酒水','耗材') and i.imported_at>=m.updated_at),r.value->>'category'),
 'reviewed_aliases',coalesce((
  select jsonb_agg(distinct label order by label)
  from private.reviewed_ingredient_items i cross join lateral unnest(i.source_names) src(label)
  where i.ingredient_id=identity.id and i.status='MATCHED'
 ),'[]'::jsonb),
 'count_name',coalesce(n.count_name,''),'recipe_aliases',coalesce(n.recipe_aliases,'[]'::jsonb)) order by r.ord),'[]'::jsonb)
 from jsonb_array_elements(rows) with ordinality r(value,ord)
 left join private.ingredient_masters m on m.id=(r.value->>'id')::uuid and m.store_id=s
 left join private.ingredient_usage_names n on n.ingredient_id=coalesce(m.canonical_ingredient_id,m.id) and n.store_id=s
 cross join lateral (select private.shared_ingredient_id(m.id) id) identity
$$;

do $patch$
declare definition text; anchor text:='''formal_name'',coalesce(n.formal_name,regexp_replace(m.name';
begin
 definition:=pg_get_functiondef('private.ingredient_usage_detail(uuid,uuid)'::regprocedure);
 if strpos(definition,anchor)=0 then raise exception 'REVIEWED_NAME_DETAIL_ANCHOR';end if;
 execute replace(definition,anchor,'''formal_name'',coalesce(private.reviewed_ingredient_name(private.shared_ingredient_id(m.id)),n.formal_name,regexp_replace(m.name');
end $patch$;

create function public.get_baihuayuan_ingredient_review_queue(p_store_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare organization uuid;
begin
 if auth.uid() is null or not private.recipe_allowed(p_store_id) or not private.office_data_access(p_store_id) then
  raise exception 'APP_FORBIDDEN' using errcode='42501';
 end if;
 select organization_id into organization from public.stores
 where id=p_store_id and name in ('BeApe','Gras') and is_active;
 return (select coalesce(jsonb_agg(jsonb_build_object('code',r.review_code,'name',r.formal_name,
  'supplier',r.supplier_name,'unit',r.unit,'specification',r.specification,'category',r.category,'reason',r.reason)
  order by r.latest_date desc,r.review_code),'[]'::jsonb)
 from private.reviewed_ingredient_items r where r.organization_id=organization and r.status='PENDING');
end $$;
revoke all on function public.get_baihuayuan_ingredient_review_queue(uuid) from public,anon,authenticated;
grant execute on function public.get_baihuayuan_ingredient_review_queue(uuid) to authenticated;

create or replace function public.get_count_ingredient_names(p_store_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or coalesce(private.store_access_mode(p_store_id),'NONE') not in ('VIEW','EDIT') then
  raise exception 'APP_FORBIDDEN' using errcode='42501';
 end if;
 with products as materialized (
  select distinct p.id product_id,p.organization_id,z.store_id
  from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
  join public.products p on p.id=zp.product_id where z.store_id=p_store_id and z.is_active
 ), links as materialized (
  select distinct p.product_id,coalesce(m.canonical_ingredient_id,m.id) ingredient_id,private.managed_ingredient_code(m.id) code
  from products p join private.ingredient_aliases a on a.store_id=p.store_id and a.source_key='p:'||p.product_id::text
  join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=p.store_id
 ), reviewed as (
  select p.product_id,(array_agg(r.receipt_name order by r.latest_date desc,r.review_code))[1] receipt_name from products p
  join private.reviewed_ingredient_items r on r.organization_id=p.organization_id
    and r.status='MATCHED' and r.count_product_ids @> array[p.product_id]
  group by p.product_id having count(distinct r.formal_name)=1
 ), safe as (select product_id,min(code) code from links group by product_id having count(distinct code)=1),
 identities as (
  select coalesce(s.product_id,r.product_id) product_id,s.code,r.receipt_name
  from safe s full join reviewed r on r.product_id=s.product_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('product_id',s.product_id,'code',coalesce(s.code,''),
 'count_name',coalesce((select case when count(distinct nullif(n.count_name,''))=1 then min(nullif(n.count_name,'')) end
  from links l join private.ingredient_usage_names n on n.ingredient_id=l.ingredient_id where s.code is not null and l.product_id=s.product_id),''),
 'receipt_name',s.receipt_name,
 'names',(select coalesce(jsonb_agg(distinct name),'[]'::jsonb) from (
  select m.name from links l join private.ingredient_masters m on m.id=l.ingredient_id where s.code is not null and l.product_id=s.product_id
  union select n.formal_name from links l join private.ingredient_usage_names n on n.ingredient_id=l.ingredient_id where s.code is not null and l.product_id=s.product_id
  union select jsonb_array_elements_text(n.recipe_aliases) from links l join private.ingredient_usage_names n on n.ingredient_id=l.ingredient_id where s.code is not null and l.product_id=s.product_id
  union select b.name from links l join private.receipt_ingredient_bindings b on b.store_id=p_store_id and b.ingredient_id=l.ingredient_id where s.code is not null and l.product_id=s.product_id
 ) names))),'[]'::jsonb) into result from identities s;
 return result;
end $$;

notify pgrst,'reload schema';
