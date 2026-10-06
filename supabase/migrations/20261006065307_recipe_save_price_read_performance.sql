-- Materialize selected mappings once; avoid millions of nested-loop comparisons.
-- Query results and purchase-first selection remain unchanged.
do $$ declare original text; revised text;begin
 original:=pg_get_functiondef('private.recipe_prices(uuid)'::regprocedure);
 revised:=replace(replace(original,'unique_maps as (','unique_maps as materialized ('),'preferred_prices as (','preferred_prices as materialized (');
 execute revised;
end $$;
alter function private.recipe_prices(uuid) set enable_nestloop=off;

-- One full price read per document save. Explicit quotes are evaluated individually;
-- never rescan every purchase/alias for every line or acknowledge before commit.
create or replace function private.recipe_commit(s uuid,data jsonb,request uuid) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare prior private.app_requests; card private.recipe_cards; item jsonb; line jsonb; result jsonb; baseline jsonb; cost jsonb; accepted jsonb:='[]';
 rev int; original_revision int; master uuid; seen uuid[]:='{}'; entries uuid[]:='{}'; entry private.recipe_price_entries; normalized jsonb; quote jsonb; one jsonb; chosen jsonb; rows jsonb; item_key text; subtotal numeric; missing int;
begin
 if auth.uid() is null or not private.recipe_allowed(s) or private.store_access_mode(s) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if request is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('recipe:'||s::text,0));
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then
  if prior.actor_id<>auth.uid() or prior.action<>'recipe.commit' or prior.payload<>data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;return prior.result;
 end if;
 if jsonb_typeof(coalesce(data->'prices','[]'))<>'array' or jsonb_array_length(coalesce(data->'prices','[]'))>150 then raise exception 'INVALID_PRICE' using errcode='22023';end if;
 if jsonb_array_length(coalesce(data->'prices','[]'))>0 and not private.recipe_allowed(s,true) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 result:=private.recipe_safe_operation(s,'recipe.save',data-'prices',gen_random_uuid());rev:=(result->>'revision')::int;
 select * into card from private.recipe_cards where id=(data->>'id')::uuid and store_id=s;
 baseline:=private.recipe_saved_snapshot(card.id);rows:=baseline#>'{cost,lines}';
 for item in select value from jsonb_array_elements(coalesce(data->'prices','[]')) loop
  select value into line from jsonb_array_elements(card.document->'lines') where value->>'id'=item->>'line_id';
  if line is null or nullif(line->>'recipe_id','') is not null or line->>'name' is distinct from item->>'name'
   or nullif(line->>'ingredient_id','') is distinct from nullif(item->>'ingredient_id','')
   or nullif(line->>'product_id','') is distinct from nullif(item->>'product_id','') then raise exception 'INVALID_INGREDIENT_TARGET' using errcode='22023';end if;
  master:=nullif(item->>'ingredient_id','')::uuid;
  if master is not null then
   select revision into original_revision from private.ingredient_masters where id=master and store_id=s;
   if not master=any(seen) and original_revision is distinct from (item->>'ingredient_revision')::int then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
   item:=item||jsonb_build_object('ingredient_revision',original_revision);seen:=array_append(seen,master);
   perform private.recipe_price_catalog_operation(s,'recipe.price',item-'recipe_id'-'recipe_revision'-'line_id',gen_random_uuid());
  else
   -- Seed/update legacy-name aliases once after all entry inserts, not per ingredient.
   one:=private.recipe_safe_operation(s,'recipe.price',item-'recipe_id'-'recipe_revision'-'line_id',gen_random_uuid());
   entries:=array_append(entries,(one->>'id')::uuid);
  end if;
  normalized:=private.recipe_purchase_value(item->'purchase',item->>'unit');
  item_key:=case when master is not null then 'i:'||master when nullif(line->>'product_id','') is not null then 'p:'||(line->>'product_id') else 'n:'||lower(btrim(line->>'name')) end;
  quote:=jsonb_build_object('key',item_key,'name',line->>'name','product_id',line->>'product_id','unit',normalized->>'unit','price',normalized->'price','cost_price',normalized->'cost_price','purchase',item->'purchase','source',item->>'source','source_kind','manual','effective_date',item->>'effective_date','recorded_at',clock_timestamp());
  one:=private.recipe_cost_indexed(s,jsonb_set(card.document,'{lines}',jsonb_build_array(line)),array[card.id],jsonb_build_object(item_key,jsonb_build_array(quote)))#>'{lines,0}';
  if jsonb_typeof(one->'amount')='number' then chosen:=one;
  else select value into chosen from jsonb_array_elements(rows) where value->>'id'=line->>'id';end if;
  chosen:=chosen||jsonb_build_object('price',quote);
  select jsonb_agg(case when value->>'id'=line->>'id' then chosen else value end order by ord) into rows from jsonb_array_elements(rows) with ordinality t(value,ord);
  accepted:=accepted||jsonb_build_array(item->>'line_id');
 end loop;
 if cardinality(entries)>0 then
  perform private.seed_ingredient_masters(s);
  for entry in select * from private.recipe_price_entries where id=any(entries) order by array_position(entries,id) loop
   update private.ingredient_masters m set purchase=entry.purchase,cost_price=coalesce(entry.cost_price,entry.price)/private.recipe_factor(entry.unit),selected_reference=entry.id,review_status='confirmed',manual=true,revision=revision+1,updated_at=now(),updated_by=auth.uid()
   from private.ingredient_aliases a where a.ingredient_id=m.id and a.store_id=s and entry.id=any(a.reference_ids) and m.selected_reference is distinct from entry.id;
  end loop;
 end if;
 select coalesce(sum((value->>'amount')::numeric),0),count(*) filter(where jsonb_typeof(value->'amount') is distinct from 'number') into subtotal,missing from jsonb_array_elements(rows);
 if jsonb_array_length(rows)=0 then missing:=1;end if;
 cost:=jsonb_build_object('lines',rows,'subtotal',subtotal,'missing',missing,'total',case when missing=0 then subtotal end);
 insert into private.recipe_cost_approvals(recipe_id,document,cost_snapshot,source_revision,actor_id,origin) values(card.id,card.document,cost,rev,auth.uid(),'confirmed');
 result:=result||jsonb_build_object('cost',cost,'accepted_lines',accepted,'ingredient_revisions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision)),'[]') from private.ingredient_masters where store_id=s and (id=any(seen) or selected_reference=any(entries))));
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),'recipe.commit',data,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id) select organization_id,'recipe',card.id::text,'recipe.commit',baseline->'cost',cost,auth.uid() from public.stores where id=s;
 return result;
end $$;
revoke all on function private.recipe_commit(uuid,jsonb,uuid) from public,anon,authenticated;
