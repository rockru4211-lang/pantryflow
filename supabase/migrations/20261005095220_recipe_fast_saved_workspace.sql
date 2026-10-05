-- Read saved costs without computing live prices or proposals. No historical data is changed.
create or replace function private.recipe_workspace_saved(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare cards jsonb; moved jsonb;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
  'cost',coalesce(v.cost_snapshot,a.cost_snapshot,jsonb_build_object('total',null,'subtotal',0,'missing',greatest(jsonb_array_length(r.document->'lines'),1),'lines','[]'::jsonb)),
  'cost_loaded',v.cost_snapshot is not null or a.cost_snapshot is not null,
  'approved_cost',case when a.id is null then null else jsonb_build_object('id',a.id,'document',a.document,'cost',a.cost_snapshot,'at',a.created_at,'origin',a.origin) end
 ) order by r.updated_at desc),'[]') into cards
 from private.recipe_cards r
 left join private.recipe_versions v on v.recipe_id=r.id and v.revision=r.revision
 left join lateral(select * from private.recipe_cost_approvals where recipe_id=r.id order by created_at desc,id desc limit 1) a on true
 where r.store_id=s;
 select coalesce(jsonb_agg(distinct x.value),'[]') into moved from private.app_requests a cross join lateral jsonb_array_elements(a.result->'moved_ids') x
 where a.store_id=s and a.action='recipe.transfer' and exists(select 1 from private.recipe_cards r where r.id=(x.value#>>'{}')::uuid and r.store_id<>s);
 return jsonb_build_object('recipes',cards,'moved_recipe_ids',moved,'products','[]'::jsonb,'prices','[]'::jsonb,'pricing_loaded',false,'can_price',private.recipe_allowed(s,true) and private.store_access_mode(s)='EDIT');
end $$;
revoke all on function private.recipe_workspace_saved(uuid) from public,anon;
grant execute on function private.recipe_workspace_saved(uuid) to authenticated;

-- Load the editor's pricing separately. References are needed only for ingredients
-- used in this store's recipes; the full ingredient picker is still included.
create or replace function private.recipe_workspace_pricing(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare prices jsonb; refs jsonb; keys text[];
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 prices:=private.recipe_prices(s);
 select array_agg(distinct case when nullif(l->>'ingredient_id','') is not null then 'i:'||(l->>'ingredient_id') when nullif(l->>'product_id','') is not null then 'p:'||(l->>'product_id') else 'n:'||lower(btrim(l->>'name')) end) into keys
 from private.recipe_cards r cross join lateral jsonb_array_elements(r.document->'lines') l where r.store_id=s;
 with confirmed_keys as materialized (select distinct source_ref->>'import_key' key from private.recipe_price_entries where store_id=s and review_status='confirmed' and source_ref->>'import_key' is not null), relevant as materialized (select * from private.recipe_price_entries r where r.store_id=s and (case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end)=any(coalesce(keys,'{}')))
 select coalesce(jsonb_agg(jsonb_build_object(
 'key',case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,
 'name',r.name,'product_id',r.product_id,'unit',private.recipe_unit(r.unit),'price',r.price/private.recipe_factor(r.unit),
 'cost_price',r.cost_price/private.recipe_factor(r.unit),'purchase',r.purchase,'source',r.source,'source_kind',r.source_kind,
 'source_ref',r.source_ref,'supplier_name',r.source_ref->>'supplier_name','reference_id',r.id,'effective_date',r.effective_date,
 'review_status',r.review_status,'created_at',r.created_at) order by r.effective_date desc nulls last,r.created_at desc),'[]') into refs
 from relevant r where r.review_status='confirmed' or not exists(select 1 from confirmed_keys c where c.key=r.source_ref->>'import_key');
 return private.ingredient_catalog(s)||jsonb_build_object('prices',prices,'pricing_loaded',true,'price_references',refs,
 'price_candidates',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(refs) x where x->>'review_status'='pending'),
 'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit,'specification',p.specification) order by p.name),'[]') from public.products p join public.stores st on st.organization_id=p.organization_id where st.id=s and p.is_active),
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.name) order by sp.name),'[]') from public.suppliers sp join public.stores st on st.organization_id=sp.organization_id where st.id=s and sp.is_active));
end $$;
revoke all on function private.recipe_workspace_pricing(uuid) from public,anon;
grant execute on function private.recipe_workspace_pricing(uuid) to authenticated;

create or replace function private.recipe_workspace_review(s uuid, recipe uuid) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare card private.recipe_cards; result jsonb; proposed jsonb;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select * into card from private.recipe_cards where id=recipe and store_id=s;
 if card.id is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select c into result from jsonb_array_elements(private.recipe_workspace_saved(s)->'recipes') c where c->>'id'=recipe::text;
 proposed:=private.recipe_cost(s,card.document,array[card.id]);
 return result||jsonb_build_object('proposed_cost',proposed,'proposed_cost_token',md5(proposed::text),
 'cost_history',(select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'at',h.created_at,'cost',h.cost_snapshot) order by h.created_at desc),'[]') from private.recipe_cost_approvals h where h.recipe_id=recipe));
end $$;
revoke all on function private.recipe_workspace_review(uuid,uuid) from public,anon;
grant execute on function private.recipe_workspace_review(uuid,uuid) to authenticated;

create or replace function public.app_workspace(p_store_id uuid,p_section text,p_filter jsonb default '{}') returns jsonb language sql stable set search_path='' as $$
 select case when p_section='recipes.saved' then private.recipe_workspace_saved(p_store_id)
 when p_section='recipes.pricing' then private.recipe_workspace_pricing(p_store_id)
 when p_section='recipes.review' then private.recipe_workspace_review(p_store_id,(p_filter->>'id')::uuid)
 when p_section='ingredients' then private.ingredient_catalog(p_store_id)
 when p_section='ingredient.sources' then private.ingredient_sources(p_store_id,(p_filter->>'id')::uuid)
 when p_section='recipes' then private.recipe_workspace_tools(p_store_id)
 when p_section='recipe.transfer' then private.recipe_transfer_plan(p_store_id,(p_filter->>'target_store_id')::uuid,(p_filter->>'id')::uuid)
 else private.app_workspace(p_store_id,p_section,p_filter) end
$$;
notify pgrst,'reload schema';
