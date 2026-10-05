-- Saved recipe cost is the source of truth for list/home views.
-- Login, refresh and background price loading must never recalculate a saved
-- recipe to zero. Live prices remain available separately as proposed_cost.
create or replace function private.recipe_workspace(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare result jsonb; cards jsonb;
begin
 result:=private.recipe_workspace_live(s);
 select coalesce(jsonb_agg(c.value||jsonb_build_object(
  'proposed_cost',c.value->'cost',
  'proposed_cost_token',md5((c.value->'cost')::text),
  'cost_history',(select coalesce(jsonb_agg(jsonb_build_object(
    'id',h.id,'at',h.created_at,'cost',h.cost_snapshot
  ) order by h.created_at desc),'[]')
    from private.recipe_cost_approvals h
    where h.recipe_id=(c.value->>'id')::uuid),
  'approved_cost',case when a.id is null then null else jsonb_build_object(
    'id',a.id,'document',a.document,'cost',a.cost_snapshot,
    'at',a.created_at,'origin',a.origin
  ) end,
  -- The latest saved version is the stable display cost. It was calculated
  -- in the same transaction as recipe.save, after explicit price persistence.
  'cost',coalesce(v.cost_snapshot,
    case when a.id is null then c.value->'cost'
      else private.recipe_locked_cost(
        c.value->'document',a.document,a.cost_snapshot,c.value->'cost'
      )
    end)
 ) order by c.value->>'updated_at' desc),'[]') into cards
 from jsonb_array_elements(result->'recipes') c
 left join lateral(
   select cost_snapshot
   from private.recipe_versions
   where recipe_id=(c.value->>'id')::uuid
     and revision=(c.value->>'revision')::integer
   limit 1
 ) v on true
 left join lateral(
   select * from private.recipe_cost_approvals
   where recipe_id=(c.value->>'id')::uuid
   order by created_at desc,id desc limit 1
 ) a on true;
 return jsonb_set(result,'{recipes}',cards);
end $$;

notify pgrst,'reload schema';
