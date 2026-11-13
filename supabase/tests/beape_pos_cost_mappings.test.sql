begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 s uuid:=gen_random_uuid(); other_store uuid:=gen_random_uuid(); dish uuid:=gen_random_uuid();
 drink uuid:=gen_random_uuid(); menu uuid:=gen_random_uuid(); request uuid:=gen_random_uuid();
 doc jsonb:='{"name":"測試食譜","kind":"dish","yield":"1","unit":"份","notes":"","lines":[]}';
 cost jsonb:='{"total":25,"subtotal":25,"missing":0,"lines":[]}';
 payload jsonb; result jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
 select id,id||'@pos-mapping-test.invalid',now(),now(),now() from unnest(array[owner_id,staff_id]) id;
 insert into public.profiles(id,display_name) select id,'POS 回滾測試' from unnest(array[owner_id,staff_id]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type) values(org,'POS 回滾測試','SINGLE_RESTAURANT');
 insert into public.stores(id,organization_id,name,store_code,created_by) values
  (s,org,'BeApe','PM'||substr(s::text,1,8),owner_id),
  (other_store,org,'Gras','PM'||substr(other_store::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
 values(org,owner_id,'OWNER',true,true),(org,staff_id,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by)
 select org,id,'POS 回滾測試',owner_id from unnest(array[owner_id,staff_id]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business)
 values(s,org,owner_id,'pos-owner','OWNER','OWNER',owner_id,true),(s,org,staff_id,'pos-staff','STAFF','STAFF',owner_id,false),
 (other_store,org,owner_id,'pos-owner','OWNER','OWNER',owner_id,true);
 insert into private.recipe_cards(id,store_id,document,revision,updated_by) values(dish,s,doc,1,owner_id);
 insert into private.recipe_versions(recipe_id,revision,document,cost_snapshot,actor_id) values(dish,1,doc,cost,owner_id);
 insert into private.recipe_menus(id,store_id,name,updated_by) values(menu,s,'季節菜單',owner_id);
 insert into private.ingredient_masters(id,store_id,name,unit,category,cost_price)
 values(drink,s,'POS 測試酒水','瓶','酒水',765);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);

 payload:=jsonb_build_object('target_id',dish,'scope',menu,'mapping','季節品項','revision',0);
 result:=public.beape_pos_cost_mappings(s,'recipe',payload,request);
 assert result=public.beape_pos_cost_mappings(s,'recipe',payload,request),'retry preserves the revision';
 assert result->>'revision'='1','first save';
 begin
  perform public.beape_pos_cost_mappings(s,'recipe',payload,gen_random_uuid());
  raise exception 'stale revision accepted';
 exception when serialization_failure then null;end;
 begin
  perform public.beape_pos_cost_mappings(other_store,'recipe',payload,gen_random_uuid());
  raise exception 'cross-store recipe accepted';
 exception when insufficient_privilege then null;end;
 assert jsonb_array_length(public.beape_pos_cost_mappings(other_store,'recipe'))=0,'cross-store read stays isolated';
 assert (select document from private.recipe_cards where id=dish)=doc,'recipe document preserved';
 assert private.recipe_saved_snapshot(dish)->'cost'=cost,'locked recipe cost preserved';

 payload:=jsonb_build_object('target_id',drink,'scope','','mapping',
  '{"bottle":"整瓶酒","half":"半瓶酒","glass":"單杯酒","bottleMl":750,"glassMl":125}'::jsonb,'revision',0);
 result:=public.beape_pos_cost_mappings(s,'drink',payload,gen_random_uuid());
 assert result#>>'{mapping,glass}'='單杯酒','drink formats saved together';
 assert (select cost_price from private.ingredient_masters where id=drink)=765,'ingredient price preserved';
 begin
  perform public.beape_pos_cost_mappings(s,'drink',jsonb_set(payload,'{mapping,glassMl}','900'),gen_random_uuid());
  raise exception 'invalid serving accepted';
 exception when raise_exception then
  if sqlerrm<>'INVALID_POS_MAPPING' then raise;end if;
 end;
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 begin
  perform public.beape_pos_cost_mappings(s,'drink');
  raise exception 'staff read accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.beape_pos_cost_mappings(s,'drink',payload,gen_random_uuid());
  raise exception 'staff write accepted';
 exception when insufficient_privilege then null;end;
 assert not has_table_privilege('authenticated','private.beape_pos_cost_mappings','select'),'direct table access denied';
 assert not has_function_privilege('anon','public.beape_pos_cost_mappings(uuid,text,jsonb,uuid)','execute'),'anonymous RPC denied';
end $test$;
rollback;
