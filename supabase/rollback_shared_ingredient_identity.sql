-- Restore behavior only; all source data and code links remain untouched.
begin;
CREATE OR REPLACE FUNCTION private.ingredient_usage_rows(s uuid, rows jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(r.value||jsonb_build_object('name',coalesce(n.formal_name,r.value->>'name'),
 'count_name',coalesce(n.count_name,''),'recipe_aliases',coalesce(n.recipe_aliases,'[]'::jsonb)) order by r.ord),'[]'::jsonb)
 from jsonb_array_elements(rows) with ordinality r(value,ord)
 left join private.ingredient_masters m on m.id=(r.value->>'id')::uuid and m.store_id=s
 left join private.ingredient_usage_names n on n.ingredient_id=coalesce(m.canonical_ingredient_id,m.id) and n.store_id=s
$function$;

CREATE OR REPLACE FUNCTION public.get_baihuayuan_ingredient_matching(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; org uuid; bindings jsonb;
begin
 result:=private.ingredient_matching_before_usage_names(p_store_id);
 select organization_id into org from public.stores where id=p_store_id;
 select coalesce(jsonb_agg(b.value||jsonb_build_object('supplier',private.supplier_display_name(org,b.value->>'supplier'),
 'stopped',exists(select 1 from private.ingredient_supply_state st where st.store_id=p_store_id and st.ingredient_id=(b.value->>'ingredient_id')::uuid and st.stopped
 and st.supplier_key in ('id:'||private.supplier_identity(org,b.value->>'supplier')::text,'name:'||private.ingredient_match_text(b.value->>'supplier'))))),'[]'::jsonb) into bindings
 from jsonb_array_elements(result->'bindings') b;
 return result||jsonb_build_object('ingredients',private.ingredient_usage_rows(p_store_id,result->'ingredients'),'bindings',bindings);
end $function$;

CREATE OR REPLACE FUNCTION private.receipt_entry_ingredient(s uuid, org uuid, product uuid, line jsonb, vendor text, vendor_id uuid, package_spec text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  unit_key text:=private.recipe_unit(line->>'unit');
  catalog_name text:=private.ingredient_name(line->>'product_name',line->>'unit')
    ||case when package_spec<>'' then ' · '||package_spec else '' end;
  receipt_name text:=private.ingredient_match_text(coalesce(nullif(line->>'supplier_item_name',''),line->>'product_name'));
  vendor_name text:=private.ingredient_match_text(private.supplier_display_name(org,vendor));
  vendor_key text:=coalesce('id:'||vendor_id::text,'name:'||vendor_name);
  explicit_id uuid:=nullif(line->>'ingredient_id','')::uuid;
  product_ingredient uuid;
  ingredient uuid;
  matches uuid[];
  scoped_matches uuid[];
  related_name text:=regexp_replace(receipt_name,'\s*\([^)]+\)$','');
begin
  if line->'ingredient_match_pending'='true'::jsonb then return null; end if;

  select coalesce(m.canonical_ingredient_id,m.id) into product_ingredient
  from private.ingredient_aliases a
  join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=s
  where a.store_id=s and a.source_key='p:'||product and a.source_unit=unit_key
    and a.specification=package_spec;
  if explicit_id is not null then
    select coalesce(m.canonical_ingredient_id,m.id) into ingredient
    from private.ingredient_masters m where m.id=explicit_id and m.store_id=s;
    if ingredient is null or (product_ingredient is not null and product_ingredient<>ingredient) then
      return null;
    end if;
  else
    select array_agg(distinct coalesce(m.canonical_ingredient_id,m.id)) into matches
    from private.receipt_ingredient_bindings b
    join private.ingredient_masters m on m.id=b.ingredient_id and m.store_id=s
    where b.store_id=s and b.name=receipt_name
      and b.unit=private.ingredient_match_text(coalesce(line->>'supplier_item_unit',line->>'unit'))
      and b.specification=private.ingredient_match_text(coalesce(line->>'supplier_item_specification',line->>'specification'))
      and (b.supplier=vendor_name or vendor_id=private.supplier_identity(org,b.supplier));

    if vendor_id is not null then
      scoped_matches:=private.scoped_receipt_ingredient_matches(s,org,vendor_id,receipt_name,
        coalesce(line->>'supplier_item_unit',line->>'unit'),
        coalesce(line->>'supplier_item_specification',line->>'specification'));
      if cardinality(scoped_matches)>1 or cardinality(matches)>1
        or (cardinality(matches)=1 and scoped_matches[1]<>matches[1]) then return null; end if;
      matches:=coalesce(scoped_matches,matches);
    end if;
    if cardinality(matches)>1 or (product_ingredient is not null and matches[1]<>product_ingredient) then
      return null;
    end if;
    ingredient:=coalesce(product_ingredient,matches[1]);

    if ingredient is null then
      select array_agg(distinct coalesce(m.canonical_ingredient_id,m.id)) into matches
      from private.ingredient_masters m
      where m.store_id=s and m.unit=unit_key
        and private.ingredient_match_text(m.name)=private.ingredient_match_text(catalog_name)
        and (package_spec<>'' or not exists (
          select 1 from private.ingredient_aliases a
          where a.store_id=s and a.ingredient_id=m.id and a.specification<>''
        ));
      if cardinality(matches)>1 then return null; end if;
      ingredient:=matches[1];
    end if;
  end if;

  if ingredient is not null then
    if exists (
      select 1 from private.ingredient_supply_state st where st.store_id=s and st.ingredient_id=ingredient
        and st.supplier_key in ('*',vendor_key,'name:'||vendor_name) and st.stopped
    ) then return null; end if;
    return ingredient;
  end if;

  -- A close name only signals review. Confirming a separate package can create
  -- its own identity after exact matches and saved supplier names are checked.
  if line->'create_ingredient' is distinct from 'true'::jsonb and exists (
    select 1 from private.ingredient_masters m
    where m.store_id=s
      and regexp_replace(private.ingredient_match_text(split_part(m.name,' · ',1)),'\s*\([^)]+\)$','')=related_name
    union all
    select 1 from private.ingredient_aliases a
    where a.store_id=s and private.ingredient_match_text(a.name)=receipt_name and a.source_key not like 'supplier-item:%'
    union all
    select 1 from private.ingredient_usage_names n
    where n.store_id=s and receipt_name in (private.ingredient_match_text(n.formal_name),private.ingredient_match_text(n.count_name))
  ) then return null; end if;

  if length(catalog_name)>200 then return null; end if;
  insert into private.ingredient_masters(store_id,name,unit,category,updated_by)
  values(s,catalog_name,unit_key,case when line->>'category' in ('食材','耗材','調料','酒水') then line->>'category' end,auth.uid())
  on conflict do nothing returning id into ingredient;
  if ingredient is null then return null; end if;

  -- A product shared by both stores may already have an official code. Keep
  -- each store's price and count records scoped while following that code.
  select array_agg(distinct coalesce(link.target_id,m.canonical_ingredient_id,m.id)) into matches
  from public.stores peer
  join private.ingredient_aliases a on a.store_id=peer.id and a.source_key='p:'||product
    and a.source_unit=unit_key and a.specification=package_spec
  join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=peer.id
  left join private.ingredient_code_links link on link.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)
  where peer.id<>s and peer.organization_id=org and peer.is_active and peer.name in ('BeApe','Gras');
  if cardinality(matches)=1 then
    insert into private.ingredient_code_links(ingredient_id,target_id,actor_id)
    values(ingredient,matches[1],auth.uid());
  end if;
  return ingredient;
end $function$;

CREATE OR REPLACE FUNCTION public.baihuayuan_code_management(p_store_id uuid, p_action text DEFAULT 'read'::text, p_data jsonb DEFAULT '{}'::jsonb, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid; rows jsonb; a private.ingredient_masters; b private.ingredient_masters; prior private.app_requests; result jsonb; expected text;
begin
 if auth.uid() is null or not private.recipe_allowed(p_store_id) or not private.office_data_access(p_store_id) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into org from public.stores where id=p_store_id;
 if p_action in ('link','unlink') then
  if p_request_id is null then raise exception 'REQUEST_REQUIRED' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text||':code-management',0));
  select * into prior from private.app_requests where store_id=p_store_id and request_id=p_request_id;
  if found then
   if prior.actor_id<>auth.uid() or prior.action<>'code.'||p_action or prior.payload<>p_data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
   return prior.result;
  end if;
  select * into a from private.ingredient_masters where id=(p_data->>'id')::uuid for update;
  if a.id is null or not exists(select 1 from public.stores where id=a.store_id and organization_id=org) or not private.recipe_allowed(a.store_id,true) or private.store_access_mode(a.store_id)<>'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  if a.canonical_ingredient_id is not null then raise exception 'SELECT_CANONICAL_ROOT' using errcode='22023';end if;
  expected:=private.managed_ingredient_code(a.id);
  if p_data->>'expected_code' is distinct from expected then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  if exists(select 1 from private.ingredient_code_links where target_id=a.id) then raise exception 'CODE_HAS_LINKED_ITEMS' using errcode='22023';end if;
  if p_action='link' then
   select * into b from private.ingredient_masters where id=(p_data->>'target_id')::uuid for update;
   if b.id is null or a.id=b.id or not exists(select 1 from public.stores where id=b.store_id and organization_id=org) or not private.recipe_allowed(b.store_id,true) or private.store_access_mode(b.store_id)<>'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
   if b.canonical_ingredient_id is not null or exists(select 1 from private.ingredient_code_links where ingredient_id=b.id) then raise exception 'SELECT_CANONICAL_ROOT' using errcode='22023';end if;
   if private.recipe_unit(a.unit)<>private.recipe_unit(b.unit) then raise exception 'UNIT_MISMATCH' using errcode='22023';end if;
   if p_data->>'target_code' is distinct from private.managed_ingredient_code(b.id) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
   insert into private.ingredient_code_links(ingredient_id,target_id,actor_id) values(a.id,b.id,auth.uid()) on conflict(ingredient_id) do update set target_id=excluded.target_id,actor_id=excluded.actor_id,updated_at=now();
  else delete from private.ingredient_code_links where ingredient_id=a.id;end if;
  result:=jsonb_build_object('id',a.id,'code',private.managed_ingredient_code(a.id),'previous_code',expected);
  insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,auth.uid(),'code.'||p_action,p_data,result);
  return result;
 elsif p_action<>'read' then raise exception 'INVALID_ACTION' using errcode='22023';end if;
 with permitted as materialized(select s.id,s.name,private.recipe_allowed(s.id,true) and private.store_access_mode(s.id)='EDIT' editable from public.stores s where s.organization_id=org and private.recipe_allowed(s.id) and private.office_data_access(s.id)), items as (
 select m.id,m.store_id,s.name store_name,'ingredient' kind,coalesce((select n.formal_name from private.ingredient_usage_names n where n.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)),m.name) name,private.managed_ingredient_code(m.id) code,m.ingredient_code original_code,m.unit,m.category,
 concat_ws('、',coalesce((select string_agg(x.name,'、' order by x.name) from private.ingredient_aliases x where x.ingredient_id=m.id),''),
 (select concat_ws('、',n.count_name,(select string_agg(value,'、') from jsonb_array_elements_text(n.recipe_aliases))) from private.ingredient_usage_names n where n.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)),
 (select string_agg(ub.name,'、') from private.receipt_ingredient_bindings ub where ub.store_id=m.store_id and ub.ingredient_id=m.id)) aliases,
 m.purchase specification,m.canonical_ingredient_id,l.target_id,s.editable,
 exists(select 1 from private.ingredient_supply_state st where st.ingredient_id in(m.id,m.canonical_ingredient_id) and st.supplier_key='*' and st.stopped) inactive
 from private.ingredient_masters m join permitted s on s.id=m.store_id left join private.ingredient_code_links l on l.ingredient_id=m.id
 where m.manual or exists(select 1 from private.ingredient_aliases x where x.ingredient_id=m.id)
 union all
 select r.id,r.store_id,s.name,case when r.document->>'kind'='prep' then 'prep' else 'dish' end,r.document->>'name',r.recipe_code,r.recipe_code,r.document->>'unit',r.document->>'category','',null::jsonb,null::uuid,null::uuid,s.editable,r.document->>'lifecycle'='archived'
 from private.recipe_cards r join permitted s on s.id=r.store_id
 ) select coalesce(jsonb_agg(to_jsonb(i) order by kind,name,store_name,id),'[]'::jsonb) into rows from items i;
 return jsonb_build_object('rows',rows);
end $function$;
drop function public.baihuayuan_shared_ingredient_name(uuid,uuid,text,integer,uuid);
drop function private.shared_receipt_bindings(uuid);
drop function private.shared_ingredient_name(uuid);
drop function private.shared_ingredient_id(uuid);
notify pgrst,'reload schema';
commit;
