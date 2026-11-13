-- POS mappings are metadata keyed by the existing recipe or ingredient identity.
create table private.beape_pos_cost_mappings (
 store_id uuid not null references public.stores(id),
 kind text not null check (kind in ('recipe','drink')),
 target_id uuid not null,
 scope_key text not null default '',
 mapping jsonb not null,
 revision integer not null default 1,
 primary key (store_id,kind,target_id,scope_key)
);
alter table private.beape_pos_cost_mappings enable row level security;
revoke all on private.beape_pos_cost_mappings from public,anon,authenticated;

create function private.beape_pos_cost_mappings(
 s uuid, k text, payload jsonb, request uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();
 target uuid;
 scope text;
 mapping jsonb;
 row_data private.beape_pos_cost_mappings;
 prior private.app_requests;
 result jsonb;
 action text:='beape.pos.'||k;
begin
 if actor is null or not private.feature_scope(s) or not private.recipe_allowed(s) then
  raise exception 'APP_FORBIDDEN' using errcode='42501';
 end if;
 if k is null or k not in ('recipe','drink') then raise exception 'INVALID_POS_MAPPING';end if;
 if payload is null then
  return (select coalesce(jsonb_agg(jsonb_build_object('target_id',r.target_id,'scope',r.scope_key,
    'mapping',r.mapping,'revision',r.revision)), '[]'::jsonb)
   from private.beape_pos_cost_mappings r
   where r.store_id=s and r.kind=k
   and case when k='recipe' then exists(select 1 from private.recipe_cards c where c.id=r.target_id and c.store_id=s)
    else exists(select 1 from private.ingredient_masters m where m.id=r.target_id and m.store_id=s) end);
 end if;
 if not private.recipe_allowed(s,true) or private.store_access_mode(s) is distinct from 'EDIT' then
  raise exception 'APP_FORBIDDEN' using errcode='42501';
 end if;
 if request is null or jsonb_typeof(payload) is distinct from 'object' then raise exception 'INVALID_POS_MAPPING';end if;
 target:=(payload->>'target_id')::uuid;
 scope:=coalesce(payload->>'scope','');
 mapping:=payload->'mapping';
 if k='recipe' then
  if not exists(select 1 from private.recipe_cards c where c.id=target and c.store_id=s and c.document->>'kind'='dish') then
   raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;
  if scope<>'' and not exists(select 1 from private.recipe_menus m where m.store_id=s and m.id::text=scope) then
   raise exception 'INVALID_MENU';
  end if;
  if jsonb_typeof(mapping) is distinct from 'string' or length(mapping#>>'{}')>200 then raise exception 'INVALID_POS_MAPPING';end if;
 else
  if not exists(select 1 from private.ingredient_masters m where m.id=target and m.store_id=s
    and m.canonical_ingredient_id is null and coalesce(m.category,private.classify_product(m.name))='酒水') then
   raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;
  if scope<>'' or jsonb_typeof(mapping) is distinct from 'object' then raise exception 'INVALID_POS_MAPPING';end if;
  if exists(select 1 from jsonb_each(mapping) f where
   case when f.key in ('bottle','half','glass') then jsonb_typeof(f.value)<>'string' or length(f.value#>>'{}')>200
    when f.key in ('bottleMl','glassMl') then case when jsonb_typeof(f.value)='number'
     then (f.value#>>'{}')::numeric not between 0.01 and 100000 else true end
    else true end) then raise exception 'INVALID_POS_MAPPING';end if;
  if coalesce((mapping->>'glassMl')::numeric>(mapping->>'bottleMl')::numeric,false) then
   raise exception 'INVALID_POS_MAPPING';
  end if;
 end if;

 perform pg_advisory_xact_lock(hashtextextended('beape.pos:'||s::text,0));
 select * into prior from private.app_requests a where a.store_id=s and a.request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>action or prior.payload<>payload then
   raise exception 'REQUEST_CONFLICT' using errcode='23505';
  end if;
  return prior.result;
 end if;
 select * into row_data from private.beape_pos_cost_mappings r
 where (r.store_id,r.kind,r.target_id,r.scope_key)=(s,k,target,scope);
 if coalesce(row_data.revision,0) is distinct from (payload->>'revision')::integer then
  raise exception 'REVISION_CONFLICT' using errcode='40001';
 end if;
 if row_data.mapping is distinct from mapping then
  insert into private.beape_pos_cost_mappings(store_id,kind,target_id,scope_key,mapping)
  values(s,k,target,scope,mapping)
  on conflict (store_id,kind,target_id,scope_key) do update
  set mapping=excluded.mapping,revision=beape_pos_cost_mappings.revision+1
  returning * into row_data;
  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
  select st.organization_id,s,k,target::text,action,jsonb_build_object('scope',scope,'mapping',mapping),actor
  from public.stores st where st.id=s;
 end if;
 result:=jsonb_build_object('target_id',target,'scope',scope,'mapping',row_data.mapping,'revision',row_data.revision);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result)
 values(s,request,actor,action,payload,result);
 return result;
end $$;
revoke all on function private.beape_pos_cost_mappings(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.beape_pos_cost_mappings(uuid,text,jsonb,uuid) to authenticated;

create function public.beape_pos_cost_mappings(
 p_store_id uuid,p_kind text,p_data jsonb default null,p_request_id uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
 select private.beape_pos_cost_mappings(p_store_id,p_kind,p_data,p_request_id);
$$;
revoke all on function public.beape_pos_cost_mappings(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.beape_pos_cost_mappings(uuid,text,jsonb,uuid) to authenticated;
