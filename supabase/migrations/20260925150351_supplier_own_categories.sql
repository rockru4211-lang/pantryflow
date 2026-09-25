-- Supplier business classification is independent of product classification.
alter table private.supplier_details
 add column supplier_category text not null default '待分類'
 check (supplier_category in ('食材','耗材','調料','酒類','待分類'));

do $$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure);
 anchor:='   update private.supplier_details set
    order_method=';
 if strpos(definition,anchor)=0 then raise exception 'supplier.save anchor missing'; end if;
 definition:=replace(definition,anchor,$replacement$   if p_data ? 'supplier_category' and
    (jsonb_typeof(p_data->'supplier_category') is distinct from 'string' or
     p_data->>'supplier_category' not in ('食材','耗材','調料','酒類','待分類')) then
    raise exception using errcode='22023',message='INVALID_SUPPLIER_CATEGORY';
   end if;
   update private.supplier_details set
    supplier_category=case when p_data ? 'supplier_category' then p_data->>'supplier_category' else supplier_category end,
    order_method=$replacement$);
 execute definition;

 definition:=pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure);
 anchor:='''contact_name'',d.contact_name,''phone'',d.phone';
 if strpos(definition,anchor)=0 then raise exception 'supplier read anchor missing'; end if;
 definition:=replace(definition,anchor,'''supplier_category'',coalesce(d.supplier_category,''待分類''),'||anchor);
 execute definition;
end $$;
notify pgrst,'reload schema';
