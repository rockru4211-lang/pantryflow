-- Keep source prices in discount metadata; all existing cost consumers see net prices.
create or replace function private.receipt_discount_line(line jsonb, previous jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare d jsonb; base numeric; value numeric; q numeric; amount numeric; price numeric;
begin
 if not (line ? 'discount') then
  -- Older clients may edit non-price fields without erasing the discount evidence.
  if (line->'quantity',line->'unit_price',line->'subtotal') is not distinct from (previous->'quantity',previous->'unit_price',previous->'subtotal') then
   line:=line||jsonb_build_object('discount',previous->'discount');
  else line:=line||'{"discount":null}'::jsonb;end if;
 end if;
 d:=line->'discount';
 if d is null or d='null'::jsonb then return line;end if;
 if jsonb_typeof(d)<>'object' or coalesce(d->>'kind','') not in ('PERCENT','AMOUNT') or coalesce(line->>'handling','NORMAL')='CUSTODY_RELEASE' then raise exception 'INVALID_RECEIPT_DISCOUNT' using errcode='22023';end if;
 base:=private.receipt_account_number(d->>'base_price');value:=private.receipt_account_number(d->>'value');q:=private.receipt_account_number(line->>'quantity');
 if value is null or value<0 or value>=1e9 or (d->>'kind'='PERCENT' and value>100) or base<0 or base>=1e9 or (d->>'base_price' is not null and base is null) then raise exception 'INVALID_RECEIPT_DISCOUNT' using errcode='22023';end if;
 if base is null or q is null or q<=0 then
  amount:=null;price:=case when base is not null and d->>'kind'='PERCENT' then round(base*(1-value/100),4) end;
 else
  amount:=case when d->>'kind'='PERCENT' then round(round(base*q,4)*(1-value/100),4) else round(round(base*q,4)-value,4) end;
  if amount<0 then raise exception 'INVALID_RECEIPT_DISCOUNT' using errcode='22023';end if;
  price:=round(amount/q,4);
 end if;
 if price is distinct from private.receipt_account_number(line->>'unit_price') or amount is distinct from private.receipt_account_number(line->>'subtotal') then raise exception 'INVALID_RECEIPT_DISCOUNT' using errcode='22023';end if;
 return line||jsonb_build_object('discount',jsonb_build_object('kind',d->>'kind','base_price',base,'value',value));
end $$;
revoke all on function private.receipt_discount_line(jsonb,jsonb) from public,anon,authenticated;
do $$
declare definition text; changed text; anchor text;
begin
 definition:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 if position('-- receipt_line_discounts_v1' in definition)>0 then return;end if;
 anchor:='q:=private.receipt_account_number(l->>''quantity'');price:=private.receipt_account_number(l->>''unit_price'');subtotal:=private.receipt_account_number(l->>''subtotal'');';
 if position(anchor in definition)=0 then raise exception 'discount save anchor missing';end if;
 changed:=replace(definition,anchor,'-- receipt_line_discounts_v1'||chr(10)||'l:=private.receipt_discount_line(l,(select x from jsonb_array_elements(current_row->''lines'') x where x->>''row_key''=l->>''row_key''));'||chr(10)||anchor);
 anchor:='into delta from jsonb_each(l) where key in (';
 if position(anchor in changed)=0 then raise exception 'discount metadata anchor missing';end if;
 changed:=replace(changed,anchor,anchor||'''discount'',');
 execute changed;
end $$;
notify pgrst,'reload schema';
