-- Keep the previously deployed catalog response available while the bounded
-- current-price read context is installed by the next migration. No data changes.
do $restore$
declare src text; fragment text := $quote$'current_quote',private.automatic_cost_quote(s,null,x.value->>'name',x.value->>'unit',(now() at time zone 'Asia/Taipei')::date,(x.value->>'id')::uuid),$quote$;
begin
 src:=pg_get_functiondef('private.ingredient_supply_read(uuid)'::regprocedure);
 if strpos(src,fragment)=0 then raise exception 'AUTOMATIC_COST_CATALOG_RESTORE_ANCHOR';end if;
 execute replace(src,fragment,'');
end $restore$;
notify pgrst,'reload schema';
