-- Save an explicitly edited quote and the target recipe snapshot in one transaction.
-- No existing recipe, price or approval is backfilled or rewritten by this migration.
create or replace function private.recipe_save_line_price(s uuid,data jsonb,request uuid) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare card private.recipe_cards; prior private.app_requests; item jsonb; saved jsonb;
 normalized jsonb; quote jsonb; prices jsonb; latest jsonb; locked jsonb; chosen jsonb; rows jsonb;
 result jsonb; approval uuid; item_key text; missing integer; subtotal numeric;
begin
 if auth.uid() is null or not private.recipe_allowed(s,true) or private.store_access_mode(s) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if request is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('recipe:'||s::text,0));
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then
  if prior.actor_id<>auth.uid() or prior.action<>'recipe.price.line' or prior.payload<>data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into card from private.recipe_cards where id=(data->>'recipe_id')::uuid and store_id=s for update;
 if card.id is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if card.revision is distinct from (data->>'recipe_revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 select value into item from jsonb_array_elements(card.document->'lines') where value->>'id'=data->>'line_id';
 if item is null or nullif(item->>'recipe_id','') is not null
  or item->>'name' is distinct from data->>'name'
  or nullif(item->>'ingredient_id','') is distinct from nullif(data->>'ingredient_id','')
  or nullif(item->>'product_id','') is distinct from nullif(data->>'product_id','') then raise exception 'INVALID_INGREDIENT_TARGET' using errcode='22023';end if;
 saved:=private.recipe_saved_snapshot(card.id);
 -- This nested request is committed or rolled back together with the outer receipt.
 result:=private.recipe_price_catalog_operation(s,'recipe.price',data-'recipe_id'-'line_id'-'recipe_revision',gen_random_uuid());
 normalized:=private.recipe_purchase_value(data->'purchase',data->>'unit');
 item_key:=case when nullif(item->>'ingredient_id','') is not null then 'i:'||(item->>'ingredient_id') when nullif(item->>'product_id','') is not null then 'p:'||(item->>'product_id') else 'n:'||lower(btrim(item->>'name')) end;
 quote:=jsonb_build_object('key',item_key,'name',item->>'name','product_id',item->>'product_id',
  'unit',normalized->>'unit','price',normalized->'price','cost_price',normalized->'cost_price',
  'purchase',data->'purchase','source',data->>'source','source_kind','manual',
  'effective_date',data->>'effective_date','recorded_at',clock_timestamp());
 select coalesce(jsonb_agg(value),'[]') into prices from jsonb_array_elements(private.recipe_prices(s)) where value->>'key'<>item_key;
 prices:=jsonb_build_array(quote)||prices;
 latest:=private.recipe_cost_indexed(s,card.document,array[card.id],private.recipe_price_index(prices));
 locked:=private.recipe_locked_cost(card.document,saved->'document',saved->'cost',latest);
 select value into chosen from jsonb_array_elements(latest->'lines') where value->>'id'=data->>'line_id';
 -- An unfinished conversion retains the last amount but always preserves the typed package.
 if jsonb_typeof(chosen->'amount') is distinct from 'number' then
  select value into chosen from jsonb_array_elements(locked->'lines') where value->>'id'=data->>'line_id';
 end if;
 chosen:=chosen||jsonb_build_object('price',quote);
 select jsonb_agg(case when value->>'id'=data->>'line_id' then chosen else value end order by ord) into rows
 from jsonb_array_elements(locked->'lines') with ordinality t(value,ord);
 select count(*) filter(where jsonb_typeof(value->'amount') is distinct from 'number'),coalesce(sum((value->>'amount')::numeric),0)
 into missing,subtotal from jsonb_array_elements(rows);
 locked:=jsonb_build_object('lines',rows,'missing',missing,'subtotal',subtotal,'total',case when missing=0 then subtotal end);
 insert into private.recipe_cost_approvals(recipe_id,document,cost_snapshot,source_revision,actor_id,origin)
 values(card.id,card.document,locked,card.revision,auth.uid(),'confirmed') returning id into approval;
 result:=result||jsonb_build_object('recipe_id',card.id,'approval_id',approval,'cost',locked);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),'recipe.price.line',data,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
 select organization_id,'recipe',card.id::text,'recipe.price.line',saved->'cost',locked,auth.uid() from public.stores where id=s;
 return result;
end $$;
revoke all on function private.recipe_save_line_price(uuid,jsonb,uuid) from public,anon,authenticated;

