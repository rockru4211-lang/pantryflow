-- Qualify the selected OCR run so publishing never selects another run's manual rows.
do $migration$
declare source text; anchor text;
begin
 select pg_get_functiondef('private.publish_receipt(uuid,uuid,boolean)'::regprocedure) into source;
 anchor:='where batch_id=b.id and run_id=run_id and deleted_at is null';
 if strpos(source,anchor)=0 then raise exception 'MANUAL_RUN_ANCHOR_MISSING';end if;
 source:=replace(source,E'declare\n',E'<<receipt_publication>>\ndeclare\n');
 source:=replace(source,anchor,'where batch_id=b.id and receipt_manual_rows.run_id=receipt_publication.run_id and deleted_at is null');
 execute source;
end $migration$;
