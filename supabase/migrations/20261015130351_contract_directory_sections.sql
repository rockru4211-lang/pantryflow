-- Ownership is independent of user-defined category labels. Existing content stays intact.
alter table private.administrative_documents
 add column directory_section text check(directory_section in ('contracts','equipment')),
 add column contract_payment text not null default '' check(length(contract_payment)<=8000),
 add column contract_contact text not null default '' check(length(contract_contact)<=8000);

create function private.document_section(category text, explicit_section text) returns text
language sql immutable set search_path='' as $$
 select coalesce(explicit_section,case when category ~ '(設備|維修|報修|保養)' then 'equipment' when category ~ '(合約|合同|契約)' then 'contracts' else 'unclassified' end);
$$;
revoke all on function private.document_section(text,text) from public,anon,authenticated;

do $patch$ declare src text; old text; replacement text; begin
 src:=pg_get_functiondef('private.administrative_save(uuid,jsonb,uuid)'::regprocedure);
 old:=$old$d.category ~ '(設備|維修|報修|保養)'$old$; replacement:=$new$private.document_section(d.category,d.directory_section)='equipment'$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.administrative_save(uuid,jsonb,uuid)';end if;
 src:=replace(src,old,replacement);
 old:=$old$d.category !~ '(設備|維修|報修|保養)'$old$; replacement:=$new$private.document_section(d.category,d.directory_section)<>'equipment'$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.administrative_save(uuid,jsonb,uuid)';end if;
 src:=replace(src,old,replacement);
 old:=$old$coalesce(i->>'category','') !~ '(設備|維修|報修|保養)'$old$; replacement:=$new$private.document_section(coalesce(i->>'category',''),i->>'directory_section')<>'equipment'$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.administrative_save(uuid,jsonb,uuid)';end if;
 src:=replace(src,old,replacement);
 old:=$old$coalesce(i->>'category','') ~ '(設備|維修|報修|保養)'$old$; replacement:=$new$private.document_section(coalesce(i->>'category',''),i->>'directory_section')='equipment'$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.administrative_save(uuid,jsonb,uuid)';end if;
 src:=replace(src,old,replacement);
 old:=$old$select * into cached$old$; replacement:=$new$if not private.administrative_access(p_store) and exists(select 1 from jsonb_array_elements(p_data->'rows') i where coalesce(i->>'contract_payment','')<>'' or coalesce(i->>'contract_contact','')<>'') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select * into cached$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.administrative_save(uuid,jsonb,uuid)';end if;
 src:=replace(src,old,replacement);
 old:=$old$insert into private.administrative_documents(id,store_id,name,category,summary,link,note,archived,revision,updated_by,contract_start,contract_end,repair_date,repair_reason,repair_result)$old$; replacement:=$new$if item->>'directory_section' is not null and item->>'directory_section' not in ('contracts','equipment') then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
  if oldrow.id is not null and item->>'directory_section' is not null and private.document_section(oldrow.category,oldrow.directory_section)<>'unclassified' and private.document_section(oldrow.category,oldrow.directory_section)<>item->>'directory_section' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  insert into private.administrative_documents(id,store_id,name,category,summary,link,note,archived,revision,updated_by,contract_start,contract_end,repair_date,repair_reason,repair_result,directory_section,contract_payment,contract_contact)$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.administrative_save(uuid,jsonb,uuid)';end if;
 src:=replace(src,old,replacement);
 old:=$old$coalesce(item->>'repair_result',oldrow.repair_result,''))$old$; replacement:=$new$coalesce(item->>'repair_result',oldrow.repair_result,''),coalesce(item->>'directory_section',oldrow.directory_section,nullif(private.document_section(oldrow.category,null),'unclassified'),nullif(private.document_section(item->>'category',null),'unclassified')),coalesce(item->>'contract_payment',oldrow.contract_payment,''),coalesce(item->>'contract_contact',oldrow.contract_contact,''))$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.administrative_save(uuid,jsonb,uuid)';end if;
 src:=replace(src,old,replacement);
 old:=$old$on conflict(id) do update set name=excluded.name$old$; replacement:=$new$on conflict(id) do update set directory_section=excluded.directory_section,contract_payment=excluded.contract_payment,contract_contact=excluded.contract_contact,name=excluded.name$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.administrative_save(uuid,jsonb,uuid)';end if;
 src:=replace(src,old,replacement);
 src:=replace(src,$old$x-'contract_start'-'contract_end'-'notified_at'$old$,$new$x-'contract_start'-'contract_end'-'notified_at'-'contract_payment'-'contract_contact'$new$);
 execute src;
