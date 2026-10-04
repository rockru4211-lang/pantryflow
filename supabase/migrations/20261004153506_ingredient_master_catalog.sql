-- Ingredient masters retain source quotations and explicit alias corrections.
create table if not exists private.ingredient_masters (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
 name text not null check(length(btrim(name)) between 1 and 200), unit text not null,
 cost_price numeric check(cost_price>=0), selected_reference uuid references private.recipe_price_entries(id),
 review_status text not null default 'pending' check(review_status in ('confirmed','pending')),
 manual boolean not null default false, revision integer not null default 1,
 updated_at timestamptz not null default now(), updated_by uuid,
 unique(id,store_id)
);
create unique index if not exists ingredient_master_name_unit on private.ingredient_masters(store_id,lower(btrim(name)),unit);
create table if not exists private.ingredient_aliases (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
 ingredient_id uuid not null, name text not null, source_key text not null, source_unit text not null,
 specification text not null default '', reference_ids uuid[] not null default '{}',
 corrected boolean not null default false,
 foreign key(ingredient_id,store_id) references private.ingredient_masters(id,store_id),
 unique(store_id,source_key,source_unit,specification)
);
create index if not exists ingredient_alias_master on private.ingredient_aliases(ingredient_id);
alter table private.ingredient_masters enable row level security;
alter table private.ingredient_aliases enable row level security;
revoke all on private.ingredient_masters,private.ingredient_aliases from public,anon,authenticated;

create or replace function private.ingredient_name(raw text,u text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare n text:=btrim(normalize(raw,NFKC));
begin
 n:=replace(replace(replace(n,'蕃茄','番茄'),'愛樂微','愛樂薇'),'安家無鹽奶油','安佳無鹽奶油');
 n:=regexp_replace(n,'[[:space:]]+',' ','g');
 if private.recipe_unit(u)='g' then n:=regexp_replace(n,'[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*(kg|KG|g|G|公克|公斤|克|磅)$','','g');end if;
 if private.recipe_unit(u)='ml' then n:=regexp_replace(n,'[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*(ml|ML|L|l|毫升|公升)$','','g');end if;
 n:=case n when '大蒜仁' then '蒜仁' when '去皮蒜頭' then '蒜仁' when '去皮大蒜' then '蒜仁'
 when '帶皮大蒜' then '帶皮蒜頭' when '台灣洋芋' then '台灣馬鈴薯'
 when '無鹽牛油' then '無鹽奶油' when '奶油(無鹽)' then '無鹽奶油'
 when '無鹽奶油-安佳' then '安佳無鹽奶油' when '無鹽奶油1P安佳' then '安佳無鹽奶油'
 when '(可果美)番茄糊' then '可果美番茄糊' else n end;
 return btrim(n);
end $$;
revoke all on function private.ingredient_name(text,text) from public,anon,authenticated;

create or replace function private.seed_ingredient_masters(s uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Internal migration/import helper; never callable by application roles.
 insert into private.ingredient_masters(store_id,name,unit)
 select distinct s,private.ingredient_name(r.name,r.unit)||case when btrim(coalesce(r.source_ref->>'specification',''))<>'' then ' · '||btrim(r.source_ref->>'specification') else '' end,private.recipe_unit(r.unit)
 from private.recipe_price_entries r where r.store_id=s
 on conflict do nothing;
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,specification,reference_ids)
 select s,m.id,min(r.name),case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,private.recipe_unit(r.unit),btrim(coalesce(r.source_ref->>'specification','')),array_agg(r.id order by r.created_at,r.id)
 from private.recipe_price_entries r join private.ingredient_masters m on m.store_id=s and lower(btrim(m.name))=lower(btrim(private.ingredient_name(r.name,r.unit)||case when btrim(coalesce(r.source_ref->>'specification',''))<>'' then ' · '||btrim(r.source_ref->>'specification') else '' end)) and m.unit=private.recipe_unit(r.unit)
 where r.store_id=s group by m.id,case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,private.recipe_unit(r.unit),btrim(coalesce(r.source_ref->>'specification',''))
 on conflict(store_id,source_key,source_unit,specification) do update set reference_ids=excluded.reference_ids;
 -- A saved correction or manual price is never reset by a later import.
 with ranked as (
 select distinct on(a.ingredient_id) a.ingredient_id,r.id,r.cost_price,r.price,r.unit
 from private.ingredient_aliases a join private.recipe_price_entries r on r.id=any(a.reference_ids)
 where a.store_id=s and r.review_status='confirmed' and coalesce(r.source_ref->>'missing_price','false')<>'true'
 order by a.ingredient_id,case when r.source_kind='history' then 1 else 0 end,r.effective_date desc nulls last,r.created_at desc,r.id desc
 ) update private.ingredient_masters m set selected_reference=r.id,cost_price=coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit),review_status='confirmed'
 from ranked r where m.id=r.ingredient_id and m.cost_price is null and m.revision=1 and not m.manual;
