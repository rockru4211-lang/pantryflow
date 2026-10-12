-- Name matching cannot manufacture a package size from a canonical name.
do $guard$declare src text;begin
 src:=pg_get_functiondef('private.resolved_cost_quote(uuid,uuid,text,text,date)'::regprocedure);
 src:=replace(src,
  'q:=private.cost_quote(s,null,canonical,u,target);',
  'if private.cost_package_measure(u,nm) is not distinct from private.cost_package_measure(u,canonical) then q:=private.cost_quote(s,null,canonical,u,target);end if;');
 execute src;
end $guard$;
