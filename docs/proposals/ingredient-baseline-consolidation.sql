-- PROPOSAL ONLY. Automatic approval review rejected this broader data change.
-- Not a deployable migration; requires explicit approval and fixture validation before any execution.
-- Reuse existing ingredient identities and source quotations. No recipe/cost history is rewritten.
-- The CLI telemetry path was rejected earlier; this migration is applied through SQL-only MCP.
create or replace function private.ingredient_baseline_name(raw text,u text) returns text
language sql immutable security invoker set search_path='' as $$
 select private.ingredient_name(
 replace(replace(replace(regexp_replace(regexp_replace(normalize(raw,NFKC),'[[:space:]]*·[[:space:]]*原表計價基準:.*$','','g'),'[[:space:]]+','','g'),'帕單諾','帕達諾'),'初炸橄欖油','初榨橄欖油'),'乾巴西里碎','乾巴西里'),u)
$$;
revoke all on function private.ingredient_baseline_name(text,text) from public,anon,authenticated;

create or replace function private.ingredient_source_priority(source text,kind text) returns integer
language sql immutable security invoker set search_path='' as $$
 select case when source like '%已核對進貨%' then 0 when source like '請購表%' or kind='purchase' then 1 when kind='history' then 2 else 3 end
$$;
revoke all on function private.ingredient_source_priority(text,text) from public,anon,authenticated;

create or replace function private.consolidate_ingredient_baseline(s uuid) returns void
language plpgsql security definer set search_path='' set jit=off as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('ingredient:'||s::text,0));
 -- One explicit manual choice is retained. Multiple manual choices or corrected aliases
 -- are never overwritten by automatic grouping. Old master IDs continue to resolve.
 with eligible as materialized (
  select m.*,private.ingredient_baseline_name(m.name,m.unit) canonical
  from private.ingredient_masters m where m.store_id=s
  and (m.manual or m.revision=1)
  and not exists(select 1 from private.ingredient_aliases a where a.ingredient_id=m.id and a.corrected)
 ), groups as (
  select canonical,unit,(array_agg(id order by manual desc,(name=canonical) desc,id))[1] target
  from eligible group by canonical,unit having count(*)>1 and count(*) filter(where manual)<=1
 ), redirects as (
  select e.id,g.target from eligible e join groups g using(canonical,unit) where e.id<>g.target and not e.manual
 ) update private.ingredient_aliases a set ingredient_id=r.target from redirects r
 where a.store_id=s and a.ingredient_id=r.id and not a.corrected;
 -- Choose usable purchasing records before history, regardless of history's newer date.
 with ranked as (
 select distinct on(a.ingredient_id) a.ingredient_id,r.id,r.cost_price,r.price,r.unit
 from private.ingredient_aliases a join private.recipe_price_entries r on r.id=any(a.reference_ids) and r.store_id=s
 where a.store_id=s and r.review_status='confirmed' and coalesce(r.source_ref->>'missing_price','false')<>'true'
 order by a.ingredient_id,private.ingredient_source_priority(r.source,r.source_kind),r.effective_date desc nulls last,r.created_at desc,r.id desc
 ) update private.ingredient_masters m set selected_reference=r.id,cost_price=coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit),review_status='confirmed'
 from ranked r where m.id=r.ingredient_id and m.store_id=s and m.revision=1 and not m.manual
 and (m.selected_reference is distinct from r.id or m.cost_price is distinct from coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit));
end $$;
revoke all on function private.consolidate_ingredient_baseline(uuid) from public,anon,authenticated;

create or replace function private.seed_ingredient_masters(s uuid) returns void
language plpgsql security definer set search_path='' set jit=off as $$
begin
 -- Internal migration/import helper; never callable by application roles.
 insert into private.ingredient_masters(store_id,name,unit)
 select distinct s,private.ingredient_baseline_name(r.name,r.unit)||case when btrim(coalesce(r.source_ref->>'specification',''))<>'' and normalize(r.source_ref->>'specification',NFKC) not like '原表計價基準:%' then ' · '||btrim(r.source_ref->>'specification') else '' end,private.recipe_unit(r.unit)
 from private.recipe_price_entries r where r.store_id=s
 on conflict do nothing;
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,specification,reference_ids)
 select s,m.id,min(r.name),case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,private.recipe_unit(r.unit),btrim(coalesce(r.source_ref->>'specification','')),array_agg(r.id order by r.created_at,r.id)
 from private.recipe_price_entries r join private.ingredient_masters m on m.store_id=s and lower(btrim(m.name))=lower(btrim(private.ingredient_baseline_name(r.name,r.unit)||case when btrim(coalesce(r.source_ref->>'specification',''))<>'' and normalize(r.source_ref->>'specification',NFKC) not like '原表計價基準:%' then ' · '||btrim(r.source_ref->>'specification') else '' end)) and m.unit=private.recipe_unit(r.unit)
 where r.store_id=s group by m.id,case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,private.recipe_unit(r.unit),btrim(coalesce(r.source_ref->>'specification',''))
 on conflict(store_id,source_key,source_unit,specification) do update set reference_ids=excluded.reference_ids;
 -- A saved correction or manual price is never reset by a later import.
 with ranked as (
 select distinct on(a.ingredient_id) a.ingredient_id,r.id,r.cost_price,r.price,r.unit
 from private.ingredient_aliases a join private.recipe_price_entries r on r.id=any(a.reference_ids)
 where a.store_id=s and r.review_status='confirmed' and coalesce(r.source_ref->>'missing_price','false')<>'true'
 order by a.ingredient_id,private.ingredient_source_priority(r.source,r.source_kind),r.effective_date desc nulls last,r.created_at desc,r.id desc
 ) update private.ingredient_masters m set selected_reference=r.id,cost_price=coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit),review_status='confirmed'
 from ranked r where m.id=r.ingredient_id and m.cost_price is null and m.revision=1 and not m.manual;
 perform private.consolidate_ingredient_baseline(s);
