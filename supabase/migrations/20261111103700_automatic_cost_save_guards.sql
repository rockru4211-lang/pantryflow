-- Treat displayed automatic quotes as optimistic concurrency evidence, never as
-- an intentional manual override. Original idempotency/role guards run first.
create function private.checked_automatic_cost_quote(actual jsonb,expected jsonb) returns numeric
language plpgsql immutable security invoker set search_path='' as $$
declare k text;
begin
 if expected is not null and expected<>'null'::jsonb then
  if jsonb_typeof(expected)<>'object' or not(expected?'price') then raise exception 'COST_QUOTE_CHANGED' using errcode='40001';end if;
  if (actual->>'price')::numeric is distinct from (expected->>'price')::numeric then raise exception 'COST_QUOTE_CHANGED' using errcode='40001';end if;
  foreach k in array array['unit','date','reference_id','batch_id','basis'] loop
   if expected?k and (actual->>k) is distinct from (expected->>k) then raise exception 'COST_QUOTE_CHANGED' using errcode='40001';end if;
  end loop;
 end if;
 return (actual->>'price')::numeric;
end $$;
revoke all on function private.checked_automatic_cost_quote(jsonb,jsonb) from public,anon,authenticated;

do $patch$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.confirm_store_transfer(uuid,jsonb)'::regprocedure);
 anchor:=$old$  v_supplier:=nullif(p_data->>'supplier_id','')::uuid;$old$;
 if strpos(src,anchor)=0 then raise exception 'AUTOMATIC_TRANSFER_SAVE_ANCHOR';end if;
 src:=replace(src,anchor,$new$  if p_data->>'price_mode'='automatic' then
    v_price:=private.checked_automatic_cost_quote(
      private.resolved_cost_quote(v_move.from_store_id,v_move.product_id,v_move.name,v_unit,(coalesce(v_move.occurred_at,v_move.created_at) at time zone 'Asia/Taipei')::date),
      p_data->'expected_cost_quote');
  end if;
$new$||anchor);
 execute src;

 src:=pg_get_functiondef('public.save_baihuayuan_sheet_row(uuid,text,uuid,jsonb,jsonb,uuid)'::regprocedure);
 anchor:=$old$   -- Missing prices remain unpriced, never converted to zero.$old$;
 if strpos(src,anchor)=0 then raise exception 'AUTOMATIC_SHEET_NEW_TRANSFER_ANCHOR';end if;
 src:=replace(src,anchor,$new$   if p_value->>'price_mode'='automatic' then
    price:=private.checked_automatic_cost_quote(private.resolved_cost_quote(source_store,product,null,unit_name,(p_value->>'date')::date),p_value->'expected_cost_quote');
   end if;
$new$||anchor);
 anchor:=$old$   if not (p_value ? 'purchase_price') then price:=coalesce(price,$old$;
 if strpos(src,anchor)=0 then raise exception 'AUTOMATIC_SHEET_NEW_WASTE_ANCHOR';end if;
 src:=replace(src,anchor,$new$   if p_value->>'price_mode'='automatic' then
    price:=private.checked_automatic_cost_quote(private.resolved_cost_quote(p_store_id,product,null,unit_name,(p_value->>'date')::date),p_value->'expected_cost_quote');
   end if;
$new$||anchor);
 anchor:=$old$  old_value:=to_jsonb(m);$old$;
 if strpos(src,anchor)=0 then raise exception 'AUTOMATIC_SHEET_TRANSFER_ANCHOR';end if;
 src:=replace(src,anchor,anchor||$new$
  if p_value->>'price_mode'='automatic' then
   price:=private.checked_automatic_cost_quote(private.resolved_cost_quote(m.from_store_id,m.product_id,m.name,unit_name,(p_value->>'date')::date),p_value->'expected_cost_quote');
  end if;
$new$);
 anchor:=$old$  old_value:=jsonb_build_object('record',to_jsonb(w),'review',to_jsonb(wr));$old$;
 if strpos(src,anchor)=0 then raise exception 'AUTOMATIC_SHEET_WASTE_ANCHOR';end if;
 src:=replace(src,anchor,anchor||$new$
  if p_value->>'price_mode'='automatic' then
   price:=private.checked_automatic_cost_quote(private.resolved_cost_quote(p_store_id,w.product_id,w.name,unit_name,(p_value->>'date')::date),p_value->'expected_cost_quote');
  end if;
$new$);
 execute src;

 src:=pg_get_functiondef('private.transfers_workspace_v2(uuid,jsonb)'::regprocedure);
 anchor:=$old$coalesce((private.resolved_cost_quote(m.from_store_id,m.product_id,m.name,m.unit,(coalesce(m.occurred_at,m.created_at) at time zone 'Asia/Taipei')::date)->>'price')::numeric,legacy.unit_price)$old$;
 if strpos(src,anchor)=0 then raise exception 'AUTOMATIC_TRANSFER_LEGACY_ANCHOR';end if;
 src:=replace(src,anchor,$new$(private.resolved_cost_quote(m.from_store_id,m.product_id,m.name,m.unit,(coalesce(m.occurred_at,m.created_at) at time zone 'Asia/Taipei')::date)->>'price')::numeric$new$);
 anchor:=$old$  'transfer_amount',case when m.review_status='CONFIRMED' then m.amount_snapshot else null end,$old$;
 if strpos(src,anchor)=0 then raise exception 'AUTOMATIC_TRANSFER_QUOTE_ANCHOR';end if;
 src:=replace(src,anchor,$new$  'cost_quote',case when m.review_status<>'CONFIRMED' then private.resolved_cost_quote(m.from_store_id,m.product_id,m.name,m.unit,(coalesce(m.occurred_at,m.created_at) at time zone 'Asia/Taipei')::date) end,
$new$||anchor);
 execute src;
end $patch$;
notify pgrst,'reload schema';
