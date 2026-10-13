-- Equipment permissions also apply to the office directory and stale save requests.
do $$declare def text;anchor text;begin
 def:=pg_get_functiondef('private.administrative_workspace(uuid)'::regprocedure);
 anchor:='where d.store_id=p_store)';
 if strpos(def,anchor)=0 then raise exception 'ADMIN_DIRECTORY_ANCHOR_MISSING';end if;
 def:=replace(def,anchor,$new$where d.store_id=p_store and (not private.feature_scope(p_store) or d.category !~ '(設備|維修|報修|保養)' or private.has_data_access(p_store,'EQUIPMENT')))$new$);execute def;
 def:=pg_get_functiondef('private.administrative_save(uuid,jsonb,uuid)'::regprocedure);
 anchor:='select * into cached';
 if strpos(def,anchor)=0 then raise exception 'ADMIN_SAVE_ANCHOR_MISSING';end if;
 def:=replace(def,anchor,$new$if private.feature_scope(p_store) and not private.has_data_access(p_store,'EQUIPMENT',true) and exists(select 1 from jsonb_array_elements(p_data->'rows') i where coalesce(i->>'category','') ~ '(設備|維修|報修|保養)' or exists(select 1 from private.administrative_documents d where d.id=(i->>'id')::uuid and d.category ~ '(設備|維修|報修|保養)')) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select * into cached$new$);
 -- Field saves and retries return the same equipment projection as field reads.
 def:=replace(def,'return cached.result;', $new$if private.feature_scope(p_store) and not private.office_data_access(p_store) then return jsonb_build_object('rows',(select coalesce(jsonb_agg(x-'contract_start'-'contract_end'-'notified_at'),'[]') from jsonb_array_elements(cached.result->'rows') x));end if;return cached.result;$new$);
 def:=replace(def,'return result;', $new$if private.feature_scope(p_store) and not private.office_data_access(p_store) then return jsonb_build_object('rows',(select coalesce(jsonb_agg(x-'contract_start'-'contract_end'-'notified_at'),'[]') from jsonb_array_elements(result->'rows') x));end if;return result;$new$);
 execute def;
end $$;
notify pgrst,'reload schema';
