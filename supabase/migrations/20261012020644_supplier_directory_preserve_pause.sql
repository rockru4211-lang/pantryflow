-- Legacy partial updates must not silently reactivate paused suppliers.
do $$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure);
 anchor:='update public.suppliers set name=btrim(p_data->>''name''),supplier_code=coalesce(nullif(btrim(p_data->>''code''),''''),supplier_code),is_active=coalesce((p_data->>''is_active'')::boolean,true)';
 if strpos(definition,anchor)=0 then raise exception 'supplier pause update anchor missing';end if;
 definition:=replace(definition,anchor,replace(anchor,'::boolean,true)','::boolean,is_active)'));
 execute definition;
end $$;
notify pgrst,'reload schema';
