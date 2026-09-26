do $migration$
declare source text;
begin
 select pg_get_functiondef('private.resolve_supplier_name(uuid,jsonb)'::regprocedure) into source;
 if strpos(source,'name text:=')=0 then raise exception 'SUPPLIER_NEW_NAME_ANCHOR_MISSING';end if;
 source:=replace(source,'name text:=','v_new_name text:=');
 source:=replace(source,'length(name)','length(v_new_name)');
 source:=replace(source,'or name=''未提供''','or v_new_name=''未提供''');
 source:=replace(source,'supplier_identity(org,name)','supplier_identity(org,v_new_name)');
 source:=replace(source,'history_key(name)','history_key(v_new_name)');
 source:=replace(source,'values(org,name)','values(org,v_new_name)');
 execute source;
end $migration$;
