create index if not exists ingredient_masters_known_cost_name on private.ingredient_masters(store_id,private.known_cost_name(name));
create index if not exists ingredient_aliases_known_cost_name on private.ingredient_aliases(store_id,private.known_cost_name(name));
alter function private.resolved_cost_quote(uuid,uuid,text,text,date) set plan_cache_mode='force_custom_plan';
