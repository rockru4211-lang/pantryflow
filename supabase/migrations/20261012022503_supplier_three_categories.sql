-- Only supplier business categories change; ingredient classifications and prices are untouched.
alter table private.supplier_details drop constraint supplier_details_supplier_category_check;
alter table private.supplier_details alter column supplier_category set default '';
with changed as (
 update private.supplier_details set supplier_category=case supplier_category when '調料' then '食材' when '酒類' then '酒水' else '' end,updated_at=now()
 where supplier_category in ('調料','酒類','待分類') returning supplier_id
)
update public.suppliers set updated_at=now() where id in (select supplier_id from changed);
alter table private.supplier_details add constraint supplier_details_supplier_category_check check (supplier_category in ('食材','酒水','耗材',''));
do $$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure);
 anchor:='   if p_data ? ''supplier_category'' and';
 if strpos(definition,anchor)=0 then raise exception 'supplier category normalization anchor missing';end if;
 definition:=replace(definition,anchor,$patch$   -- Keep older clients and exported files compatible without restoring retired categories.
   if p_data->>'supplier_category' in ('調料','酒類','待分類') then
    p_data:=jsonb_set(p_data,'{supplier_category}',to_jsonb(case p_data->>'supplier_category' when '調料' then '食材' when '酒類' then '酒水' else '' end));
   end if;
$patch$||anchor);
 anchor:='p_data->>''supplier_category'' not in (''食材'',''耗材'',''調料'',''酒類'',''待分類'')';
 if strpos(definition,anchor)=0 then raise exception 'supplier category validation anchor missing';end if;
 definition:=replace(definition,anchor,'p_data->>''supplier_category'' not in (''食材'',''酒水'',''耗材'','''')');
 execute definition;
 definition:=pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure);
 anchor:='coalesce(d.supplier_category,''待分類'')';
 if strpos(definition,anchor)=0 then raise exception 'supplier category read anchor missing';end if;
 definition:=replace(definition,anchor,'coalesce(d.supplier_category,'''')');
 execute definition;
end $$;
notify pgrst,'reload schema';
