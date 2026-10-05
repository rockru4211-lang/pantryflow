-- Isolated fixtures: all writes are rolled back, including audit and request rows.
begin;
do $test$
declare owner_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid(); s uuid; r uuid:=gen_random_uuid();
 data jsonb; doc jsonb; result jsonb; baseline jsonb; denied boolean; req uuid:=gen_random_uuid();
 code text:='FAST'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@recipe-fast-qa.invalid',now() from unnest(array[owner_id,outsider_id])id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 data:=public.owner_setup('business',jsonb_build_object('organization_name','食譜快速讀取測試','business_type','SINGLE_RESTAURANT','store_mode','MULTI'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code',code,'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);s:=(data->>'store_id')::uuid;
 doc:='{"name":"快讀測試","kind":"dish","yield":"1","unit":"份","notes":"","lines":[{"id":"line","name":"QA食材","quantity":"2","unit":"盒"}]}';
 perform private.recipe_operation(s,'recipe.price','{"name":"QA食材","unit":"盒","price":30,"source":"測試","effective_date":"2026-10-01"}',gen_random_uuid());
 data:=jsonb_build_object('id',r,'revision',0,'document',doc);
 result:=private.recipe_safe_operation(s,'recipe.save',data,req);
 assert private.recipe_safe_operation(s,'recipe.save',data,req)=result,'save replay changed';
 baseline:=result->'cost';
 assert (baseline->>'total')::numeric=60,'fixture baseline incorrect';
 result:=public.app_workspace(s,'recipes.saved')->'recipes'->0;
 assert result->'cost'=baseline and (result->>'cost_loaded')::boolean,'saved snapshot not returned';
 perform private.recipe_operation(s,'recipe.price','{"name":"QA食材","unit":"盒","price":50,"source":"測試","effective_date":"2026-10-02"}',gen_random_uuid());
 assert (public.app_workspace(s,'recipes.saved')->'recipes'->0->'cost')=baseline,'price update overwrote saved cost';
 assert (public.app_workspace(s,'recipes.pricing')->>'pricing_loaded')::boolean,'pricing missing';
 result:=public.app_workspace(s,'recipes.review',jsonb_build_object('id',r));
 assert result->'cost'=baseline,'review overwrote saved cost';
 assert (result->'proposed_cost'->>'total')::numeric=100,'proposal incorrect';
 assert result->>'proposed_cost_token'=md5((result->'proposed_cost')::text),'review token changed';
 assert (select count(*)=1 from private.recipe_versions where recipe_id=r),'reads created versions';
 -- Explicit document saves must not approve a newly increased ingredient price.
 perform private.recipe_safe_operation(s,'recipe.save',jsonb_build_object('id',r,'revision',1,'document',doc),gen_random_uuid());
 assert (public.app_workspace(s,'recipes.saved')->'recipes'->0->'cost')=baseline,'save accepted an unconfirmed increase';
 result:=public.app_workspace(s,'recipes.review',jsonb_build_object('id',r));
 perform private.recipe_safe_operation(s,'recipe.cost.confirm',jsonb_build_object('id',r,'revision',2,'approval_id',null,'expected_token',result->>'proposed_cost_token'),gen_random_uuid());
 assert (public.app_workspace(s,'recipes.saved')->'recipes'->0->'cost'->>'total')::numeric=100,'confirmed cost not visible';
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);
 foreach code in array array['recipes.saved','recipes.pricing','recipes.catalog','recipes.review'] loop
  denied:=false;begin perform public.app_workspace(s,code,jsonb_build_object('id',r));exception when insufficient_privilege then denied:=true;end;
  assert denied,'unauthorized recipe read';
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.app_workspace(s,'recipes.saved');exception when insufficient_privilege then denied:=true;end;assert denied,'anonymous recipe read';
end $test$;
select 'saved read / prices / review / repeat save / outsider / anonymous / preservation: passed' result;
rollback;
