-- Naming metadata never rewrites ingredient IDs, source evidence, quantities or prices.
create table private.ingredient_usage_names (
 ingredient_id uuid primary key, store_id uuid not null,
 formal_name text not null, count_name text not null default '', recipe_aliases jsonb not null default '[]',
 revision integer not null default 1, updated_by uuid not null, updated_at timestamptz not null default now(),
 foreign key(ingredient_id,store_id) references private.ingredient_masters(id,store_id),
 check(length(formal_name) between 1 and 160 and length(count_name)<=160 and jsonb_typeof(recipe_aliases)='array')
);
create index ingredient_usage_names_store on private.ingredient_usage_names(store_id);
alter table private.ingredient_usage_names enable row level security;
revoke all on private.ingredient_usage_names from public,anon,authenticated;

create function private.ingredient_usage_rows(s uuid, rows jsonb) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(r.value||jsonb_build_object('name',coalesce(n.formal_name,r.value->>'name'),
 'count_name',coalesce(n.count_name,''),'recipe_aliases',coalesce(n.recipe_aliases,'[]'::jsonb)) order by r.ord),'[]'::jsonb)
 from jsonb_array_elements(rows) with ordinality r(value,ord)
 left join private.ingredient_masters m on m.id=(r.value->>'id')::uuid and m.store_id=s
 left join private.ingredient_usage_names n on n.ingredient_id=coalesce(m.canonical_ingredient_id,m.id) and n.store_id=s
$$;
revoke all on function private.ingredient_usage_rows(uuid,jsonb) from public,anon,authenticated;

-- Retain existing authorization and pricing logic; enrich only returned display names.
alter function private.ingredient_catalog(uuid) rename to ingredient_catalog_before_usage_names;
create function private.ingredient_catalog(s uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.ingredient_catalog_before_usage_names(s);
 return result||jsonb_build_object('ingredients',private.ingredient_usage_rows(s,result->'ingredients'));
end $$;
revoke all on function private.ingredient_catalog(uuid) from public,anon,authenticated;

alter function private.recipe_picker_workspace(uuid) rename to recipe_picker_before_usage_names;
create function private.recipe_picker_workspace(s uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.recipe_picker_before_usage_names(s);
 return result||jsonb_build_object('ingredients',private.ingredient_usage_rows(s,result->'ingredients'));
end $$;
revoke all on function private.recipe_picker_workspace(uuid) from public,anon,authenticated;

alter function public.get_baihuayuan_ingredient_matching(uuid) rename to ingredient_matching_before_usage_names;
alter function public.ingredient_matching_before_usage_names(uuid) set schema private;
revoke all on function private.ingredient_matching_before_usage_names(uuid) from public,anon,authenticated;
create function public.get_baihuayuan_ingredient_matching(p_store_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; org uuid; bindings jsonb;
begin
 result:=private.ingredient_matching_before_usage_names(p_store_id);
 select organization_id into org from public.stores where id=p_store_id;
 select coalesce(jsonb_agg(b.value||jsonb_build_object('supplier',private.supplier_display_name(org,b.value->>'supplier'),
 'stopped',exists(select 1 from private.ingredient_supply_state st where st.store_id=p_store_id and st.ingredient_id=(b.value->>'ingredient_id')::uuid and st.stopped
 and st.supplier_key in ('id:'||private.supplier_identity(org,b.value->>'supplier')::text,'name:'||private.ingredient_match_text(b.value->>'supplier'))))),'[]'::jsonb) into bindings
 from jsonb_array_elements(result->'bindings') b;
 return result||jsonb_build_object('ingredients',private.ingredient_usage_rows(p_store_id,result->'ingredients'),'bindings',bindings);
end $$;
revoke all on function public.get_baihuayuan_ingredient_matching(uuid) from public,anon;
grant execute on function public.get_baihuayuan_ingredient_matching(uuid) to authenticated;

-- Supplier aliases use the confirmed supplier directory, with an explicit opt-out.
do $patch$declare src text;anchor text;begin
 src:=pg_get_functiondef('private.save_receipt_ingredient_match(uuid,uuid,text,jsonb,jsonb,text)'::regprocedure);
 anchor:='supplier_key:=private.ingredient_match_text(supplier_name);';
 if strpos(src,anchor)=0 then raise exception 'supplier matching anchor missing';end if;
 src:=replace(src,anchor,'supplier_key:=private.ingredient_match_text(private.supplier_display_name((select organization_id from public.stores where id=s),supplier_name));');
 anchor:='if supplier_key<>'''' and prior.ingredient_id is distinct from new_id then';
 if strpos(src,anchor)=0 then raise exception 'remember matching anchor missing';end if;
 execute replace(src,anchor,'if coalesce((l->>''remember_ingredient_alias'')::boolean,true) and supplier_key<>'''' and prior.ingredient_id is distinct from new_id then');
end $patch$;

create function private.ingredient_usage_detail(s uuid,i uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',m.id,'code',private.managed_ingredient_code(m.id),
 'formal_name',coalesce(n.formal_name,regexp_replace(m.name,'\s*·\s*原表計價基準:.*$','')),'count_name',coalesce(n.count_name,''),
 'recipe_aliases',coalesce(n.recipe_aliases,'[]'::jsonb),'revision',coalesce(n.revision,0),
 'products',(select coalesce(jsonb_agg(distinct jsonb_build_object('id',p.id,'name',p.name,'code',p.product_code)),'[]'::jsonb)
 from private.ingredient_aliases a join private.ingredient_masters am on am.id=a.ingredient_id
 join public.products p on a.source_key='p:'||p.id::text where a.store_id=s and coalesce(am.canonical_ingredient_id,am.id)=m.id),
 'bindings',(select coalesce(jsonb_agg(jsonb_build_object('supplier',b.supplier,'supplier_id',private.supplier_identity(st.organization_id,b.supplier),
 'name',b.name,'unit',b.unit,'specification',b.specification,'ingredient_id',b.ingredient_id,'revision',b.revision,
 'stopped',coalesce(ss.stopped,false),'supply_revision',coalesce(ss.revision,0)) order by b.supplier,b.name),'[]'::jsonb)
 from private.receipt_ingredient_bindings b join private.ingredient_masters bm on bm.id=b.ingredient_id
 left join lateral (select t.stopped,t.revision from private.ingredient_supply_state t where t.store_id=s and t.ingredient_id=b.ingredient_id
 and t.supplier_key in ('id:'||private.supplier_identity(st.organization_id,b.supplier)::text,'name:'||private.ingredient_match_text(b.supplier)) order by t.stopped desc,t.updated_at desc limit 1) ss on true
 where b.store_id=s and coalesce(bm.canonical_ingredient_id,bm.id)=m.id),
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.name,'stopped',coalesce(ss.stopped,false),'supply_revision',coalesce(ss.revision,0)) order by sp.name),'[]'::jsonb) from public.suppliers sp left join lateral (select t.stopped,t.revision from private.ingredient_supply_state t where t.store_id=s and t.ingredient_id=m.id and t.supplier_key in ('id:'||sp.id::text,'name:'||private.ingredient_match_text(sp.name)) order by t.stopped desc,t.updated_at desc limit 1) ss on true where sp.organization_id=st.organization_id and sp.is_active))
 from private.ingredient_masters m join public.stores st on st.id=m.store_id
 left join private.ingredient_usage_names n on n.ingredient_id=m.id
 where m.store_id=s and m.id=i