end $$;
revoke all on function private.seed_ingredient_masters(uuid) from public,anon,authenticated;

create or replace function private.ingredient_catalog(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 with aliases as (
 select ingredient_id,jsonb_agg(jsonb_build_object('id',id,'name',name,'unit',source_unit,'specification',specification,'corrected',corrected) order by name,id) items
 from private.ingredient_aliases where store_id=s group by ingredient_id
 ) select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('aliases',coalesce(a.items,'[]'::jsonb)) order by m.name,m.unit),'[]'::jsonb) into rows
 from private.ingredient_masters m left join aliases a on a.ingredient_id=m.id
 where m.store_id=s and (a.ingredient_id is not null or m.manual);
 return jsonb_build_object('ingredients',rows,'can_price',private.recipe_allowed(s,true) and private.store_access_mode(s)='EDIT');
end $$;
revoke all on function private.ingredient_catalog(uuid) from public,anon;
grant execute on function private.ingredient_catalog(uuid) to authenticated;

create or replace function private.ingredient_sources(s uuid,i uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.recipe_allowed(s) or not exists(select 1 from private.ingredient_masters where id=i and store_id=s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'unit',private.recipe_unit(r.unit),'price',case when r.source_ref->>'missing_price'='true' then null else coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) end,'source',r.source,'effective_date',r.effective_date,'review_status',r.review_status,'source_ref',r.source_ref,'purchase',r.purchase) order by r.effective_date desc nulls last,r.created_at desc),'[]') into result
 from private.recipe_price_entries r where r.store_id=s and exists(select 1 from private.ingredient_aliases a where a.ingredient_id=i and a.store_id=s and r.id=any(a.reference_ids));
 return result;
end $$;
revoke all on function private.ingredient_sources(uuid,uuid) from public,anon;
grant execute on function private.ingredient_sources(uuid,uuid) to authenticated;

