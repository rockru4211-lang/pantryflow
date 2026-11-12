-- Latest-cost reads authorize the store once at the workspace boundary instead
-- of re-reading role/module permissions for every card and nested component.
-- The historical engine and all arithmetic, store filters and cycle checks stay
-- intact. The inner helper is not callable by application roles.
do $clone$
declare src text; gate text:='if not private.recipe_allowed(s) then raise exception ''APP_FORBIDDEN'' using errcode=''42501'';end if;';
begin
 src:=pg_get_functiondef('private.recipe_current_cost_indexed(uuid,jsonb,uuid[],jsonb)'::regprocedure);
 if strpos(src,gate)=0 then raise exception 'CURRENT_RECIPE_GATE_ANCHOR';end if;
 src:=replace(src,'private.recipe_current_cost_indexed','private.recipe_current_cost_inner');
 src:=replace(src,gate,'-- Store authorization is checked by the guarded caller.');
 execute src;
end $clone$;
revoke all on function private.recipe_current_cost_inner(uuid,jsonb,uuid[],jsonb) from public,anon,authenticated;

-- Retain a guarded entry point for every independent direct calculation.
create or replace function private.recipe_current_cost_indexed(s uuid,doc jsonb,visited uuid[],price_index jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 return private.recipe_current_cost_inner(s,doc,visited,price_index);
end $$;
revoke all on function private.recipe_current_cost_indexed(uuid,jsonb,uuid[],jsonb) from public,anon,authenticated;

do $workspace$
declare src text; anchor text:='private.recipe_current_cost_indexed(s,r.document,array[r.id],idx)';
begin
 src:=pg_get_functiondef('private.recipe_workspace_pricing(uuid)'::regprocedure);
 if strpos(src,'if auth.uid() is null or not private.recipe_allowed(s)')=0 or strpos(src,anchor)=0
  or strpos(src,'from private.recipe_cards r where r.store_id=s')=0 then raise exception 'CURRENT_RECIPE_WORKSPACE_GATE_ANCHOR';end if;
 execute replace(src,anchor,'private.recipe_current_cost_inner(s,r.document,array[r.id],idx)');
end $workspace$;
notify pgrst,'reload schema';
