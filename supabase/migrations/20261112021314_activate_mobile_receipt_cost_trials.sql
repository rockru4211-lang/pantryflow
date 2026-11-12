-- Activate the already-reviewed mobile quote read/save paths after explicit
-- publication approval. Reuse the existing private context; do not rewrite any
-- saved trial, recipe baseline, approval or transaction.
do $mobile$
declare src text; old_branch text; new_branch text; anchor text;
begin
 src:=pg_get_functiondef('public.mobile_recipe_workspace(uuid,text)'::regprocedure);
 if strpos(src,'if not private.has_data_access(p_store_id,''RECIPE'')')=0 then raise exception 'MOBILE_READ_GATE_ANCHOR';end if;
 old_branch:=substring(src from strpos(src,' elsif p_section=''prices'' then') for strpos(src,' elsif p_section=''trials'' then')-strpos(src,' elsif p_section=''prices'' then'));
 if old_branch is null or old_branch='' or strpos(old_branch,'m.cost_price')=0 then raise exception 'MOBILE_PRICE_BRANCH_ANCHOR';end if;
 src:=replace(src,'declare result jsonb;','declare result jsonb; price_context jsonb; cutoff date:=(now() at time zone ''Asia/Taipei'')::date;');
 new_branch:=$branch$ elsif p_section='prices' then
  price_context:=private.automatic_cost_context_inner(p_store_id,cutoff);
  with quoted as materialized (
   select m.*,private.automatic_cost_quote_cached(p_store_id,null,m.name,m.unit,cutoff,m.id,price_context) q
   from private.ingredient_masters m where m.store_id=p_store_id and m.canonical_ingredient_id is null
  ) select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.unit,'price',m.q->'price','current_quote',m.q,'revision',m.revision,
   'aliases',coalesce((select string_agg(a.name,' ') from private.ingredient_aliases a where a.store_id=p_store_id and a.ingredient_id=m.id),'')) order by m.name),'[]') into result from quoted m;
  return jsonb_build_object('prices',result);
$branch$;
 execute replace(src,old_branch,new_branch);
 src:=pg_get_functiondef('public.save_mobile_recipe_trial(uuid,uuid,integer,jsonb,uuid)'::regprocedure);
 if strpos(src,'not private.has_data_access(p_store_id,''RECIPE'') or not private.can_edit_store(p_store_id)')=0 then raise exception 'MOBILE_SAVE_GATE_ANCHOR';end if;
 src:=replace(src,'portions numeric;','portions numeric; price_context jsonb; q jsonb; current_price numeric; cutoff date:=(now() at time zone ''Asia/Taipei'')::date;');
 anchor:='if coalesce(old.revision,0)<>p_revision then raise exception ''VERSION_CONFLICT'' using errcode=''40001'';end if;';
 if strpos(src,anchor)=0 then raise exception 'MOBILE_SAVE_VERSION_ANCHOR';end if;
 src:=replace(src,anchor,anchor||chr(10)||' price_context:=private.automatic_cost_context_inner(p_store_id,cutoff);');
 anchor:='if (line->>''price_revision'')::integer is distinct from m.revision then raise exception ''TRIAL_PRICE_CHANGED'';end if;';
 if strpos(src,anchor)=0 then raise exception 'MOBILE_SAVE_QUOTE_ANCHOR';end if;
 src:=replace(src,anchor,anchor||$guard$
  if jsonb_typeof(line->'expected_cost_quote') is distinct from 'object' or not ((line->'expected_cost_quote')?'price') then raise exception 'TRIAL_PRICE_CHANGED';end if;
  q:=private.automatic_cost_quote_cached(p_store_id,null,m.name,m.unit,cutoff,m.id,price_context);
  current_price:=private.checked_automatic_cost_quote(q,line->'expected_cost_quote');
$guard$);
 anchor:='if m.review_status=''confirmed'' and m.unit not in ('''',''待確認'') and m.cost_price is not null and private.recipe_unit(line->>''unit'')=private.recipe_unit(m.unit) then amount:=qty*private.recipe_factor(line->>''unit'')/private.recipe_factor(m.unit)*m.cost_price;end if;';
 if strpos(src,anchor)=0 then raise exception 'MOBILE_SAVE_AMOUNT_ANCHOR';end if;
 src:=replace(src,anchor,'if current_price is not null and private.recipe_unit(line->>''unit'')=private.recipe_unit(m.unit) then amount:=qty*private.recipe_factor(line->>''unit'')/private.recipe_factor(m.unit)*current_price;end if;');
 anchor:='''price'',case when m.review_status=''confirmed'' and m.unit not in ('''',''待確認'') then m.cost_price else null end,''price_unit'',m.unit';
 if strpos(src,anchor)=0 then raise exception 'MOBILE_SAVE_SNAPSHOT_ANCHOR';end if;
 execute replace(src,anchor,'''price'',current_price,''price_unit'',m.unit,''expected_cost_quote'',q');
end $mobile$;
notify pgrst,'reload schema';
