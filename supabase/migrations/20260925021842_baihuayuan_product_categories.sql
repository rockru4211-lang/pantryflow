-- Primary categories are shared product metadata. Original import categories and
-- closed inventory payloads remain unchanged. NULL override means auto classify.
create table private.product_categories (
 product_id uuid primary key references public.products(id),
 category text not null check(category in ('食材','耗材','調料','酒水','待分類')),
 revision integer not null default 1,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default clock_timestamp()
);
alter table private.product_categories enable row level security;
revoke all on private.product_categories from public,anon,authenticated;

create function private.classify_product(p_name text,p_category text default null)
returns text language sql immutable set search_path='' as $$
 select case
 when p_category in ('食材','耗材','調料','酒水','待分類') then p_category
 when p_name ~* '(保鮮膜|鋁箔|烘焙紙|烤盤紙|餐巾紙|衛生紙|紙巾|紙捲|紙盒|餐盒|紙杯|飲料杯|杯蓋|桶蓋|盒蓋|手套|垃圾袋|塑膠袋|夾鏈袋|清潔|洗碗精|消毒|漂白|菜瓜布|抹布|吸管|竹籤|牙籤|免洗)' then '耗材'
 when p_name ~* '(醬油|醬料|辣椒醬|番茄醬|美乃滋|沙拉醬|芥末醬|豆瓣醬|蠔油|魚露|紅酒醋|白酒醋|果醋|香醋|白醋|米醋|海鹽|食鹽|岩鹽|砂糖|黑糖|糖粉|糖漿|蜂蜜|胡椒|香料|調味|孜然|肉桂粉|咖哩粉|橄欖油|沙拉油|炸油|葵花油|芝麻油|香油|料理酒|料理用酒|米酒|味醂|荳蔻|豆蔻|月桂葉)' then '調料'
 when p_name ~* '(啤酒|氣泡水|礦泉水|飲用水|果汁|汽水|可樂|雪碧|烏龍茶|紅茶|綠茶|茶葉|咖啡豆|咖啡粉|威士忌|伏特加|琴酒|蘭姆酒|白蘭地|香檳|saison|lager|pilsner|whisky|whiskey|vodka)' then '酒水'
 when p_name ~* '(核桃|杏仁|腰果|開心果|花生|牛肉|和牛|豬肉|羊肉|雞肉|雞腿|雞胸|鴨肉|鴨胸|火腿|培根|香腸|肋排|牛排|牛腱|松阪豬|豬頸|里肌|鮭魚|鱈魚|鯖魚|鮪魚|鱸魚|鯛魚|鰻魚|生蠔|牡蠣|干貝|蝦仁|白蝦|草蝦|龍蝦|蛤蜊|淡菜|花枝|透抽|小卷|章魚|蟹肉|牛奶|鮮奶|奶油|起司|乳酪|乾酪|優格|雞蛋|鴨蛋|蛋白|蛋黃|麵粉|米粉|義大利麵|烏龍麵|白米|糯米|麵包|麵糰|塔殼|豆腐|豆皮|番茄|蕃茄|洋蔥|青蔥|蒜頭|馬鈴薯|地瓜|南瓜|高麗菜|花椰菜|菠菜|生菜|青江菜|小白菜|蘿蔔|甜椒|茄子|小黃瓜|香菇|蘑菇|杏鮑菇|檸檬|蘋果|香蕉|草莓|藍莓|葡萄|酪梨|柳橙)' then '食材'
 else '待分類' end
$$;
revoke all on function private.classify_product(text,text) from public,anon,authenticated;

