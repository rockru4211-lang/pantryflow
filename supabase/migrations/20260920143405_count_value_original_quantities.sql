-- A discrepancy's confirmed quantity is a product total across all zones.
-- Preserve per-zone original count values; never add that total to other zones again.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.get_pilot_count_details(uuid)'::regprocedure) into definition;
 if position('round(coalesce(final.quantity,e.quantity)*price.unit_price,2)' in definition)=0 then
   raise exception 'COUNT_VALUE_PATCH_TARGET_MISSING';
 end if;
 execute replace(definition,'round(coalesce(final.quantity,e.quantity)*price.unit_price,2)','round(e.quantity*price.unit_price,2)');
end $$;
notify pgrst,'reload schema';
