-- Correct one misassigned card during an active count. Reuse the existing
-- serialized move, draft CAS, collision checks, and immutable-history guards.
-- The original assign-zone action remains restricted to unclassified cards.
do $migration$
declare src text; needle text; replacement text;
begin
 select pg_get_functiondef('private.count_inline_operation(uuid,text,jsonb)'::regprocedure) into src;
 needle:='elsif p_action<>''count.assign-zone'' then';
 if position(needle in src)=0 then raise exception 'count move action source mismatch'; end if;
 src:=replace(src,needle,'elsif p_action not in (''count.assign-zone'',''count.move-zone'') then');
 needle:=$old$if regexp_replace(source.name,'[[:space:]]+','','g')<>'未分類' or source.id=target.id
   or regexp_replace(target.name,'[[:space:]]+','','g')='未分類' then raise exception 'UNCLASSIFIED_SOURCE_REQUIRED' using errcode='22023'; end if;$old$;
 replacement:=$new$if p_action='count.assign-zone' and (regexp_replace(source.name,'[[:space:]]+','','g')<>'未分類' or source.id=target.id
   or regexp_replace(target.name,'[[:space:]]+','','g')='未分類') then raise exception 'UNCLASSIFIED_SOURCE_REQUIRED' using errcode='22023'; end if;
 if source.id=target.id or regexp_replace(target.name,'[[:space:]]+','','g')='未分類' then
   raise exception 'INVALID_COUNT_ZONE_DESTINATION' using errcode='22023';
 end if;$new$;
 if position(needle in src)=0 then raise exception 'count move source guard mismatch'; end if;
 src:=replace(src,needle,replacement);
 src:=replace(src,'-- Move only this unclassified card.','-- Move only this active card.');
 execute src;

 -- Extend both the pre-cache permission check and the narrow action dispatch.
 -- Never let a revoked member replay a cached move by reusing its request UUID.
 select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src;
 needle:='(''count.assign-zone'',''count.ensure-zones'',''count.zone-create'',''count.zone-rename'')';
 if (length(src)-length(replace(src,needle,'')))/length(needle)<>2 then
   raise exception 'count move dispatcher source mismatch';
 end if;
 src:=replace(src,needle,'(''count.assign-zone'',''count.move-zone'',''count.ensure-zones'',''count.zone-create'',''count.zone-rename'')');
 execute src;
end $migration$;

notify pgrst,'reload schema';
