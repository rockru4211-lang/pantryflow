-- Use the organization supplier directory for both historical standards and
-- verified receipt offers. Keep the original references and amounts intact.
do $migration$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('private.ingredient_supply_read(uuid)'::regprocedure);
 anchor:='declare base jsonb; result jsonb; price_context jsonb;';
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_SCOPE_ANCHOR';end if;
 definition:=replace(definition,anchor,anchor||' org uuid;');
 anchor:=' base:=private.ingredient_catalog(s);';
 definition:=replace(definition,anchor,' select organization_id into org from public.stores where id=s;'||chr(10)||anchor);

 anchor:=$old$ select lower(btrim(normalize(sp.name,NFKC))) name_key,min(sp.id::text) supplier_id
 from public.suppliers sp join public.stores st on st.organization_id=sp.organization_id
 where st.id=s group by 1 having count(*)=1$old$;
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_NAME_MAP_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$ select keys.name_key,identity.supplier_id,canonical.name display_name
 from (
  select private.history_key(sp.name) name_key from public.suppliers sp where sp.organization_id=org
  union
  select private.history_key(alias.name) from public.suppliers sp
  join private.supplier_details d on d.supplier_id=sp.id cross join unnest(d.aliases) alias(name)
  where sp.organization_id=org
  union
  select l.name_key from private.supplier_name_links l where l.organization_id=org
 ) keys
 cross join lateral (select private.supplier_identity(org,keys.name_key) supplier_id offset 0) identity
 left join private.supplier_name_links link on link.organization_id=org and link.name_key=keys.name_key
 left join public.suppliers canonical on canonical.organization_id=org and canonical.id=coalesce(link.supplier_id,identity.supplier_id)$new$);

 anchor:=$old$live.supplier as receipt_supplier,
 coalesce('id:'||rn.supplier_id,private.ingredient_supplier_key(r.source_ref)) supplier_key,coalesce(r.source_ref->>'supplier_name','') supplier_name$old$;
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_SOURCE_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$coalesce(receipt_name.display_name,live.supplier) as receipt_supplier,
 coalesce('id:'||coalesce(receipt_name.supplier_id,rn.supplier_id),private.ingredient_supplier_key(r.source_ref)) supplier_key,
 coalesce(rn.display_name,rsupplier.name,r.source_ref->>'supplier_name','') supplier_name$new$);
 anchor:=$old$ left join supplier_names rn on nullif(r.source_ref->>'supplier_id','') is null and rn.name_key=lower(btrim(normalize(r.source_ref->>'supplier_name',NFKC)))
 left join local_receipt_prices live on live.id=r.id where a.store_id=s$old$;
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_SOURCE_JOIN_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$ left join public.suppliers rsupplier on rsupplier.organization_id=org and rsupplier.id=
  case when pg_input_is_valid(r.source_ref->>'supplier_id','uuid') then (r.source_ref->>'supplier_id')::uuid end
 left join supplier_names rn on rn.name_key=private.history_key(coalesce(rsupplier.name,r.source_ref->>'supplier_name'))
 left join local_receipt_prices live on live.id=r.id
 left join supplier_names receipt_name on receipt_name.name_key=private.history_key(live.supplier)
 where a.store_id=s$new$);
 anchor:=$old$  l.price,l.unit,l.purchase,l.supplier,'',l.supplier
 from local_receipt_prices l$old$;
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_RECEIPT_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$  l.price,l.unit,l.purchase,coalesce(receipt_name.display_name,l.supplier),
  coalesce('id:'||receipt_name.supplier_id,''),coalesce(receipt_name.display_name,l.supplier)
 from local_receipt_prices l
 left join supplier_names receipt_name on receipt_name.name_key=private.history_key(l.supplier)$new$);

 anchor:=$old$ 'current_quote',private.automatic_cost_quote_cached(s,null,x.value->>'name',x.value->>'unit',(now() at time zone 'Asia/Taipei')::date,(x.value->>'id')::uuid,price_context),'supplier_id',c.supplier_id,'supplier_name',coalesce(sp.name,selected.source_ref->>'supplier_name',''),
 'supplier_key',coalesce('id:'||c.supplier_id,'id:'||sn.supplier_id,private.ingredient_supplier_key(selected.source_ref),''),$old$;
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_QUOTE_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$ 'current_quote',case when quote_name.display_name is not null then
  q.value||jsonb_build_object('supplier_name',quote_name.display_name,'source',
   case when q.value->>'basis'='receipt' then '本店進貨' else q.value->>'source' end)
  else q.value end,
 'supplier_id',coalesce(sn.supplier_id,c.supplier_id),
 'supplier_name',coalesce(sn.display_name,sp.name,selected_supplier.name,selected.source_ref->>'supplier_name',''),
 'supplier_key',coalesce('id:'||coalesce(sn.supplier_id,c.supplier_id),private.ingredient_supplier_key(selected.source_ref),''),$new$);
 anchor:=$old$ left join supplier_names sn on c.supplier_id is null and nullif(selected.source_ref->>'supplier_id','') is null and sn.name_key=lower(btrim(normalize(selected.source_ref->>'supplier_name',NFKC)))$old$;
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_QUOTE_JOIN_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$ left join public.suppliers selected_supplier on selected_supplier.organization_id=org and selected_supplier.id=
  case when pg_input_is_valid(selected.source_ref->>'supplier_id','uuid') then (selected.source_ref->>'supplier_id')::uuid end
 left join supplier_names sn on sn.name_key=private.history_key(coalesce(sp.name,selected_supplier.name,selected.source_ref->>'supplier_name'))
 cross join lateral (select private.automatic_cost_quote_cached(s,null,x.value->>'name',x.value->>'unit',
  (now() at time zone 'Asia/Taipei')::date,(x.value->>'id')::uuid,price_context) value offset 0) q
 left join supplier_names quote_name on quote_name.name_key=private.history_key(q.value->>'supplier_name')$new$);
 anchor:=$old$jsonb_build_object('actor_name',coalesce((select display_name from public.profiles where id=v.actor_id),'系統'))$old$;
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_HISTORY_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$jsonb_build_object('supplier_name',private.supplier_display_name(org,v.supplier_name),
  'actor_name',coalesce((select display_name from public.profiles where id=v.actor_id),'系統'))$new$);
 anchor:=$old$jsonb_agg(to_jsonb(t))$old$;
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_STATE_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$jsonb_agg(to_jsonb(t)||jsonb_build_object('supplier_name',private.supplier_display_name(org,t.supplier_name)))$new$);
 anchor:=$old$jsonb_build_object('actor_name',coalesce((select display_name from public.profiles where id=t.actor_id),'使用者'))$old$;
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_EVENT_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$jsonb_build_object('supplier_name',private.supplier_display_name(org,t.supplier_name),
  'actor_name',coalesce((select display_name from public.profiles where id=t.actor_id),'使用者'))$new$);
 anchor:=$old$where st.id=s));$old$;
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_CHOICES_ANCHOR';end if;
 execute replace(definition,anchor,$new$where st.id=s and not exists(
  select 1 from private.supplier_name_links l where l.organization_id=org
  and l.name_key=private.history_key(sp.name) and l.supplier_id<>sp.id)));$new$);

 definition:=pg_get_functiondef('public.baihuayuan_ingredient_prices(uuid,text,jsonb,uuid)'::regprocedure);
 anchor:=$old$     and lower(btrim(normalize(q.supplier,NFKC)))=lower(btrim(normalize(supplier.name,NFKC)))$old$;
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_ADOPT_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$     and private.supplier_identity(supplier.organization_id,q.supplier)=supplier.id$new$);
 anchor:=$old$       and stop.supplier_key in ('*','id:'||sp,private.ingredient_supplier_key(jsonb_build_object('supplier_name',supplier.name))))$old$;
 if strpos(definition,anchor)=0 then raise exception 'INGREDIENT_SUPPLIER_STOP_ANCHOR';end if;
 execute replace(definition,anchor,$new$       and (stop.supplier_key in ('*','id:'||sp,private.ingredient_supplier_key(jsonb_build_object('supplier_name',supplier.name)))
        or private.supplier_identity(supplier.organization_id,stop.supplier_name)=sp))$new$);
end
$migration$;
notify pgrst,'reload schema';