create function private.save_product_category(p_store uuid,p_data jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare org uuid; pid uuid:=(p_data->>'id')::uuid; old private.product_categories; saved private.product_categories; product public.products;
begin
 if auth.uid() is null or coalesce(private.app_role(p_store),'') not in ('OWNER','LOGISTICS') or not private.has_active_store_role(p_store,null) then raise exception 'CATALOG_ROLE_REQUIRED' using errcode='42501';end if;
 select s.organization_id into org from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store and s.is_active and o.business_type<>'CHAIN_RESTAURANT';
 if org is null then raise exception 'CATALOG_ROLE_REQUIRED' using errcode='42501';end if;
 if p_data->>'category' is null or p_data->>'category' not in ('食材','耗材','調料','酒水','待分類') then raise exception 'INVALID_PRODUCT_CATEGORY' using errcode='22023';end if;
 select * into product from public.products where id=pid and organization_id=org;
 if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002';end if;
 perform pg_advisory_xact_lock(hashtextextended(pid::text||':category',902));
 select * into old from private.product_categories where product_id=pid;
 if (p_data->>'revision')::integer is distinct from coalesce(old.revision,0) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 insert into private.product_categories(product_id,category,updated_by) values(pid,p_data->>'category',auth.uid())
 on conflict(product_id) do update set category=excluded.category,revision=private.product_categories.revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() returning * into saved;
 return jsonb_build_object('id',pid,'primary_category',saved.category,'category_revision',saved.revision,'previous',coalesce(old.category,private.classify_product(product.name,product.category)));
end $$;
revoke all on function private.save_product_category(uuid,jsonb) from public,anon,authenticated;

-- Enrich presentation rows only, including historical months. Saved quantities,
-- amounts, source signatures, review acknowledgements and closure payloads are intact.
create function private.inventory_category_rows(p_state jsonb,p_store uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_set(p_state,'{rows}',coalesce((select jsonb_agg(r||jsonb_build_object(
 'original_category',r->'category','category',coalesce(c.category,private.classify_product(p.name,p.category)),
 'category_revision',coalesce(c.revision,0)) order by ord)
 from jsonb_array_elements(p_state->'rows') with ordinality as a(r,ord)
 left join public.products p on p.id::text=r->>'product_id' and p.organization_id=(select organization_id from public.stores where id=p_store)
 left join private.product_categories c on c.product_id=p.id),'[]'::jsonb))
$$;
revoke all on function private.inventory_category_rows(jsonb,uuid) from public,anon,authenticated;

do $migration$
declare src text; anchor text;
begin
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into src;
 anchor:='''aliases'',coalesce(d.aliases,''{}''),''safety_quantity''';
 if strpos(src,anchor)=0 then raise exception 'CATEGORY_CATALOG_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'''primary_category'',coalesce(pc.category,private.classify_product(p.name,p.category)),''category_revision'',coalesce(pc.revision,0),'||anchor);
 anchor:='from public.products p left join private.product_details d on d.product_id=p.id';
 if strpos(src,anchor)=0 then raise exception 'CATEGORY_JOIN_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,anchor||' left join private.product_categories pc on pc.product_id=p.id');execute src;
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into src;
 anchor:=' if p_action=''store.create'' then';
 if strpos(src,anchor)=0 then raise exception 'CATEGORY_SAVE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,' if p_action=''product.category'' then return private.save_product_category(p_store,p_data);end if;'||chr(10)||anchor);
 anchor:='v_result:=to_jsonb(v_product);';
 if strpos(src,anchor)=0 then raise exception 'CATEGORY_PRODUCT_FORM_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,anchor||$patch$
 if coalesce(p_data->>'primary_category','')<>'' then
  v_result:=v_result||private.save_product_category(p_store,jsonb_build_object('id',v_id,'category',p_data->>'primary_category','revision',coalesce((p_data->>'category_revision')::integer,0)));
 end if;
$patch$);execute src;
 select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src;
 anchor:=' if p_action=''supplier.save'' then';
 if strpos(src,anchor)=0 then raise exception 'CATEGORY_AUTH_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,' if p_action=''product.category'' and (auth.uid() is null or coalesce(v_role,'''') not in (''OWNER'',''LOGISTICS'') or not private.has_active_store_role(p_store,null) or not exists(select 1 from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store and s.is_active and o.business_type<>''CHAIN_RESTAURANT'')) then raise exception ''CATALOG_ROLE_REQUIRED'' using errcode=''42501'';end if;'||chr(10)||anchor);execute src;
 select pg_get_functiondef('private.baihuayuan_inventory_month(uuid,date,text,jsonb)'::regprocedure) into src;
 if strpos(src,'then return state;end if;')=0 or strpos(src,'return private.inventory_month_state(p_store_id,p_month,source_id);')=0 then raise exception 'CATEGORY_INVENTORY_ANCHOR_MISSING';end if;
 src:=replace(src,'then return state;end if;','then return private.inventory_category_rows(state,p_store_id);end if;');
 src:=replace(src,'return private.inventory_month_state(p_store_id,p_month,source_id);','return private.inventory_category_rows(private.inventory_month_state(p_store_id,p_month,source_id),p_store_id);');execute src;
end $migration$;
notify pgrst,'reload schema';
