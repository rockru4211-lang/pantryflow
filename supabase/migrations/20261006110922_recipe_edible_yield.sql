-- Only explicitly selected net weights add trim loss. Existing documents stay unchanged.
CREATE OR REPLACE FUNCTION private.recipe_edible_factor(line jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $function$
declare raw text; rate numeric;
begin
 if nullif(line->>'recipe_id','') is not null or coalesce(line->>'quantity_basis','')<>'net' then return 1;end if;
 raw:=coalesce(nullif(btrim(line->>'edible_rate'),''),'1');
 if raw!~'^(\d+(\.\d*)?|\.\d+)$' then return null;end if;
 rate:=raw::numeric;
 if rate<=0 or rate>1 then return null;end if;
 return 1/rate;
end $function$;
REVOKE ALL ON FUNCTION private.recipe_edible_factor(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.recipe_cost_indexed(s uuid, doc jsonb, visited uuid[], price_index jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare line jsonb; price jsonb; direct jsonb; child jsonb; result jsonb; lines jsonb:='[]'; total numeric:=0; amount numeric; qty numeric; child_id uuid; missing integer:=0; reason text; basis jsonb; each_price numeric; item_key text; piece boolean; prices jsonb; all_prices jsonb; explicit_package boolean; edible_factor numeric;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;

 if cardinality(visited)>20 then raise exception 'INVALID_RECIPE_CYCLE' using errcode='22023';end if;
 for line in select value from jsonb_array_elements(coalesce(doc->'lines','[]')) loop
  amount:=null;reason:=null;price:=null;direct:=null;qty:=nullif(line->>'quantity','')::numeric;
  if qty is null or qty<=0 or nullif(btrim(line->>'unit'),'') is null then reason:='待填用量';
  elsif nullif(line->>'recipe_id','') is not null then
   child_id:=(line->>'recipe_id')::uuid;
   if child_id=any(visited) then raise exception 'INVALID_RECIPE_CYCLE' using errcode='22023';end if;
   select document into child from private.recipe_cards where id=child_id and store_id=s;
   if child is null then raise exception 'INVALID_RECIPE_REFERENCE' using errcode='22023';end if;
   result:=private.recipe_cost_indexed(s,child,array_append(visited,child_id),price_index);
   if result->>'total' is null then reason:='備料成本未完整';
   elsif nullif(child->>'yield','')::numeric is null or (child->>'yield')::numeric<=0 then reason:='待填製成量';
   elsif private.recipe_unit(child->>'unit')<>private.recipe_unit(line->>'unit') then reason:='待確認單位換算';
   else amount:=(result->>'total')::numeric*qty*private.recipe_factor(line->>'unit')/((child->>'yield')::numeric*private.recipe_factor(child->>'unit'));end if;
  else
   item_key:=case when nullif(line->>'ingredient_id','') is not null then 'i:'||(line->>'ingredient_id') when nullif(line->>'product_id','') is not null then 'p:'||(line->>'product_id') else 'n:'||lower(btrim(line->>'name')) end;
   prices:=private.recipe_effective_prices(line,coalesce(price_index->item_key,'[]'::jsonb));
   select value into direct from jsonb_array_elements(prices) where value->>'key'=item_key and value->>'unit'=private.recipe_unit(line->>'unit') limit 1;
   explicit_package:=coalesce(direct->'purchase'->>'conversion_basis'='package' and (direct->'purchase'->>'content_quantity')::numeric>0 and private.recipe_unit(direct->'purchase'->>'content_unit')=private.recipe_unit(line->>'unit'),false);
   basis:=private.recipe_note_basis(line,coalesce(doc->>'notes',''));piece:=false;
   if not explicit_package and basis is not null and private.recipe_unit(basis->>'unit')=private.recipe_unit(line->>'unit') and basis->>'countUnit'<>private.recipe_unit(line->>'unit') then
    select value into price from jsonb_array_elements(prices) where value->>'key'=item_key and value->>'unit'=basis->>'countUnit' limit 1;
    if price is null then select value into price from jsonb_array_elements(prices) where value->>'key'=item_key and value->>'unit'=private.recipe_unit(line->>'unit') and private.recipe_unit(value->'purchase'->>'unit')=basis->>'countUnit' limit 1;end if;
    piece:=price is not null;
   end if;
   if piece then
    if price->>'unit'=basis->>'countUnit' then each_price:=coalesce((price->>'cost_price')::numeric,(price->>'price')::numeric);
    else each_price:=coalesce((price->'purchase'->>'cost_unit_price')::numeric,case when (price->'purchase'->>'quantity')::numeric>0 then (price->'purchase'->>'amount')::numeric/(price->'purchase'->>'quantity')::numeric else (price->>'price')::numeric end);end if;
    if each_price>=0 then amount:=each_price*qty*private.recipe_factor(line->>'unit')*(basis->>'count')::numeric/((basis->>'quantity')::numeric*private.recipe_factor(basis->>'unit'));else reason:='待補價格或換算';end if;
   else
    price:=direct;
    if price is null then reason:='待補價格或換算';
    elsif private.recipe_unit(price->'purchase'->>'unit') in ('顆','片') and private.recipe_unit(line->>'unit')<>private.recipe_unit(price->'purchase'->>'unit') and not explicit_package then reason:='待確認單位換算';
    else amount:=coalesce((price->>'cost_price')::numeric,(price->>'price')::numeric)*qty*private.recipe_factor(line->>'unit');end if;
   end if;
  end if;
  edible_factor:=private.recipe_edible_factor(line);
  if edible_factor is null then amount:=null;reason:='可食用率需大於 0 且不超過 1';elsif amount is not null then amount:=amount*edible_factor;end if;
  if amount is null then missing:=missing+1;else total:=total+amount;end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('id',line->>'id','amount',amount,'reason',reason,'price',price));
 end loop;
 if jsonb_array_length(lines)=0 then missing:=missing+1;end if;
 return jsonb_build_object('total',case when missing=0 then total end,'subtotal',total,'missing',missing,'lines',lines);
end $function$
;
CREATE OR REPLACE FUNCTION private.recipe_locked_cost(doc jsonb, approved_doc jsonb, approved_cost jsonb, proposed_cost jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  line jsonb;
  saved_line jsonb;
  saved_cost jsonb;
  proposed_line jsonb;
  chosen jsonb;
  lines jsonb := '[]'::jsonb;
  total numeric := 0;
  amount numeric;
  old_qty numeric;
  new_qty numeric;
  missing integer := 0;
  same_identity boolean;
  normalized jsonb;
  edible_factor numeric; old_edible_factor numeric;
begin
  for line in select value from jsonb_array_elements(coalesce(doc->'lines','[]'::jsonb)) loop
    saved_line := null;
    saved_cost := null;
    proposed_line := null;
    chosen := null;
    amount := null;

    select value into saved_line
    from jsonb_array_elements(coalesce(approved_doc->'lines','[]'::jsonb))
    where value->>'id'=line->>'id' limit 1;

    select value into saved_cost
    from jsonb_array_elements(coalesce(approved_cost->'lines','[]'::jsonb))
    where value->>'id'=line->>'id' limit 1;

    select value into proposed_line
    from jsonb_array_elements(coalesce(proposed_cost->'lines','[]'::jsonb))
    where value->>'id'=line->>'id' limit 1;

    same_identity := saved_line is not null
      and coalesce(saved_line->>'name','')=coalesce(line->>'name','')
      and coalesce(saved_line->>'product_id','')=coalesce(line->>'product_id','')
      and coalesce(saved_line->>'ingredient_id','')=coalesce(line->>'ingredient_id','')
      and coalesce(saved_line->>'recipe_id','')=coalesce(line->>'recipe_id','') and coalesce(saved_line->>'cost_revision','')=coalesce(line->>'cost_revision','');

    edible_factor:=private.recipe_edible_factor(line);old_edible_factor:=private.recipe_edible_factor(saved_line);
    if same_identity and edible_factor is not null and old_edible_factor is not null
       and saved_cost is not null
       and saved_cost->'amount' is not null
       and jsonb_typeof(saved_cost->'amount')='number' then
      old_qty := nullif(saved_line->>'quantity','')::numeric;
      new_qty := nullif(line->>'quantity','')::numeric;
      if old_qty is not null and old_qty>0 and new_qty is not null and new_qty>0 then
        if private.recipe_unit(saved_line->>'unit')=private.recipe_unit(line->>'unit') then
          amount := (saved_cost->>'amount')::numeric * new_qty * private.recipe_factor(line->>'unit') * edible_factor / (old_qty * private.recipe_factor(saved_line->>'unit') * old_edible_factor);
          chosen := saved_cost || jsonb_build_object('amount',amount,'reason',null);
        else
          begin
            normalized:=private.recipe_purchase_value(saved_cost#>'{price,purchase}',line->>'unit');
            amount:=coalesce((normalized->>'cost_price')::numeric,(normalized->>'price')::numeric)*new_qty*private.recipe_factor(line->>'unit')*edible_factor;
            chosen:=saved_cost||jsonb_build_object('amount',amount,'reason',case when amount is null then '待補包裝換算' end);
          exception when sqlstate '22023' or division_by_zero or invalid_text_representation then
            chosen:=saved_cost||jsonb_build_object('amount',null,'reason','待補包裝換算');
          end;
        end if;
      end if;
    end if;

    -- A formerly missing saved line is not treated as a locked zero/null.
    -- Use the current calculable proposal for that line instead.
    if chosen is null then
      chosen := coalesce(proposed_line,jsonb_build_object(
        'id',line->>'id','amount',null,'reason','待補價格或換算','price',null
      ));
      if chosen->'amount' is not null and jsonb_typeof(chosen->'amount')='number' then
        amount := (chosen->>'amount')::numeric;
      else
        amount := null;
      end if;
    end if;

    if amount is null then missing := missing + 1;
    else total := total + amount;
    end if;
    lines := lines || jsonb_build_array(chosen);
  end loop;

  if jsonb_array_length(lines)=0 then missing := missing + 1; end if;
  return jsonb_build_object(
    'total',case when missing=0 then total end,
    'subtotal',total,
    'missing',missing,
    'lines',lines
  );
end $function$
;
