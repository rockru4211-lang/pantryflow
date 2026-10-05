-- Avoid per-request JIT compilation on interactive recipe operations.
-- Scope settings to these functions; preserve privileges and stored data.
alter function private.recipe_prices(uuid) set jit = off;
alter function private.recipe_workspace_live(uuid) set jit = off;
alter function private.recipe_workspace(uuid) set jit = off;
alter function private.recipe_workspace_tools(uuid) set jit = off;
alter function private.seed_ingredient_masters(uuid) set jit = off;
alter function private.recipe_price_catalog_operation(uuid,text,jsonb,uuid) set jit = off;

-- Match workspace costing: build an index only for the document and its children.
-- Traversal is bounded; existing evaluator still enforces cycles and store ownership.
create or replace function private.recipe_cost(s uuid,doc jsonb,visited uuid[] default '{}') returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare prices jsonb; price_index jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 prices:=private.recipe_prices(s);
 with recursive documents(document,path,depth) as (
 select doc,visited,0
 union all
 select r.document,array_append(d.path,r.id),d.depth+1
 from documents d cross join lateral jsonb_array_elements(coalesce(d.document->'lines','[]')) l
 join private.recipe_cards r on r.id=nullif(l.value->>'recipe_id','')::uuid and r.store_id=s
 where d.depth<20 and not r.id=any(d.path)
 ), keys as (
 select distinct case when nullif(l.value->>'ingredient_id','') is not null then 'i:'||(l.value->>'ingredient_id')
 when nullif(l.value->>'product_id','') is not null then 'p:'||(l.value->>'product_id')
 else 'n:'||lower(btrim(l.value->>'name')) end key
 from documents d cross join lateral jsonb_array_elements(coalesce(d.document->'lines','[]')) l
 )
 select private.recipe_price_index(coalesce(jsonb_agg(p.value),'[]')) into price_index
 from jsonb_array_elements(prices) p join keys k on k.key=p.value->>'key';
 return private.recipe_cost_indexed(s,doc,visited,price_index);
end $$;
notify pgrst,'reload schema';

-- Materialize the small key list before scanning large price JSON.
CREATE OR REPLACE FUNCTION private.recipe_workspace_live(s uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO off
AS $function$
declare current_prices jsonb; price_index jsonb; needed_keys text[];
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 current_prices:=private.recipe_prices(s);
 select array_agg(distinct case when nullif(l.value->>'ingredient_id','') is not null then 'i:'||(l.value->>'ingredient_id') when nullif(l.value->>'product_id','') is not null then 'p:'||(l.value->>'product_id') else 'n:'||lower(btrim(l.value->>'name')) end) into needed_keys
 from private.recipe_cards c cross join lateral jsonb_array_elements(coalesce(c.document->'lines','[]')) l where c.store_id=s;
 select private.recipe_price_index(coalesce(jsonb_agg(p.value),'[]')) into price_index
 from jsonb_array_elements(current_prices) p where p.value->>'key'=any(coalesce(needed_keys,'{}'));
 return jsonb_build_object('can_price',private.recipe_allowed(s,true),
 'recipes',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('cost',private.recipe_cost_indexed(s,r.document,array[r.id],price_index)) order by updated_at desc),'[]') from private.recipe_cards r where store_id=s),
 'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit,'specification',p.specification) order by p.name),'[]') from public.products p join public.stores st on st.organization_id=p.organization_id where st.id=s and p.is_active),
 'prices',current_prices,
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.name) order by sp.name),'[]') from public.suppliers sp join public.stores st on st.organization_id=sp.organization_id where st.id=s and sp.is_active),
 'price_references',(select coalesce(jsonb_agg(jsonb_build_object(
 'key',case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,
 'name',r.name,'product_id',r.product_id,'unit',private.recipe_unit(r.unit),'price',r.price/private.recipe_factor(r.unit),
 'cost_price',r.cost_price/private.recipe_factor(r.unit),'purchase',r.purchase,'source',r.source,'source_kind',r.source_kind,
 'source_ref',r.source_ref,'supplier_name',r.source_ref->>'supplier_name','reference_id',r.id,'effective_date',r.effective_date,
 'review_status',r.review_status,'created_at',r.created_at) order by r.effective_date desc nulls last,r.created_at desc),'[]')
 from private.recipe_price_entries r where r.store_id=s and (r.review_status='confirmed' or not exists(
 select 1 from private.recipe_price_entries c where c.store_id=s and c.review_status='confirmed' and c.source_ref->>'import_key'=r.source_ref->>'import_key'))),
 'price_candidates',(select coalesce(jsonb_agg(jsonb_build_object(
 'key',case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,
 'name',r.name,'product_id',r.product_id,'unit',private.recipe_unit(r.unit),'price',r.price/private.recipe_factor(r.unit),
 'purchase',r.purchase,'source',r.source,'source_kind',r.source_kind,'source_ref',r.source_ref,'reference_id',r.id,'effective_date',r.effective_date
 ) order by r.source_kind,r.effective_date desc nulls last),'[]') from private.recipe_price_entries r
 where r.store_id=s and r.review_status='pending' and not exists (
 select 1 from private.recipe_price_entries c where c.store_id=s and c.review_status='confirmed'
 and c.source_ref->>'import_key'=r.source_ref->>'import_key')));
end $function$
;


