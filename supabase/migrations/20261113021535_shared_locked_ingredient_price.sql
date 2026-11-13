-- An explicit lock is an ordinary standard-price version with a distinct
-- reason. Existing automatic quotes and historical prices keep their meaning.
create function private.locked_ingredient_quote(
 snapshot jsonb, effective_date date, supplier text, requested_unit text, target_package jsonb
) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare purchase jsonb:=snapshot->'purchase'; price numeric; requested_base text:=private.recipe_unit(requested_unit);
begin
 if target_package is not null then
  price:=private.cost_purchase_price(purchase,target_package->>'unit')*(target_package->>'quantity')::numeric;
 elsif requested_base not in ('包','瓶','罐','盒','袋','桶','箱','打','組','塊','條')
  or (private.recipe_unit(purchase->>'unit')=requested_base
   and private.recipe_factor(purchase->>'unit')=private.recipe_factor(requested_unit)) then
  price:=private.cost_purchase_price(purchase,requested_unit);
 end if;
 if price is null and snapshot->>'unit'=requested_base and target_package is null
  and requested_base not in ('包','瓶','罐','盒','袋','桶','箱','打','組','塊','條') then
  price:=(snapshot->>'cost_price')::numeric*private.recipe_factor(requested_unit);
 end if;
 if price<0 or price>=1000000000 then price:=null;end if;
 return jsonb_strip_nulls(jsonb_build_object('unit',requested_unit,'basis','locked',
  'date',effective_date,'supplier_name',supplier,'purchase',purchase,
  'reference_id',snapshot->>'selected_reference','source','食材價格表 · 鎖定進價',
  'reason',case when price is null then '鎖定進價的計價單位待確認' end))
  ||jsonb_build_object('price',round(price,6));
end
$$;
revoke all on function private.locked_ingredient_quote(jsonb,date,text,text,jsonb) from public,anon,authenticated;

do $patch$
declare source text; old_text text; name text; qualifier text; replacement text;
begin
 source:=pg_get_functiondef('private.capture_ingredient_standard()'::regprocedure);
 old_text:='if tg_op=''UPDATE'' and (new.cost_price';
 if strpos(source,old_text)=0 then raise exception 'LOCKED_INGREDIENT_CAPTURE_ANCHOR';end if;
 execute replace(source,old_text,'if tg_op=''UPDATE'' and (current_setting(''app.standard_change_reason'',true) is distinct from ''鎖定進價'' or new.revision=old.revision) and (new.cost_price');

 source:=pg_get_functiondef('private.automatic_cost_context_inner(uuid,date)'::regprocedure);
 old_text:='v.ingredient_id,v.snapshot,v.effective_date from private.ingredient_standard_versions v';
 if strpos(source,old_text)=0 then raise exception 'LOCKED_INGREDIENT_CONTEXT_ANCHOR';end if;
 source:=replace(source,old_text,'v.ingredient_id,v.snapshot,v.effective_date,v.reason,v.supplier_name from private.ingredient_standard_versions v');
 old_text:='''snapshot'',snapshot,''effective_date'',effective_date';
 if strpos(source,old_text)=0 then raise exception 'LOCKED_INGREDIENT_CONTEXT_RESULT_ANCHOR';end if;
 source:=replace(source,old_text,old_text||',''reason'',reason,''supplier_name'',supplier_name');
 old_text:='''product_roots'',coalesce';
 if strpos(source,old_text)=0 then raise exception 'LOCKED_INGREDIENT_PRODUCT_MAP_ANCHOR';end if;
 execute replace(source,old_text,$links$
  'corrected_product_roots',coalesce((select jsonb_object_agg(product_key,ids) from (
   select substring(source_key from 3) product_key,jsonb_agg(distinct root) ids
   from aliases where corrected and source_key like 'p:%' group by source_key
  ) corrected_products),'{}'::jsonb),
  'product_roots',coalesce$links$);

 foreach name in array array[
  'private.automatic_cost_quote(uuid,uuid,text,text,date,uuid)',
  'private.automatic_cost_quote_cached(uuid,uuid,text,text,date,uuid,jsonb)'
 ] loop
  source:=pg_get_functiondef(name::regprocedure);
  if name like '%_cached(%' then
   old_text:='(v->>''effective_date'')::date effective_date into version';
   replacement:='(v->>''effective_date'')::date effective_date,v->>''reason'' reason,v->>''supplier_name'' supplier_name into version';
   qualifier:=chr(10)||' from (select cache';
  else
   old_text:='v.snapshot,v.effective_date into version';
   replacement:='v.snapshot,v.effective_date,v.reason,v.supplier_name into version';
   qualifier:=' from private.ingredient_standard_versions';
  end if;
  if strpos(source,old_text||qualifier)=0 then raise exception 'LOCKED_INGREDIENT_VERSION_ANCHOR: %',name;end if;
  source:=replace(source,old_text||qualifier,replacement||qualifier);
  old_text:='  if cardinality(ids)>1 then return';
  if strpos(source,old_text)=0 then raise exception 'LOCKED_INGREDIENT_IDENTITY_ANCHOR: %',name;end if;
  if name like '%_cached(%' then
   replacement:=$links$
  if product is not null and cardinality(ids)>1 and jsonb_array_length(cache#>array['corrected_product_roots',product::text])=1 then
   root:=(cache#>>array['corrected_product_roots',product::text,'0'])::uuid;
   if cache#>>array['versions',root::text,'reason']='鎖定進價' then ids:=array[root];end if;
  end if;
$links$;
  else
   replacement:=$links$
  if product is not null and cardinality(ids)>1 then
   select case when count(distinct coalesce(m.canonical_ingredient_id,m.id))=1
    then min(coalesce(m.canonical_ingredient_id,m.id)::text)::uuid end into root
   from private.ingredient_aliases a join private.ingredient_masters m on m.store_id=s and m.id=a.ingredient_id
   where a.store_id=s and a.source_key='p:'||product and a.corrected;
   if (select v.reason from private.ingredient_standard_versions v where v.store_id=s and v.ingredient_id=root
    and v.effective_date<=cutoff order by v.effective_date desc,v.created_at desc,v.id desc limit 1)='鎖定進價' then ids:=array[root];end if;
  end if;
$links$;
  end if;
  source:=replace(source,old_text,replacement||old_text);
  old_text:=' baseline_package:=private.inventory_package_measure';
  if strpos(source,old_text)=0 then raise exception 'LOCKED_INGREDIENT_QUOTE_ANCHOR: %',name;end if;
  execute replace(source,old_text,$locked$
 if version.reason='鎖定進價' and version.snapshot->>'review_status'='confirmed' and version.snapshot->>'cost_price' is not null then
  return private.locked_ingredient_quote(version.snapshot,version.effective_date,version.supplier_name,u,
   private.cost_package_measure(u,specs));
 end if;
$locked$||old_text);
 end loop;
end
$patch$;

notify pgrst,'reload schema';
