-- Read-only catalog provenance and source ordering. No data or costing writes.
create or replace function private.ingredient_source_priority(source text,kind text) returns integer
language sql immutable security invoker set search_path='' as $$
 select case when source like '%已核對進貨%' then 0 when source like '請購表%' or kind='purchase' then 1 when kind='history' then 2 else 3 end
$$;
revoke all on function private.ingredient_source_priority(text,text) from public,anon,authenticated;

create or replace function private.ingredient_catalog(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 with aliases as (
 select ingredient_id,jsonb_agg(jsonb_build_object('id',id,'name',name,'unit',source_unit,'specification',specification,'corrected',corrected) order by name,id) items
 from private.ingredient_aliases where store_id=s group by ingredient_id
 ) select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('aliases',coalesce(a.items,'[]'::jsonb),'source',r.source,'source_kind',r.source_kind,'effective_date',r.effective_date) order by m.name,m.unit),'[]'::jsonb) into rows
 from private.ingredient_masters m left join aliases a on a.ingredient_id=m.id
 left join private.recipe_price_entries r on r.id=m.selected_reference and r.store_id=s
 where m.store_id=s and (a.ingredient_id is not null or m.manual);
 return jsonb_build_object('ingredients',rows,'can_price',private.recipe_allowed(s,true) and private.store_access_mode(s)='EDIT');
end $$;
revoke all on function private.ingredient_catalog(uuid) from public,anon;
grant execute on function private.ingredient_catalog(uuid) to authenticated;

create or replace function private.ingredient_sources(s uuid,i uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.recipe_allowed(s) or not exists(select 1 from private.ingredient_masters where id=i and store_id=s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'unit',private.recipe_unit(r.unit),'price',case when r.source_ref->>'missing_price'='true' then null else coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) end,'source',r.source,'source_kind',r.source_kind,'effective_date',r.effective_date,'review_status',r.review_status,'source_ref',r.source_ref,'purchase',r.purchase) order by (r.review_status='confirmed' and coalesce(r.source_ref->>'missing_price','false')<>'true') desc,private.ingredient_source_priority(r.source,r.source_kind),r.effective_date desc nulls last,r.created_at desc),'[]') into result
 from private.recipe_price_entries r where r.store_id=s and exists(select 1 from private.ingredient_aliases a where a.ingredient_id=i and a.store_id=s and r.id=any(a.reference_ids));
 return result;
end $$;
revoke all on function private.ingredient_sources(uuid,uuid) from public,anon;
grant execute on function private.ingredient_sources(uuid,uuid) to authenticated;


notify pgrst,'reload schema';
