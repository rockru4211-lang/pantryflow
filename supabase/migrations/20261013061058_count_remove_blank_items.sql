-- BeApe: an unused blank item can be excluded without manufacturing a zero count.
-- Preserve all evidence and retain the nonzero-stock, version and store guards.
do $$declare def text;old_block text;start_at integer;end_at integer;begin
 def:=pg_get_functiondef('private.count_field_lifecycle(uuid,text,jsonb)'::regprocedure);
 start_at:=strpos(def,'  -- Explicit zero is required');
 end_at:=strpos(def,'  insert into private.count_field_removed');
 if start_at=0 or end_at<=start_at then raise exception 'COUNT_REMOVE_ANCHOR_MISSING';end if;
 old_block:=substr(def,start_at,end_at-start_at);
 def:=replace(def,old_block,$new$  if private.feature_scope(s) then
   if exists(select 1 from public.count_drafts where session_id=cs.id and product_id=pid and quantity<>0)
    or exists(select 1 from private.current_count_entries where session_id=cs.id and product_id=pid and quantity<>0)
   then raise exception 'COUNT_FIELD_ZERO_REQUIRED' using errcode='22023';end if;
  else
$new$||old_block||E'  end if;\n');
 execute def;
end $$;
