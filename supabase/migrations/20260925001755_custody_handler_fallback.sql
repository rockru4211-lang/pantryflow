-- Some valid profiles have no display name. Keep actor UUID and a readable fallback.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('private.baihuayuan_custody(uuid,text,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,
 $old$handler:=btrim(coalesce(p_data->>'handler',(select display_name from public.profiles where id=auth.uid()),''));$old$,
 $new$handler:=coalesce(nullif(btrim(p_data->>'handler'),''),nullif(btrim((select display_name from public.profiles where id=auth.uid())),''),'登記人員');$new$);
 execute definition;
end $migration$;
