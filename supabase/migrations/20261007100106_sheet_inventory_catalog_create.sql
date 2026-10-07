-- Catalog additions use the same authorized, idempotent boundary without fabricating upload files.
do $$
declare src text;
begin
 select pg_get_functiondef('public.save_baihuayuan_sheet_row(uuid,text,uuid,jsonb,jsonb,uuid)'::regprocedure) into src;
 if position('qty:=nullif(p_value' in src)=0 then raise exception 'SHEET_CONTRACT_CHANGED';end if;
 src:=replace(src,$old$p_kind not in ('receipt','transfer','waste')$old$,$new$p_kind not in ('receipt','transfer','waste','inventory')$new$);
 src:=replace(src,$old$ qty:=nullif(p_value$old$,$new$
 if p_kind='inventory' then
  if p_id is not null or nullif(p_value->>'quantity','') is not null then raise exception 'CATALOG_CREATE_ONLY';end if;
  unit_name:=btrim(p_value->>'unit');price:=nullif(p_value->>'price','')::numeric;
  if coalesce(length(btrim(p_value->>'name')),0) not between 1 and 160 or coalesce(length(unit_name),0) not between 1 and 30 then raise exception 'INVALID_SHEET_FIELDS';end if;
  if price is not null and (price<0 or price>=1e9 or price::text in ('NaN','Infinity','-Infinity')) then raise exception 'INVALID_PRICE';end if;
  if exists(select 1 from public.products p where p.organization_id=org and p.name=btrim(p_value->>'name') and coalesce(p.count_unit,p.base_unit)=unit_name and
   (not p.is_active or exists(select 1 from private.count_catalog_removed c where c.store_id=p_store_id and c.product_id=p.id))) then raise exception 'PRODUCT_REMOVED_OR_DISABLED';end if;
  result:=public.import_pilot_inventory_quick(p_store_id,jsonb_build_array(jsonb_build_object(
   'source_id',p_request_id,'sheet_name','行政表格','source_row',1,'name',btrim(p_value->>'name'),'count_unit',unit_name,
   'specification','','supplier_name',coalesce(p_value->>'supplier',''),'zone_name',coalesce(nullif(p_value->>'zone',''),'未分類'),
   'unit_price',price,'opening_quantity',null,'generated_code',true,'raw_values',p_value,'merged_ranges','[]'::jsonb)));
  if jsonb_typeof(result)<>'array' or jsonb_array_length(result)<>1 or result->0->>'status' not in ('ADDED','EXISTING') then raise exception 'CATALOG_CREATE_FAILED: %',result;end if;
  perform public.sync_active_count_after_import(p_store_id);
  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
   values(org,p_store_id,'inventory',result->0->>'product_id','ADMIN_SHEET_CREATE',p_value,auth.uid());
  insert into private.operations_sheet_requests(actor,store_id,request_id,payload,result) values(auth.uid(),p_store_id,p_request_id,payload,result);
  return result;
 end if;
 qty:=nullif(p_value$new$);
 execute src;
end $$;
