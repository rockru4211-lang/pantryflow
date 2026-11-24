-- Apply reviewed names in bulk without changing local prices or source evidence.
create or replace function private.ingredient_usage_rows(s uuid, rows jsonb)
returns jsonb language sql stable set search_path='' as $function$
 with identities as materialized (
  select r.value,r.ord,coalesce(m.canonical_ingredient_id,m.id) local_id,
   n.formal_name,n.count_name,n.recipe_aliases,
   coalesce(case when a.name in ('BeApe','Gras') and b.name in ('BeApe','Gras')
    and a.organization_id=b.organization_id then l.target_id end,m.canonical_ingredient_id,m.id) shared_id
  from jsonb_array_elements(rows) with ordinality r(value,ord)
  left join private.ingredient_masters m on m.id=(r.value->>'id')::uuid and m.store_id=s
  left join private.ingredient_usage_names n on n.ingredient_id=coalesce(m.canonical_ingredient_id,m.id) and n.store_id=s
  left join private.ingredient_code_links l on l.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)
  left join public.stores a on a.id=m.store_id
  left join private.ingredient_masters target on target.id=l.target_id
  left join public.stores b on b.id=target.store_id
 ), shared_roots as materialized (
  select distinct shared_id from identities where shared_id is not null
 ), reviewed_items as materialized (
  select i.ingredient_id,i.formal_name,i.category,i.imported_at,i.source_names
  from private.reviewed_ingredient_items i
  join shared_roots r on r.shared_id=i.ingredient_id
  where i.status='MATCHED'
 ), shared_names as (
  select m.id,
   case when count(distinct i.formal_name) filter (where n.updated_at is null or n.updated_at<=i.imported_at)=1
    then min(i.formal_name) filter (where n.updated_at is null or n.updated_at<=i.imported_at) end reviewed_name,
   case when count(distinct i.category) filter (where i.category in ('食材','酒水','耗材') and i.imported_at>=m.updated_at)=1
    then min(i.category) filter (where i.category in ('食材','酒水','耗材') and i.imported_at>=m.updated_at) end category,
   coalesce(n.formal_name,m.name) fallback_name
  from shared_roots r join private.ingredient_masters m on m.id=r.shared_id
  left join private.ingredient_usage_names n on n.ingredient_id=m.id
  left join reviewed_items i on i.ingredient_id=m.id
  group by m.id,n.formal_name
 ), reviewed_aliases as (
  select i.ingredient_id,jsonb_agg(distinct label order by label) labels
  from reviewed_items i cross join lateral unnest(i.source_names) src(label)
  group by i.ingredient_id
 )
 select coalesce(jsonb_agg(r.value||jsonb_build_object(
  'name',coalesce(shared.reviewed_name,shared.fallback_name,r.formal_name,r.value->>'name'),
  'original_name',r.value->>'name','shared_ingredient_id',r.shared_id,
  'shared_name',case when linked.target_id is not null then coalesce(shared.reviewed_name,shared.fallback_name) end,
  'reviewed_name',shared.reviewed_name,'archived',coalesce(c.archived,false),
  'category',coalesce(shared.category,r.value->>'category'),
  'reviewed_aliases',coalesce(aliases.labels,'[]'::jsonb),
  'count_name',coalesce(r.count_name,''),'recipe_aliases',coalesce(r.recipe_aliases,'[]'::jsonb)
 ) order by r.ord),'[]'::jsonb)
 from identities r
 left join shared_names shared on shared.id=r.shared_id
 left join reviewed_aliases aliases on aliases.ingredient_id=r.shared_id
 left join (select distinct target_id from private.ingredient_code_links) linked on linked.target_id=r.shared_id
 left join private.ingredient_sheet_classifications c on c.store_id=s and c.ingredient_id=r.local_id
$function$;

-- The price sheet needs source labels and price evidence, not the original
-- import payload. Keep that payload stored with the source entry.
do $migration$
declare
 definition text:=pg_get_functiondef('private.ingredient_supply_payload(uuid)'::regprocedure);
 source_anchor text:='r.effective_date,r.created_at,r.source_ref,live.price';
 source_projection text:=$projection$r.effective_date,r.created_at,
 jsonb_strip_nulls(jsonb_build_object(
  'url',r.source_ref->'url','supplier_name',r.source_ref->'supplier_name',
  'review_note',r.source_ref->'review_note','specification',r.source_ref->'specification',
  'batch_id',r.source_ref->'batch_id','row_key',r.source_ref->'row_key',
  'supplier_id',r.source_ref->'supplier_id','missing_price',r.source_ref->'missing_price'
 )) as source_ref,live.price$projection$;
 object_anchor text:=E'select jsonb_build_object(\n  ''can_price''';
 projected_object text:=E'select json_build_object(\n  ''can_price''';
 aggregate_anchor text:='jsonb_agg(value order by ord)';
 projected_aggregate text:='json_agg(value order by ord)';
begin
 if strpos(definition,source_projection)>0 and strpos(definition,projected_object)>0
  and strpos(definition,projected_aggregate)>0 then return; end if;
 if strpos(definition,source_anchor)=0 or strpos(definition,object_anchor)=0
  or strpos(definition,aggregate_anchor)=0 then
  raise exception 'Unexpected ingredient supply query';
 end if;
 definition:=replace(definition,source_anchor,source_projection);
 -- Assemble the final array as JSON and convert to the existing JSONB
 -- return type once, avoiding several rewrites of the full array.
 definition:=replace(definition,object_anchor,projected_object);
 definition:=replace(definition,aggregate_anchor,projected_aggregate);
 execute definition;
end $migration$;

alter function private.ingredient_supply_payload(uuid) set work_mem to '8MB';