end $patch$;

do $patch$ declare src text; old text; replacement text; begin
 src:=pg_get_functiondef('private.administrative_workspace(uuid)'::regprocedure);
 old:=$old$d.category !~ '(設備|維修|報修|保養)'$old$; replacement:=$new$private.document_section(d.category,d.directory_section)<>'equipment'$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.administrative_workspace(uuid)';end if;
 src:=replace(src,old,replacement);
 execute src;
end $patch$;

do $patch$ declare src text; old text; replacement text; begin
 src:=pg_get_functiondef('private.equipment_workspace(uuid)'::regprocedure);
 old:=$old$d.category ~ '(設備|維修|報修|保養)'$old$; replacement:=$new$private.document_section(d.category,d.directory_section)='equipment'$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.equipment_workspace(uuid)';end if;
 src:=replace(src,old,replacement);
 old:=$old$to_jsonb(d)-'contract_start'-'contract_end'$old$; replacement:=$new$to_jsonb(d)-'contract_start'-'contract_end'-'contract_payment'-'contract_contact'$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.equipment_workspace(uuid)';end if;
 src:=replace(src,old,replacement);
 execute src;
end $patch$;

do $patch$ declare src text; old text; replacement text; begin
 src:=pg_get_functiondef('private.directory_attachment_access(uuid,text,uuid,boolean)'::regprocedure);
 old:=$old$d.category ~ '(設備|維修|報修|保養)'$old$; replacement:=$new$private.document_section(d.category,d.directory_section)='equipment'$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.directory_attachment_access(uuid,text,uuid,boolean)';end if;
 src:=replace(src,old,replacement);
 execute src;
end $patch$;

do $patch$ declare src text; old text; replacement text; begin
 src:=pg_get_functiondef('private.directory_lifecycle(uuid,jsonb,uuid)'::regprocedure);
 old:=$old$d.category !~ '(設備|維修|報修|保養)'$old$; replacement:=$new$private.document_section(d.category,d.directory_section)<>'equipment'$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.directory_lifecycle(uuid,jsonb,uuid)';end if;
 src:=replace(src,old,replacement);
 old:=$old$d.category !~ '(合約|合同|契約)'$old$; replacement:=$new$private.document_section(d.category,d.directory_section)<>'contracts'$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.directory_lifecycle(uuid,jsonb,uuid)';end if;
 src:=replace(src,old,replacement);
 execute src;
end $patch$;

do $patch$ declare src text; old text; replacement text; begin
 src:=pg_get_functiondef('private.enqueue_contract_reminders()'::regprocedure);
 old:=$old$d.category ~ '合約|合同|契約'$old$; replacement:=$new$not d.is_removed and private.document_section(d.category,d.directory_section)='contracts'$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.enqueue_contract_reminders()';end if;
 src:=replace(src,old,replacement);
 execute src;
end $patch$;

do $patch$ declare src text; old text; replacement text; begin
 src:=pg_get_functiondef('private.enqueue_saved_contract_reminder()'::regprocedure);
 old:=$old$new.category ~ '合約|合同|契約'$old$; replacement:=$new$not new.is_removed and private.document_section(new.category,new.directory_section)='contracts'$new$;
 if strpos(src,old)=0 then raise exception 'CONTRACT_SECTION_ANCHOR_MISSING: private.enqueue_saved_contract_reminder()';end if;
 src:=replace(src,old,replacement);
 execute src;
end $patch$;

drop trigger administrative_contract_reminder on private.administrative_documents;
create trigger administrative_contract_reminder after insert or update of contract_end,category,archived,directory_section
 on private.administrative_documents for each row execute function private.enqueue_saved_contract_reminder();
notify pgrst,'reload schema';
