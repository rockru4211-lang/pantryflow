do $migration$
declare source text;next text;
begin
 select pg_get_functiondef('public.get_pilot_count_details(uuid)'::regprocedure) into source;
 next:=replace(source,'''product_id'',e.product_id','''product_id'',e.product_id,''difference'',d.difference,''confirmed_quantity'',coalesce(final.quantity,e.quantity),''correction_reason'',d.reason,''confirmed_at'',d.answered_at,''confirmed_by'',confirmer.display_name');
 next:=replace(next,'join public.products p on p.id=e.product_id','join public.products p on p.id=e.product_id
  left join public.inventory_count_discrepancies d on d.initial_entry_id=e.id
  left join public.count_entries final on final.id=d.final_entry_id
  left join public.profiles confirmer on confirmer.id=d.answered_by');
 if next=source then raise exception 'Count details source not found';end if;
 execute next;
end $migration$;
notify pgrst,'reload schema';
