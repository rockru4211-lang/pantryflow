-- Every fixture is created in a rollback-only subtransaction.
do $test$
declare owner_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid(); s uuid; r uuid:=gen_random_uuid();
 data jsonb; doc jsonb; saved jsonb; result jsonb; quote jsonb; req uuid:=gen_random_uuid(); denied boolean;
 code text:='NOTE'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
begin
 begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@recipe-note-qa.invalid',now() from unnest(array[owner_id,outsider_id])id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','食譜備註換算測試','business_type','SINGLE_RESTAURANT','store_mode','MULTI'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code',code,'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);s:=(data->>'store_id')::uuid;
 quote:='{"name":"蛋黃","unit":"顆","price":8.4,"source":"供應商報價","effective_date":"2026-09-30","purchase":{"amount":8.4,"quantity":1,"unit":"顆"}}';
 result:=private.recipe_operation(s,'recipe.price',quote,req);
 assert private.recipe_operation(s,'recipe.price',quote,req)=result,'price retry not idempotent';
 assert (select count(*)=1 from private.recipe_price_entries where store_id=s),'duplicate quote';
 doc:='{"name":"備註食譜","kind":"prep","yield":"120","unit":"g","notes":"","lines":[{"id":"egg","name":"蛋黃","quantity":"120","unit":"g","note":"120g 使用 6顆蛋"}]}';
 req:=gen_random_uuid();data:=jsonb_build_object('id',r,'revision',0,'document',doc);
 saved:=private.recipe_operation(s,'recipe.save',data,req);
 assert private.recipe_operation(s,'recipe.save',data,req)=saved,'recipe retry not idempotent';
 assert (saved->'cost'->>'total')::numeric=50.4,'six egg cost incorrect';
 assert (select document=doc from private.recipe_cards where id=r),'save mutated usage or note';
 assert (select count(*)=1 from private.recipe_versions where recipe_id=r),'duplicate recipe version';
 assert (select document=doc and (cost_snapshot->>'total')::numeric=50.4 from private.recipe_versions where recipe_id=r),'snapshot differs';
 result:=private.recipe_cost(s,jsonb_set(doc,'{lines,0,note}','"120g 使用 8顆"'));
 assert (result->>'total')::numeric=67.2,'per-recipe count contaminated shared quote';
 result:=private.recipe_cost(s,jsonb_set(doc,'{lines,0,quantity}','"60"'));
 assert (result->>'total')::numeric=25.2,'weight scaling incorrect';
 result:=private.recipe_cost(s,jsonb_set(doc,'{lines,0,note}','""'));
 assert result->>'total' is null,'blank note inferred a count';
 result:=private.recipe_cost(s,jsonb_set(doc,'{lines,0,note}','"取皮切絲，汁40g"'));
 assert result->>'total' is null,'freeform note inferred a count';
 data:=doc #- '{lines,0,note}';data:=jsonb_set(data,'{notes}','"蛋黃 120g(6 顆 )"');
 assert (private.recipe_cost(s,data)->>'total')::numeric=50.4,'source note equivalence missing';
 assert private.recipe_note_basis(data->'lines'->0,E'蛋黃 120g(6顆)\n蛋黃 120g(8顆)') is null,'ambiguous source note accepted';
 assert private.recipe_note_basis(data->'lines'->0,E'蛋黃 120g(6顆)\n蛋黃 0.12kg(6顆)')->>'count'='6','equivalent notes conflict';
 assert private.recipe_note_basis('{"name":"蛋黃（6顆）"}',E'蛋黃 120g(6 顆 )')->>'quantity'='120','named count source note not matched';
 assert private.recipe_note_basis('{"note":"1台斤 使用 30顆"}')->>'quantity'='1','jin note not recognized';
 -- Estimate retains the supplier quote and every recipe retains its own note.
 quote:=jsonb_set(quote,'{purchase,cost_unit_price}','9');
 perform private.recipe_operation(s,'recipe.price',quote,gen_random_uuid());
 -- Use a future effective date so same-transaction test entries have deterministic precedence.
 update private.recipe_price_entries set effective_date='2026-10-01' where store_id=s and cost_price=9;
 assert (private.recipe_cost(s,doc)->>'total')::numeric=54,'high estimate not applied';
 assert (private.recipe_cost(s,jsonb_set(doc,'{lines,0,note}','"120g 使用 8顆"'))->>'total')::numeric=72,'high estimate overwritten note';
 assert (select bool_and(price=8.4) from private.recipe_price_entries where store_id=s),'raw quote changed';
 -- Legacy weight-normalized piece quotes must recover the per-piece price.
 delete from private.recipe_price_entries where store_id=s;
 quote:='{"name":"蛋黃","unit":"g","price":0.42,"source":"供應商報價","effective_date":"2026-09-30","purchase":{"amount":8.4,"quantity":1,"unit":"顆","content_quantity":20,"content_unit":"g","cost_unit_price":9}}';
 perform private.recipe_operation(s,'recipe.price',quote,gen_random_uuid());
 assert (private.recipe_cost(s,doc)->>'total')::numeric=54,'legacy piece quote not recovered';
 assert (private.recipe_cost(s,jsonb_set(doc,'{lines,0,note}','"120g 使用 8顆"'))->>'total')::numeric=72,'legacy equivalence contaminated recipe';
 result:=private.recipe_cost(s,jsonb_set(doc,'{lines,0,note}','""'));
 assert result->'lines'->0->>'reason'='備註待補換算','legacy conversion guessed without note';
 -- Existing package conversions remain unchanged.
 assert (private.recipe_purchase_value('{"amount":300,"quantity":1,"unit":"包","content_quantity":750,"content_unit":"g"}','g')->>'price')::numeric=0.4,'750g package regressed';
 assert (private.recipe_purchase_value('{"amount":600,"quantity":1,"unit":"桶","content_quantity":5,"content_unit":"L"}','ml')->>'price')::numeric=0.12,'5L package regressed';
 assert (select document=doc and revision=1 from private.recipe_cards where id=r),'pricing modified saved usage';
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);
 denied:=false;begin perform private.recipe_cost(s,doc);exception when insufficient_privilege then denied:=true;end;assert denied,'out-of-store cost access';
 denied:=false;begin perform private.recipe_operation(s,'recipe.save',data,req);exception when insufficient_privilege then denied:=true;end;assert denied,'out-of-store write';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform private.recipe_cost(s,doc);exception when insufficient_privilege then denied:=true;end;assert denied,'anonymous cost access';
 assert not has_function_privilege('anon','private.recipe_note_basis(jsonb,text)','execute'),'helper exposed anonymously';
 assert not has_function_privilege('authenticated','private.recipe_note_basis(jsonb,text)','execute'),'helper exposed directly';
 raise exception using errcode='Z9904',message='RECIPE_NOTE_TEST_ROLLBACK';
 exception when sqlstate 'Z9904' then null;
 end;
end $test$;
