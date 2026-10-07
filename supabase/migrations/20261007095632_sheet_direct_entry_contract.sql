-- Existing administrative entry RPCs use an explicit source classification.
alter table public.receipt_upload_batches drop constraint receipt_upload_batches_group_mode_check;
alter table public.receipt_upload_batches add constraint receipt_upload_batches_group_mode_check
 check(group_mode in ('SAME_RECEIPT','SEPARATE_RECEIPTS','ADMIN_DIRECT'));
-- An unknown price stays NULL. Explicit administrative prices must survive the stock quote trigger.
do $$
declare src text;
begin
 select pg_get_functiondef('public.create_baihuayuan_transfer_backfill(uuid,uuid,uuid,uuid,numeric,text,numeric,timestamptz,text,text,text)'::regprocedure) into src;
 if position('if p_unit_price is null or p_unit_price<0 then' in src)=0 then raise exception 'TRANSFER_CONTRACT_CHANGED';end if;
 src:=replace(src,'if p_unit_price is null or p_unit_price<0 then','if p_unit_price is not null and (p_unit_price<0 or p_unit_price>=1e9 or p_unit_price::text in (''NaN'',''Infinity'',''-Infinity'')) then');
 src:=replace(src,'returning * into v_move;','returning * into v_move;
  update private.store_movements set unit_price_snapshot=p_unit_price,amount_snapshot=p_unit_price*p_quantity where id=v_move.id returning * into v_move;');
 execute src;
 select pg_get_functiondef('public.save_baihuayuan_sheet_row(uuid,text,uuid,jsonb,jsonb,uuid)'::regprocedure) into src;
 if position('if price is null then raise exception ''TRANSFER_PRICE_REQUIRED'';end if;' in src)=0 then raise exception 'SHEET_CONTRACT_CHANGED';end if;
 src:=replace(src,'-- Missing prices are explicitly pending, never converted to zero.','-- Missing prices remain unpriced, never converted to zero.');
 src:=replace(src,'if price is null then raise exception ''TRANSFER_PRICE_REQUIRED'';end if;','');
 execute src;
end $$;
