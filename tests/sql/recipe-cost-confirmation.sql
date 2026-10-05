-- All test rows are rolled back by a private subtransaction.
do $test$
declare owner_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid(); s uuid; r uuid:=gen_random_uuid();
 data jsonb; doc jsonb; result jsonb; quote jsonb; req uuid; denied boolean; baseline jsonb; live jsonb; a uuid;
 code text:='COST'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
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

 doc:='{"name":"成本保留測試","kind":"dish","yield":"1","unit":"份","notes":"","lines":[{"id":"test-line","name":"QA食材","quantity":"2","unit":"盒"}]}';
 quote:='{"name":"QA食材","unit":"盒","price":30,"source":"測試報價","effective_date":"2026-10-01"}';
 perform private.recipe_operation(s,'recipe.price',quote,gen_random_uuid());
 perform private.recipe_safe_operation(s,'recipe.save',jsonb_build_object('id',r,'revision',0,'document',doc),gen_random_uuid());
 baseline:=private.recipe_cost(s,doc,array[r]);
 assert (baseline->>'total')::numeric=60,'fixture baseline wrong';
 data:=jsonb_build_object('id',r,'revision',1,'approval_id',null,'expected_token',md5(baseline::text));req:=gen_random_uuid();
 result:=private.recipe_safe_operation(s,'recipe.cost.confirm',data,req);a:=(result->>'approval_id')::uuid;
 assert private.recipe_safe_operation(s,'recipe.cost.confirm',data,req)=result,'confirmation retry not idempotent';
 assert (select count(*)=1 from private.recipe_cost_approvals where recipe_id=r),'retry duplicated approval';
 quote:=quote||'{"price":50,"effective_date":"2026-10-02"}';
 perform private.recipe_operation(s,'recipe.price',quote,gen_random_uuid());
 live:=private.recipe_cost(s,doc,array[r]);assert (live->>'total')::numeric=100,'new price not visible';
 result:=private.recipe_workspace(s)->'recipes'->0;
 assert result->'cost'=baseline,'price update overwrote saved cost';
 assert result->'proposed_cost'=live,'proposal missing';
 assert (select count(*)=1 from private.recipe_versions where recipe_id=r),'price changed saved recipe history';
 -- A stale comparison must not approve a price the user did not see.
 data:=jsonb_build_object('id',r,'revision',1,'approval_id',a,'expected_token',md5(baseline::text));
 denied:=false;begin perform private.recipe_safe_operation(s,'recipe.cost.confirm',data,gen_random_uuid());exception when serialization_failure then denied:=true;end;assert denied,'stale proposal accepted';
 data:=jsonb_set(data,'{expected_token}',to_jsonb(md5(live::text)));req:=gen_random_uuid();
 result:=private.recipe_safe_operation(s,'recipe.cost.confirm',data,req);
 assert private.recipe_safe_operation(s,'recipe.cost.confirm',data,req)=result,'second confirmation retry not idempotent';
 assert (select count(*)=2 from private.recipe_cost_approvals where recipe_id=r),'history missing';
 assert (select cost_snapshot=baseline from private.recipe_cost_approvals where id=a),'old cost overwritten';
 assert (private.recipe_workspace(s)->'recipes'->0->'cost')=live,'confirmed cost not selected';
 -- Autosaving a recipe must never create a price approval.
 perform private.recipe_safe_operation(s,'recipe.save',jsonb_build_object('id',r,'revision',1,'document',doc||'{"name":"改名保留成本"}'),gen_random_uuid());
 assert (select count(*)=2 from private.recipe_cost_approvals where recipe_id=r),'autosave approved new costs';
 data:=data||jsonb_build_object('revision',2,'approval_id',result->>'approval_id');
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);
 denied:=false;begin perform private.recipe_safe_operation(s,'recipe.cost.confirm',data,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'outsider approved cost';
 denied:=false;begin perform private.recipe_workspace(s);exception when insufficient_privilege then denied:=true;end;assert denied,'outsider read costs';
 -- A supervisor can edit recipes but cannot approve pricing.
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
 select organization_id,outsider_id,'SUPERVISOR',false,false from public.stores where id=s;
 insert into public.staff_identities(organization_id,user_id,display_name,created_by)
 select organization_id,outsider_id,'成本測試主管',owner_id from public.stores where id=s;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
 select s,organization_id,outsider_id,code||'-chef','SUPERVISOR','SUPERVISOR',owner_id,false from public.stores where id=s;
 denied:=false;begin perform private.recipe_safe_operation(s,'recipe.cost.confirm',data,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'supervisor approved pricing';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform private.recipe_confirm_cost(s,data,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'anonymous approved cost';
 assert not has_table_privilege('authenticated','private.recipe_cost_approvals','INSERT'),'client can forge approval';
 assert not has_function_privilege('anon','private.recipe_confirm_cost(uuid,jsonb,uuid)','execute'),'anonymous helper exposed';
 raise exception 'ROLLBACK_COST_QA' using errcode='PZ001';
 exception when sqlstate 'PZ001' then null;end;
end $test$;