$$;
revoke all on function private.ingredient_usage_detail(uuid,uuid) from public,anon,authenticated;

create function public.baihuayuan_ingredient_names(p_store_id uuid,p_ingredient_id uuid,p_data jsonb default null,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.ingredient_masters;n private.ingredient_usage_names;prior private.app_requests;b jsonb;binding private.receipt_ingredient_bindings;state private.ingredient_supply_state;
 result jsonb;org uuid;sid uuid;bid uuid;nm text;un text;spec text;sp text;k text;stop boolean;seen text[]:='{}';state_keys text[]:='{}';old_state jsonb;
begin
 if auth.uid() is null or not private.recipe_allowed(p_store_id) or not private.office_data_access(p_store_id) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select * into m from private.ingredient_masters where id=p_ingredient_id and store_id=p_store_id;
 if m.id is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if m.canonical_ingredient_id is not null then select * into m from private.ingredient_masters where id=m.canonical_ingredient_id and store_id=p_store_id;end if;
 if p_data is null then return private.ingredient_usage_detail(p_store_id,m.id);end if;
 if not private.recipe_allowed(p_store_id,true) or private.store_access_mode(p_store_id) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_request_id is null then raise exception 'REQUEST_REQUIRED' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('ingredient-match:'||p_store_id::text,0));
 select * into prior from private.app_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
  if prior.actor_id<>auth.uid() or prior.action<>'ingredient.names' or prior.payload is distinct from (p_data||jsonb_build_object('ingredient_id',m.id)) then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into n from private.ingredient_usage_names where ingredient_id=m.id for update;
 if coalesce(n.revision,0) is distinct from (p_data->>'revision')::int then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 if nullif(btrim(p_data->>'formal_name'),'') is null or length(p_data->>'formal_name')>160 or length(coalesce(p_data->>'count_name',''))>160
 or jsonb_typeof(p_data->'recipe_aliases') is distinct from 'array' or jsonb_array_length(p_data->'recipe_aliases')>60
 or exists(select 1 from jsonb_array_elements(p_data->'recipe_aliases') a where jsonb_typeof(a)<>'string' or length(btrim(a#>>'{}')) not between 1 and 160)
 or jsonb_typeof(p_data->'bindings') is distinct from 'array' or jsonb_array_length(p_data->'bindings')>200 then raise exception 'INVALID_NAMES' using errcode='22023';end if;
 select organization_id into org from public.stores where id=p_store_id;
 for b in select value from jsonb_array_elements(p_data->'bindings') loop
  nm:=private.ingredient_match_text(b->>'name');un:=private.ingredient_match_text(b->>'unit');spec:=private.ingredient_match_text(b->>'specification');
  sid:=nullif(b->>'supplier_id','')::uuid;bid:=coalesce(nullif(b->>'ingredient_id','')::uuid,m.id);
  if not exists(select 1 from private.ingredient_masters where id=bid and store_id=p_store_id and coalesce(canonical_ingredient_id,id)=m.id) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  if coalesce((b->>'revision')::int,0)>0 then
   sp:=b->>'supplier';
   select * into binding from private.receipt_ingredient_bindings where store_id=p_store_id and supplier=sp and name=nm and unit=un and specification=spec for update;
   if binding.ingredient_id is distinct from bid or binding.revision is distinct from (b->>'revision')::int then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
   sid:=private.supplier_identity(org,sp);
  else
   select name into sp from public.suppliers where id=sid and organization_id=org and is_active;
   if sp is null then raise exception 'INVALID_SUPPLIER' using errcode='22023';end if;
   sp:=private.ingredient_match_text(sp);
   if exists(select 1 from private.receipt_ingredient_bindings rb where rb.store_id=p_store_id and private.supplier_identity(org,rb.supplier)=sid and rb.name=nm and rb.unit=un and rb.specification=spec and rb.ingredient_id<>bid) then raise exception 'ALIAS_ALREADY_ASSIGNED' using errcode='22023';end if;
   select * into binding from private.receipt_ingredient_bindings where store_id=p_store_id and supplier=sp and name=nm and unit=un and specification=spec for update;
   if binding.ingredient_id is not null and binding.ingredient_id<>bid then raise exception 'ALIAS_ALREADY_ASSIGNED' using errcode='22023';end if;
  end if;
  if length(nm) not between 1 and 160 or length(sp)>160 or length(un)>30 or length(spec)>500 then raise exception 'INVALID_NAMES' using errcode='22023';end if;
  k:=jsonb_build_array(sp,nm,un,spec)::text;
  if k=any(seen) then raise exception 'INVALID_NAMES' using errcode='22023';end if;seen:=array_append(seen,k);
  insert into private.receipt_ingredient_bindings(store_id,supplier,name,unit,specification,ingredient_id,updated_by)
  values(p_store_id,sp,nm,un,spec,bid,auth.uid()) on conflict(store_id,supplier,name,unit,specification) do nothing;
  k:=coalesce('id:'||sid::text,'name:'||private.ingredient_match_text(sp));stop:=coalesce((b->>'stopped')::boolean,false);
  if (bid::text||k)=any(state_keys) then continue;end if;state_keys:=array_append(state_keys,bid::text||k);
  select * into state from private.ingredient_supply_state where store_id=p_store_id and ingredient_id=bid and supplier_key in (k,'name:'||private.ingredient_match_text(sp)) order by stopped desc,updated_at desc limit 1 for update;
  if coalesce(state.revision,0) is distinct from coalesce((b->>'supply_revision')::int,0) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  if stop is distinct from coalesce(state.stopped,false) then
   old_state:=to_jsonb(state);
   -- Reuse the existing supplier state key when present, retaining the audit trail.
   k:=coalesce(state.supplier_key,k);
   insert into private.ingredient_supply_state(store_id,ingredient_id,supplier_key,supplier_name,stopped,reason,disposition,note,updated_by)
   values(p_store_id,bid,k,private.supplier_display_name(org,sp),stop,'供應商更換','暫停使用','於編碼與別名管理調整',auth.uid())
   on conflict(store_id,ingredient_id,supplier_key) do update set stopped=excluded.stopped,revision=ingredient_supply_state.revision+1,updated_at=now(),updated_by=auth.uid();
   insert into private.ingredient_supply_events(store_id,ingredient_id,supplier_key,supplier_name,action,reason,disposition,note,snapshot,actor_id)
   values(p_store_id,bid,k,private.supplier_display_name(org,sp),case when stop then 'stop' else 'restore' end,'供應商更換','暫停使用','於編碼與別名管理調整',jsonb_build_object('previous_state',old_state),auth.uid());
  end if;
 end loop;
 insert into private.ingredient_usage_names(ingredient_id,store_id,formal_name,count_name,recipe_aliases,updated_by)
 values(m.id,p_store_id,btrim(p_data->>'formal_name'),btrim(coalesce(p_data->>'count_name','')),(select coalesce(jsonb_agg(x),'[]') from (select distinct btrim(value) x from jsonb_array_elements_text(p_data->'recipe_aliases')) a),auth.uid())
 on conflict(ingredient_id) do update set formal_name=excluded.formal_name,count_name=excluded.count_name,recipe_aliases=excluded.recipe_aliases,revision=ingredient_usage_names.revision+1,updated_by=auth.uid(),updated_at=now();
 result:=private.ingredient_usage_detail(p_store_id,m.id);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,auth.uid(),'ingredient.names',p_data||jsonb_build_object('ingredient_id',m.id),result);
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
 values(org,p_store_id,'ingredient_names',m.id::text,'ingredient.names',to_jsonb(n),p_data,auth.uid());
 return result;
end $$;
revoke all on function public.baihuayuan_ingredient_names(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.baihuayuan_ingredient_names(uuid,uuid,jsonb,uuid) to authenticated;

-- Field reader returns names and effective codes only. No costs, recipe data or vendor contacts.
create function public.get_count_ingredient_names(p_store_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or coalesce(private.store_access_mode(p_store_id),'NONE') not in ('VIEW','EDIT') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 with links as materialized (
 select distinct p.id product_id,coalesce(m.canonical_ingredient_id,m.id) ingredient_id,private.managed_ingredient_code(m.id) code
 from public.count_zones z join public.zone_products zp on zp.zone_id=z.id join public.products p on p.id=zp.product_id
 join private.ingredient_aliases a on a.store_id=z.store_id and a.source_key='p:'||p.id::text
 join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=z.store_id
 where z.store_id=p_store_id and z.is_active
 ), safe as (select product_id,min(code) code from links group by product_id having count(distinct code)=1)
 select coalesce(jsonb_agg(jsonb_build_object('product_id',s.product_id,'code',s.code,
 'count_name',coalesce((select case when count(distinct nullif(n.count_name,''))=1 then min(nullif(n.count_name,'')) end from links l join private.ingredient_usage_names n on n.ingredient_id=l.ingredient_id where l.product_id=s.product_id),''),
 'names',(select coalesce(jsonb_agg(distinct name),'[]'::jsonb) from (
 select m.name from links l join private.ingredient_masters m on m.id=l.ingredient_id where l.product_id=s.product_id
 union select n.formal_name from links l join private.ingredient_usage_names n on n.ingredient_id=l.ingredient_id where l.product_id=s.product_id
 union select jsonb_array_elements_text(n.recipe_aliases) from links l join private.ingredient_usage_names n on n.ingredient_id=l.ingredient_id where l.product_id=s.product_id
 union select b.name from links l join private.receipt_ingredient_bindings b on b.store_id=p_store_id and b.ingredient_id=l.ingredient_id where l.product_id=s.product_id
 ) names))),'[]'::jsonb) into result from safe s;
 return result;
end $$;
revoke all on function public.get_count_ingredient_names(uuid) from public,anon;
grant execute on function public.get_count_ingredient_names(uuid) to authenticated;

-- The directory searches the same metadata without replacing existing shared-code operations.
do $patch$declare src text;anchor text;begin
 src:=pg_get_functiondef('public.baihuayuan_code_management(uuid,text,jsonb,uuid)'::regprocedure);
 anchor:='coalesce((select string_agg(x.name,''、'' order by x.name) from private.ingredient_aliases x where x.ingredient_id=m.id),'''') aliases';
 if strpos(src,anchor)=0 then raise exception 'Code alias anchor missing';end if;
 src:=replace(src,anchor,$a$concat_ws('、',coalesce((select string_agg(x.name,'、' order by x.name) from private.ingredient_aliases x where x.ingredient_id=m.id),''),
 (select concat_ws('、',n.count_name,(select string_agg(value,'、') from jsonb_array_elements_text(n.recipe_aliases))) from private.ingredient_usage_names n where n.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)),
 (select string_agg(ub.name,'、') from private.receipt_ingredient_bindings ub where ub.store_id=m.store_id and ub.ingredient_id=m.id)) aliases$a$);
 anchor:='''ingredient'' kind,m.name,private.managed_ingredient_code(m.id)';
 if strpos(src,anchor)=0 then raise exception 'Code name anchor missing';end if;
 execute replace(src,anchor,$a$'ingredient' kind,coalesce((select n.formal_name from private.ingredient_usage_names n where n.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)),m.name) name,private.managed_ingredient_code(m.id)$a$);
end $patch$;
notify pgrst,'reload schema';
