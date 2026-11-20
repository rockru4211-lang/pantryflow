-- A count labelled g/包 or 500g/包 records packages. Keep physical count
-- identities and quantities, and normalize only the inventory report unit.
create function private.inventory_count_unit(u text)
returns text language sql immutable set search_path='' as $$
 select coalesce((regexp_match(btrim(normalize(u,NFKC)),
  '^(?:[0-9]+(?:[.][0-9]+)?[[:space:]]*)?(?:kg|g|ml|l|公斤|公克|克|毫升|公升)[[:space:]]*/[[:space:]]*(包|袋|盒|罐|瓶|桶|箱)$','i'))[1],u)
$$;
revoke all on function private.inventory_count_unit(text) from public,anon,authenticated;

do $migration$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('private.inventory_count_quote(uuid,uuid,text,text,date,text)'::regprocedure);
 anchor:=' q:=private.inventory_scoped_cost_quote(s,product,nm,u,cutoff,null,supplier);';
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_PACKAGE_QUOTE_ANCHOR';end if;
 execute replace(definition,anchor,' u:=private.inventory_count_unit(u);'||chr(10)||anchor);

 definition:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
 anchor:=$old$'unit',coalesce(v.report_unit,coalesce(v.c,v.p)->>'unit'),'source_unit'$old$;
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_PACKAGE_REPORT_UNIT_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$'unit',case when historical then coalesce(v.report_unit,coalesce(v.c,v.p)->>'unit')
    else private.inventory_count_unit(coalesce(v.report_unit,coalesce(v.c,v.p)->>'unit')) end,'source_unit'$new$);
 anchor:='case when r.price_set then r.unit_price else case when historical then';
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_PACKAGE_SAVED_PRICE_ANCHOR';end if;
 -- Repair previously saved per-gram valuations only when their original
 -- package quotation remains attached to this exact month and count row.
 definition:=replace(definition,anchor,$new$case when r.price_set then
    case when not historical and jsonb_typeof(r.purchase_evidence->'purchase')='object'
     and private.inventory_count_unit(coalesce(r.report_unit,x.c->>'unit')) is distinct from coalesce(r.report_unit,x.c->>'unit')
    then private.cost_purchase_price(r.purchase_evidence->'purchase',private.inventory_count_unit(coalesce(r.report_unit,x.c->>'unit')))
    else r.unit_price end else case when historical then$new$);
 execute definition;

 definition:=pg_get_functiondef('public.save_baihuayuan_inventory_valuation(uuid,date,uuid,text,jsonb,jsonb,jsonb)'::regprocedure);
 anchor:=$old$count_unit:=case when editing then btrim(p_edit->>'unit') else r->>'unit' end;$old$;
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_PACKAGE_VALUATION_SAVE_ANCHOR';end if;
 execute replace(definition,anchor,$new$count_unit:=private.inventory_count_unit(case when editing then btrim(p_edit->>'unit') else r->>'unit' end);$new$);
end $migration$;

notify pgrst,'reload schema';
