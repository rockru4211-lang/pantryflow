-- Inventory quantities and automatic receipt valuations belong to the same store.
-- Keep the explicitly confirmed local standard and existing closure snapshots.
do $patch$
declare src text; scope_start integer; scope_end integer; anchor text;
begin
 src:=pg_get_functiondef('private.inventory_price_quote(uuid,uuid,text,text,date)'::regprocedure);
 scope_start:=strpos(src,' with allowed_peers as materialized (');
 scope_end:=strpos(src,' ), refs as materialized (');
 if scope_start=0 or scope_end<=scope_start then raise exception 'INVENTORY_LOCAL_SCOPE_ANCHOR';end if;
 src:=left(src,scope_start-1)||$local$ with scopes as materialized (
   select m.id,m.store_id from private.ingredient_masters m
   where m.store_id=s and (m.id=root or m.canonical_ingredient_id=root)
$local$||substr(src,scope_end);
 anchor:='and (r.store_id=s or r.store_id in (select id from allowed_peers))';
 if strpos(src,anchor)=0 then raise exception 'INVENTORY_LOCAL_RECEIPT_ANCHOR';end if;
 src:=replace(src,anchor,'and r.store_id=s');
 src:=replace(src,'order by (store_id=s) desc,effective_date desc','order by effective_date desc');
 src:=replace(src,$old$case when selected.latest->>'store_id'=s::text then '本店進貨' else '另一店進貨' end$old$,$new$'本店進貨'$new$);
 execute src;
end $patch$;
