-- Manual rows share the document supplier and must carry the same opening identity.
do $$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.baihuayuan_receipt_detail_ledger_before_table(uuid)'::regprocedure);
 anchor:='''supplier_name'',manual->>''supplier_name'',';
 if strpos(src,anchor)=0 then raise exception 'MANUAL_SUPPLIER_IDENTITY_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$patch$
 'raw_supplier_name',(select value#>>'{}' from private.receipt_effective_fields((s->>'run_id')::uuid) where row_key='document' and field_name='supplier_name'),
 'supplier_id',private.supplier_identity((select organization_id from public.stores where id=p_store),(select value#>>'{}' from private.receipt_effective_fields((s->>'run_id')::uuid) where row_key='document' and field_name='supplier_name')),
 'supplier_name',private.supplier_display_name((select organization_id from public.stores where id=p_store),(select value#>>'{}' from private.receipt_effective_fields((s->>'run_id')::uuid) where row_key='document' and field_name='supplier_name')),
 $patch$);
 execute src;
end $$;
notify pgrst,'reload schema';
