-- Joined members may read their existing workspace, but cannot submit setup.
do $migration$
declare source text;updated text;
begin
 select pg_get_functiondef('public.owner_setup(text,jsonb,integer)'::regprocedure) into source;
 updated:=replace(source,
 '    if p_action not in (''get'',''complete'') then raise exception ''OWNER_SETUP_ALREADY_COMPLETE'' using errcode=''42501'';end if;',
 '    if progress.step is distinct from ''complete'' and p_action<>''get'' then raise exception ''OWNER_SETUP_NOT_OWNER'' using errcode=''42501'';end if;'||chr(10)||
 '    if p_action not in (''get'',''complete'') then raise exception ''OWNER_SETUP_ALREADY_COMPLETE'' using errcode=''42501'';end if;');
 if source=updated then raise exception 'Joined member setup guard source mismatch';end if;
 execute updated;
end $migration$;
notify pgrst,'reload schema';
