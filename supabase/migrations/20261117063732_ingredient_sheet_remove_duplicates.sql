-- Remember the chosen supplier label without rewriting catalog or receipt names.
alter table private.ingredient_masters add column sheet_receipt_label jsonb;

create function private.remove_ingredient_sheet_duplicates(
 store uuid, keeper private.ingredient_masters, payload jsonb
) returns jsonb
language plpgsql set search_path='' as $$
declare
 sources uuid[];
 source_count integer;
 label text:=btrim(payload->>'receipt_name');
 supplier_key text:=coalesce(payload->>'supplier_key','');
 incompatible boolean;
begin
 if keeper.id is null or keeper.store_id is distinct from store
    or jsonb_typeof(payload->'rows') is distinct from 'array'
    or coalesce(length(label),0) not between 1 and 2000
    or (supplier_key<>'' and not exists(
      select 1 from public.suppliers s join public.stores t on t.organization_id=s.organization_id
      where t.id=store and supplier_key='id:'||s.id
    )) then
  raise exception 'INVALID_INGREDIENT_DUPLICATE' using errcode='22023';
 end if;

 select array_agg(item.id order by item.id),count(distinct item.id) into sources,source_count
 from jsonb_to_recordset(payload->'rows') item(id uuid);
 if source_count=0 or source_count<>cardinality(sources) or keeper.id=any(sources) then
  raise exception 'INVALID_INGREDIENT_DUPLICATE' using errcode='22023';
 end if;

 perform m.id from private.ingredient_masters m
 where m.store_id=store and m.id=any(sources)
 order by m.id for update;
 if exists(
  select 1 from jsonb_to_recordset(payload->'rows') item(id uuid,revision integer)
  left join private.ingredient_masters m on m.store_id=store and m.id=item.id
  where m.id is null or m.revision is distinct from item.revision
 ) then
  raise exception 'REVISION_CONFLICT' using errcode='40001';
 end if;

 -- Include every member when moving a previously grouped item. Each member
 -- points directly to the kept code, including members of older groups.
 if keeper.canonical_ingredient_id is not null
    or exists(
      select 1 from private.ingredient_masters m where m.store_id=store and
       ((m.canonical_ingredient_id=any(sources) and not(m.id=any(sources)))
        or (m.id=any(sources) and m.canonical_ingredient_id is not null
         and not(m.canonical_ingredient_id=any(sources||keeper.id))))
    )
    or exists(select 1 from private.ingredient_code_links l where l.ingredient_id=any(sources) or l.target_id=any(sources))
    or exists(
      select 1 from private.ingredient_supply_state st
      where st.store_id=store and st.ingredient_id=any(sources||keeper.id) and st.supplier_key='*' and st.stopped
    ) then
  raise exception 'INGREDIENT_DUPLICATE_LINK_CONFLICT' using errcode='22023';
 end if;

 with units as (
  select m.name,m.category,m.purchase,coalesce(nullif(m.purchase->>'unit',''),m.unit) unit
  from private.ingredient_masters m where m.store_id=store and m.id=any(sources||keeper.id)
 ), measures as (
  select private.recipe_unit(unit) unit,category,private.inventory_package_measure(
   purchase,unit,regexp_replace(normalize(name,NFKC),'([0-9])\s*cc\M','\1ml','gi')
  ) measure from units
 )
 select count(distinct unit)>1 or count(distinct category) filter(where category<>'待分類')>1
        or count(distinct measure)>1 into incompatible
 from measures;
 if incompatible then
  raise exception 'INVALID_INGREDIENT_DUPLICATE' using errcode='22023';
 end if;

 update private.ingredient_masters m set canonical_ingredient_id=keeper.id,revision=m.revision+1
 where m.store_id=store and m.id=any(sources);
 update private.ingredient_masters m
 set sheet_receipt_label=jsonb_build_object('name',label,'supplier_key',supplier_key),revision=m.revision+1
 where m.store_id=store and m.id=keeper.id;
 return jsonb_build_object('id',keeper.id,'count',source_count);
end $$;
revoke all on function private.remove_ingredient_sheet_duplicates(uuid,private.ingredient_masters,jsonb) from public,anon,authenticated;

-- The existing store lock, role check, request cache and audit cover the batch.
do $migration$
declare
 definition text:=pg_get_functiondef('public.baihuayuan_ingredient_prices(uuid,text,jsonb,uuid)'::regprocedure);
 anchor text:='elsif p_action=''merge_duplicate'' then';
 catalog text:=pg_get_functiondef('private.ingredient_catalog_before_usage_names(uuid)'::regprocedure);
 code_anchor text:='left join private.ingredient_display_codes display on display.ingredient_id=coalesce(linked.id,canonical.id,m.id)';
begin
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_DUPLICATE_ACTION_ANCHOR';end if;
 if strpos(catalog,code_anchor)=0 or strpos(catalog,'to_jsonb(m)||jsonb_build_object(')=0 then
  raise exception 'INGREDIENT_ORIGINAL_DISPLAY_CODE_ANCHOR';
 end if;
 execute replace(definition,anchor,$new$elsif p_action='remove_duplicates' then
  perform set_config('app.standard_change_reason','移除重複品項',true);
  result:=private.remove_ingredient_sheet_duplicates(p_store_id,m,p_data);
 $new$||anchor);
 -- A historical display code may differ from the imported code stored on the row.
 catalog:=replace(catalog,'to_jsonb(m)||jsonb_build_object(',
  'to_jsonb(m)||jsonb_build_object(''original_display_code'',own_display.code,');
 execute replace(catalog,code_anchor,code_anchor||$new$
  left join private.ingredient_display_codes own_display on own_display.ingredient_id=m.id
   and m.canonical_ingredient_id is not null
 $new$);
end $migration$;

notify pgrst,'reload schema';
