-- A supplier change updates a quote on the chosen ingredient. Preserve the
-- reviewed identity links when the invoice name or purchase pack changes.
do $switch$
declare source text; anchor text;
begin
 source:=pg_get_functiondef('public.baihuayuan_ingredient_prices(uuid,text,jsonb,uuid)'::regprocedure);
 anchor:=$old$  result:=private.ingredient_operation(p_store_id,'ingredient.save',p_data-'supplier_id',gen_random_uuid());$old$;
 if strpos(source,anchor)=0 then raise exception 'SUPPLIER_SWITCH_SAVE_ANCHOR';end if;
 execute replace(source,anchor,$new$
  if p_data ? 'supplier_receipt_id' then
   if m.id is null or m.canonical_ingredient_id is not null or sp is null
    or p_data->>'change_reason' is distinct from '鎖定進價'
    or not exists(select 1 from public.suppliers where id=sp and is_active)
   then raise exception 'INVALID_SUPPLIER_SWITCH' using errcode='22023';end if;
   if not exists(
    select 1 from private.live_ingredient_receipt_prices q
    join public.suppliers supplier on supplier.id=sp
    where q.id=(p_data->>'supplier_receipt_id')::uuid and q.store_id=p_store_id and q.price is not null
     and q.effective_date<=(now() at time zone 'Asia/Taipei')::date
     and lower(btrim(normalize(q.supplier,NFKC)))=lower(btrim(normalize(supplier.name,NFKC)))
     and (p_data#>>'{purchase,amount}')::numeric=q.price and p_data#>>'{purchase,unit}'=q.unit
     and p_data#>'{purchase,content_quantity}' is not distinct from q.purchase->'content_quantity'
     and p_data#>>'{purchase,content_unit}' is not distinct from q.purchase->>'content_unit'
     and not exists(select 1 from private.ingredient_supply_state stop join private.ingredient_masters rm on rm.id=stop.ingredient_id
      where stop.store_id=p_store_id and coalesce(rm.canonical_ingredient_id,rm.id)=m.id and stop.stopped
       and stop.supplier_key in ('*','id:'||sp,private.ingredient_supplier_key(jsonb_build_object('supplier_name',supplier.name))))
     and exists(select 1 from private.ingredient_aliases a join private.ingredient_masters r
      on r.id=a.ingredient_id and r.store_id=p_store_id
      where a.store_id=p_store_id and coalesce(r.canonical_ingredient_id,r.id)=m.id
       and (q.id=any(a.reference_ids) or (a.source_key='p:'||q.product_id::text
        and a.source_unit=private.recipe_unit(q.unit) and a.specification=q.specification)))
   ) then raise exception 'SUPPLIER_RECEIPT_CHANGED' using errcode='40001';end if;
   perform set_config('app.ingredient_supplier_switch',m.id::text,true);
  end if;
  result:=private.ingredient_operation(p_store_id,'ingredient.save',p_data-'supplier_id'-'supplier_receipt_id',gen_random_uuid());
  perform set_config('app.ingredient_supplier_switch','',true);
$new$);
 source:=pg_get_functiondef('private.assign_ingredient_canonical()'::regprocedure);
 anchor:=' if TG_OP=''UPDATE'' then';
 if strpos(source,anchor)=0 then raise exception 'SUPPLIER_SWITCH_IDENTITY_ANCHOR';end if;
 execute replace(source,anchor,anchor||$guard$
  if current_setting('app.ingredient_supplier_switch',true)=old.id::text then return new;end if;
$guard$);
 source:=pg_get_functiondef('private.detach_corrected_ingredient()'::regprocedure);
 anchor:=' if new.corrected or';
 if strpos(source,anchor)=0 then raise exception 'SUPPLIER_SWITCH_ALIAS_ANCHOR';end if;
 execute replace(source,anchor,$guard$
 if TG_OP='INSERT' and current_setting('app.ingredient_supplier_switch',true)=new.ingredient_id::text then return new;end if;
$guard$||anchor);
end
$switch$;
notify pgrst,'reload schema';
