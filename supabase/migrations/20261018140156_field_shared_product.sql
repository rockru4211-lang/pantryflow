-- One atomic field catalog entry, not an inventory receipt or opening balance.
create table private.field_product_entries(
 store_id uuid not null references public.stores(id), product_id uuid not null references public.products(id),
 ingredient_id uuid not null, unit text not null, unit_price numeric check(unit_price>=0 and unit_price<1000000000),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 primary key(store_id,product_id), foreign key(ingredient_id,store_id) references private.ingredient_masters(id,store_id)
);
alter table private.field_product_entries enable row level security;
revoke all on private.field_product_entries from public,anon,authenticated;

create function private.field_product_scope(s uuid,target uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
 if auth.uid() is null or coalesce(private.app_role(s),'') not in ('STAFF','SUPERVISOR','LOGISTICS','OWNER') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 perform private.assert_store_editable(s);
 select organization_id into org from public.stores where id=s and is_active and name in ('BeApe','Gras');
 if s<>target and not exists(select 1 from public.organizations where id=org and store_mode='MULTI') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if org is null or not exists(select 1 from public.stores where id=target and organization_id=org and is_active and name in ('BeApe','Gras')) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 -- Match the existing two-store field transfer authorization; explicit view access cannot write.
 if private.store_access_mode(target)='VIEW' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 return org;
end $$;
revoke all on function private.field_product_scope(uuid,uuid) from public,anon,authenticated;

create function private.field_product_options(s uuid,target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
 org:=private.field_product_scope(s,target);
 return jsonb_build_object('store_name',(select name from public.stores where id=target),
 'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',coalesce(nullif(p.count_unit,''),p.base_unit)) order by p.name),'[]') from public.products p where p.organization_id=org and p.is_active and private.count_product_not_removed(target,p.id) and not exists(select 1 from private.count_field_removed where store_id=target and product_id=p.id)),
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from public.suppliers where organization_id=org and is_active),
 'units',(select coalesce(jsonb_agg(unit order by unit),'[]') from private.store_units where store_id=target));
