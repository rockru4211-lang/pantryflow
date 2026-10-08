-- Preserve explicit incomplete price bases; round only new/corrected amounts.
do $$
declare src text;
begin
 select pg_get_functiondef('public.save_baihuayuan_sheet_row(uuid,text,uuid,jsonb,jsonb,uuid)'::regprocedure) into src;
 if position('price:=coalesce(price,(private.cost_quote' in src)=0 then raise exception 'SHEET_PRICE_CONTRACT_CHANGED';end if;
 src:=replace(src,'price:=coalesce(price,(private.cost_quote(p_store_id,product,null,unit_name,(p_value->>''date'')::date)->>''price'')::numeric);','if not (p_value ? ''purchase_price'') then price:=coalesce(price,(private.cost_quote(p_store_id,product,null,unit_name,(p_value->>''date'')::date)->>''price'')::numeric);end if;');
 src:=replace(src,'if price is null and m.review_status<>''CONFIRMED'' then','if price is null and not (p_value ? ''purchase_price'') and m.review_status<>''CONFIRMED'' then');
 src:=replace(src,'(p.base_unit=unit_name or p.count_unit=unit_name)','(p.base_unit=unit_name or p.count_unit=unit_name or (private.recipe_unit(unit_name) in (''g'',''ml'') and private.recipe_unit(unit_name) in (private.recipe_unit(p.base_unit),private.recipe_unit(p.count_unit))))');
 src:=replace(src,'amount_snapshot=price*quantity','amount_snapshot=round(price*quantity,2)');
 src:=replace(src,'amount=price*qty','amount=round(price*qty,2)');
 execute src;
 select pg_get_functiondef('public.create_baihuayuan_transfer_backfill(uuid,uuid,uuid,uuid,numeric,text,numeric,timestamptz,text,text,text)'::regprocedure) into src;
 if position('p_unit_price*p_quantity' in src)=0 then raise exception 'TRANSFER_PRICE_CONTRACT_CHANGED';end if;
 execute replace(src,'p_unit_price*p_quantity','round(p_unit_price*p_quantity,2)');
 select pg_get_functiondef('public.confirm_baihuayuan_waste(uuid,uuid,numeric,numeric)'::regprocedure) into src;
 if position('price:=coalesce(p_unit_price,private.waste_review_quote(w.id));' in src)=0 then raise exception 'WASTE_PRICE_CONTRACT_CHANGED';end if;
 src:=replace(src,'price:=coalesce(p_unit_price,private.waste_review_quote(w.id));','price:=case when w.source=''ADMIN_BACKFILL'' then p_unit_price else coalesce(p_unit_price,private.waste_review_quote(w.id)) end;');
 execute replace(src,'else price*qty end','else round(price*qty,2) end');
 -- Reviewed unit mappings remain valid when a manually saved standard has no invoice reference.
 select pg_get_functiondef('private.cost_quote(uuid,uuid,text,text,date)'::regprocedure) into src;
 if position('and nullif(v->>''selected_reference'','''')::uuid=any(a.reference_ids)' in src)=0 then raise exception 'STANDARD_MAPPING_CONTRACT_CHANGED';end if;
 execute replace(src,'and nullif(v->>''selected_reference'','''')::uuid=any(a.reference_ids)','');
end $$;