create or replace function private.ingredient_operation(s uuid,action text,data jsonb,request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.app_requests; m private.ingredient_masters; a private.ingredient_aliases; target private.ingredient_masters; ref private.recipe_price_entries; result jsonb; org uuid; nm text; u text; price numeric; old jsonb;
begin
 if not private.recipe_allowed(s,true) or private.store_access_mode(s) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if request is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('ingredient:'||s::text,0));
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then
  if prior.actor_id<>auth.uid() or prior.action<>action or prior.payload<>data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return prior.result;
 end if;
 select organization_id into org from public.stores where id=s;
 if action='ingredient.save' then
  if nullif(data->>'id','') is not null then
   select * into m from private.ingredient_masters where id=(data->>'id')::uuid and store_id=s for update;
   if not found then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
   if m.revision is distinct from (data->>'revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  end if;
  old:=to_jsonb(m);nm:=btrim(data->>'name');u:=private.recipe_unit(coalesce(data->>'unit',''));
  price:=nullif(data->>'cost_price','')::numeric/private.recipe_factor(coalesce(data->>'unit',''));
  if nm is null or length(nm) not between 1 and 200 or u='' or price<0 or price::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_INGREDIENT' using errcode='22023';end if;
  if nullif(data->>'selected_reference','') is not null then
   select * into ref from private.recipe_price_entries where id=(data->>'selected_reference')::uuid and store_id=s;
   if ref.id is null or not exists(select 1 from private.ingredient_aliases where ingredient_id=m.id and store_id=s and ref.id=any(reference_ids)) then raise exception 'INVALID_PRICE_REFERENCE' using errcode='22023';end if;
  end if;
  if m.id is null then
   insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,review_status,updated_by) values(s,nm,u,price,true,case when price is null or u in ('待確認','待補單位') then 'pending' else 'confirmed' end,auth.uid()) returning * into m;
  else
   -- Keep the former canonical name searchable after a rename.
   if lower(m.name)<>lower(nm) or m.unit<>u then
    insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,corrected) values(s,m.id,m.name,'n:'||lower(btrim(m.name)),m.unit,true) on conflict do nothing;
   end if;
   update private.ingredient_masters set name=nm,unit=u,cost_price=price,selected_reference=ref.id,manual=true,review_status=case when price is null or u in ('待確認','待補單位') then 'pending' else 'confirmed' end,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=m.id returning * into m;
  end if;
  result:=jsonb_build_object('id',m.id,'revision',m.revision);
 elsif action='ingredient.alias' then
  select * into a from private.ingredient_aliases where id=(data->>'alias_id')::uuid and store_id=s for update;
  if not found then raise exception 'INVALID_INGREDIENT_ALIAS' using errcode='22023';end if;
  select * into m from private.ingredient_masters where id=a.ingredient_id and store_id=s for update;
  if m.id is distinct from (data->>'id')::uuid or m.revision is distinct from (data->>'revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  old:=to_jsonb(a);
  if nullif(data->>'target_id','') is not null then
   select * into target from private.ingredient_masters where id=(data->>'target_id')::uuid and store_id=s for update;
   if target.id is null or target.id=m.id or target.unit<>a.source_unit then raise exception 'INVALID_INGREDIENT_TARGET' using errcode='22023';end if;
   if target.revision is distinct from (data->>'target_revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  else
   nm:=btrim(data->>'name');
   if nm is null or length(nm) not between 1 and 200 then raise exception 'INVALID_INGREDIENT' using errcode='22023';end if;
   select * into ref from private.recipe_price_entries where id=any(a.reference_ids) and store_id=s and review_status='confirmed' order by effective_date desc nulls last,created_at desc limit 1;
   insert into private.ingredient_masters(store_id,name,unit,cost_price,selected_reference,manual,review_status,updated_by)
   values(s,nm,a.source_unit,case when ref.id is not null then coalesce(ref.cost_price,ref.price)/private.recipe_factor(ref.unit) end,ref.id,true,case when ref.id is null then 'pending' else 'confirmed' end,auth.uid()) returning * into target;
  end if;
  update private.ingredient_aliases set ingredient_id=target.id,corrected=true where id=a.id;
  update private.ingredient_masters set revision=revision+1,updated_at=now(),updated_by=auth.uid(),cost_price=case when selected_reference=any(a.reference_ids) then null else cost_price end,review_status=case when selected_reference=any(a.reference_ids) then 'pending' else review_status end,selected_reference=case when selected_reference=any(a.reference_ids) then null else selected_reference end where id=m.id;
  update private.ingredient_masters set revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=target.id;
  result:=jsonb_build_object('id',target.id,'from_id',m.id);
 else raise exception 'INVALID_INGREDIENT_ACTION' using errcode='22023';end if;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),action,data,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id) values(org,'ingredient',result->>'id',action,old,data||result,auth.uid());
 return result;
end $$;
revoke all on function private.ingredient_operation(uuid,text,jsonb,uuid) from public,anon;
grant execute on function private.ingredient_operation(uuid,text,jsonb,uuid) to authenticated;

