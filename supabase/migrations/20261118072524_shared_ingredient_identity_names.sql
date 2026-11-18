-- Add shared display identity only. Original rows, codes and prices remain intact.
create or replace function private.shared_ingredient_id(i uuid) returns uuid
language sql stable set search_path='' as $$
 select coalesce(case when a.name in ('BeApe','Gras') and b.name in ('BeApe','Gras') and a.organization_id=b.organization_id then l.target_id end,m.canonical_ingredient_id,m.id)
 from private.ingredient_masters m
 left join private.ingredient_code_links l on l.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)
 left join public.stores a on a.id=m.store_id
 left join private.ingredient_masters target on target.id=l.target_id
 left join public.stores b on b.id=target.store_id
 where m.id=i
$$;
revoke all on function private.shared_ingredient_id(uuid) from public,anon,authenticated;

create or replace function private.shared_ingredient_name(i uuid) returns text
language sql stable set search_path='' as $$
 select coalesce(n.formal_name,m.name)
 from private.ingredient_masters m
 left join private.ingredient_usage_names n on n.ingredient_id=m.id
 where m.id=private.shared_ingredient_id(i)
$$;
revoke all on function private.shared_ingredient_name(uuid) from public,anon,authenticated;

create or replace function private.ingredient_usage_rows(s uuid, rows jsonb) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(r.value||jsonb_build_object(
 'name',coalesce(private.shared_ingredient_name(m.id),n.formal_name,r.value->>'name'),
 'original_name',r.value->>'name','shared_ingredient_id',private.shared_ingredient_id(m.id),
 'shared_name',case when exists(select 1 from private.ingredient_code_links l where l.target_id=private.shared_ingredient_id(m.id)) then private.shared_ingredient_name(m.id) end,
 'count_name',coalesce(n.count_name,''),'recipe_aliases',coalesce(n.recipe_aliases,'[]'::jsonb)) order by r.ord),'[]'::jsonb)
 from jsonb_array_elements(rows) with ordinality r(value,ord)
 left join private.ingredient_masters m on m.id=(r.value->>'id')::uuid and m.store_id=s
 left join private.ingredient_usage_names n on n.ingredient_id=coalesce(m.canonical_ingredient_id,m.id) and n.store_id=s
$$;

-- Only explicitly linked identities share approved supplier aliases. Resolve back
-- to exactly one LOCAL identity: a peer's prices/stock IDs never enter this store.
create function private.shared_receipt_bindings(s uuid)
returns table(store_id uuid,supplier text,name text,unit text,specification text,ingredient_id uuid,stopped boolean)
language sql stable set search_path='' as $$
 with locals as materialized (
  select private.shared_ingredient_id(m.id) shared_id, min(m.id::text)::uuid local_id
  from private.ingredient_masters m where m.store_id=s and m.canonical_ingredient_id is null
  group by private.shared_ingredient_id(m.id) having count(*)=1
 ), candidates as (
 select s store_id,b.supplier,b.name,b.unit,b.specification,l.local_id ingredient_id,
 exists(select 1 from private.ingredient_supply_state st
   where st.store_id=s and st.ingredient_id=l.local_id
   and st.stopped and st.supplier_key in ('*','id:'||private.supplier_identity(ss.organization_id,b.supplier)::text,'name:'||private.ingredient_match_text(b.supplier))) stopped
 from private.receipt_ingredient_bindings b
 join private.ingredient_masters peer on peer.id=b.ingredient_id and peer.store_id=b.store_id
 join public.stores ps on ps.id=b.store_id
 join public.stores ss on ss.id=s and ss.organization_id=ps.organization_id
 join locals l on l.shared_id=private.shared_ingredient_id(peer.id)
 where b.store_id<>s and ps.name in ('BeApe','Gras') and ss.name in ('BeApe','Gras')
 and private.recipe_allowed(ps.id) and private.office_data_access(ps.id)
 and not exists(select 1 from private.ingredient_supply_state st where st.store_id=b.store_id
   and st.ingredient_id in(b.ingredient_id,peer.canonical_ingredient_id) and st.stopped
   and st.supplier_key in ('*','id:'||private.supplier_identity(ss.organization_id,b.supplier)::text,'name:'||private.ingredient_match_text(b.supplier)))
 and not exists(select 1 from private.receipt_ingredient_bindings own
   where own.store_id=s and own.name=b.name and own.unit=b.unit and own.specification=b.specification
   and (own.supplier=b.supplier or private.supplier_identity(ss.organization_id,own.supplier)=private.supplier_identity(ss.organization_id,b.supplier)))
 ) select distinct * from candidates
$$;
revoke all on function private.shared_receipt_bindings(uuid) from public,anon,authenticated;

