-- Date-aware costing for pending movements; confirmed snapshots remain unchanged.
create or replace function private.waste_review_quote(p_waste uuid) returns numeric
language plpgsql stable security definer set search_path='' as $$
declare w private.waste_records;
begin
 select * into w from private.waste_records where id=p_waste;
 if not found or w.product_id is null then return null;end if;
 return (private.cost_quote(w.store_id,w.product_id,w.name,w.unit,coalesce(w.work_date,(w.created_at at time zone 'Asia/Taipei')::date))->>'price')::numeric;
end $$;
revoke all on function private.waste_review_quote(uuid) from public,anon,authenticated;
do $patch$
declare original text; revised text;
begin
 original:=pg_get_functiondef('private.confirm_store_transfer(uuid,jsonb)'::regprocedure);
 revised:=replace(original,'private.ingredient_price_quote(v_move.from_store_id,v_move.product_id,v_unit)',
 '(private.cost_quote(v_move.from_store_id,v_move.product_id,v_move.name,v_unit,(coalesce(v_move.occurred_at,v_move.created_at) at time zone ''Asia/Taipei'')::date)->>''price'')::numeric');
 if revised=original then raise exception 'Transfer confirmation price hook missing';end if;execute revised;
 original:=pg_get_functiondef('private.transfers_workspace_v2(uuid,jsonb)'::regprocedure);
 revised:=replace(original,'private.ingredient_price_quote(m.from_store_id,m.product_id,m.unit)',
 '(private.cost_quote(m.from_store_id,m.product_id,m.name,m.unit,(coalesce(m.occurred_at,m.created_at) at time zone ''Asia/Taipei'')::date)->>''price'')::numeric');
 if revised=original then raise exception 'Transfer read price hook missing';end if;execute revised;
 original:=pg_get_functiondef('public.save_baihuayuan_sheet_row(uuid,text,uuid,jsonb,jsonb,uuid)'::regprocedure);
 revised:=replace(original,'old_value:=to_jsonb(m);',
 'old_value:=to_jsonb(m);'||chr(10)||'  if price is null and m.review_status<>''CONFIRMED'' then price:=(private.cost_quote(m.from_store_id,m.product_id,m.name,unit_name,(p_value->>''date'')::date)->>''price'')::numeric;end if;');
 if revised=original then raise exception 'Transfer sheet price hook missing';end if;execute revised;
end $patch$;
notify pgrst,'reload schema';
