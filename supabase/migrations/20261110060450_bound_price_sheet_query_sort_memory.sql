-- Keep catalog sorting in memory and allow this RPC to finish during brief load spikes.
alter function private.ingredient_supply_read(uuid) set work_mem to '24MB';
alter function public.baihuayuan_ingredient_prices(uuid,text,jsonb,uuid) set statement_timeout to '14s';
notify pgrst, 'reload schema';
