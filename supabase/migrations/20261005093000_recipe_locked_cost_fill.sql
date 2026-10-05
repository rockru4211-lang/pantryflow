-- Preserve already accepted recipe costs while allowing previously missing lines
-- to become calculable as soon as a valid shared price/conversion exists.
-- This prevents a saved NULL line from permanently forcing the whole recipe
-- to appear incomplete after the user has already supplied its price.

create or replace function private.recipe_locked_cost(
  doc jsonb,
  approved_doc jsonb,
  approved_cost jsonb,
  proposed_cost jsonb
) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare
  line jsonb;
  saved_line jsonb;
  saved_cost jsonb;
  proposed_line jsonb;
  chosen jsonb;
  lines jsonb := '[]'::jsonb;
  total numeric := 0;
  amount numeric;
  old_qty numeric;
  new_qty numeric;
  missing integer := 0;
  same_identity boolean;
begin
  for line in select value from jsonb_array_elements(coalesce(doc->'lines','[]'::jsonb)) loop
    saved_line := null;
    saved_cost := null;
    proposed_line := null;
    chosen := null;
    amount := null;

    select value into saved_line
    from jsonb_array_elements(coalesce(approved_doc->'lines','[]'::jsonb))
    where value->>'id'=line->>'id' limit 1;

    select value into saved_cost
    from jsonb_array_elements(coalesce(approved_cost->'lines','[]'::jsonb))
    where value->>'id'=line->>'id' limit 1;

    select value into proposed_line
    from jsonb_array_elements(coalesce(proposed_cost->'lines','[]'::jsonb))
    where value->>'id'=line->>'id' limit 1;

    same_identity := saved_line is not null
      and coalesce(saved_line->>'name','')=coalesce(line->>'name','')
      and coalesce(saved_line->>'unit','')=coalesce(line->>'unit','')
      and coalesce(saved_line->>'product_id','')=coalesce(line->>'product_id','')
      and coalesce(saved_line->>'ingredient_id','')=coalesce(line->>'ingredient_id','')
      and coalesce(saved_line->>'recipe_id','')=coalesce(line->>'recipe_id','')
      and coalesce(saved_line->>'note','')=coalesce(line->>'note','');

    if same_identity
       and saved_cost is not null
       and saved_cost->'amount' is not null
       and jsonb_typeof(saved_cost->'amount')='number' then
      old_qty := nullif(saved_line->>'quantity','')::numeric;
      new_qty := nullif(line->>'quantity','')::numeric;
      if old_qty is not null and old_qty>0 and new_qty is not null and new_qty>0 then
        amount := (saved_cost->>'amount')::numeric * new_qty / old_qty;
        chosen := saved_cost || jsonb_build_object('amount',amount,'reason',null);
      end if;
    end if;

    -- A formerly missing saved line is not treated as a locked zero/null.
    -- Use the current calculable proposal for that line instead.
    if chosen is null then
      chosen := coalesce(proposed_line,jsonb_build_object(
        'id',line->>'id','amount',null,'reason','待補價格或換算','price',null
      ));
      if chosen->'amount' is not null and jsonb_typeof(chosen->'amount')='number' then
        amount := (chosen->>'amount')::numeric;
      else
        amount := null;
      end if;
    end if;

    if amount is null then missing := missing + 1;
    else total := total + amount;
    end if;
    lines := lines || jsonb_build_array(chosen);
  end loop;

  if jsonb_array_length(lines)=0 then missing := missing + 1; end if;
  return jsonb_build_object(
    'total',case when missing=0 then total end,
    'subtotal',total,
    'missing',missing,
    'lines',lines
  );
end $$;

revoke all on function private.recipe_locked_cost(jsonb,jsonb,jsonb,jsonb)
from public,anon,authenticated;

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
  'cost',case when a.id is null then c.value->'cost'
    else private.recipe_locked_cost(
      c.value->'document',a.document,a.cost_snapshot,c.value->'cost'
    ) end
 ) order by c.value->>'updated_at' desc),'[]') into cards
 from jsonb_array_elements(result->'recipes') c
 left join lateral(
   select * from private.recipe_cost_approvals
   where recipe_id=(c.value->>'id')::uuid
   order by created_at desc,id desc limit 1
 ) a on true;
 return jsonb_set(result,'{recipes}',cards);
end $$;

notify pgrst,'reload schema';
