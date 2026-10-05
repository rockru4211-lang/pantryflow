-- A save fills missing lines but cannot accept a price increase on an existing line.
-- Only recipe.cost.confirm may replace a previously saved cost.
create or replace function private.recipe_saved_snapshot(recipe uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when a.id is not null and a.origin='confirmed' and a.source_revision=r.revision and a.document=r.document
 then jsonb_build_object('document',a.document,'cost',a.cost_snapshot)
 else jsonb_build_object('document',coalesce(v.document,a.document),'cost',coalesce(v.cost_snapshot,a.cost_snapshot)) end
 from private.recipe_cards r
 left join private.recipe_versions v on v.recipe_id=r.id and v.revision=r.revision
 left join lateral(select * from private.recipe_cost_approvals where recipe_id=r.id order by created_at desc,id desc limit 1) a on true
 where r.id=recipe
$$;
revoke all on function private.recipe_saved_snapshot(uuid) from public,anon,authenticated;

do $$ declare original text; revised text;
begin
 original:=pg_get_functiondef('private.recipe_operation(uuid,text,jsonb,uuid)'::regprocedure);
 if position('saved:=private.recipe_saved_snapshot' in original)=0 then
  revised:=replace(original,'cost jsonb; normalized jsonb;','cost jsonb; saved jsonb; normalized jsonb;');
  revised:=replace(revised,'cost:=private.recipe_cost(s,doc,array[v_id]);',
  'cost:=private.recipe_cost(s,doc,array[v_id]);
  saved:=private.recipe_saved_snapshot(v_id);
  if jsonb_typeof(saved->''cost'')=''object'' then
   cost:=private.recipe_locked_cost(doc,saved->''document'',saved->''cost'',cost);
  end if;');
  if revised=original or position('saved jsonb;' in revised)=0 or position('saved:=private.recipe_saved_snapshot' in revised)=0 then raise exception 'Recipe save source changed';end if;
  execute revised;
 end if;
 original:=pg_get_functiondef('private.recipe_workspace_saved(uuid)'::regprocedure);
 revised:=replace(original,'coalesce(v.cost_snapshot,a.cost_snapshot,jsonb_build_object(',
 'coalesce(nullif(private.recipe_saved_snapshot(r.id)->''cost'',''null''::jsonb),v.cost_snapshot,a.cost_snapshot,jsonb_build_object(');
 if revised<>original then execute revised;end if;
 original:=pg_get_functiondef('private.recipe_workspace(uuid)'::regprocedure);
 revised:=replace(original,'''cost'',coalesce(v.cost_snapshot,',
 '''cost'',coalesce(nullif(private.recipe_saved_snapshot((c.value->>''id'')::uuid)->''cost'',''null''::jsonb),v.cost_snapshot,');
 if revised<>original then execute revised;end if;
end $$;
notify pgrst,'reload schema';
