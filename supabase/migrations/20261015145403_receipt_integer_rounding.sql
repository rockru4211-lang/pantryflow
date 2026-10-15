-- Preserve precise costs, source fingerprints, permissions and stored amounts.
-- Only an integer printed total may use whole-dollar rounding.
do $migration$
declare signature text; definition text; old_gate text; new_gate text;
begin
 foreach signature in array array[
  'private.receipt_account_rows(uuid,date,date,text,uuid)',
  'public.save_baihuayuan_receipt_reconciliation(uuid,uuid,jsonb,uuid)',
  'public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  old_gate:=case when signature like 'private.%' then 'abs(net+tax-stated_total)>0.01' else 'abs(net+tax-total)>0.01' end;
  new_gate:=case when signature like 'private.%'
   then '(abs(net+tax-stated_total)>0.01 and not (stated_total=trunc(stated_total) and round(round(net+tax,4))=stated_total))'
   else '(abs(net+tax-total)>0.01 and not (total=trunc(total) and round(round(net+tax,4))=total))' end;
  if strpos(definition,new_gate)>0 then continue; end if;
  if (length(definition)-length(replace(definition,old_gate,'')))/length(old_gate)<>1 then
   raise exception 'Unexpected receipt amount gate in %',signature;
  end if;
  execute replace(definition,old_gate,new_gate);
 end loop;
end;
$migration$;
