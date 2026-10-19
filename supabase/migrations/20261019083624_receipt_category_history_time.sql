-- Expose the existing save timestamp through the already scoped receipt reader.
-- No data rewrite, new writer, permission grant, or change to financial fingerprints.
do $migration$
declare source text; anchor text := $anchor$'receipt_categories',coalesce($anchor$;
begin
 select pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure) into source;
 if strpos(source,'''edited_at''')>0 then return;end if;
 if strpos(source,anchor)=0 then raise exception 'RECEIPT_CATEGORY_HISTORY_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,$replacement$'edited_at',(select classification.updated_at from private.receipt_account_edits classification where classification.batch_id=a.id and classification.store_id=p_store),
  'receipt_categories',coalesce($replacement$);
 execute source;
end $migration$;
