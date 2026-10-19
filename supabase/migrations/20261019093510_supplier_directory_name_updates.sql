-- Central supplier edits retain old spellings and reject claims on another identity.
-- Reuse the existing role checks, revision guard, request audit and transaction.
do $migration$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure);
 anchor:=$old$  else
   if v_id is null then
    
 perform pg_advisory_xact_lock(hashtextextended(v_org::text||':supplier-create',0));$old$;
 if strpos(definition,anchor)=0 then raise exception 'supplier save lock anchor missing';end if;
 definition:=replace(definition,anchor,$new$  else
   -- Share the inbox resolver lock before taking any supplier row locks.
   perform pg_advisory_xact_lock(hashtextextended(v_org::text||':supplier-names',0));
   perform pg_advisory_xact_lock(hashtextextended(v_org::text||':supplier-create',0));
   if v_id is null then
    $new$);
 anchor:=$old$    if v_supplier.is_removed then raise exception 'DIRECTORY_REMOVED' using errcode='22023';end if;$old$;
 if strpos(definition,anchor)=0 then raise exception 'supplier shadow guard anchor missing';end if;
 definition:=replace(definition,anchor,anchor||$new$
    if exists(select 1 from private.supplier_name_links l where l.organization_id=v_org
      and l.name_key=private.history_key(v_supplier.name) and l.supplier_id<>v_supplier.id)
    then raise exception 'INVALID_SUPPLIER_TARGET' using errcode='22023';end if;$new$);
 anchor:=$old$   v_result:=to_jsonb(v_supplier)||coalesce((select to_jsonb(d)-'supplier_id' from private.supplier_details d where d.supplier_id=v_id),'{}'::jsonb);$old$;
 if strpos(definition,anchor)=0 then raise exception 'supplier result anchor missing';end if;
 definition:=replace(definition,anchor,$new$
   -- Validate newly claimed names. An unchanged legacy alias does not block contact edits.
   if exists(
    with candidates as (
     select v_supplier.name as name where v_old->>'name' is distinct from v_supplier.name
     union select v_old->>'name' where v_old->>'name' is not null and v_old->>'name'<>v_supplier.name
     union select a from private.supplier_details d cross join unnest(d.aliases) a
       where d.supplier_id=v_id and not exists(
        select 1 from jsonb_array_elements_text(coalesce(v_old->'aliases','[]')) old_alias
        where private.history_key(old_alias)=private.history_key(a))
    )
    select 1 from candidates c where exists(
     select 1 from private.supplier_name_links l where l.organization_id=v_org
      and l.name_key=private.history_key(c.name) and l.supplier_id<>v_id
    ) or exists(
     select 1 from public.suppliers s where s.organization_id=v_org and s.id<>v_id
      and not exists(select 1 from private.supplier_name_links shadow where shadow.organization_id=v_org
       and shadow.name_key=private.history_key(s.name) and shadow.supplier_id<>s.id)
      and (private.history_key(s.name)=private.history_key(c.name) or exists(
       select 1 from unnest(private.supplier_display_aliases(s.id)) a where private.history_key(a)=private.history_key(c.name)))
    )
   ) then raise exception 'SUPPLIER_NAME_CONFLICT' using errcode='23505';end if;
   -- Retain previous names independently of the editable alias field, including paused suppliers.
   if v_old->>'name' is not null and v_old->>'name'<>v_supplier.name then
    insert into private.supplier_name_links(organization_id,name_key,source_name,supplier_id,confirmed_by,evidence)
    values(v_org,private.history_key(v_old->>'name'),v_old->>'name',v_id,auth.uid(),'DIRECTORY_RENAME')
    on conflict(organization_id,name_key) do nothing;
   end if;
   v_result:=to_jsonb(v_supplier)||coalesce((select to_jsonb(d)-'supplier_id' from private.supplier_details d where d.supplier_id=v_id),'{}'::jsonb)
    ||jsonb_build_object('aliases',private.supplier_display_aliases(v_id));$new$);
 execute definition;
end $migration$;
notify pgrst,'reload schema';