end $$;
revoke all on function private.field_product_options(uuid,uuid) from public,anon;
grant execute on function private.field_product_options(uuid,uuid) to authenticated;
create function public.field_product_options(p_store_id uuid,p_target_store_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.field_product_options(p_store_id,p_target_store_id)$$;
revoke all on function public.field_product_options(uuid,uuid) from public,anon;
grant execute on function public.field_product_options(uuid,uuid) to authenticated;

create function private.create_field_product(s uuid,target uuid,d jsonb,request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; prior private.app_requests; payload jsonb:=jsonb_build_object('target',target,'data',d);p public.products;mid uuid;sp uuid;nm text:=btrim(d->>'name');u text:=btrim(d->>'unit');price numeric;z uuid;sid uuid:=nullif(d->>'session_id','')::uuid;cs public.inventory_count_sessions;vitem jsonb;result jsonb;created boolean:=false;master_new boolean:=false;n integer;
begin
 org:=private.field_product_scope(s,target);
 if request is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('field-product:'||org,0));
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then
  if prior.actor_id is distinct from auth.uid() or prior.action<>'product.field-create' or prior.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return prior.result;
 end if;
 if nm is null or length(nm) not between 1 and 160 or u is null or length(u) not between 1 and 30 then raise exception 'FIELD_PRODUCT_REQUIRED' using errcode='22023';end if;
 price:=nullif(d->>'unit_price','')::numeric;sp:=nullif(d->>'supplier_id','')::uuid;
 if price<0 or price>=1000000000 or price::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_PRICE' using errcode='22023';end if;
 if sp is not null and not exists(select 1 from public.suppliers where id=sp and organization_id=org and is_active) then raise exception 'INVALID_SUPPLIER' using errcode='22023';end if;
 if nullif(d->>'product_id','') is not null then
  select * into p from public.products where id=(d->>'product_id')::uuid and organization_id=org;
  if p.id is null or p.name<>nm or coalesce(nullif(p.count_unit,''),p.base_unit)<>u then raise exception 'FIELD_PRODUCT_CHANGED' using errcode='40001';end if;
 else
  select count(*) into n from public.products where organization_id=org and private.ingredient_match_text(name)=private.ingredient_match_text(nm) and coalesce(nullif(count_unit,''),base_unit)=u;
  if n>1 then raise exception 'FIELD_PRODUCT_AMBIGUOUS' using errcode='22023';end if;
  select * into p from public.products where organization_id=org and private.ingredient_match_text(name)=private.ingredient_match_text(nm) and coalesce(nullif(count_unit,''),base_unit)=u limit 1;
 end if;
 if p.id is not null and (not p.is_active or not private.count_product_not_removed(target,p.id) or exists(select 1 from private.count_field_removed where store_id=target and product_id=p.id)) then raise exception 'FIELD_PRODUCT_REMOVED' using errcode='22023';end if;
 if p.id is not null and (price is not null or sp is not null) then raise exception 'FIELD_PRODUCT_EXISTS' using errcode='22023';end if;
 if p.id is null then
  insert into public.products(organization_id,product_code,name,category,base_unit,count_unit,current_supplier_id,is_active) values(org,'ITEM-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),nm,'其他',u,u,sp,true) returning * into p;
  created:=true;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('ingredient:'||target,0));
 select id into mid from private.ingredient_masters where store_id=target and lower(btrim(name))=lower(btrim(nm)) and unit=private.recipe_unit(u);
 if mid is not null and exists(select 1 from private.ingredient_supply_state where store_id=target and ingredient_id=mid and stopped and supplier_key='*') then raise exception 'FIELD_PRODUCT_REMOVED' using errcode='22023';end if;
 if mid is null then
  perform set_config('app.standard_change_reason','現場新增品項，價格待後勤確認',true);
  insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,review_status,updated_by,purchase)
  values(target,nm,private.recipe_unit(u),price/private.recipe_factor(u),true,'pending',auth.uid(),case when price is not null then jsonb_build_object('amount',price,'quantity',1,'unit',u) end) returning id into mid;
  master_new:=true;
 elsif price is not null or sp is not null then raise exception 'FIELD_PRODUCT_EXISTS' using errcode='22023';end if;
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,corrected) values(target,mid,p.name,'p:'||p.id,private.recipe_unit(u),true) on conflict do nothing;
 if master_new then
  insert into private.ingredient_price_choices(store_id,ingredient_id,supplier_id) values(target,mid,sp) on conflict do nothing;
  insert into private.field_product_entries(store_id,product_id,ingredient_id,unit,unit_price,created_by) values(target,p.id,mid,u,price,auth.uid()) on conflict do nothing;
 end if;
 z:=nullif(d->>'zone_id','')::uuid;
 if sid is not null then
  select * into cs from public.inventory_count_sessions where id=sid and store_id=target and status='IN_PROGRESS' for update;
  if cs.id is null or z is null then raise exception 'COUNT_ZONE_NOT_AVAILABLE' using errcode='22023';end if;
 end if;
 if z is not null then
  if not exists(select 1 from public.count_zones where id=z and store_id=target and is_active) or exists(select 1 from public.count_zone_progress where session_id=sid and zone_id=z and status='COMPLETED') then raise exception 'COUNT_ZONE_NOT_AVAILABLE' using errcode='22023';end if;
 else
  select zp.zone_id into z from public.zone_products zp join public.count_zones cz on cz.id=zp.zone_id where cz.store_id=target and cz.is_active and zp.product_id=p.id order by cz.sort_order limit 1;
  if z is null then
   select id into z from public.count_zones where store_id=target and name='未分類' and is_active order by sort_order limit 1;
   if z is null then insert into public.count_zones(organization_id,store_id,name,sort_order) values(org,target,'未分類',coalesce((select max(sort_order)+1 from public.count_zones where store_id=target),0)) returning id into z;end if;
  end if;
 end if;
 insert into public.zone_products(zone_id,product_id,sort_order,count_unit) values(z,p.id,coalesce((select max(sort_order)+1 from public.zone_products where zone_id=z),0),u) on conflict do nothing;
 if sid is not null and not exists(select 1 from jsonb_array_elements(coalesce(cs.snapshot->'zones','[]')) x where x->>'zone_id'=z::text and x->>'product_id'=p.id::text) then
  vitem:=jsonb_build_object('zone_id',z,'zone_name',(select name from public.count_zones where id=z),'product_id',p.id,'product_code',p.product_code,'product_name',p.name,'unit',u,'supplier',(select name from public.suppliers where id=p.current_supplier_id),'added_during_count',true);
  update public.inventory_count_sessions set snapshot=jsonb_set(snapshot,'{zones}',coalesce(snapshot->'zones','[]')||jsonb_build_array(vitem)) where id=sid;
  insert into private.count_opening_snapshots(session_id,product_id,quantity,confirmed_at) values(sid,p.id,null,now()) on conflict do nothing;
 end if;
 insert into private.store_units(store_id,unit) values(target,u) on conflict do nothing;
 result:=jsonb_build_object('id',p.id,'name',p.name,'unit',u,'created',created,'ingredient_id',mid,'store_id',target);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),'product.field-create',payload,result);
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id) values(org,target,'product',p.id,'FIELD_PRODUCT_SAVED',d||result,auth.uid());
 return result;