CREATE OR REPLACE FUNCTION private.recipe_prices_before_master(s uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with refs as (
 select *,case when product_id is not null then 'p:'||product_id else 'n:'||lower(btrim(name)) end key
 from private.recipe_price_entries where store_id=s and review_status='confirmed' and (select private.recipe_allowed(s))
 ), mappings as (
 select distinct on(key,private.recipe_unit(unit),coalesce(source_ref->>'product_id',product_id::text),coalesce(source_ref->>'supplier_id',source_ref->>'supplier_name','')) * from refs
 order by key,private.recipe_unit(unit),coalesce(source_ref->>'product_id',product_id::text),coalesce(source_ref->>'supplier_id',source_ref->>'supplier_name',''),effective_date desc nulls last,created_at desc,id desc
 ), receipts as (
 select l.product_id,p.name,l.specification,l.unit,l.unit_price_ex_tax,g.receipt_date,coalesce(l.supplier_id,g.supplier_id) supplier_id,
 coalesce(g.reviewed_at,l.created_at) recorded_at,l.id::text source_id,sp.name supplier_name
 from public.receipt_lines l join public.goods_receipts g on g.id=l.receipt_id
 join public.receipt_upload_batches b on b.id=g.source_batch_id join public.products p on p.id=l.product_id
 left join public.suppliers sp on sp.id=coalesce(l.supplier_id,g.supplier_id)
 where g.store_id=s and b.status::text='COMPLETED' and l.unit_price_ex_tax>=0 and l.quantity>0
 and nullif(btrim(l.unit),'') is not null and (select private.recipe_allowed(s))
 ), candidates as (
 select 'p:'||r.product_id key,r.name,r.product_id,private.recipe_unit(r.unit) unit,
 r.unit_price_ex_tax/private.recipe_factor(r.unit) price,'已核對進貨'::text source,r.receipt_date effective_date,
 r.recorded_at,r.source_id,r.supplier_name,jsonb_build_object('amount',r.unit_price_ex_tax,'quantity',1,'unit',r.unit) purchase,
 null::numeric cost_price,'purchase'::text source_kind,jsonb_build_object('supplier_id',r.supplier_id,'supplier_name',r.supplier_name,'specification',r.specification) source_ref,null::uuid reference_id,0 priority
 from receipts r
 union all
 select q.key,q.name,q.product_id,private.recipe_unit(q.unit),q.price/private.recipe_factor(q.unit),q.source,q.effective_date,
 q.created_at,q.id::text,q.source_ref->>'supplier_name',q.purchase,q.cost_price/private.recipe_factor(q.unit),q.source_kind,q.source_ref,q.id,
 case when q.source_kind='history' then 1 else 0 end
 from refs q
 union all
 -- Reuse only explicitly approved product matches and package conversions.
 select q.key,q.name,q.product_id,private.recipe_unit(q.unit),r.unit_price_ex_tax/conversion.factor,
 '已核對進貨',r.receipt_date,r.recorded_at,r.source_id,r.supplier_name,
 jsonb_build_object('amount',r.unit_price_ex_tax,'quantity',1,'unit',r.unit)||
 case when private.recipe_unit(r.unit)=private.recipe_unit(q.unit) then '{}'::jsonb
 else jsonb_build_object('content_quantity',conversion.factor,'content_unit',private.recipe_unit(q.unit)) end,
 case when q.cost_price is not null then greatest(r.unit_price_ex_tax/conversion.factor,q.cost_price/private.recipe_factor(q.unit)) end,
 'purchase',(q.source_ref-'url'-'review_note')||jsonb_build_object('supplier_id',r.supplier_id,'supplier_name',r.supplier_name,'specification',coalesce(nullif(btrim(r.specification),''),q.source_ref->>'specification')),q.id,0
 from receipts r join mappings q on r.product_id=coalesce(nullif(q.source_ref->>'product_id','')::uuid,q.product_id)
 cross join lateral (select case
 when private.recipe_unit(r.unit)=private.recipe_unit(q.unit) then private.recipe_factor(r.unit)
 when private.recipe_unit(r.unit)=private.recipe_unit(q.purchase->>'unit')
 and private.recipe_unit(q.purchase->>'content_unit')=private.recipe_unit(q.unit)
 then nullif(q.purchase->>'content_quantity','')::numeric*private.recipe_factor(q.purchase->>'content_unit') end factor) conversion
 where conversion.factor>0
 -- A changed, explicitly recorded package must be confirmed before reusing its conversion.
 and (private.recipe_unit(r.unit)=private.recipe_unit(q.unit) or nullif(btrim(r.specification),'') is null or
 regexp_replace(lower(r.specification),'[[:space:]/／]','','g')=regexp_replace(lower(q.source_ref->>'specification'),'[[:space:]/／]','','g'))
 and case
 when nullif(q.source_ref->>'supplier_id','') is not null then r.supplier_id::text=q.source_ref->>'supplier_id'
 when nullif(q.source_ref->>'supplier_name','') is not null then lower(btrim(r.supplier_name))=lower(btrim(q.source_ref->>'supplier_name'))
 else true end
 )
 , changed_packages as (
 select q.key,private.recipe_unit(q.unit) unit,max(r.receipt_date) latest_date
 from receipts r join mappings q on r.product_id=coalesce(nullif(q.source_ref->>'product_id','')::uuid,q.product_id)
 where private.recipe_unit(r.unit)<>private.recipe_unit(q.unit) and nullif(btrim(r.specification),'') is not null
 and regexp_replace(lower(r.specification),'[[:space:]/／]','','g') is distinct from regexp_replace(lower(q.source_ref->>'specification'),'[[:space:]/／]','','g')
 and case when nullif(q.source_ref->>'supplier_id','') is not null then r.supplier_id::text=q.source_ref->>'supplier_id'
 when nullif(q.source_ref->>'supplier_name','') is not null then lower(btrim(r.supplier_name))=lower(btrim(q.source_ref->>'supplier_name')) else true end
 group by q.key,private.recipe_unit(q.unit)
 ), events as (
 -- Deduplicate the native and converted view of the same receipt before comparing events.
 select distinct on(key,unit,source_id) * from candidates
 where source_kind='purchase' and effective_date is not null
 and coalesce(nullif(source_ref->>'supplier_id',''),nullif(btrim(supplier_name),'')) is not null
 order by key,unit,source_id,reference_id nulls last
 ), movements as (
 select key,unit,source_id,
 lag(price) over comparison previous_price,
 lag(effective_date) over comparison previous_date,
 lag(purchase) over comparison previous_purchase
 from events
 window comparison as (partition by key,unit,
 coalesce(nullif(source_ref->>'supplier_id',''),lower(btrim(supplier_name))),
 coalesce(nullif(btrim(source_ref->>'specification'),''),''),
 coalesce(purchase->>'unit',unit),purchase->'content_quantity',purchase->>'content_unit'
 order by effective_date,recorded_at,source_id)
 ), selected as (
 select distinct on(key,unit) * from candidates
 order by key,unit,priority,effective_date desc nulls last,recorded_at desc,source_id desc,reference_id nulls last
 )
 select coalesce(jsonb_agg((to_jsonb(x)-'priority')||jsonb_build_object(
 'conversion_pending',coalesce(changed.latest_date>coalesce(x.effective_date,'-infinity'::date),false),
 'previous_price',m.previous_price,'previous_date',m.previous_date,'previous_purchase',m.previous_purchase)),'[]')
 from selected x left join movements m on x.source_kind='purchase' and m.key=x.key and m.unit=x.unit and m.source_id=x.source_id
 left join changed_packages changed on changed.key=x.key and changed.unit=x.unit
$function$
;
revoke all on function private.recipe_prices_before_master(uuid) from public,anon,authenticated;

create or replace function private.recipe_prices(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare original jsonb; result jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 original:=private.recipe_prices_before_master(s);
 with maps as materialized (
 select 'i:'||id key,unit,id ingredient_id from private.ingredient_masters where store_id=s
 union
 select 'n:'||lower(btrim(m.name)),m.unit,m.id from private.ingredient_masters m where m.store_id=s and not exists(select 1 from private.ingredient_aliases a where a.store_id=s and a.source_key='n:'||lower(btrim(m.name)) and a.source_unit=m.unit and a.ingredient_id<>m.id)
 union
 select source_key,source_unit,ingredient_id from private.ingredient_aliases where store_id=s
 ), unique_maps as (
 select key,unit,min(ingredient_id::text)::uuid ingredient_id from maps group by key,unit having count(distinct ingredient_id)=1
 ), resolved as (
 select distinct u.key,m.* from unique_maps u join private.ingredient_masters m on m.id=u.ingredient_id where m.cost_price is not null and m.review_status='confirmed'
 ), quotes as (
 select jsonb_build_object('key',m.key,'name',m.name,'product_id',case when m.key like 'p:%' then substring(m.key from 3) end,'unit',m.unit,'price',m.cost_price,'cost_price',m.cost_price,'source','基礎食材','source_kind','manual','effective_date',coalesce(r.effective_date,m.updated_at::date),'recorded_at',m.updated_at,'reference_id',m.selected_reference,'source_ref',coalesce(r.source_ref,'{}'::jsonb)||jsonb_build_object('ingredient_id',m.id),'purchase',case when not m.manual and r.purchase is not null then r.purchase else jsonb_build_object('amount',m.cost_price,'quantity',1,'unit',m.unit) end) value
 from resolved m left join private.recipe_price_entries r on r.id=m.selected_reference
 union all
 select x.value from jsonb_array_elements(original) x where not exists(select 1 from maps where key=x.value->>'key' and unit=x.value->>'unit')
 ) select coalesce(jsonb_agg(value),'[]') into result from quotes;
 return result;
end $$;
-- Existing grants on the private entrypoint are retained; new helpers stay private.

create or replace function public.app_workspace(p_store_id uuid,p_section text,p_filter jsonb default '{}')
returns jsonb language sql stable set search_path='' as $$
 select case when p_section='ingredients' then private.ingredient_catalog(p_store_id)
 when p_section='ingredient.sources' then private.ingredient_sources(p_store_id,(p_filter->>'id')::uuid)
 when p_section='recipes' then private.recipe_workspace_tools(p_store_id)
 when p_section='recipe.transfer' then private.recipe_transfer_plan(p_store_id,(p_filter->>'target_store_id')::uuid,(p_filter->>'id')::uuid)
 else private.app_workspace(p_store_id,p_section,p_filter) end
$$;
CREATE OR REPLACE FUNCTION private.recipe_workspace_tools(s uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; moved jsonb;
begin
 result:=private.recipe_workspace(s);
 select coalesce(jsonb_agg(distinct x.value),'[]') into moved from private.app_requests a cross join lateral jsonb_array_elements(a.result->'moved_ids') x where a.store_id=s and a.action='recipe.transfer' and exists(select 1 from private.recipe_cards r where r.id=(x.value#>>'{}')::uuid and r.store_id<>s);
 return result||jsonb_build_object('moved_recipe_ids',moved)||private.ingredient_catalog(s);
end $function$
;

create or replace function private.recipe_price_catalog_operation(s uuid,action text,data jsonb,request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; ref private.recipe_price_entries; master private.ingredient_masters;
begin
 if action='recipe.price' and nullif(data->>'ingredient_id','') is not null then
  select * into master from private.ingredient_masters where id=(data->>'ingredient_id')::uuid and store_id=s;
  if master.id is null then raise exception 'INVALID_INGREDIENT_TARGET' using errcode='22023';end if;
  return private.ingredient_operation(s,'ingredient.save',jsonb_build_object('id',master.id,'revision',data->'ingredient_revision','name',master.name,'unit',data->>'unit','cost_price',coalesce(nullif(data->>'cost_price',''),data->>'price')),request);
 end if;
 result:=private.recipe_safe_operation(s,action,data,request);
 if action='recipe.price' then
  select * into ref from private.recipe_price_entries where id=(result->>'id')::uuid and store_id=s;
  if ref.id is not null then
   perform private.seed_ingredient_masters(s);
   update private.ingredient_masters m set cost_price=coalesce(ref.cost_price,ref.price)/private.recipe_factor(ref.unit),selected_reference=ref.id,review_status='confirmed',manual=true,revision=revision+1,updated_at=now(),updated_by=auth.uid()
   from private.ingredient_aliases a where a.ingredient_id=m.id and a.store_id=s and ref.id=any(a.reference_ids) and m.selected_reference is distinct from ref.id;
  end if;
 end if;
 return result;
end $$;
revoke all on function private.recipe_price_catalog_operation(uuid,text,jsonb,uuid) from public,anon;
grant execute on function private.recipe_price_catalog_operation(uuid,text,jsonb,uuid) to authenticated;

create or replace function public.app_operation(p_store_id uuid,p_action text,p_data jsonb,p_request_id uuid)
returns jsonb language sql set search_path='' as $$
 select case when p_action in ('ingredient.save','ingredient.alias') then private.ingredient_operation(p_store_id,p_action,p_data,p_request_id)
 when p_action='recipe.transfer' then private.recipe_transfer(p_store_id,p_data,p_request_id)
 when p_action like 'recipe.%' then private.recipe_price_catalog_operation(p_store_id,p_action,p_data,p_request_id)
 else private.app_operation(p_store_id,p_action,p_data,p_request_id) end
$$;

-- Seed only stores covered by the user's three-workbook import.
do $$ declare s uuid;begin
 for s in select distinct store_id from private.recipe_price_entries where source_ref->>'import_batch'='three-workbook-price-baseline-20261004-v1' loop
  perform private.seed_ingredient_masters(s);
 end loop;
end $$;
notify pgrst,'reload schema';

CREATE OR REPLACE FUNCTION private.recipe_cost_indexed(s uuid, doc jsonb, visited uuid[], price_index jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare line jsonb; price jsonb; direct jsonb; child jsonb; result jsonb; lines jsonb:='[]'; total numeric:=0; amount numeric; qty numeric; child_id uuid; missing integer:=0; reason text; basis jsonb; each_price numeric; item_key text; piece boolean; prices jsonb; all_prices jsonb; explicit_package boolean;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;

 if cardinality(visited)>20 then raise exception 'INVALID_RECIPE_CYCLE' using errcode='22023';end if;
 for line in select value from jsonb_array_elements(coalesce(doc->'lines','[]')) loop
  amount:=null;reason:=null;price:=null;direct:=null;qty:=nullif(line->>'quantity','')::numeric;
  if qty is null or qty<=0 or nullif(btrim(line->>'unit'),'') is null then reason:='待填用量';
  elsif nullif(line->>'recipe_id','') is not null then
   child_id:=(line->>'recipe_id')::uuid;
   if child_id=any(visited) then raise exception 'INVALID_RECIPE_CYCLE' using errcode='22023';end if;
   select document into child from private.recipe_cards where id=child_id and store_id=s;
   if child is null then raise exception 'INVALID_RECIPE_REFERENCE' using errcode='22023';end if;
   result:=private.recipe_cost_indexed(s,child,array_append(visited,child_id),price_index);
   if result->>'total' is null then reason:='備料成本未完整';
   elsif nullif(child->>'yield','')::numeric is null or (child->>'yield')::numeric<=0 then reason:='待填製成量';
   elsif private.recipe_unit(child->>'unit')<>private.recipe_unit(line->>'unit') then reason:='待確認單位換算';
   else amount:=(result->>'total')::numeric*qty*private.recipe_factor(line->>'unit')/((child->>'yield')::numeric*private.recipe_factor(child->>'unit'));end if;
  else
   item_key:=case when nullif(line->>'ingredient_id','') is not null then 'i:'||(line->>'ingredient_id') when nullif(line->>'product_id','') is not null then 'p:'||(line->>'product_id') else 'n:'||lower(btrim(line->>'name')) end;
   prices:=private.recipe_effective_prices(line,coalesce(price_index->item_key,'[]'::jsonb));
   select value into direct from jsonb_array_elements(prices) where value->>'key'=item_key and value->>'unit'=private.recipe_unit(line->>'unit') limit 1;
   explicit_package:=coalesce(direct->'purchase'->>'conversion_basis'='package' and (direct->'purchase'->>'content_quantity')::numeric>0 and private.recipe_unit(direct->'purchase'->>'content_unit')=private.recipe_unit(line->>'unit'),false);
   basis:=private.recipe_note_basis(line,coalesce(doc->>'notes',''));piece:=false;
   if not explicit_package and basis is not null and private.recipe_unit(basis->>'unit')=private.recipe_unit(line->>'unit') and basis->>'countUnit'<>private.recipe_unit(line->>'unit') then
    select value into price from jsonb_array_elements(prices) where value->>'key'=item_key and value->>'unit'=basis->>'countUnit' limit 1;
    if price is null then select value into price from jsonb_array_elements(prices) where value->>'key'=item_key and value->>'unit'=private.recipe_unit(line->>'unit') and private.recipe_unit(value->'purchase'->>'unit')=basis->>'countUnit' limit 1;end if;
    piece:=price is not null;
   end if;
   if piece then
    if price->>'unit'=basis->>'countUnit' then each_price:=coalesce((price->>'cost_price')::numeric,(price->>'price')::numeric);
    else each_price:=coalesce((price->'purchase'->>'cost_unit_price')::numeric,case when (price->'purchase'->>'quantity')::numeric>0 then (price->'purchase'->>'amount')::numeric/(price->'purchase'->>'quantity')::numeric else (price->>'price')::numeric end);end if;
    if each_price>=0 then amount:=each_price*qty*private.recipe_factor(line->>'unit')*(basis->>'count')::numeric/((basis->>'quantity')::numeric*private.recipe_factor(basis->>'unit'));else reason:='待補價格或換算';end if;
   else
    price:=direct;
    if price is null then reason:='待補價格或換算';
    elsif private.recipe_unit(price->'purchase'->>'unit') in ('顆','片') and private.recipe_unit(line->>'unit')<>private.recipe_unit(price->'purchase'->>'unit') and not explicit_package then reason:='待確認單位換算';
    else amount:=coalesce((price->>'cost_price')::numeric,(price->>'price')::numeric)*qty*private.recipe_factor(line->>'unit');end if;
   end if;
  end if;
  if amount is null then missing:=missing+1;else total:=total+amount;end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('id',line->>'id','amount',amount,'reason',reason,'price',price));
 end loop;
 if jsonb_array_length(lines)=0 then missing:=missing+1;end if;
 return jsonb_build_object('total',case when missing=0 then total end,'subtotal',total,'missing',missing,'lines',lines);
end $function$
;

create or replace function private.recipe_effective_prices(line jsonb, current_prices jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare prices jsonb; item_key text; original jsonb; normalized jsonb;
begin
 item_key:=case when nullif(line->>'ingredient_id','') is not null then 'i:'||(line->>'ingredient_id') when nullif(line->>'product_id','') is not null then 'p:'||(line->>'product_id') else 'n:'||lower(btrim(line->>'name')) end;
 select coalesce(jsonb_agg(value),'[]') into prices from jsonb_array_elements(current_prices) where value->>'key'=item_key;
 if jsonb_typeof(line->'transfer_prices')='array' and nullif(line->>'transfer_price_at','') is not null then
  select coalesce(jsonb_agg(value),'[]') into prices from jsonb_array_elements(prices) where nullif(value->>'recorded_at','')::timestamptz>(line->>'transfer_price_at')::timestamptz;
  select prices||coalesce(jsonb_agg(old.value),'[]') into prices from jsonb_array_elements(line->'transfer_prices') old where old.value->>'key'=item_key and not exists(select 1 from jsonb_array_elements(prices) newer where newer.value->>'unit'=old.value->>'unit');
 end if;
 if not exists(select 1 from jsonb_array_elements(prices) where value->>'unit'=private.recipe_unit(line->>'unit')) then
  select value into original from jsonb_array_elements(prices) where private.recipe_unit(value->'purchase'->>'unit')=private.recipe_unit(line->>'unit') order by coalesce(value->>'recorded_at',value->>'effective_date','') desc limit 1;
  if original is not null then
   normalized:=private.recipe_purchase_value(original->'purchase',line->>'unit');
   prices:=jsonb_build_array(original||jsonb_build_object('unit',normalized->>'unit','price',normalized->'price','cost_price',normalized->'cost_price'))||prices;
  end if;
 end if;
 return prices;
end $$;
revoke all on function private.recipe_effective_prices(jsonb,jsonb) from public;


-- Index only keys used by saved recipes; the full catalog remains available to the picker.
CREATE OR REPLACE FUNCTION private.recipe_workspace(s uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_prices jsonb; price_index jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 current_prices:=private.recipe_prices(s);
 select private.recipe_price_index(coalesce(jsonb_agg(p.value),'[]')) into price_index
 from jsonb_array_elements(current_prices) p
 where p.value->>'key' in (
 select case when nullif(l.value->>'ingredient_id','') is not null then 'i:'||(l.value->>'ingredient_id') when nullif(l.value->>'product_id','') is not null then 'p:'||(l.value->>'product_id') else 'n:'||lower(btrim(l.value->>'name')) end
 from private.recipe_cards c cross join lateral jsonb_array_elements(coalesce(c.document->'lines','[]')) l where c.store_id=s
 );
 return jsonb_build_object('can_price',private.recipe_allowed(s,true),
 'recipes',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('cost',private.recipe_cost_indexed(s,r.document,array[r.id],price_index)) order by updated_at desc),'[]') from private.recipe_cards r where store_id=s),
 'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit,'specification',p.specification) order by p.name),'[]') from public.products p join public.stores st on st.organization_id=p.organization_id where st.id=s and p.is_active),
 'prices',current_prices,
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.name) order by sp.name),'[]') from public.suppliers sp join public.stores st on st.organization_id=sp.organization_id where st.id=s and sp.is_active),
 'price_references',(select coalesce(jsonb_agg(jsonb_build_object(
 'key',case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,
 'name',r.name,'product_id',r.product_id,'unit',private.recipe_unit(r.unit),'price',r.price/private.recipe_factor(r.unit),
 'cost_price',r.cost_price/private.recipe_factor(r.unit),'purchase',r.purchase,'source',r.source,'source_kind',r.source_kind,
 'source_ref',r.source_ref,'supplier_name',r.source_ref->>'supplier_name','reference_id',r.id,'effective_date',r.effective_date,
 'review_status',r.review_status,'created_at',r.created_at) order by r.effective_date desc nulls last,r.created_at desc),'[]')
 from private.recipe_price_entries r where r.store_id=s and (r.review_status='confirmed' or not exists(
 select 1 from private.recipe_price_entries c where c.store_id=s and c.review_status='confirmed' and c.source_ref->>'import_key'=r.source_ref->>'import_key'))),
 'price_candidates',(select coalesce(jsonb_agg(jsonb_build_object(
 'key',case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,
 'name',r.name,'product_id',r.product_id,'unit',private.recipe_unit(r.unit),'price',r.price/private.recipe_factor(r.unit),
 'purchase',r.purchase,'source',r.source,'source_kind',r.source_kind,'source_ref',r.source_ref,'reference_id',r.id,'effective_date',r.effective_date
 ) order by r.source_kind,r.effective_date desc nulls last),'[]') from private.recipe_price_entries r
 where r.store_id=s and r.review_status='pending' and not exists (
 select 1 from private.recipe_price_entries c where c.store_id=s and c.review_status='confirmed'
 and c.source_ref->>'import_key'=r.source_ref->>'import_key')));
end $function$
;

analyze private.ingredient_masters;
analyze private.ingredient_aliases;
