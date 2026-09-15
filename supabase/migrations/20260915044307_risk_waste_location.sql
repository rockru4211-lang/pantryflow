-- Carry an existing risk location into the existing waste transaction.
do $migration$
declare definition text; needle text:='   item_name:=coalesce(item.name,btrim(p_data->>''name''));';
begin
 select pg_get_functiondef('private.expiry_waste_command(uuid,uuid,text,jsonb)'::regprocedure) into definition;
 if position(needle in definition)=0 then raise exception 'Unexpected expiry command version'; end if;
 definition:=replace(definition,needle,$code$   if eid is null and nullif(p_data->>'risk_id','') is not null then
    select * into risk from private.expiry_risk_locations where id=(p_data->>'risk_id')::uuid and store_id=p_store_id and is_active;
    if not found then raise exception 'RISK_NOT_FOUND'; end if;
    item.zone_id:=risk.zone_id; item.zone_name:=risk.zone_name;
   end if;
$code$||needle);
 execute definition;
end $migration$;
