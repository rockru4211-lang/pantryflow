-- Atomic recipe persistence and ingredient-scoped cost reviews. No data backfill.
create or replace function private.recipe_scoped_cost(s uuid,doc jsonb,baseline jsonb,path uuid[],idx jsonb,targets text[] default null)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare line jsonb; old jsonb; one jsonb; chosen jsonb; rows jsonb:='[]'; child private.recipe_cards; nested jsonb; child_baseline jsonb; child_doc jsonb;
 key text; affected boolean:=false; hit boolean; subtotal numeric; missing int; amount numeric; qty numeric; y numeric;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 for line in select value from jsonb_array_elements(coalesce(doc->'lines','[]')) loop
  key:=case when nullif(line->>'ingredient_id','') is not null then 'i:'||(line->>'ingredient_id') when nullif(line->>'product_id','') is not null then 'p:'||(line->>'product_id') else 'n:'||lower(btrim(line->>'name')) end;
  hit:=targets is not null and key=any(targets);
  select value into old from jsonb_array_elements(coalesce(baseline#>'{cost,lines}','[]')) where value->>'id'=line->>'id';
  if nullif(line->>'recipe_id','') is not null then
   one:=jsonb_build_object('id',line->>'id','amount',null,'reason','配件尚無可計算金額','price',null);
   select * into child from private.recipe_cards where store_id=s and id=(line->>'recipe_id')::uuid;
   if child.id is not null and not child.id=any(path) and cardinality(path)<20 then
    child_baseline:=case when targets is not null then coalesce(old->'child_snapshot',private.recipe_saved_snapshot(child.id)) else private.recipe_saved_snapshot(child.id) end;
    child_doc:=case when targets is not null then coalesce(child_baseline->'document',child.document) else child.document end;
    nested:=private.recipe_scoped_cost(s,child_doc,child_baseline,array_append(path,child.id),idx,targets);
    hit:=coalesce((nested->>'affected')::boolean,false);
    qty:=nullif(line->>'quantity','')::numeric;y:=nullif(child_doc->>'yield','')::numeric;
    if qty>0 and y>0 and private.recipe_unit(line->>'unit')=private.recipe_unit(child_doc->>'unit') and jsonb_typeof(nested#>'{cost,total}')='number' then
     amount:=(nested#>>'{cost,total}')::numeric*qty*private.recipe_factor(line->>'unit')/(y*private.recipe_factor(child_doc->>'unit'));
     -- Apply only this ingredient's delta to an already locked parent amount.
     -- Keep unrelated prep edits out of this confirmation, including legacy parents.
     if targets is not null and jsonb_typeof(old->'amount')='number' and jsonb_typeof(child_baseline#>'{cost,total}')='number' then
      amount:=(old->>'amount')::numeric+((nested#>>'{cost,total}')::numeric-(child_baseline#>>'{cost,total}')::numeric)*qty*private.recipe_factor(line->>'unit')/(y*private.recipe_factor(child_doc->>'unit'));
     end if;
     one:=one||jsonb_build_object('amount',amount,'reason',null,'child_snapshot',jsonb_build_object('document',child_doc,'cost',nested->'cost'));
    end if;
   end if;
  else
   one:=private.recipe_cost_indexed(s,jsonb_set(doc,'{lines}',jsonb_build_array(line)),path,idx)#>'{lines,0}';
  end if;
  affected:=affected or hit;
  if targets is not null then
   chosen:=coalesce(old,one);
   if hit and jsonb_typeof(one->'amount')='number' then chosen:=one;end if;
  else
   chosen:=private.recipe_locked_cost(jsonb_set(doc,'{lines}',jsonb_build_array(line)),baseline->'document',baseline->'cost',jsonb_build_object('lines',jsonb_build_array(one)))#>'{lines,0}';
  end if;
  rows:=rows||jsonb_build_array(chosen);
 end loop;
 select coalesce(sum((value->>'amount')::numeric),0),count(*) filter(where jsonb_typeof(value->'amount') is distinct from 'number') into subtotal,missing from jsonb_array_elements(rows);
 if jsonb_array_length(rows)=0 then missing:=1;end if;
 return jsonb_build_object('affected',affected,'cost',jsonb_build_object('lines',rows,'subtotal',subtotal,'missing',missing,'total',case when missing=0 then subtotal end));
end $$;
revoke all on function private.recipe_scoped_cost(uuid,jsonb,jsonb,uuid[],jsonb,text[]) from public,anon,authenticated;

create or replace function private.recipe_commit(s uuid,data jsonb,request uuid) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare prior private.app_requests; card private.recipe_cards; item jsonb; result jsonb; baseline jsonb; cost jsonb; accepted jsonb:='[]';rev int; original_revision int; master uuid; seen uuid[]:='{}';
begin
 if auth.uid() is null or not private.recipe_allowed(s) or private.store_access_mode(s) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if request is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('recipe:'||s::text,0));
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then
  if prior.actor_id<>auth.uid() or prior.action<>'recipe.commit' or prior.payload<>data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;return prior.result;
 end if;
 if jsonb_typeof(coalesce(data->'prices','[]'))<>'array' or jsonb_array_length(coalesce(data->'prices','[]'))>150 then raise exception 'INVALID_PRICE' using errcode='22023';end if;
 -- Existing validation and permission checks remain the entry point for document saves.
 result:=private.recipe_safe_operation(s,'recipe.save',data-'prices',gen_random_uuid());rev:=(result->>'revision')::int;
 for item in select value from jsonb_array_elements(coalesce(data->'prices','[]')) loop
  master:=nullif(item->>'ingredient_id','')::uuid;
  if master is not null then
   select revision into original_revision from private.ingredient_masters where id=master and store_id=s;
   if not master=any(seen) and original_revision is distinct from (item->>'ingredient_revision')::int then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
   item:=item||jsonb_build_object('ingredient_revision',original_revision);seen:=array_append(seen,master);
  end if;
  perform private.recipe_save_line_price(s,item||jsonb_build_object('recipe_id',data->>'id','recipe_revision',rev),gen_random_uuid());
  accepted:=accepted||jsonb_build_array(item->>'line_id');
 end loop;
 select * into card from private.recipe_cards where id=(data->>'id')::uuid and store_id=s;
 baseline:=private.recipe_saved_snapshot(card.id);
 cost:=private.recipe_scoped_cost(s,card.document,baseline,array[card.id],private.recipe_price_index(private.recipe_prices(s))) ->'cost';
 insert into private.recipe_cost_approvals(recipe_id,document,cost_snapshot,source_revision,actor_id,origin) values(card.id,card.document,cost,rev,auth.uid(),'confirmed');
 result:=result||jsonb_build_object('cost',cost,'accepted_lines',accepted,'ingredient_revisions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision)),'[]') from private.ingredient_masters where store_id=s and id=any(seen)));
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),'recipe.commit',data,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
 select organization_id,'recipe',card.id::text,'recipe.commit',baseline->'cost',cost,auth.uid() from public.stores where id=s;
 return result;
end $$;
revoke all on function private.recipe_commit(uuid,jsonb,uuid) from public,anon,authenticated;

create or replace function private.recipe_ingredient_review(s uuid,target text) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare prices jsonb; idx jsonb; keys text[];card private.recipe_cards; baseline jsonb; proposed jsonb; rows jsonb:='[]';
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 prices:=private.recipe_prices(s);idx:=private.recipe_price_index(prices);
 select array_agg(distinct value->>'key') into keys from jsonb_array_elements(prices)
 where coalesce('i:'||(value#>>'{source_ref,ingredient_id}'),value->>'key')=target or value->>'key'=target;
 keys:=array_append(coalesce(keys,'{}'),target);
 for card in select * from private.recipe_cards where store_id=s order by id loop
  baseline:=private.recipe_saved_snapshot(card.id);
  proposed:=private.recipe_scoped_cost(s,card.document,baseline,array[card.id],idx,keys);
  if (proposed->>'affected')::boolean then
   rows:=rows||jsonb_build_array(jsonb_build_object('id',card.id,'name',card.document->>'name','kind',card.document->>'kind','revision',card.revision,'document',card.document,'before',baseline->'cost','after',proposed->'cost'));
  end if;
 end loop;
 return jsonb_build_object('key',target,'rows',rows,'token',md5(rows::text));
end $$;
revoke all on function private.recipe_ingredient_review(uuid,text) from public,anon,authenticated;

create or replace function private.recipe_ingredient_confirm(s uuid,data jsonb,request uuid) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare prior private.app_requests; proposal jsonb; item jsonb; result jsonb; n int:=0;
begin
 if auth.uid() is null or not private.recipe_allowed(s,true) or private.store_access_mode(s) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if request is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('recipe:'||s::text,0));
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then
  if prior.actor_id<>auth.uid() or prior.action<>'recipe.ingredient.confirm' or prior.payload<>data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;return prior.result;
 end if;
 -- Lock source ingredient rows against concurrent catalog edits during confirmation.
 perform id from private.ingredient_masters where store_id=s order by id for share;
 proposal:=private.recipe_ingredient_review(s,data->>'key');
 if proposal->>'token' is distinct from data->>'token' then raise exception 'COST_REVIEW_CHANGED: 資料已異動，請重新查看' using errcode='40001';end if;
 for item in select value from jsonb_array_elements(proposal->'rows') loop
  if item->'before' is distinct from item->'after' then
   insert into private.recipe_cost_approvals(recipe_id,document,cost_snapshot,source_revision,actor_id,origin)
   values((item->>'id')::uuid,item->'document',item->'after',(item->>'revision')::int,auth.uid(),'confirmed');
   insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
   select organization_id,'recipe',item->>'id','recipe.ingredient.confirm',item->'before',jsonb_build_object('ingredient_key',data->>'key','cost',item->'after'),auth.uid() from public.stores where id=s;
   n:=n+1;
  end if;
 end loop;
 result:=jsonb_build_object('updated',n);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),'recipe.ingredient.confirm',data,result);
 return result;
end $$;
revoke all on function private.recipe_ingredient_confirm(uuid,jsonb,uuid) from public,anon,authenticated;

do $$ declare original text;revised text;begin
 original:=pg_get_functiondef('private.recipe_safe_operation(uuid,text,jsonb,uuid)'::regprocedure);
 revised:=replace(original,E'begin\n',E'begin\n if action=''recipe.commit'' then return private.recipe_commit(s,data,request);end if;\n if action=''recipe.ingredient.review'' then return private.recipe_ingredient_review(s,data->>''key'');end if;\n if action=''recipe.ingredient.confirm'' then return private.recipe_ingredient_confirm(s,data,request);end if;\n');
 if original=revised then raise exception 'Entry point changed';end if;execute revised;
 -- A save must use saved child costs; never implicitly adopt unrelated catalog changes.
 original:=pg_get_functiondef('private.recipe_operation(uuid,text,jsonb,uuid)'::regprocedure);
 revised:=replace(original,'cost:=private.recipe_cost(s,doc,array[v_id]);','cost:=private.recipe_scoped_cost(s,doc,private.recipe_saved_snapshot(v_id),array[v_id],private.recipe_price_index(private.recipe_prices(s)))->''cost'';');
 if original=revised then raise exception 'Save entry point changed';end if;execute revised;
end $$;
notify pgrst,'reload schema';