end $$;
revoke all on function private.seed_ingredient_masters(uuid) from public,anon,authenticated;

create or replace function private.ingredient_catalog(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 with aliases as (
 select ingredient_id,jsonb_agg(jsonb_build_object('id',id,'name',name,'unit',source_unit,'specification',specification,'corrected',corrected) order by name,id) items
 from private.ingredient_aliases where store_id=s group by ingredient_id
 ) select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('name',case when m.manual then m.name else private.ingredient_baseline_name(m.name,m.unit) end,'aliases',coalesce(a.items,'[]'::jsonb),'source',r.source,'source_kind',r.source_kind,'effective_date',r.effective_date) order by m.name,m.unit),'[]'::jsonb) into rows
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

create or replace function private.recipe_prices(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare original jsonb; result jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 original:=private.recipe_prices_before_master(s);
 with maps as materialized (
 select 'i:'||id key,unit,id ingredient_id from private.ingredient_masters where store_id=s
 union
 select 'n:'||lower(btrim(m.name)),m.unit,m.id from private.ingredient_masters m where m.store_id=s and (m.manual or exists(select 1 from private.ingredient_aliases active where active.ingredient_id=m.id)) and not exists(select 1 from private.ingredient_aliases a where a.store_id=s and a.source_key='n:'||lower(btrim(m.name)) and a.source_unit=m.unit and a.ingredient_id<>m.id)
 union
 select source_key,source_unit,ingredient_id from private.ingredient_aliases where store_id=s
 ), unique_maps as (
 select key,unit,min(ingredient_id::text)::uuid ingredient_id from maps group by key,unit having count(distinct ingredient_id)=1
 ), resolved as (
 select distinct u.key,m.* from unique_maps u join private.ingredient_masters m on m.id=u.ingredient_id
 ), receipts as materialized (
 select distinct on(u.ingredient_id) u.ingredient_id,x.value
 from unique_maps u join jsonb_array_elements(original) x on x.value->>'key'=u.key and x.value->>'unit'=u.unit
 where x.value->>'source'='已核對進貨' and coalesce((x.value->>'conversion_pending')::boolean,false)=false
 order by u.ingredient_id,x.value->>'effective_date' desc nulls last,x.value->>'recorded_at' desc nulls last
 ), quotes as (
 select case when receipt.value is not null and not m.manual and coalesce(receipt.value->>'effective_date','')>=coalesce(r.effective_date::text,'') then receipt.value||jsonb_build_object('key',m.key,'name',m.name,'source_ref',coalesce(receipt.value->'source_ref','{}'::jsonb)||jsonb_build_object('ingredient_id',m.id)) else jsonb_build_object('key',m.key,'name',m.name,'product_id',case when m.key like 'p:%' then substring(m.key from 3) end,'unit',m.unit,'price',m.cost_price,'cost_price',m.cost_price,'source','基礎食材','source_kind','manual','effective_date',coalesce(r.effective_date,m.updated_at::date),'recorded_at',m.updated_at,'reference_id',m.selected_reference,'source_ref',coalesce(r.source_ref,'{}'::jsonb)||jsonb_build_object('ingredient_id',m.id),'purchase',case when not m.manual and r.purchase is not null then r.purchase else jsonb_build_object('amount',m.cost_price,'quantity',1,'unit',m.unit) end) end value
 from resolved m left join private.recipe_price_entries r on r.id=m.selected_reference left join receipts receipt on receipt.ingredient_id=m.id
 where (m.cost_price is not null and m.review_status='confirmed') or (receipt.value is not null and not m.manual and coalesce(receipt.value->>'effective_date','')>=coalesce(r.effective_date::text,''))
 union all
 select x.value from jsonb_array_elements(original) x where not exists(select 1 from maps where key=x.value->>'key' and unit=x.value->>'unit')
 ) select coalesce(jsonb_agg(value),'[]') into result from quotes;
 return result;
end $$;
-- Existing grants on the private entrypoint are retained; new helpers stay private.


-- Scope the one-time cleanup to the already authorized three-workbook baseline stores.
do $$ declare s uuid;begin
 for s in select distinct store_id from private.recipe_price_entries where source_ref->>'import_batch'='three-workbook-price-baseline-20261004-v1' loop
  perform private.seed_ingredient_masters(s);
 end loop;
end $$;
notify pgrst,'reload schema';
