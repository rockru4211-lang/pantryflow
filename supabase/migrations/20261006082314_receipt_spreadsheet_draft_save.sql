-- Saving entered receipt data is separate from confirming a financial reconciliation.
-- Keep permissions, row identities, custody locks, revision checks and numeric parsing.
do $$
declare definition text; changed text;
begin
 definition:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 changed:=replace(definition,
  'or coalesce(l->>''category'','''') not in (''食材'',''耗材'',''調料'',''酒水'',''待分類'') or q<=0 or price<0 or',
  'or length(coalesce(l->>''category'',''''))>40 or');
 changed:=replace(changed,'or scale(q)>4 or scale(price)>4 or scale(subtotal)>4','');
 changed:=replace(changed,'incomplete:=incomplete or q is null or','incomplete:=incomplete or q is null or q<=0 or price<0 or');
 if changed=definition then raise exception 'Receipt save validation patch not applied';end if;
 execute changed;
end $$;
notify pgrst,'reload schema';