-- Keep all existing role checks and local binding precedence.
do $patch$
declare src text;anchor text;
begin
 src:=pg_get_functiondef('public.get_baihuayuan_ingredient_matching(uuid)'::regprocedure);
 anchor:='return result||jsonb_build_object(''ingredients'',private.ingredient_usage_rows(p_store_id,result->''ingredients''),''bindings'',bindings);';
 if strpos(src,anchor)=0 then raise exception 'SHARED_MATCH_READER_ANCHOR';end if;
 execute replace(src,anchor,$new$
 bindings:=bindings||coalesce((select jsonb_agg(jsonb_build_object(
  'supplier',private.supplier_display_name(org,b.supplier),'name',b.name,'unit',b.unit,
  'specification',b.specification,'ingredient_id',b.ingredient_id,'revision',0,'shared',true,'stopped',b.stopped))
 from private.shared_receipt_bindings(p_store_id) b),'[]'::jsonb);
 return result||jsonb_build_object('ingredients',private.ingredient_usage_rows(p_store_id,result->'ingredients'),'bindings',bindings);$new$);

 src:=pg_get_functiondef('private.receipt_entry_ingredient(uuid,uuid,uuid,jsonb,text,uuid,text)'::regprocedure);
 anchor:='from private.receipt_ingredient_bindings b';
 if strpos(src,anchor)=0 then raise exception 'SHARED_RECEIPT_RESOLVER_ANCHOR';end if;
 if strpos(src,'if line->''ingredient_match_pending''=''true''::jsonb then return null; end if;')=0 then raise exception 'SHARED_RECEIPT_STOP_GUARD_ANCHOR';end if;
 src:=replace(src,'if line->''ingredient_match_pending''=''true''::jsonb then return null; end if;', $guard$if line->'ingredient_match_pending'='true'::jsonb then return null; end if;
  if exists(select 1 from private.shared_receipt_bindings(s) b where b.stopped and b.name=receipt_name
    and b.unit=private.ingredient_match_text(coalesce(line->>'supplier_item_unit',line->>'unit'))
    and b.specification=private.ingredient_match_text(coalesce(line->>'supplier_item_specification',line->>'specification'))
    and (b.supplier=vendor_name or vendor_id=private.supplier_identity(org,b.supplier))) then return null; end if;$guard$);
 execute replace(src,anchor,$new$from (
 select store_id,supplier,name,unit,specification,ingredient_id from private.receipt_ingredient_bindings where store_id=s
 union all select store_id,supplier,name,unit,specification,ingredient_id from private.shared_receipt_bindings(s) where not stopped
 ) b$new$);

 src:=pg_get_functiondef('public.baihuayuan_code_management(uuid,text,jsonb,uuid)'::regprocedure);
 anchor:='coalesce((select n.formal_name from private.ingredient_usage_names n where n.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)),m.name) name';
 if strpos(src,anchor)=0 then raise exception 'SHARED_CODE_READER_ANCHOR';end if;
 src:=replace(src,anchor,'private.shared_ingredient_name(m.id) name');
 anchor:='coalesce((select string_agg(x.name,''、'' order by x.name) from private.ingredient_aliases x where x.ingredient_id=m.id),'''')';
 if strpos(src,anchor)=0 then raise exception 'SHARED_CODE_ALIAS_ANCHOR';end if;
 execute replace(src,anchor,$new$concat_ws('、',case when m.name<>private.shared_ingredient_name(m.id) then m.name end,
 (select string_agg(x.name,'、' order by x.name) from private.ingredient_aliases x where x.ingredient_id=m.id))$new$);
end $patch$;
-- Shared-name editor changes only the common formal name, never another
-- store's supplier controls, counting labels, recipe aliases or prices.
create function public.baihuayuan_shared_ingredient_name(p_store_id uuid,p_ingredient_id uuid,p_name text default null,p_revision integer default null,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.ingredient_masters;root private.ingredient_masters;n private.ingredient_usage_names;detail jsonb;result jsonb;
begin
 if auth.uid() is null or not private.recipe_allowed(p_store_id) or not private.office_data_access(p_store_id) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select * into m from private.ingredient_masters where id=p_ingredient_id and store_id=p_store_id;
 select * into root from private.ingredient_masters where id=private.shared_ingredient_id(m.id);
 if root.id is null or not exists(select 1 from public.stores a join public.stores b on b.organization_id=a.organization_id where a.id=p_store_id and b.id=root.store_id and a.name in ('BeApe','Gras') and b.name in ('BeApe','Gras')) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if not private.recipe_allowed(root.store_id) or not private.office_data_access(root.store_id) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select * into n from private.ingredient_usage_names where ingredient_id=root.id;
 if p_name is not null then
  if not private.recipe_allowed(p_store_id,true) or private.store_access_mode(p_store_id) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  result:=public.baihuayuan_ingredient_names(root.store_id,root.id,jsonb_build_object(
   'revision',p_revision,'formal_name',p_name,'count_name',coalesce(n.count_name,''),
   'recipe_aliases',coalesce(n.recipe_aliases,'[]'::jsonb),'bindings','[]'::jsonb),p_request_id);
  return jsonb_build_object('name',result->>'formal_name','code',result->>'code','revision',result->'revision');
 end if;
 return jsonb_build_object('name',private.shared_ingredient_name(m.id),'code',private.managed_ingredient_code(m.id),'revision',coalesce(n.revision,0));
end $$;
revoke all on function public.baihuayuan_shared_ingredient_name(uuid,uuid,text,integer,uuid) from public,anon;
grant execute on function public.baihuayuan_shared_ingredient_name(uuid,uuid,text,integer,uuid) to authenticated;

notify pgrst,'reload schema';
