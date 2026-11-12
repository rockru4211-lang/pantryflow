-- Explicit metadata-only edits must not turn an imported quote into a manual
-- standard price, replace purchase provenance, or create a cost-history entry.
-- Existing save/create/confirm/keep callers retain their original behavior.
do $patch$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('public.baihuayuan_ingredient_prices(uuid,text,jsonb,uuid)'::regprocedure);
 anchor:=$old$ result:=private.ingredient_operation(p_store_id,'ingredient.save',p_data-'supplier_id',gen_random_uuid());$old$;
 if (length(src)-length(replace(src,anchor,'')))/length(anchor)<>1 then
  raise exception 'INGREDIENT_METADATA_SAVE_ANCHOR';
 end if;
 src:=replace(src,anchor,$new$ if p_data ? 'preserve_price' and jsonb_typeof(p_data->'preserve_price') is distinct from 'boolean' then
  raise exception 'INVALID_PRESERVE_PRICE' using errcode='22023';end if;
 if p_data->'preserve_price'='true'::jsonb then
  if m.id is null then raise exception 'INVALID_PRESERVE_PRICE' using errcode='22023';end if;
  -- Accept metadata only. Conflicting price fields must fail rather than be
  -- silently discarded or interpreted as a new standard price.
  if exists(select 1 from jsonb_object_keys(p_data) as keys(key)
    where key not in ('id','revision','name','category','supplier_id','preserve_price')) then
   raise exception 'PRESERVE_PRICE_FIELDS_NOT_ALLOWED' using errcode='22023';end if;
  nm:=btrim(p_data->>'name');
  if nm is null or length(nm) not between 1 and 200 then
   raise exception 'INVALID_INGREDIENT' using errcode='22023';end if;
  if p_data ? 'category' and (p_data->>'category' is null or p_data->>'category' not in ('食材','酒水','耗材','調料','待分類')) then
   raise exception 'INVALID_CATEGORY' using errcode='22023';end if;
  -- Match legacy rename behavior without altering the original purchase unit.
  if lower(m.name)<>lower(nm) then
   insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,corrected)
   values(p_store_id,m.id,m.name,'n:'||lower(btrim(m.name)),m.unit,true) on conflict do nothing;
  end if;
  update private.ingredient_masters im set name=nm,
   category=case when p_data ? 'category' then p_data->>'category' else im.category end,
   revision=im.revision+1,updated_at=now(),updated_by=actor
  where im.id=m.id
  returning jsonb_build_object('id',im.id,'revision',im.revision) into result;
 else
  result:=private.ingredient_operation(p_store_id,'ingredient.save',p_data-'supplier_id',gen_random_uuid());
 end if;$new$);
 anchor:=$old$ if p_action in ('save','confirm','keep') then
 update private.ingredient_standard_versions$old$;
 if (length(src)-length(replace(src,anchor,'')))/length(anchor)<>1 then
  raise exception 'INGREDIENT_METADATA_HISTORY_ANCHOR';
 end if;
 src:=replace(src,anchor,$new$ if p_action in ('save','confirm','keep') and not(p_action='save' and coalesce(p_data->'preserve_price'='true'::jsonb,false)) then
 update private.ingredient_standard_versions$new$);
 execute src;
end $patch$;
notify pgrst,'reload schema';
