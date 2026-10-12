-- Organization changes reuse immutable saved costs; no price lookup or recipe re-import.
create table private.recipe_menus (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 name text not null check(length(btrim(name)) between 1 and 100),
 state text not null default 'draft' check(state in ('draft','active','closed')),
 revision integer not null default 1,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 unique(store_id,name)
);
alter table private.recipe_menus enable row level security;
revoke all on private.recipe_menus from public,anon,authenticated;

create function private.recipe_organization(s uuid, action text, data jsonb, request uuid) returns jsonb
language plpgsql security definer set search_path='' set jit='off' as $$
declare actor uuid:=auth.uid(); prior private.app_requests; card private.recipe_cards; menu private.recipe_menus;
 item jsonb; doc jsonb; snap jsonb; result jsonb; ids uuid[]; mapping jsonb:='{}'; groups jsonb:='{}';
 source_id uuid; new_id uuid; root_id uuid; group_id text; changed integer:=0; org uuid; patch jsonb;
begin
 if actor is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if action='read' then
  return jsonb_build_object('menus',(select coalesce(jsonb_agg(to_jsonb(m) order by m.updated_at desc),'[]') from private.recipe_menus m where store_id=s));
 end if;
 if private.store_access_mode(s) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if request is null or jsonb_typeof(data)<>'object' then raise exception 'INVALID_REQUEST';end if;
 perform pg_advisory_xact_lock(hashtextextended('recipe:'||s::text,0));
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>'recipe.organization.'||action or prior.payload<>data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return prior.result;
 end if;
 select organization_id into org from public.stores where id=s;
 if action='menu_save' then
  if length(btrim(coalesce(data->>'name',''))) not between 1 and 100 or coalesce(data->>'state','') not in ('draft','active','closed') then raise exception 'INVALID_MENU';end if;
  new_id:=coalesce(nullif(data->>'id','')::uuid,gen_random_uuid());
  select * into menu from private.recipe_menus where id=new_id for update;
  if found and (menu.store_id<>s or menu.revision is distinct from (data->>'revision')::int) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  if not found and coalesce((data->>'revision')::int,0)<>0 then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  insert into private.recipe_menus(id,store_id,name,state,revision,updated_by) values(new_id,s,btrim(data->>'name'),data->>'state',coalesce(menu.revision,0)+1,actor)
  on conflict(id) do update set name=excluded.name,state=excluded.state,revision=excluded.revision,updated_by=actor,updated_at=now();
  result:=jsonb_build_object('id',new_id,'revision',coalesce(menu.revision,0)+1);
 elsif action='update' then
  patch:=coalesce(data->'patch','{}');
  if jsonb_typeof(data->'rows')<>'array' or jsonb_array_length(data->'rows') not between 1 and 500
   or jsonb_typeof(patch)<>'object' or exists(select 1 from jsonb_object_keys(patch) k where k not in ('category','lifecycle')) then raise exception 'INVALID_RECIPE_METADATA';end if;
  if patch ? 'category' and (jsonb_typeof(patch->'category')<>'string' or length(patch->>'category')>100) then raise exception 'INVALID_CATEGORY';end if;
  if patch ? 'lifecycle' and coalesce(patch->>'lifecycle','') not in ('unset','serving','research','archived','menu') then raise exception 'INVALID_STATUS';end if;
  if data ? 'menu_id' then
   select * into menu from private.recipe_menus where id=(data->>'menu_id')::uuid and store_id=s;
   if not found or coalesce(data->>'membership','') not in ('add','remove') then raise exception 'INVALID_MENU';end if;
  end if;
  for item in select value from jsonb_array_elements(data->'rows') loop
   select * into card from private.recipe_cards where id=(item->>'id')::uuid and store_id=s for update;
   if not found then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
   if card.revision is distinct from (item->>'revision')::int then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
   doc:=card.document||patch;
   if data ? 'menu_id' then
    doc:=jsonb_set(doc,'{menu_ids}',(select coalesce(jsonb_agg(x),'[]') from (select distinct value x from jsonb_array_elements_text(coalesce(doc->'menu_ids','[]')) where value<>menu.id::text union select menu.id::text where data->>'membership'='add') t));
    if data->>'membership'='add' then doc:=doc||jsonb_build_object('lifecycle','menu');end if;
   end if;
   if doc=card.document then continue;end if;
   snap:=private.recipe_saved_snapshot(card.id);
   if jsonb_typeof(snap->'cost') is distinct from 'object' then raise exception 'INVALID_SAVED_COST';end if;
   update private.recipe_cards set document=doc,revision=revision+1,updated_by=actor,updated_at=now() where id=card.id;
   insert into private.recipe_versions(recipe_id,revision,document,cost_snapshot,actor_id) values(card.id,card.revision+1,doc,snap->'cost',actor);
   insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
   values(org,s,'recipe',card.id::text,'recipe.organization.update',jsonb_build_object('revision',card.revision),jsonb_build_object('revision',card.revision+1,'patch',patch,'menu_id',data->'menu_id','membership',data->'membership'),actor);
   changed:=changed+1;
  end loop;
  result:=jsonb_build_object('changed',changed);
 elsif action='clone' then
  root_id:=(data->>'id')::uuid;
  select * into card from private.recipe_cards where id=root_id and store_id=s;
  if not found then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  if card.revision is distinct from (data->>'revision')::int then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  -- UNION terminates cycles. All traversed children are constrained to this store.
  with recursive tree(id) as (
   select root_id union
   select child.id from tree t join private.recipe_cards parent on parent.id=t.id
   join private.recipe_cards child on child.store_id=s and (
    child.id::text in (select value->>'recipe_id' from jsonb_array_elements(parent.document->'lines'))
    or coalesce(parent.document->'component_order','[]') ? child.id::text
    or (parent.document->>'kind'='dish' and child.document->>'kind'='prep' and nullif(parent.document->>'source_import_id','')=child.document->>'source_import_id'
      and (select count(*) from private.recipe_cards siblings where siblings.store_id=s and siblings.document->>'kind'='dish' and siblings.document->>'source_import_id'=parent.document->>'source_import_id')=1)
   )
  ) select array_agg(id) into ids from tree;
  if cardinality(ids)>150 then raise exception 'INVALID_RECIPE_TREE';end if;
  foreach source_id in array ids loop mapping:=mapping||jsonb_build_object(source_id::text,gen_random_uuid());end loop;
  foreach source_id in array ids loop
   select * into card from private.recipe_cards where id=source_id and store_id=s;
   snap:=private.recipe_saved_snapshot(source_id);
   if jsonb_typeof(snap->'cost') is distinct from 'object' then raise exception 'INVALID_SAVED_COST';end if;
   doc:=(card.document-'import_batch')||jsonb_build_object('lifecycle','research','menu_ids','[]'::jsonb,'derived_from',source_id,'derived_revision',card.revision);
   group_id:=nullif(doc->>'source_import_id','');
   if group_id is not null then
    if not(groups ? group_id) then groups:=groups||jsonb_build_object(group_id,gen_random_uuid());end if;
    doc:=jsonb_set(doc,'{source_import_id}',groups->group_id);
   end if;
   if source_id=root_id then
    doc:=doc||jsonb_build_object('name',left(case when doc->>'name' in ('成品','出餐','出餐菜色') then coalesce(nullif(doc->>'source_name',''),doc->>'name') else doc->>'name' end,150)||'（改良版）');
   end if;
   doc:=jsonb_set(doc,'{lines}',(select coalesce(jsonb_agg(case when mapping ? (l->>'recipe_id') then jsonb_set(l,'{recipe_id}',mapping->(l->>'recipe_id')) else l end order by ord),'[]') from jsonb_array_elements(doc->'lines') with ordinality x(l,ord)));
   if doc ? 'component_order' then doc:=jsonb_set(doc,'{component_order}',(select coalesce(jsonb_agg(mapping->v order by ord),'[]') from jsonb_array_elements_text(doc->'component_order') with ordinality x(v,ord) where mapping ? v));end if;
   new_id:=(mapping->>source_id::text)::uuid;
   insert into private.recipe_cards(id,store_id,document,revision,updated_by) values(new_id,s,doc,1,actor);
   insert into private.recipe_versions(recipe_id,revision,document,cost_snapshot,actor_id) values(new_id,1,doc,snap->'cost',actor);
  end loop;
  result:=jsonb_build_object('id',mapping->root_id::text,'copied',cardinality(ids));
 else raise exception 'INVALID_RECIPE_ACTION';end if;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,actor,'recipe.organization.'||action,data,result);
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
 values(org,s,'recipe',coalesce(result->>'id',s::text),'recipe.organization.'||action,result,actor);
 return result;
end $$;
revoke all on function private.recipe_organization(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.recipe_organization(uuid,text,jsonb,uuid) to authenticated;
create function public.recipe_organization(p_store_id uuid,p_action text default 'read',p_data jsonb default '{}',p_request_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.recipe_organization(p_store_id,p_action,p_data,p_request_id); $$;
revoke all on function public.recipe_organization(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.recipe_organization(uuid,text,jsonb,uuid) to authenticated;
