do $migration$
declare source text;next text;
begin
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 next:=replace(source,'if p_action=''mapping.resolve'' then return private.app_resolve_receipt_mapping(p_store,p_data);end if;'||chr(10)||' if p_action in (''member.save''','if p_action in (''member.save''');
 next:=replace(next,'if p_action in (''member.save'',''member.assign'',''member.offboard'') then','if p_action=''mapping.resolve'' then return private.app_resolve_receipt_mapping(p_store,p_data);end if;'||chr(10)||' if p_action in (''member.save'',''member.assign'',''member.offboard'') then');
 if next=source then raise exception 'Management dispatch source mismatch';end if;
 execute next;
end $migration$;
