-- Review fixes discovered by isolation tests. Existing rows are unchanged.
do $$ declare src text;begin
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into src;
 src:=replace(src,$n$return jsonb_build_object('editable',v_role in ('OWNER','LOGISTICS')$n$,$p$return jsonb_build_object('lifecycle_allowed',private.can_import_inventory(p_store),'editable',v_role in ('OWNER','LOGISTICS')$p$);
 execute src;
 select pg_get_functiondef('private.expiry_waste_workspace(uuid,date,date)'::regprocedure) into src;
 src:=replace(src,'declare erp boolean;', 'declare chain boolean; price_allowed boolean; erp boolean;');
 src:=replace(src,'select has_erp into erp from public.organizations where id=s.organization_id;', $p$select has_erp,business_type::text='CHAIN_RESTAURANT' into erp,chain from public.organizations where id=s.organization_id;
 price_allowed:=not chain and private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR','LOGISTICS','OWNER']::public.app_role[]);$p$);
 src:=replace(src,'''has_erp'',erp,','''has_erp'',erp,''can_view_amount'',price_allowed,');
 src:=replace(src,'case when not erp then w.reference_price end','case when price_allowed then w.reference_price end');
 src:=replace(src,'case when not erp then w.quantity*w.reference_price end','case when price_allowed then w.quantity*w.reference_price end');
 execute src;
 select pg_get_functiondef('private.stock_post(uuid,uuid,text,numeric,text,uuid,boolean)'::regprocedure) into src;
 src:=replace(src,'perform private.stock_initialize(s,p,u);','perform private.stock_initialize(s,p,(select base_unit from public.products where id=p));'||chr(10)||' perform private.stock_initialize(s,p,u);');execute src;
 select pg_get_functiondef('private.stock_initialize(uuid,uuid,text)'::regprocedure) into src;
 src:=replace(src,$n$values(s,p,row.zone_id,u,row.quantity,'READY');$n$,$p$values(s,p,row.zone_id,u,row.quantity,case when coalesce((select thaw_enabled from private.stock_settings where store_id=s and product_id=p),false) then 'UNCONFIRMED' else 'READY' end);$p$);
 src:=replace(src,$n$values(s,p,z,u,row.quantity,'READY');$n$,$p$values(s,p,z,u,row.quantity,case when coalesce((select thaw_enabled from private.stock_settings where store_id=s and product_id=p),false) then 'FROZEN' else 'READY' end);$p$);execute src;
 select pg_get_functiondef('private.stock_operation(uuid,text,jsonb)'::regprocedure) into src;
 src:=replace(src,'enabled:=coalesce((d->>''thaw_enabled'')::boolean,false);','perform private.stock_initialize(s,p,(select base_unit from public.products where id=p));'||chr(10)||'  enabled:=coalesce((d->>''thaw_enabled'')::boolean,false);');
 src:=replace(src,$n$if newstate not in ('READY','FROZEN','THAWING')$n$, $p$if newstate is null or newstate not in ('READY','FROZEN','THAWING')$p$);execute src;
 select pg_get_functiondef('private.inventory_import_review(uuid,jsonb,jsonb)'::regprocedure) into src;
 src:=replace(src,$n$if f->>'file_sha256' !~$n$,$p$if coalesce(f->>'file_sha256','') !~$p$);
 src:=replace(src,$n$or f->>'storage_path' not like$n$,$p$or coalesce(f->>'storage_path','') not like$p$);
 src:=replace(src,$n$or jsonb_typeof(rows)<>'array'$n$,$p$or jsonb_typeof(rows) is distinct from 'array' or jsonb_typeof(f->'sheet_names') is distinct from 'array' or length(coalesce(f->>'original_filename','')) not between 1 and 255$p$);execute src;
 select pg_get_functiondef('private.product_lifecycle(uuid,jsonb)'::regprocedure) into src;
 src:=replace(src,'if mode not in','if mode is null or mode not in');src:=replace(src,$n$jsonb_typeof(d->'ids')<>'array'$n$,$p$jsonb_typeof(d->'ids') is distinct from 'array'$p$);execute src;
end $$;
