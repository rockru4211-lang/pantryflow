-- Add identity metadata only; preserve prices, documents, approvals and historical IDs.
create temporary table code_preservation on commit drop as
select 'recipes' kind,md5(coalesce(string_agg(to_jsonb(r)::text,'' order by id),'')) hash from private.recipe_cards r
union all select 'ingredients',md5(coalesce(string_agg(to_jsonb(m)::text,'' order by id),'')) from private.ingredient_masters m;
create sequence private.recipe_code_sequence;
revoke all on sequence private.recipe_code_sequence from public,anon,authenticated;
alter table private.recipe_cards add column recipe_code text;
with numbered as materialized(select id,case when document->>'kind'='prep' then 'P' else 'R' end prefix,nextval('private.recipe_code_sequence') n from private.recipe_cards order by id)
update private.recipe_cards r set recipe_code=n.prefix||lpad(n.n::text,greatest(6,length(n.n::text)),'0') from numbered n where n.id=r.id;
alter table private.recipe_cards alter column recipe_code set not null;
create unique index recipe_fixed_code_unique on private.recipe_cards(recipe_code);
create function private.assign_recipe_code() returns trigger language plpgsql set search_path='' as $$
declare n bigint;
begin
 if TG_OP='INSERT' then
  n:=nextval('private.recipe_code_sequence');
  new.recipe_code:=(case when new.document->>'kind'='prep' then 'P' else 'R' end)||lpad(n::text,greatest(6,length(n::text)),'0');
 elsif new.recipe_code is distinct from old.recipe_code then raise exception 'RECIPE_CODE_IMMUTABLE' using errcode='22023';end if;
 return new;
end $$;
revoke all on function private.assign_recipe_code() from public,anon,authenticated;
create trigger recipe_fixed_code before insert or update of recipe_code on private.recipe_cards for each row execute function private.assign_recipe_code();

-- Cross-store links are explicit, reversible, one level deep. Old codes stay searchable.
create table private.ingredient_code_links(
 ingredient_id uuid primary key references private.ingredient_masters(id),
 target_id uuid not null references private.ingredient_masters(id),
 actor_id uuid not null,updated_at timestamptz not null default now(),
 check(ingredient_id<>target_id)
);
alter table private.ingredient_code_links enable row level security;
revoke all on private.ingredient_code_links from public,anon,authenticated;
create index ingredient_code_links_target on private.ingredient_code_links(target_id);
create function private.managed_ingredient_code(i uuid) returns text language sql stable set search_path='' as $$
 select coalesce(t.ingredient_code,r.ingredient_code,m.ingredient_code)
 from private.ingredient_masters m
 left join private.ingredient_masters r on r.id=m.canonical_ingredient_id
 left join private.ingredient_code_links l on l.ingredient_id=coalesce(r.id,m.id)
 left join private.ingredient_masters t on t.id=l.target_id where m.id=i
$$;
revoke all on function private.managed_ingredient_code(uuid) from public,anon,authenticated;
-- Existing pricing and matching readers expose the same effective code, without recalculation.
do $$
declare signature text; src text; anchor text:='coalesce((select c.ingredient_code from private.ingredient_masters c where c.id=m.canonical_ingredient_id),m.ingredient_code)';
begin
 foreach signature in array array['private.ingredient_catalog(uuid)','public.get_baihuayuan_ingredient_matching(uuid)'] loop
  src:=pg_get_functiondef(signature::regprocedure);
  if strpos(src,anchor)=0 then raise exception 'Code reader anchor missing: %',signature;end if;
  execute replace(src,anchor,'private.managed_ingredient_code(m.id)');
 end loop;
end $$;
create function public.baihuayuan_code_management(p_store_id uuid,p_action text default 'read',p_data jsonb default '{}'::jsonb,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
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
   if p_data->>'target_code' is distinct from b.ingredient_code then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
   insert into private.ingredient_code_links(ingredient_id,target_id,actor_id) values(a.id,b.id,auth.uid()) on conflict(ingredient_id) do update set target_id=excluded.target_id,actor_id=excluded.actor_id,updated_at=now();
  else delete from private.ingredient_code_links where ingredient_id=a.id;end if;
  result:=jsonb_build_object('id',a.id,'code',private.managed_ingredient_code(a.id),'previous_code',expected);
  insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,auth.uid(),'code.'||p_action,p_data,result);
  return result;
 elsif p_action<>'read' then raise exception 'INVALID_ACTION' using errcode='22023';end if;
 with permitted as materialized(select s.id,s.name,private.recipe_allowed(s.id,true) and private.store_access_mode(s.id)='EDIT' editable from public.stores s where s.organization_id=org and private.recipe_allowed(s.id) and private.office_data_access(s.id)), items as (
 select m.id,m.store_id,s.name store_name,'ingredient' kind,m.name,private.managed_ingredient_code(m.id) code,m.ingredient_code original_code,m.unit,m.category,
 coalesce((select string_agg(x.name,'、' order by x.name) from private.ingredient_aliases x where x.ingredient_id=m.id),'') aliases,
 m.purchase specification,m.canonical_ingredient_id,l.target_id,s.editable,
 exists(select 1 from private.ingredient_supply_state st where st.ingredient_id in(m.id,m.canonical_ingredient_id) and st.supplier_key='*' and st.stopped) inactive
 from private.ingredient_masters m join permitted s on s.id=m.store_id left join private.ingredient_code_links l on l.ingredient_id=m.id
 where m.manual or exists(select 1 from private.ingredient_aliases x where x.ingredient_id=m.id)
 union all
 select r.id,r.store_id,s.name,case when r.document->>'kind'='prep' then 'prep' else 'dish' end,r.document->>'name',r.recipe_code,r.recipe_code,r.document->>'unit',r.document->>'category','',null::jsonb,null::uuid,null::uuid,s.editable,r.document->>'lifecycle'='archived'
 from private.recipe_cards r join permitted s on s.id=r.store_id
 ) select coalesce(jsonb_agg(to_jsonb(i) order by kind,name,store_name,id),'[]'::jsonb) into rows from items i;
 return jsonb_build_object('rows',rows);
end $$;
revoke all on function public.baihuayuan_code_management(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.baihuayuan_code_management(uuid,text,jsonb,uuid) to authenticated;

do $$begin
 assert (select hash from code_preservation where kind='recipes')=(select md5(coalesce(string_agg((to_jsonb(r)-'recipe_code')::text,'' order by id),'')) from private.recipe_cards r),'Recipe content changed';
 assert (select hash from code_preservation where kind='ingredients')=(select md5(coalesce(string_agg(to_jsonb(m)::text,'' order by id),'')) from private.ingredient_masters m),'Ingredient content changed';
end $$;
