-- Explicitly returning an edited prep adopts its saved cost only in the active parent.
-- Other recipes keep their previously saved component cost.
do $$ declare original text; revised text;begin
 original:=pg_get_functiondef('private.recipe_locked_cost(jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 revised:=replace(original,
 'and coalesce(saved_line->>''recipe_id'','''')=coalesce(line->>''recipe_id'','''');',
 'and coalesce(saved_line->>''recipe_id'','''')=coalesce(line->>''recipe_id'','''') and coalesce(saved_line->>''cost_revision'','''')=coalesce(line->>''cost_revision'','''');');
 if revised=original then raise exception 'Saved cost identity changed';end if;execute revised;
end $$;
