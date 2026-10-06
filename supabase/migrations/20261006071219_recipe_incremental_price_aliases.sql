-- A recipe save touches only explicitly supplied quotations; it never rebuilds the store catalog.
create or replace function private.recipe_link_price_entries(s uuid, entries uuid[]) returns void
language plpgsql security definer set search_path='' set jit=off as $$
declare r private.recipe_price_entries; mid uuid; canonical text; u text; k text; spec text;
begin
 if auth.uid() is null or not private.recipe_allowed(s,true) or private.store_access_mode(s) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 for r in select * from private.recipe_price_entries where store_id=s and id=any(entries) order by array_position(entries,id) loop
  u:=private.recipe_unit(r.unit);spec:=btrim(coalesce(r.source_ref->>'specification',''));
  k:=case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end;
  canonical:=private.ingredient_name(r.name,r.unit)||case when spec<>'' then ' · '||spec else '' end;
  insert into private.ingredient_masters(store_id,name,unit) values(s,canonical,u) on conflict do nothing;
  select id into mid from private.ingredient_masters where store_id=s and lower(btrim(name))=lower(btrim(canonical)) and unit=u;
  insert into private.ingredient_aliases as a(store_id,ingredient_id,name,source_key,source_unit,specification,reference_ids)
  values(s,mid,r.name,k,u,spec,(select array_agg(p.id order by p.created_at,p.id) from private.recipe_price_entries p where p.store_id=s and (case when p.product_id is not null then 'p:'||p.product_id else 'n:'||lower(btrim(p.name)) end)=k and private.recipe_unit(p.unit)=u and btrim(coalesce(p.source_ref->>'specification',''))=spec))
  on conflict(store_id,source_key,source_unit,specification) do update set reference_ids=excluded.reference_ids;
  -- Preserve a user's alias correction: only reference history changes on conflict.
 end loop;
end $$;
revoke all on function private.recipe_link_price_entries(uuid,uuid[]) from public,anon,authenticated;
do $$ declare original text; revised text;begin
 original:=pg_get_functiondef('private.recipe_commit(uuid,jsonb,uuid)'::regprocedure);
 revised:=replace(original,'perform private.seed_ingredient_masters(s);','perform private.recipe_link_price_entries(s,entries);');
 if revised=original then raise exception 'Recipe commit source changed';end if;execute revised;
end $$;
