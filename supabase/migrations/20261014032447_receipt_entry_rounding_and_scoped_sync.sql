-- A receipt confirmation must not scan every historical receipt or quote every store item.
-- Keep the original full-store refresh for callers that explicitly request it.
do $migration$
declare src text;anchor text;
begin
 src:=pg_get_functiondef('private.refresh_ingredient_price_cache(uuid)'::regprocedure);
 src:=replace(src,'private.refresh_ingredient_price_cache(p_store uuid)','private.refresh_ingredient_price_cache(p_store uuid, p_products uuid[])');
 src:=replace(src,'where store_id=p_store;','where store_id=p_store and product_id=any(p_products);');
 src:=replace(src,'where z.store_id=p_store','where z.store_id=p_store and zp.product_id=any(p_products)');
 src:=replace(src,'where s.store_id=p_store','where s.store_id=p_store and nullif(item->>''product_id'','''')::uuid=any(p_products)');
 if strpos(src,'product_id=any(p_products)')=0 then raise exception 'SCOPED_CACHE_ANCHOR';end if;
 execute src;
 src:=pg_get_functiondef('private.sync_ingredient_prices(uuid,uuid)'::regprocedure);
 anchor:='jsonb_array_elements(private.baihuayuan_receipt_detail_ledger(p_store))';
 if strpos(src,anchor)=0 then raise exception 'SCOPED_SYNC_LEDGER_ANCHOR';end if;
 -- A completed batch is already represented by posted lines (the authoritative priority).
 src:=replace(src,anchor,$patch$jsonb_array_elements(case when p_batch is not null and exists(select 1 from public.receipt_upload_batches where id=p_batch and store_id=p_store and status='COMPLETED') then '[]'::jsonb else private.baihuayuan_receipt_detail_ledger(p_store) end)$patch$);
 anchor:='perform private.refresh_ingredient_price_cache(p_store);';
 if strpos(src,anchor)=0 then raise exception 'SCOPED_SYNC_CACHE_ANCHOR';end if;
 src:=replace(src,anchor,$patch$
 if p_batch is null then
  perform private.refresh_ingredient_price_cache(p_store);
 else
  perform private.refresh_ingredient_price_cache(p_store,coalesce((
   select array_agg(distinct r.product_id) from private.recipe_price_entries r
   where r.store_id=p_store and r.source_ref->>'batch_id'=p_batch::text and r.product_id is not null
  ),'{}'::uuid[]));
 end if;$patch$);
 execute src;
end $migration$;
revoke all on function private.refresh_ingredient_price_cache(uuid,uuid[]) from public,anon,authenticated;
