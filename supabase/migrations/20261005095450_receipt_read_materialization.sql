-- Preserve receipt values, fingerprints and permissions; evaluate each expensive stage once.
do $$
declare src text; stage text;
begin
 src:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
 foreach stage in array array['raw_lines','grouped','source','amounts','reconciled','ready'] loop
  if position(', '||stage||' as materialized (' in src)>0 then continue;end if;
  if position(', '||stage||' as (' in src)=0 then raise exception 'Receipt query stage missing: %',stage;end if;
  src:=replace(src,', '||stage||' as (',', '||stage||' as materialized (');
 end loop;
 execute src;
end $$;
