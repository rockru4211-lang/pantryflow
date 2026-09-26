-- Exact row identities are hash-joinable and avoid ambiguous unit conversions.
do $$ declare src text; begin
 src:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
 src:=replace(src, ' or (c->>''product_id'' is not null and c->>''product_id''=p->>''product_id'' and private.history_unit(c->>''unit'')=private.history_unit(p->>''unit''))','');
 execute src;
end $$;
