-- Some deployed releases have a cache. Keep its normalized-unit values on the shared resolver.
do $patch$
declare definition text; revised text;
begin
 if to_regprocedure('private.refresh_ingredient_price_cache(uuid)') is not null then
  definition:=pg_get_functiondef('private.refresh_ingredient_price_cache(uuid)'::regprocedure);
  revised:=replace(definition,'private.ingredient_price_resolve_uncached(p_store,u.product_id,u.unit)',
   '(private.cost_quote(p_store,u.product_id,null,u.unit,(now() at time zone ''Asia/Taipei'')::date)->>''price'')::numeric');
  if revised=definition then raise exception 'Cache resolver hook changed';end if;execute revised;
 end if;
end $patch$;
