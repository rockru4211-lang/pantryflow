-- Reuse the supplier shown on the existing inventory sheet; read-only projection.
do $$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.spot_check_source(uuid)'::regprocedure);
 anchor:=$q$coalesce(r.x->>'specification',p.specification,'') specification,$q$;
 if strpos(src,anchor)=0 then raise exception 'SPOT_SUPPLIER_FIELD_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,anchor||$q$
   coalesce(nullif(btrim(r.x->>'supplier'),''),sp.name,'') supplier,$q$);
 anchor:='left join public.count_entries e on e.session_id=s.id';
 if strpos(src,anchor)=0 then raise exception 'SPOT_SUPPLIER_JOIN_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'left join public.suppliers sp on sp.id=p.current_supplier_id and sp.organization_id=s.organization_id '||anchor);
 execute src;
end $$;
notify pgrst,'reload schema';
