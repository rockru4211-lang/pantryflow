-- Recipe usage is immutable during pricing. Notes provide a per-recipe costing
-- equivalence, while shared quotes remain in their actual purchase/count unit.
create or replace function private.recipe_note_basis(line jsonb,source_text text default '') returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare pattern text:='^([0-9]+(?:\.[0-9]+)?)\s*(kg|g|公克|公斤|克|台斤|臺斤|斤|ml|l|公升|毫升)\s*(?:[（(]\s*|(?:使用|約用|約需|需|用|=|＝)\s*)([0-9]+(?:\.[0-9]+)?)\s*(顆|個|pcs?|片)(?:蛋黃|雞蛋|蛋)?\s*[)）]?\s*$';
 texts text[]; raw text; candidate text; matched text[]; split_line text[]; base_name text; basis jsonb; next_basis jsonb;
begin
 if line ? 'note' then texts:=array[coalesce(line->>'note','')];
 else
  base_name:=regexp_replace(regexp_replace(line->>'name','\s*[(（]\s*[0-9]+(?:\.[0-9]+)?\s*(?:顆|個|pcs?|片|份|包|瓶|盒)\s*[)）]\s*$','','i'),'\s+','','g');
  texts:=regexp_split_to_array(coalesce(source_text,''),E'\n');
 end if;
 foreach raw in array texts loop
  candidate:=btrim(raw);
  if not(line ? 'note') then
   split_line:=regexp_match(candidate,'^(.+?)\s*([0-9].*)$');
   if split_line is null or regexp_replace(split_line[1],'\s+','','g')<>base_name then continue;end if;
   candidate:=btrim(split_line[2]);
  end if;
  matched:=regexp_match(candidate,pattern,'i');
  if matched is null or matched[1]::numeric<=0 or matched[3]::numeric<=0 then continue;end if;
  next_basis:=jsonb_build_object('quantity',matched[1]::numeric,'unit',matched[2],'count',matched[3]::numeric,'countUnit',private.recipe_unit(matched[4]));
  if basis is not null and (
    (basis->>'quantity')::numeric*private.recipe_factor(basis->>'unit')<>(next_basis->>'quantity')::numeric*private.recipe_factor(next_basis->>'unit')
    or private.recipe_unit(basis->>'unit')<>private.recipe_unit(next_basis->>'unit')
    or basis->>'count'<>next_basis->>'count' or basis->>'countUnit'<>next_basis->>'countUnit') then return null;end if;
  basis:=coalesce(basis,next_basis);
 end loop;
 return basis;
end $$;
revoke all on function private.recipe_note_basis(jsonb,text) from public,anon,authenticated;

create or replace function private.recipe_cost(s uuid,doc jsonb,visited uuid[] default '{}') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare line jsonb; price jsonb; child jsonb; result jsonb; lines jsonb:='[]'; total numeric:=0; amount numeric; qty numeric; child_id uuid; missing integer:=0; reason text; basis jsonb; each_price numeric; item_key text; piece boolean; prices jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 prices:=private.recipe_prices(s);
 if cardinality(visited)>20 then raise exception 'INVALID_RECIPE_CYCLE' using errcode='22023';end if;
 for line in select value from jsonb_array_elements(coalesce(doc->'lines','[]')) loop
  amount:=null;reason:=null;price:=null;qty:=nullif(line->>'quantity','')::numeric;
  if qty is null or qty<=0 or nullif(btrim(line->>'unit'),'') is null then reason:='待填用量';
  elsif nullif(line->>'recipe_id','') is not null then
   child_id:=(line->>'recipe_id')::uuid;
   if child_id=any(visited) then raise exception 'INVALID_RECIPE_CYCLE' using errcode='22023';end if;
   select document into child from private.recipe_cards where id=child_id and store_id=s;
   if child is null then raise exception 'INVALID_RECIPE_REFERENCE' using errcode='22023';end if;
   result:=private.recipe_cost(s,child,array_append(visited,child_id));
   if result->>'total' is null then reason:='備料成本未完整';
   elsif nullif(child->>'yield','')::numeric is null or (child->>'yield')::numeric<=0 then reason:='待填製成量';
   elsif private.recipe_unit(child->>'unit')<>private.recipe_unit(line->>'unit') then reason:='待確認單位換算';
   else amount:=(result->>'total')::numeric*qty*private.recipe_factor(line->>'unit')/((child->>'yield')::numeric*private.recipe_factor(child->>'unit'));end if;
  else
   item_key:=case when nullif(line->>'product_id','') is not null then 'p:'||(line->>'product_id') else 'n:'||lower(btrim(line->>'name')) end;
   basis:=private.recipe_note_basis(line,coalesce(doc->>'notes',''));piece:=false;
   if basis is not null and private.recipe_unit(basis->>'unit')=private.recipe_unit(line->>'unit') and basis->>'countUnit'<>private.recipe_unit(line->>'unit') then
    select value into price from jsonb_array_elements(prices) where value->>'key'=item_key and value->>'unit'=basis->>'countUnit' limit 1;
    if price is null then
     select value into price from jsonb_array_elements(prices) where value->>'key'=item_key and value->>'unit'=private.recipe_unit(line->>'unit') and private.recipe_unit(value->'purchase'->>'unit')=basis->>'countUnit' limit 1;
    end if;
    piece:=price is not null;
   end if;
   if piece then
    if price->>'unit'=basis->>'countUnit' then each_price:=coalesce((price->>'cost_price')::numeric,(price->>'price')::numeric);
    else each_price:=coalesce((price->'purchase'->>'cost_unit_price')::numeric,
      case when (price->'purchase'->>'quantity')::numeric>0 then (price->'purchase'->>'amount')::numeric/(price->'purchase'->>'quantity')::numeric else (price->>'price')::numeric end);end if;
    if each_price>=0 then amount:=each_price*qty*private.recipe_factor(line->>'unit')*(basis->>'count')::numeric/((basis->>'quantity')::numeric*private.recipe_factor(basis->>'unit'));
    else reason:='待補價格或換算';end if;
   else
    select value into price from jsonb_array_elements(prices) where value->>'key'=item_key and value->>'unit'=private.recipe_unit(line->>'unit') limit 1;
    if price is null then reason:='待補價格或換算';
    elsif private.recipe_unit(price->'purchase'->>'unit') in ('顆','片') and private.recipe_unit(line->>'unit')<>private.recipe_unit(price->'purchase'->>'unit') then reason:='備註待補換算';
    else amount:=coalesce((price->>'cost_price')::numeric,(price->>'price')::numeric)*qty*private.recipe_factor(line->>'unit');end if;
   end if;
  end if;
  if amount is null then missing:=missing+1;else total:=total+amount;end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('id',line->>'id','amount',amount,'reason',reason,'price',price));
 end loop;
 if jsonb_array_length(lines)=0 then missing:=missing+1;end if;
 return jsonb_build_object('total',case when missing=0 then total end,'subtotal',total,'missing',missing,'lines',lines);
end $$;
notify pgrst,'reload schema';
