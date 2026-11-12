-- Request-local, read-only pricing context. Nothing is persisted, updated or
-- shared between requests. Keep operational single-quote/save behavior intact.
create function private.automatic_cost_context(s uuid,cutoff date) returns jsonb
language plpgsql stable security invoker set search_path='' set jit=off as $$
declare result jsonb; org uuid;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into org from public.stores where id=s and is_active and name in ('BeApe','Gras');
 if org is null or cutoff is null then return jsonb_build_object('store_id',s,'cutoff',cutoff,'organization_id',org);end if;
 with masters as materialized (
  select m.id,m.name,coalesce(m.canonical_ingredient_id,m.id) root from private.ingredient_masters m where m.store_id=s
 ), aliases as materialized (
  select a.*,m.root from private.ingredient_aliases a join masters m on m.id=a.ingredient_id where a.store_id=s
 ), alias_scopes as materialized (
  select ingredient_id root,source_key,reference_ids from aliases
  union select root,source_key,reference_ids from aliases
 ), names as materialized (
  select private.cost_name_key(name) key,root from masters
  union select private.cost_name_key(name),root from aliases where corrected
 ), name_maps as (
  select key,jsonb_agg(distinct root) ids from names group by key
 ), product_maps as (
  select substring(source_key from 3) key,jsonb_agg(distinct root) ids from aliases where source_key like 'p:%' group by source_key
 ), receipts as materialized (
  select row_number() over() rid,r.* from private.live_ingredient_receipt_prices r where r.store_id=s and r.effective_date<=cutoff
 ), receipt_links as materialized (
  select a.root,r.rid from alias_scopes a cross join lateral unnest(a.reference_ids) ref(id) join receipts r on r.id=ref.id
  union
  select a.root,r.rid from alias_scopes a join receipts r on a.source_key='p:'||r.product_id
 ), ingredient_receipts as (
  select l.root,jsonb_agg(to_jsonb(r)-'rid') rows from receipt_links l join receipts r using(rid) group by l.root
 ), product_receipts as (
  select r.product_id,jsonb_agg(to_jsonb(r)-'rid') rows from receipts r group by r.product_id
 ), versions as materialized (
  select distinct on(v.ingredient_id) v.ingredient_id,v.snapshot,v.effective_date from private.ingredient_standard_versions v
  where v.store_id=s and v.effective_date<=cutoff order by v.ingredient_id,v.effective_date desc,v.created_at desc,v.id desc
 ), manual_versions as (
  select distinct v.ingredient_id from private.ingredient_standard_versions v where v.store_id=s and v.effective_date<=cutoff and v.actor_id is not null
 ), baselines as (
  select b.product_id,jsonb_object_agg(b.unit,b.quote) units from private.ingredient_standard_baselines b
  where b.store_id=s and b.quote->>'basis'='confirmed_baseline'
   and coalesce(nullif(b.quote->>'date','')::date,(b.captured_at at time zone 'Asia/Taipei')::date)<=cutoff group by b.product_id
 ), stops as (
  select st.ingredient_id,jsonb_object_agg(st.supplier_key,true) keys from private.ingredient_supply_state st where st.store_id=s and st.stopped group by st.ingredient_id
 ), supplier_keys as (
  select lower(btrim(normalize(sp.name,NFKC))) key,'id:'||min(sp.id::text) value from public.suppliers sp
  where sp.organization_id=org group by 1 having count(*)=1
 ) select jsonb_build_object('store_id',s,'cutoff',cutoff,'organization_id',org,
  'roots',coalesce((select jsonb_object_agg(id,root) from masters),'{}'::jsonb),
  'names',coalesce((select jsonb_object_agg(key,ids) from name_maps),'{}'::jsonb),
  'product_roots',coalesce((select jsonb_object_agg(key,ids) from product_maps),'{}'::jsonb),
  'products',coalesce((select jsonb_object_agg(p.id,jsonb_build_object('name',p.name,'specification',p.specification)) from public.products p where p.organization_id=org),'{}'::jsonb),
  'ingredient_receipts',coalesce((select jsonb_object_agg(root,rows) from ingredient_receipts),'{}'::jsonb),
  'product_receipts',coalesce((select jsonb_object_agg(product_id,rows) from product_receipts where product_id is not null),'{}'::jsonb),
  'versions',coalesce((select jsonb_object_agg(ingredient_id,jsonb_build_object('snapshot',snapshot,'effective_date',effective_date)) from versions),'{}'::jsonb),
  'manual_versions',coalesce((select jsonb_object_agg(ingredient_id,true) from manual_versions),'{}'::jsonb),
  'baselines',coalesce((select jsonb_object_agg(product_id,units) from baselines),'{}'::jsonb),
  'stops',coalesce((select jsonb_object_agg(ingredient_id,keys) from stops),'{}'::jsonb),
  'supplier_keys',coalesce((select jsonb_object_agg(key,value) from supplier_keys),'{}'::jsonb)) into result;
 return result;
