-- Future explicit automatic report-unit edits remain live quotes. No stored rows
-- or closures are changed; legacy/manual requests retain their existing behavior.
do $patch$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('public.save_baihuayuan_inventory_inline_v3(uuid,date,uuid,text,jsonb,text,text,numeric,numeric,text)'::regprocedure);
 anchor:='declare preserve_auto boolean;';
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_AUTO_UNIT_DECLARATION_ANCHOR';end if;
 src:=replace(src,anchor,'declare auto_quote jsonb; expected_quote jsonb; quote_key text; preserve_auto boolean;');
 anchor:=' result:=public.save_baihuayuan_inventory_inline_v2';
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_AUTO_UNIT_SAVE_ANCHOR';end if;
 src:=replace(src,anchor,$new$ if p_expected->>'price_mode'='automatic' then
  expected_quote:=p_expected->'expected_cost_quote';
  if jsonb_typeof(expected_quote) is distinct from 'object' or not(expected_quote?'price') then
   raise exception 'COST_QUOTE_CHANGED' using errcode='40001';end if;
  auto_quote:=private.inventory_price_quote(p_store_id,nullif(r->>'product_id','')::uuid,r->>'name',btrim(p_unit),private.inventory_count_date(p_session_id));
  -- Missing-cost responses may omit unit; the resolver still uses the requested
  -- report unit and count date. A priced quote must always carry its unit.
  if not(expected_quote?'unit') and (expected_quote->>'price' is not null or auto_quote->>'price' is not null) then
   raise exception 'COST_QUOTE_CHANGED' using errcode='40001';end if;
  perform private.checked_automatic_cost_quote(auto_quote,expected_quote);
  -- Require source identity even if a receipt replacement has the same amount.
  foreach quote_key in array array['unit','date','reference_id','batch_id','basis','store_id','ingredient_id','reason'] loop
   if quote_key='unit' and not(expected_quote?'unit') and expected_quote->>'price' is null and auto_quote->>'price' is null then continue;end if;
   if auto_quote->>quote_key is distinct from expected_quote->>quote_key then
    raise exception 'COST_QUOTE_CHANGED' using errcode='40001';end if;
  end loop;
  if (auto_quote->>'price')::numeric is distinct from p_unit_price then
   raise exception 'COST_QUOTE_CHANGED' using errcode='40001';end if;
  preserve_auto:=true;
 end if;
$new$||anchor);
 execute src;

 src:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
 anchor:=$old$private.inventory_price_quote(p_store,nullif(c->>'product_id','')::uuid,c->>'name',c->>'unit',valuation_date) end cost_quote from paired$old$;
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_AUTO_REPORT_UNIT_QUOTE_ANCHOR';end if;
 src:=replace(src,anchor,$new$private.inventory_price_quote(p_store,nullif(c->>'product_id','')::uuid,c->>'name',coalesce(quote_review.report_unit,c->>'unit'),valuation_date) end cost_quote from paired
   left join private.inventory_month_reviews quote_review on quote_review.store_id=p_store and quote_review.month=p_month
    and quote_review.session_id=source.id and quote_review.row_key=paired.row_key and quote_review.source_signature=paired.signature$new$);
 execute src;
end $patch$;
notify pgrst,'reload schema';
