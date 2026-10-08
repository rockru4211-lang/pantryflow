-- Qualify the column separately from the stop/restore operation variable.
do $patch$
declare original text; patched text;
begin
 original:=pg_get_functiondef('public.baihuayuan_ingredient_prices(uuid,text,jsonb,uuid)'::regprocedure);
 patched:=replace(original,'and stopped and supplier_key in','and ingredient_supply_state.stopped and supplier_key in');
 if patched=original then raise exception 'SUPPLY_CONFIRMATION_PATCH_MISSING';end if;
 execute patched;
end $patch$;
notify pgrst,'reload schema';
