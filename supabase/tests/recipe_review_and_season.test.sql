begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();chef uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();s uuid:=gen_random_uuid();other_s uuid:=gen_random_uuid();root_id uuid:=gen_random_uuid();prep uuid:=gen_random_uuid();req uuid:=gen_random_uuid();menu_id uuid:=gen_random_uuid();
 usage_state text;doc jsonb;payload jsonb;result jsonb;cost jsonb;copy_id uuid;copy_prep uuid;before_hash text;original jsonb;read_result jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select id,id||'@recipe-org-test.invalid',now(),now(),now() from unnest(array[owner_id,chef,staff,outsider]) id;
 insert into public.profiles(id,display_name) select id,'食譜分類回滾測試' from unnest(array[owner_id,chef,staff,outsider]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type) values(org,'食譜分類回滾測試','SINGLE_RESTAURANT');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(s,org,'食譜分類測試','RM'||substr(s::text,1,8),owner_id),(other_s,org,'另一店','RM'||substr(other_s::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,owner_id,'OWNER',true,true),(org,chef,'SUPERVISOR',false,false),(org,staff,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'食譜分類測試',owner_id from unnest(array[owner_id,chef,staff]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(s,org,owner_id,'rm-owner','OWNER','OWNER',owner_id,true),(s,org,chef,'rm-chef','SUPERVISOR','SUPERVISOR',owner_id,false),(s,org,staff,'rm-staff','STAFF','STAFF',owner_id,false);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 cost:='{"total":null,"subtotal":12.3,"missing":1,"lines":[{"id":"l","amount":12.3,"reason":null,"price":null},{"id":"q","amount":null,"reason":"待補","price":null}]}'::jsonb;
 doc:=jsonb_build_object('name','原配件','kind','prep','yield','','unit','g','notes','保留','lines','[]'::jsonb,'source_import_id',root_id);
 insert into private.recipe_cards(id,store_id,document,revision,updated_by) values(prep,s,doc,1,owner_id);
 insert into private.recipe_versions(recipe_id,revision,document,cost_snapshot,actor_id) values(prep,1,doc,cost,owner_id);
 doc:=jsonb_build_object('name','原菜','kind','dish','yield','1','unit','份','source_category','前菜','source_import_id',root_id,'component_order',jsonb_build_array(prep),'notes','保留','lines',jsonb_build_array(jsonb_build_object('id','l','name','配件','quantity','','unit','g','recipe_id',prep)));
 insert into private.recipe_cards(id,store_id,document,revision,updated_by) values(root_id,s,doc,1,owner_id);
 insert into private.recipe_versions(recipe_id,revision,document,cost_snapshot,actor_id) values(root_id,1,doc,cost,owner_id);
 original:=doc;
 result:=public.recipe_organization(s,'menu_save',jsonb_build_object('id',menu_id,'revision',0,'name','秋冬菜單','state','active'),gen_random_uuid());
 payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',root_id,'revision',1)),'patch',jsonb_build_object('category','熱前菜'),'menu_id',menu_id,'membership','add');
 result:=public.recipe_organization(s,'update',payload,req);
 assert result=public.recipe_organization(s,'update',payload,req),'retry idempotent';
 assert private.recipe_saved_snapshot(root_id)->'cost'=cost,'classification preserves incomplete locked cost exactly';
 assert (select document-'category'-'menu_ids'-'lifecycle' from private.recipe_cards where id=root_id)=original,'only metadata changes';
 assert (select revision from private.recipe_cards where id=root_id)=2,'retry does not create another version';
 begin perform public.recipe_organization(s,'update',payload,gen_random_uuid());raise exception 'stale revision accepted';exception when serialization_failure then null;end;
 begin perform public.recipe_organization(other_s,'update',payload-'menu_id'-'membership',gen_random_uuid());raise exception 'cross store accepted';exception when insufficient_privilege then null;end;
 select md5(jsonb_agg(to_jsonb(r) order by id)::text) into before_hash from private.recipe_cards r where store_id=s;
 payload:=jsonb_build_object('id',root_id,'revision',2);req:=gen_random_uuid();
 result:=public.recipe_organization(s,'clone',payload,req);copy_id:=(result->>'id')::uuid;
 assert result=public.recipe_organization(s,'clone',payload,req),'clone retry does not duplicate';
 assert (result->>'copied')::int=2,'components copied';
 assert (select count(*) from private.recipe_cards where store_id=s)=4,'exact tree count';
 assert (select md5(jsonb_agg(to_jsonb(r) order by id)::text) from private.recipe_cards r where id in(root_id,prep))=before_hash,'originals immutable';
 assert private.recipe_saved_snapshot(copy_id)->'cost'=cost,'copy preserves cost';
 select (document#>>'{lines,0,recipe_id}')::uuid into copy_prep from private.recipe_cards where id=copy_id;
 assert copy_prep<>prep and (select document->>'derived_from' from private.recipe_cards where id=copy_prep)=prep::text,'cloned ingredient points to copied component';
 assert (select document->>'lifecycle' from private.recipe_cards where id=copy_id)='unused','copy starts unused';
 assert (select document->'menu_ids' from private.recipe_cards where id=copy_id)='[]'::jsonb,'copy not published';
 assert (select document->>'source_import_id' from private.recipe_cards where id=copy_id)=(select document->>'source_import_id' from private.recipe_cards where id=copy_prep),'new source grouping retained';
 assert (select document->>'source_import_id' from private.recipe_cards where id=copy_id)<>root_id::text,'new grouping separate from original';
 perform public.recipe_organization(s,'menu_save',jsonb_build_object('id',menu_id,'revision',1,'name','秋冬菜單','state','closed'),gen_random_uuid());
 assert private.recipe_saved_snapshot(root_id)->'cost'=cost,'closing menu preserves cost';
 assert (select document->'menu_ids' from private.recipe_cards where id=root_id)=jsonb_build_array(menu_id),'closing menu retains membership history';
 payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',root_id,'revision',2)),'patch',jsonb_build_object('lifecycle','reserve'));req:=gen_random_uuid();
 result:=public.recipe_organization(s,'update',payload,req);
 assert result=public.recipe_organization(s,'update',payload,req),'reserve retry idempotent';
 assert (select document->>'lifecycle' from private.recipe_cards where id=root_id)='reserve','reserve saved';
 assert private.recipe_saved_snapshot(root_id)->'cost'=cost,'reserve preserves locked cost';
 read_result:=public.mobile_recipe_workspace(s,'recipes');
 assert exists(select 1 from jsonb_array_elements(read_result->'recipes') r where r->>'id'=root_id::text and r->>'lifecycle'='reserve'),'mobile receives same storage state';
 assert jsonb_array_length(read_result->'menus')=1,'mobile receives menu state';
 -- Approved lifecycle and seasons retain snapshots, and retry is idempotent.
 payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',root_id,'revision',(select revision from private.recipe_cards where id=root_id))),'patch',jsonb_build_object('lifecycle','ready','season','秋季'));req:=gen_random_uuid();
 result:=public.recipe_organization(s,'update',payload,req);
 assert result=public.recipe_organization(s,'update',payload,req),'ready retry idempotent';
 assert private.recipe_saved_snapshot(root_id)->'cost'=cost,'ready and season preserve locked cost';
 assert (select document->>'season' from private.recipe_cards where id=root_id)='秋季','season persists';
 assert exists(select 1 from jsonb_array_elements(public.mobile_recipe_workspace(s,'recipes')->'recipes') r where r->>'id'=root_id::text and r->>'season'='秋季' and r->>'lifecycle'='ready'),'mobile receives ready and season';
 -- Every recipe editor can set usage status directly, without supervisor approval.
 update public.store_memberships set role='LOGISTICS',work_role='LOGISTICS' where store_id=s and user_id=chef;
 perform set_config('request.jwt.claim.sub',chef::text,true);
 foreach usage_state in array array['serving','unused','archived','ready'] loop
  payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',root_id,'revision',(select revision from private.recipe_cards where id=root_id))),'patch',jsonb_build_object('lifecycle',usage_state));req:=gen_random_uuid();
  result:=public.recipe_organization(s,'update',payload,req);
  assert result=public.recipe_organization(s,'update',payload,req),'usage status retry idempotent';
  assert (select document->>'lifecycle' from private.recipe_cards where id=root_id)=usage_state,'logistics can set all four usage statuses';
  assert private.recipe_saved_snapshot(root_id)->'cost'=cost,'usage status preserves locked cost';
 end loop;
 -- Menu activation, attachment and closure must not overwrite explicit status.
 result:=public.recipe_organization(s,'menu_save',jsonb_build_object('id',menu_id,'revision',2,'name','秋冬菜單','state','active'),gen_random_uuid());
 payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',root_id,'revision',(select revision from private.recipe_cards where id=root_id))),'patch',jsonb_build_object('lifecycle','unused'),'menu_id',menu_id,'membership','add');
 perform public.recipe_organization(s,'update',payload,gen_random_uuid());
 assert (select document->>'lifecycle' from private.recipe_cards where id=root_id)='unused','menu attachment preserves explicit usage status';
 perform public.recipe_organization(s,'menu_save',jsonb_build_object('id',menu_id,'revision',3,'name','秋冬菜單','state','closed'),gen_random_uuid());
 assert (select document->>'lifecycle' from private.recipe_cards where id=root_id)='unused','menu closure preserves explicit usage status';
 assert private.recipe_saved_snapshot(root_id)->'cost'=cost,'menu changes preserve locked cost';
 -- Legacy values remain valid and untouched until an editor explicitly chooses.
 foreach usage_state in array array['unset','research','reserve','menu'] loop
  payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',root_id,'revision',(select revision from private.recipe_cards where id=root_id))),'patch',jsonb_build_object('lifecycle',usage_state));
  perform public.recipe_organization(s,'update',payload,gen_random_uuid());
  payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',root_id,'revision',(select revision from private.recipe_cards where id=root_id))),'patch',jsonb_build_object('category','保留原狀態'));
  perform public.recipe_organization(s,'update',payload,gen_random_uuid());
  assert (select document->>'lifecycle' from private.recipe_cards where id=root_id)=usage_state,'legacy status survives metadata updates';
  assert private.recipe_saved_snapshot(root_id)->'cost'=cost,'legacy status retains locked cost';
 end loop;
 begin
  update private.recipe_cards set document=document||'{"lifecycle":"invalid"}'::jsonb where id=root_id;
  raise exception 'invalid status accepted';
 exception when invalid_parameter_value then null;end;
 begin
  update private.recipe_cards set document=document||'{"season":12}'::jsonb where id=root_id;
  raise exception 'invalid season accepted';
 exception when invalid_parameter_value then null;end;
 perform set_config('request.jwt.claim.sub',chef::text,true);
 read_result:=public.recipe_organization(s,'read');assert jsonb_array_length(read_result->'menus')=1,'chef can read';
 perform public.recipe_organization(s,'update',jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',prep,'revision',1)),'patch',jsonb_build_object('category','配件')),gen_random_uuid());
 -- BeApe feature-level RECIPE edit grants are still required.
 update public.stores set name='BeApe' where id=s;
 insert into private.person_data_access(organization_id,user_id,permissions,updated_by)
 values(org,chef,'{"RECIPE":{"view":true,"edit":false}}',owner_id);
 payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',root_id,'revision',(select revision from private.recipe_cards where id=root_id))),'patch',jsonb_build_object('lifecycle','serving'));
 begin perform public.recipe_organization(s,'update',payload,gen_random_uuid());raise exception 'feature edit denial bypassed';exception when insufficient_privilege then null;end;
 update private.person_data_access set permissions='{"RECIPE":{"view":true,"edit":true}}' where organization_id=org and user_id=chef;
 perform public.recipe_organization(s,'update',payload,gen_random_uuid());
 assert (select document->>'lifecycle' from private.recipe_cards where id=root_id)='serving','BeApe editor can set status without supervisor';
 assert private.recipe_saved_snapshot(root_id)->'cost'=cost,'feature editor status retains costs';
 update public.store_memberships set access_mode='VIEW' where store_id=s and user_id=chef;
 payload:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',root_id,'revision',(select revision from private.recipe_cards where id=root_id))),'patch',jsonb_build_object('lifecycle','serving'));
 begin perform public.recipe_organization(s,'update',payload,gen_random_uuid());raise exception 'read only status accepted';exception when insufficient_privilege then null;end;
 begin perform public.recipe_organization(s,'menu_save',jsonb_build_object('name','禁止寫入','state','draft'),gen_random_uuid());raise exception 'read only accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.recipe_organization(s,'read');raise exception 'staff accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin perform public.recipe_organization(s,'clone',payload,req);raise exception 'outsider accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.recipe_organization(s,'read');raise exception 'anonymous accepted';exception when insufficient_privilege then null;end;
 assert not has_table_privilege('authenticated','private.recipe_menus','select'),'no direct menu table access';
 assert not has_function_privilege('anon','public.recipe_organization(uuid,text,jsonb,uuid)','execute'),'anonymous rpc denied';
end $test$;
rollback;
