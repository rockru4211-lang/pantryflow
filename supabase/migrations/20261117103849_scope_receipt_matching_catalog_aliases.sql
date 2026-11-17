-- Supplier-specific receipt spellings must not become global name matches.
do $migration$
declare
 definition text:=pg_get_functiondef('private.ingredient_matching_before_usage_names(uuid)'::regprocedure);
 anchor text:='from private.ingredient_aliases where store_id=p_store_id group by ingredient_id';
begin
 if strpos(definition,anchor)=0 then
  raise exception 'RECEIPT_MATCHING_ALIASES_ANCHOR';
 end if;
 execute replace(definition,anchor,
  'from private.ingredient_aliases where store_id=p_store_id and source_key not like ''supplier-item:%'' group by ingredient_id');
end $migration$;