end $$;
revoke all on function private.automatic_cost_context(uuid,date) from public,anon,authenticated;

create function private.automatic_cost_quote_cached(s uuid,product uuid,nm text,u text,cutoff date,ingredient uuid,cache jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' set jit=off as $$
declare org uuid; specs text; ids uuid[]; root uuid;
 target_package jsonb; target_unit text:=private.recipe_unit(u); selected record; version record; quote numeric; baseline jsonb; count_baseline jsonb; baseline_package jsonb;
begin
 if cache->>'store_id' is distinct from s::text or cache->>'cutoff' is distinct from cutoff::text then raise exception 'INVALID_PRICE_CONTEXT';end if;
 if cutoff is null or nullif(btrim(u),'') is null then return jsonb_build_object('price',null,'reason','待確認日期或計價單位');end if;
 org:=(cache->>'organization_id')::uuid;
 if org is null then return jsonb_build_object('price',null,'reason','尚未找到此門市');end if;
 if product is not null then
  nm:=cache#>>array['products',product::text,'name'];specs:=cache#>>array['products',product::text,'specification'];
  if nm is null then return jsonb_build_object('price',null,'reason','品項不屬於此門市');end if;
 end if;
 if ingredient is not null then
  root:=(cache#>>array['roots',ingredient::text])::uuid;
  if root is null then return jsonb_build_object('price',null,'reason','食材不屬於此門市');end if;
 else
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(coalesce(
   case when product is null then cache#>array['names',private.cost_name_key(nm)] else cache#>array['product_roots',product::text] end,'[]'::jsonb));
  if cardinality(ids)>1 then return jsonb_build_object('price',null,'reason','同名有不同品項或規格，待確認對應');end if;
  root:=ids[1];
 end if;
 if coalesce((cache#>>array['stops',root::text,'*'])::boolean,false) then
  return jsonb_build_object('price',null,'reason','此品項已停止供貨');end if;
 select v->'snapshot' snapshot,(v->>'effective_date')::date effective_date into version
 from (select cache#>array['versions',root::text] v) cached;
 count_baseline:=case when not coalesce((cache#>>array['manual_versions',root::text])::boolean,false)
  then cache#>array['baselines',product::text,u] end;
 baseline_package:=private.inventory_package_measure(count_baseline->'purchase',u,null);
 target_package:=coalesce(baseline_package,private.cost_package_measure(u,specs),private.inventory_package_measure(case when version.snapshot->>'review_status'='confirmed' then version.snapshot->'purchase' end,u,null));
 with candidates as materialized (
  select r.* from jsonb_to_recordset(coalesce(case when product is not null
   then cache#>array['product_receipts',product::text] else cache#>array['ingredient_receipts',root::text] end,'[]'::jsonb))
   r(id uuid,store_id uuid,product_id uuid,effective_date date,created_at timestamptz,unit text,price numeric,batch_id uuid,row_key text,supplier text,specification text,purchase jsonb)
  where not coalesce((cache#>>array['stops',root::text,coalesce(cache#>>array['supplier_keys',lower(btrim(normalize(r.supplier,NFKC)))],private.ingredient_supplier_key(jsonb_build_object('supplier_name',r.supplier)))])::boolean,false)
   and not coalesce((cache#>>array['stops',root::text,private.ingredient_supplier_key(jsonb_build_object('supplier_name',r.supplier))])::boolean,false)
 ), latest as (
  select * from candidates where effective_date=(select max(effective_date) from candidates)
 ), converted as (
  select r.*,case
   when r.price is null then null
   when count_baseline is not null and baseline_package is null and target_unit in ('包','瓶','罐','盒','袋','桶','箱','打','組','塊','條') then null
   when target_unit in ('包','瓶','罐','盒','袋','桶','箱','打','組','塊','條')
    and (target_package is null or private.inventory_package_measure(r.purchase,r.unit,null) is null) then null
   when target_package is not null then private.cost_purchase_price(r.purchase,target_package->>'unit')*(target_package->>'quantity')::numeric
   else private.cost_purchase_price(r.purchase,u) end value from latest r
 ) select count(*) n,count(*) filter(where value is null or value<0 or value>=1000000000) invalid,
  count(distinct value) distinct_prices,(array_agg(to_jsonb(c) order by created_at desc,id))[1] latest into selected from converted c;
 if selected.n>0 then
  if selected.invalid>0 then return jsonb_build_object('price',null,'reason','最新進貨缺少已確認的規格或單位換算','basis','receipt','date',selected.latest->'effective_date')||
   case when selected.n=1 then jsonb_build_object('unit',u,'purchase',selected.latest->'purchase','specification',selected.latest->'specification',
    'source',concat_ws(' · ','本店進貨',nullif(selected.latest->>'supplier','')),'supplier_name',selected.latest->'supplier',
    'reference_id',selected.latest->'id','batch_id',selected.latest->'batch_id','store_id',s) else '{}'::jsonb end;end if;
  if selected.distinct_prices<>1 then return jsonb_build_object('price',null,'reason','同日有不同的已確認進價，待核對','basis','receipt','date',selected.latest->'effective_date');end if;
  return jsonb_build_object('price',round((selected.latest->>'value')::numeric,6),'unit',u,'source',concat_ws(' · ','本店進貨',nullif(selected.latest->>'supplier','')),
   'date',selected.latest->'effective_date','basis','receipt','reference_id',selected.latest->'id','batch_id',selected.latest->'batch_id','store_id',s,
   'purchase',selected.latest->'purchase','specification',selected.latest->'specification','supplier_name',selected.latest->'supplier');
 end if;
 if product is not null and count_baseline is not null and (count_baseline->>'price')::numeric>=0 and (count_baseline->>'price')::numeric<1000000000 then
  return count_baseline||jsonb_build_object('unit',u,'source','食材價格表 · 已確認基準');
 end if;
 -- Only absent receipt evidence can use an existing dated confirmed standard.
 if version.snapshot->>'review_status'='confirmed' and version.snapshot->>'cost_price' is not null then
  quote:=case when target_package is not null then coalesce(private.cost_purchase_price(version.snapshot->'purchase',target_package->>'unit'),
   case when version.snapshot->>'unit'=target_package->>'unit' then (version.snapshot->>'cost_price')::numeric end)*(target_package->>'quantity')::numeric
   when version.snapshot->>'unit'=target_unit then (version.snapshot->>'cost_price')::numeric*private.recipe_factor(u)
   else private.cost_purchase_price(version.snapshot->'purchase',u) end;
  if quote>=0 and quote<1000000000 then return jsonb_build_object('price',round(quote,6),'unit',u,'source','食材價格表 · 標準價','basis','standard',
   'date',case when version.effective_date>'0001-01-01'::date then version.effective_date end,'purchase',version.snapshot->'purchase');end if;
 end if;
 return jsonb_build_object('price',null,'unit',u,'reason','缺少已確認進價或單位換算');
end $$;
revoke all on function private.automatic_cost_quote_cached(uuid,uuid,text,text,date,uuid,jsonb) from public,anon,authenticated;

-- Reuse the context across all prices in a request, preserving existing public
-- authentication, baseline fields, history and scalar operational save guards.
do $patch$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.recipe_current_prices(uuid)'::regprocedure);
 anchor:=' with raw_identities as materialized (';
 if strpos(src,anchor)=0 then raise exception 'RECIPE_PRICE_CONTEXT_ANCHOR';end if;
 src:=replace(src,'declare result jsonb;','declare result jsonb; price_context jsonb;');
 src:=replace(src,anchor,' price_context:=private.automatic_cost_context(s,(now() at time zone ''Asia/Taipei'')::date);'||chr(10)||anchor);
 anchor:='private.automatic_cost_quote(s,product,name,unit,(now() at time zone ''Asia/Taipei'')::date,coalesce(ingredient,root))';
 if strpos(src,anchor)=0 then raise exception 'RECIPE_CACHED_QUOTE_ANCHOR';end if;
 src:=replace(src,anchor,'private.automatic_cost_quote_cached(s,product,name,unit,(now() at time zone ''Asia/Taipei'')::date,coalesce(ingredient,root),price_context)');
 execute src;
 src:=pg_get_functiondef('private.ingredient_supply_read(uuid)'::regprocedure);
 anchor:='base:=private.ingredient_catalog(s);';
 if strpos(src,anchor)=0 then raise exception 'INGREDIENT_PRICE_CONTEXT_ANCHOR';end if;
 src:=replace(src,'declare base jsonb; result jsonb;','declare base jsonb; result jsonb; price_context jsonb;');
 src:=replace(src,anchor,anchor||chr(10)||' price_context:=private.automatic_cost_context(s,(now() at time zone ''Asia/Taipei'')::date);');
 anchor:='''supplier_id'',c.supplier_id';
 if strpos(src,anchor)=0 or strpos(src,'''current_quote''')>0 then raise exception 'INGREDIENT_CACHED_QUOTE_ANCHOR';end if;
 execute replace(src,anchor,'''current_quote'',private.automatic_cost_quote_cached(s,null,x.value->>''name'',x.value->>''unit'',(now() at time zone ''Asia/Taipei'')::date,(x.value->>''id'')::uuid,price_context),'||anchor);

end $patch$;
notify pgrst,'reload schema';