end $$;
revoke all on function private.create_field_product(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function private.create_field_product(uuid,uuid,jsonb,uuid) to authenticated;
create function public.create_field_product(p_store_id uuid,p_target_store_id uuid,p_data jsonb,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.create_field_product(p_store_id,p_target_store_id,p_data,p_request_id)$$;
revoke all on function public.create_field_product(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.create_field_product(uuid,uuid,jsonb,uuid) to authenticated;

-- Keep provenance visible in the existing back-office ingredient catalog.
do $patch$
declare src text;anchor text:='''source'',r.source';
begin
 src:=pg_get_functiondef('private.ingredient_catalog(uuid)'::regprocedure);
 if strpos(src,anchor)=0 then raise exception 'INGREDIENT_SOURCE_ANCHOR_MISSING';end if;
 execute replace(src,anchor,'''source'',coalesce(r.source,case when exists(select 1 from private.field_product_entries f where f.ingredient_id=m.id and m.review_status=''pending'' and m.revision=1) then ''現場填寫・待後勤確認'' end)');
end $patch$;

-- Optional field quotes are an explicitly labelled fallback; confirmed standards win.
alter function private.resolved_cost_quote(uuid,uuid,text,text,date) rename to resolved_cost_quote_before_field;
create function private.resolved_cost_quote(s uuid,product uuid,nm text,u text,at_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q jsonb; f private.field_product_entries;
begin
 q:=private.resolved_cost_quote_before_field(s,product,nm,u,at_date);
 if q->>'price' is not null then return q;end if;
 select e.* into f from private.field_product_entries e join private.ingredient_masters m on m.id=e.ingredient_id
 where e.store_id=s and e.product_id=product and e.unit=u and e.unit_price is not null and m.revision=1 and m.review_status='pending'
 and (e.created_at at time zone 'Asia/Taipei')::date<=coalesce(at_date,(now() at time zone 'Asia/Taipei')::date)
 and not exists(select 1 from private.ingredient_supply_state st where st.store_id=s and st.ingredient_id=m.id and st.stopped and st.supplier_key='*');
 if f.product_id is not null then return jsonb_build_object('price',f.unit_price,'source','現場填寫・待後勤確認','date',(f.created_at at time zone 'Asia/Taipei')::date,'basis','field_estimate','unit',u);end if;
 return q;
end $$;
revoke all on function private.resolved_cost_quote(uuid,uuid,text,text,date),private.resolved_cost_quote_before_field(uuid,uuid,text,text,date) from public,anon,authenticated;
notify pgrst,'reload schema';
