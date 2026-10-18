-- Read only the authoritative ingredient catalog and confirmed prices for the
-- recipe picker. Full historical evidence remains in its original tables/APIs.
create or replace function private.recipe_picker_workspace(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' set jit='off' as $$
declare rows jsonb; prices jsonb;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 with aliases as materialized (
  select ingredient_id,jsonb_agg(jsonb_build_object('id',id,'name',name,'unit',source_unit,'specification',specification,'corrected',corrected)) as items
  from private.ingredient_aliases where store_id=s group by ingredient_id
 ) select coalesce(jsonb_agg(jsonb_build_object(
  'id',m.id,'ingredient_code',m.ingredient_code,'canonical_ingredient_id',m.canonical_ingredient_id,
  'canonical_code',private.managed_ingredient_code(m.id),'name',m.name,'unit',m.unit,'cost_price',m.cost_price,
  'selected_reference',m.selected_reference,'review_status',m.review_status,'revision',m.revision,
  'aliases',coalesce(a.items,'[]'::jsonb),'source',coalesce(r.source,'既有資料'),'source_kind',r.source_kind,'effective_date',r.effective_date,
  'purchase',coalesce(m.purchase,case when m.cost_price=coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) then r.purchase end)
 ) order by m.name,m.unit),'[]'::jsonb) into rows
 from private.ingredient_masters m left join aliases a on a.ingredient_id=m.id
 left join private.recipe_price_entries r on r.id=m.selected_reference and exists(select 1 from public.stores rs join public.stores ts on rs.organization_id=ts.organization_id where rs.id=r.store_id and ts.id=s)
 where m.store_id=s and (a.ingredient_id is not null or m.manual);
 select coalesce(jsonb_agg(jsonb_build_object('key','i:'||(v->>'id'),'name',v->>'name','unit',v->>'unit',
  'price',v->'cost_price','cost_price',v->'cost_price','source',v->>'source','source_kind',v->'source_kind',
  'reference_id',v->'selected_reference','effective_date',v->'effective_date','purchase',v->'purchase')),'[]'::jsonb) into prices
 from jsonb_array_elements(rows) v where v->>'review_status'='confirmed' and v->>'cost_price' is not null;
 return jsonb_build_object('ingredients',rows,'products','[]'::jsonb,'prices',prices,'pricing_loaded',true,
  'can_price',private.recipe_allowed(s,true) and private.store_access_mode(s)='EDIT');
end $$;
revoke all on function private.recipe_picker_workspace(uuid) from public,anon,authenticated;
-- Preserve all existing public office/feature/session authorization checks.
do $patch$declare src text;begin
 src:=pg_get_functiondef('public.app_workspace(uuid,text,jsonb)'::regprocedure);
 if strpos(src,$a$p_section='recipes.picker'$a$)=0 then
  if strpos(src,' return private.app_workspace_before_data_access(p_store_id,p_section,p_filter);')=0 then raise exception 'Workspace route anchor missing';end if;
  execute replace(src,' return private.app_workspace_before_data_access(p_store_id,p_section,p_filter);',
   $a$ if p_section='recipes.picker' then return private.recipe_picker_workspace(p_store_id);end if;
 return private.app_workspace_before_data_access(p_store_id,p_section,p_filter);$a$);
 end if;
end $patch$;
