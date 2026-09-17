do $$
declare src text;
begin
  select pg_get_functiondef('public.import_pilot_inventory(uuid,jsonb)'::regprocedure) into src;
  if src not like '%on conflict (store_id, product_id) do nothing%' then
    raise exception 'Expected opening balance conflict clause not found';
  end if;
  src := replace(
    src,
    'on conflict (store_id, product_id) do nothing',
    'on conflict (store_id, product_id) do update set quantity = public.store_product_opening_balances.quantity + excluded.quantity'
  );
  execute src;
end $$;