do $$ declare original text; revised text;
begin
 original:=pg_get_functiondef('private.recipe_price_catalog_operation(uuid,text,jsonb,uuid)'::regprocedure);
 revised:=replace(original,E'begin\n',E'begin\n if action=''recipe.price'' and nullif(data->>''recipe_id'','''') is not null then return private.recipe_save_line_price(s,data,request);end if;\n');
 if revised=original then raise exception 'Recipe price entry point changed';end if;execute revised;
 -- A manual correction must survive the purchase-first default selection.
 original:=pg_get_functiondef('private.recipe_prices(uuid)'::regprocedure);
 revised:=replace(original,'(not m.manual or m.selected_reference is not null)','(not m.manual or r.source_kind in (''purchase'',''history'') or (preferred.value->>''effective_date'')::date>coalesce(r.effective_date,m.updated_at::date) or (preferred.value->>''recorded_at'')::timestamptz>m.updated_at)');
 if revised=original then raise exception 'Recipe price priority source changed';end if;execute revised;
 -- A review and a normal reload must both return the newest saved/confirmed baseline.
 original:=pg_get_functiondef('private.recipe_workspace(uuid)'::regprocedure);
 revised:=replace(original,'''cost'',coalesce(v.cost_snapshot,','''cost'',coalesce(nullif(private.recipe_saved_snapshot((c.value->>''id'')::uuid)->''cost'',''null''::jsonb),v.cost_snapshot,');
 revised:=replace(revised,'''document'',a.document,''cost'',a.cost_snapshot,','''document'',coalesce(private.recipe_saved_snapshot((c.value->>''id'')::uuid)->''document'',a.document),''cost'',coalesce(private.recipe_saved_snapshot((c.value->>''id'')::uuid)->''cost'',a.cost_snapshot),');
 execute revised;
 original:=pg_get_functiondef('private.recipe_workspace_saved(uuid)'::regprocedure);
 revised:=replace(original,'''document'',a.document,''cost'',a.cost_snapshot,','''document'',coalesce(private.recipe_saved_snapshot(r.id)->''document'',a.document),''cost'',coalesce(private.recipe_saved_snapshot(r.id)->''cost'',a.cost_snapshot),');
 execute revised;
end $$;

-- Unit edits reuse the saved quote, including g/kg and whole packages.
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
  normalized jsonb;
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
      and coalesce(saved_line->>'product_id','')=coalesce(line->>'product_id','')
      and coalesce(saved_line->>'ingredient_id','')=coalesce(line->>'ingredient_id','')
      and coalesce(saved_line->>'recipe_id','')=coalesce(line->>'recipe_id','');

    if same_identity
       and saved_cost is not null
       and saved_cost->'amount' is not null
       and jsonb_typeof(saved_cost->'amount')='number' then
      old_qty := nullif(saved_line->>'quantity','')::numeric;
      new_qty := nullif(line->>'quantity','')::numeric;
      if old_qty is not null and old_qty>0 and new_qty is not null and new_qty>0 then
        if private.recipe_unit(saved_line->>'unit')=private.recipe_unit(line->>'unit') then
          amount := (saved_cost->>'amount')::numeric * new_qty * private.recipe_factor(line->>'unit') / (old_qty * private.recipe_factor(saved_line->>'unit'));
          chosen := saved_cost || jsonb_build_object('amount',amount,'reason',null);
        else
          begin
            normalized:=private.recipe_purchase_value(saved_cost#>'{price,purchase}',line->>'unit');
            amount:=coalesce((normalized->>'cost_price')::numeric,(normalized->>'price')::numeric)*new_qty*private.recipe_factor(line->>'unit');
            chosen:=saved_cost||jsonb_build_object('amount',amount,'reason',case when amount is null then '待補包裝換算' end);
          exception when sqlstate '22023' or division_by_zero or invalid_text_representation then
            chosen:=saved_cost||jsonb_build_object('amount',null,'reason','待補包裝換算');
          end;
        end if;
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

create or replace function private.recipe_workspace_review(s uuid, recipe uuid) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare card private.recipe_cards; result jsonb; proposed jsonb; history jsonb;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select * into card from private.recipe_cards where id=recipe and store_id=s;
 if card.id is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select c into result from jsonb_array_elements(private.recipe_workspace_saved(s)->'recipes') c where c->>'id'=recipe::text;
 proposed:=private.recipe_cost(s,card.document,array[card.id]);
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'at',h.at,'cost',h.cost,'actor_name',p.display_name) order by h.at desc,h.id),'[]') into history
 from (
  select a.id::text id,a.created_at at,a.cost_snapshot cost,a.actor_id from private.recipe_cost_approvals a where a.recipe_id=recipe
  union all
  select 'version:'||v.revision,v.created_at,v.cost_snapshot,v.actor_id from private.recipe_versions v where v.recipe_id=recipe
 ) h left join public.profiles p on p.id=h.actor_id;
 return result||jsonb_build_object('proposed_cost',proposed,'proposed_cost_token',md5(proposed::text),'cost_history',history);
end $$;
