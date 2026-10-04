-- Avoid a full confirmed-quotation scan for each pending import entry.
create index if not exists recipe_confirmed_import_lookup
on private.recipe_price_entries (store_id,(source_ref->>'import_key'))
where review_status='confirmed';
