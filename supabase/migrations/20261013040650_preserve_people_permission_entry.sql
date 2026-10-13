-- Preserve separately assigned personnel-management rights without granting data features.
do $$declare def text;anchor text;begin
 def:=pg_get_functiondef('public.app_workspace(uuid,text,jsonb)'::regprocedure);
 anchor:='if p_section not in';
 if strpos(def,anchor)=0 then raise exception 'WORKSPACE_PERMISSION_ANCHOR_MISSING';end if;
 def:=replace(def,anchor,$new$if p_section in ('members','permissions','business') and private.can_manage_members(p_store_id) then return private.app_workspace_before_data_access(p_store_id,p_section,p_filter);end if;
  if p_section not in$new$);execute def;
end $$;
notify pgrst,'reload schema';
