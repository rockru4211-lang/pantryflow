-- Editing the formal name of a confirmed shared ingredient code updates all linked
-- store records. Store-specific count names, recipe aliases, supplier bindings,
-- prices, stock, and historical source rows remain independent.
alter function public.baihuayuan_ingredient_names(uuid,uuid,jsonb,uuid)
 rename to baihuayuan_ingredient_names_before_shared_names;
alter function public.baihuayuan_ingredient_names_before_shared_names(uuid,uuid,jsonb,uuid)
 set schema private;
revoke all on function private.baihuayuan_ingredient_names_before_shared_names(uuid,uuid,jsonb,uuid)
 from public,anon,authenticated;

create function public.baihuayuan_ingredient_names(
 p_store_id uuid,
 p_ingredient_id uuid,
 p_data jsonb default null,
 p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 result jsonb;
 root_id uuid;
 org_id uuid;
 root_unit text;
 shared_code text;
 formal text;
 target record;
 current_name private.ingredient_usage_names;
 old_value jsonb;
 new_value jsonb;
begin
 if p_data is null then
  return private.baihuayuan_ingredient_names_before_shared_names(p_store_id,p_ingredient_id,null,null);
 end if;

 select coalesce(m.canonical_ingredient_id,m.id),s.organization_id
 into root_id,org_id
 from private.ingredient_masters m
 join public.stores s on s.id=m.store_id
 where m.id=p_ingredient_id and m.store_id=p_store_id;

 -- Preserve the original RPC's validation/error behavior for unknown IDs.
 if root_id is null or org_id is null then
  return private.baihuayuan_ingredient_names_before_shared_names(p_store_id,p_ingredient_id,p_data,p_request_id);
 end if;

 select m.unit into root_unit from private.ingredient_masters m where m.id=root_id;
 shared_code:=private.managed_ingredient_code(root_id);

 -- Serialize name edits across both stores. Require edit rights to every linked
 -- store before saving anything, so no partial sync or cross-store permission bypass.
 perform pg_advisory_xact_lock(hashtextextended(org_id::text||':shared-ingredient-name',0));
 for target in
  select distinct m.store_id
  from private.ingredient_masters m
  join public.stores s on s.id=m.store_id
  where s.organization_id=org_id
    and private.recipe_unit(m.unit)=private.recipe_unit(root_unit)
    and private.managed_ingredient_code(coalesce(m.canonical_ingredient_id,m.id))=shared_code
 loop
  if not private.recipe_allowed(target.store_id,true)
     or private.store_access_mode(target.store_id) is distinct from 'EDIT' then
   raise exception 'SHARED_INGREDIENT_EDIT_REQUIRED' using errcode='42501';
  end if;
 end loop;

 result:=private.baihuayuan_ingredient_names_before_shared_names(p_store_id,p_ingredient_id,p_data,p_request_id);
 formal:=btrim(p_data->>'formal_name');
 if shared_code is null or formal is null or formal='' then return result; end if;

 -- A shared code is the explicit user-confirmed identity. Restrict propagation to
 -- the same organization and compatible units; never merge merely similar names.
 for target in
  select m.id,m.store_id
  from private.ingredient_masters m
  join public.stores s on s.id=m.store_id
  where s.organization_id=org_id
    and private.recipe_unit(m.unit)=private.recipe_unit(root_unit)
    and private.managed_ingredient_code(coalesce(m.canonical_ingredient_id,m.id))=shared_code
  order by m.store_id,m.id
 loop
  select * into current_name
  from private.ingredient_usage_names n
  where n.ingredient_id=target.id and n.store_id=target.store_id
  for update;

  if current_name.ingredient_id is null then
   insert into private.ingredient_usage_names(ingredient_id,store_id,formal_name,count_name,recipe_aliases,updated_by)
   values(target.id,target.store_id,formal,'','[]'::jsonb,auth.uid())
   returning * into current_name;
   new_value:=to_jsonb(current_name);
   insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
   values(org_id,target.store_id,'ingredient_names',target.id::text,'ingredient.shared-name-sync',null,new_value,auth.uid());
  elsif current_name.formal_name is distinct from formal then
   old_value:=to_jsonb(current_name);
   update private.ingredient_usage_names
   set formal_name=formal,revision=revision+1,updated_by=auth.uid(),updated_at=now()
   where ingredient_id=target.id and store_id=target.store_id
   returning * into current_name;
   new_value:=to_jsonb(current_name);
   insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
   values(org_id,target.store_id,'ingredient_names',target.id::text,'ingredient.shared-name-sync',old_value,new_value,auth.uid());
  end if;
 end loop;

 return result;
end $$;
revoke all on function public.baihuayuan_ingredient_names(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.baihuayuan_ingredient_names(uuid,uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
