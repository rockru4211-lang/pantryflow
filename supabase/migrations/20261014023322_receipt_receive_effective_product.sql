-- An OCR mapping cannot override an explicitly corrected item identity at receiving.
do $$declare src text;anchor text;begin
 src:=pg_get_functiondef('public.receive_baihuayuan_receipt(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='select id into pid from public.products where id=nullif(l->>''product_id'','''')::uuid and organization_id=b.organization_id and is_active;';
 if strpos(src,anchor)=0 then raise exception 'RECEIVE_PRODUCT_ANCHOR';end if;
 src:=replace(src,anchor,$patch$select id into pid from public.products where id=nullif(l->>'product_id','')::uuid and organization_id=b.organization_id and is_active
  and lower(btrim(name))=lower(btrim(l->>'product_name')) and coalesce(specification,'')=coalesce(l->>'specification','') and base_unit=l->>'unit';$patch$);
 execute src;
end $$;
