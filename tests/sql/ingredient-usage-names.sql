-- Isolated tenant fixtures. Every fixture is rolled back, including on success.
do $test$
declare actor uuid:=gen_random_uuid();viewer uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
s uuid;s2 uuid;org uuid;a uuid;b uuid;c uuid;d uuid;z uuid;p uuid;sa uuid;sb uuid;batch uuid;r uuid:=gen_random_uuid();req uuid:=gen_random_uuid();
 data jsonb;payload jsonb;result jsonb;saved jsonb;line jsonb;before_master jsonb;before_recipe jsonb;before_product jsonb;denied boolean;code text;
begin
 begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@usage-names-qa.invalid',now() from unnest(array[actor,viewer,staff,outsider])id;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','名稱隔離測試','business_type','SINGLE_RESTAURANT','store_mode','SINGLE'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code','NAME'||substr(replace(actor::text,'-',''),1,16),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);s:=(data->>'store_id')::uuid;org:=(data->>'organization_id')::uuid;
 insert into public.organization_members(organization_id,user_id,role,work_role) values(org,viewer,'LOGISTICS','LOGISTICS'),(org,staff,'STAFF','STAFF');
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,viewer,'唯讀',actor),(org,staff,'員工',actor);
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,access_mode)
 values(s,org,viewer,'viewer','LOGISTICS','LOGISTICS',actor,'VIEW'),(s,org,staff,'staff','STAFF','STAFF',actor,'EDIT');
 -- Second store has the same explicitly linked ingredient code but its own local settings.
 update public.organizations set store_mode='MULTI' where id=org;
 insert into public.stores(organization_id,store_code,name,created_by) values(org,'GR'||substr(replace(actor::text,'-',''),1,16),'Gras',actor) returning id into s2;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,access_mode)
 values(s2,org,actor,'owner-gras','OWNER','OWNER',actor,'EDIT');
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,review_status) values(s,'原正式名稱','g',.25,true,'confirmed') returning id,ingredient_code into a,code;
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual) values(s,'另一食材','g',.5,true) returning id into b;
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual) values(s2,'Gras原正式名稱','g',.75,true) returning id into d;
 insert into private.ingredient_code_links(ingredient_id,target_id,actor_id) values(d,a,actor);
 insert into private.ingredient_usage_names(ingredient_id,store_id,formal_name,count_name,recipe_aliases,updated_by)
 values(d,s2,'Gras原正式名稱','Gras現場盤點名','["Gras食譜別名"]'::jsonb,actor);
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,canonical_ingredient_id) values(s,'原同食材別名','g',.3,true,a) returning id into c;
 update private.ingredient_masters set canonical_ingredient_id=a where id=c;
 insert into public.suppliers(organization_id,name) values(org,'QA A供應商') returning id into sa;
 insert into public.suppliers(organization_id,name) values(org,'QA B供應商') returning id into sb;
 insert into public.count_zones(organization_id,store_id,name) values(org,s,'冷藏') returning id into z;
 insert into public.products(organization_id,name,base_unit,count_unit) values(org,'原盤點名稱','g','g') returning id into p;
 insert into public.zone_products(zone_id,product_id,count_unit) values(z,p,'g');
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit) values(s,a,'原盤點名稱','p:'||p::text,'g');
 insert into private.recipe_cards(id,store_id,document,updated_by) values(r,s,jsonb_build_object('name','保留食譜','kind','prep','yield','1','unit','份','lines',jsonb_build_array(jsonb_build_object('id','one','name','原正式名稱','ingredient_id',a,'unit','g','quantity','50'))),actor);
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,status) values(org,s,'BeApe',actor,current_date,'READY_FOR_REVIEW') returning id into batch;
 select to_jsonb(m) into before_master from private.ingredient_masters m where id=a;
 select to_jsonb(m) into before_recipe from private.recipe_cards m where id=r;
 select to_jsonb(m) into before_product from public.products m where id=p;
 data:=public.baihuayuan_ingredient_names(s,c);
 assert data->>'id'=a::text and data->>'code'=code and (data->>'revision')::int=0,'canonical initial read';
 payload:=jsonb_build_object('revision',0,'formal_name','鐵塔鮮奶油 1L','count_name','鐵塔鮮奶油','recipe_aliases',jsonb_build_array('鮮奶油','動物性奶油'),
 'bindings',jsonb_build_array(jsonb_build_object('supplier_id',sa,'name','A貨單奶油','unit','瓶','specification','1L','revision',0,'stopped',false,'supply_revision',0),jsonb_build_object('supplier_id',sb,'name','B貨單奶油','unit','瓶','specification','1L','revision',0,'stopped',false,'supply_revision',0)));
 set local role authenticated;
 saved:=public.baihuayuan_ingredient_names(s,a,payload,req);
 assert saved=public.baihuayuan_ingredient_names(s,a,payload,req),'retry not idempotent';
 reset role;
 assert (saved->>'revision')::int=1 and jsonb_array_length(saved->'bindings')=2,'name save missing';
 assert (select formal_name='鐵塔鮮奶油 1L' and count_name='Gras現場盤點名' and recipe_aliases='["Gras食譜別名"]'::jsonb from private.ingredient_usage_names where ingredient_id=d and store_id=s2),'shared formal name did not sync or overwrote store-specific names';
 assert (select cost_price=.75 from private.ingredient_masters where id=d),'shared name sync changed store-specific price';
 assert (select count(*)=1 from public.audit_logs where store_id=s2 and entity_type='ingredient_names' and entity_id=d::text and action='ingredient.shared-name-sync'),'cross-store sync audit missing';
 assert (select count(*)=1 from private.app_requests where store_id=s and request_id=req),'duplicate retry';
 assert (select to_jsonb(m)=before_master from private.ingredient_masters m where id=a),'master price/code/history changed';
 assert (select to_jsonb(m)=before_recipe from private.recipe_cards m where id=r),'recipe changed';
 assert (select to_jsonb(m)=before_product from public.products m where id=p),'inventory source changed';
 data:=private.recipe_picker_workspace(s);
 assert exists(select 1 from jsonb_array_elements(data->'ingredients')x where x->>'id'=a::text and x->>'name'='鐵塔鮮奶油 1L' and x->'recipe_aliases'?'鮮奶油'),'recipe picker missing aliases';
 assert exists(select 1 from jsonb_array_elements(data->'prices')x where x->>'key'='i:'||a::text and (x->>'price')::numeric=.25),'recipe price changed';
 data:=private.ingredient_catalog(s);
 assert exists(select 1 from jsonb_array_elements(data->'ingredients')x where x->>'id'=a::text and x->>'count_name'='鐵塔鮮奶油'),'price catalog name missing';
 data:=public.baihuayuan_code_management(s);
 assert exists(select 1 from jsonb_array_elements(data->'rows')x where x->>'id'=a::text and x->>'name'='鐵塔鮮奶油 1L' and x->>'aliases' like '%鮮奶油%'),'directory aliases missing';
 denied:=false;begin perform public.baihuayuan_ingredient_names(s,a,payload,gen_random_uuid());exception when serialization_failure then denied:=true;end;assert denied,'stale profile accepted';
 denied:=false;begin perform public.baihuayuan_ingredient_names(s,a,payload||'{"formal_name":"other"}',req);exception when unique_violation then denied:=true;end;assert denied,'request conflict accepted';
 denied:=false;begin perform public.baihuayuan_ingredient_names(s,b,payload,gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'supplier alias reassigned';
 assert not exists(select 1 from private.ingredient_usage_names where ingredient_id=b),'failed save partially committed';
 payload:=jsonb_build_object('revision',1,'formal_name',saved->>'formal_name','count_name',saved->>'count_name','recipe_aliases',saved->'recipe_aliases',
 'bindings',(select jsonb_agg(x||jsonb_build_object('stopped',(x->>'supplier_id')::uuid=sa)) from jsonb_array_elements(saved->'bindings')x));
 saved:=public.baihuayuan_ingredient_names(s,a,payload,gen_random_uuid());
 assert jsonb_array_length(saved->'bindings')=2 and saved->>'code'=code,'supplier switch lost history/code';
 data:=public.get_baihuayuan_ingredient_matching(s);
 assert exists(select 1 from jsonb_array_elements(data->'bindings')x where x->>'name'=private.ingredient_match_text('A貨單奶油') and (x->>'stopped')::boolean),'A not stopped';
 assert exists(select 1 from jsonb_array_elements(data->'bindings')x where x->>'name'=private.ingredient_match_text('B貨單奶油') and not (x->>'stopped')::boolean),'B stopped';
 line:=jsonb_build_object('ingredient_id',a,'product_name','鐵塔鮮奶油 1L','supplier_item_name','原貨單新名稱','unit','瓶','specification','1L','quantity',6,'subtotal',1200,'remember_ingredient_alias',false);
 result:=private.save_receipt_ingredient_match(s,batch,'QA B供應商',line,'{}','');
 assert result->>'supplier_item_name'='原貨單新名稱' and result->>'subtotal'='1200' and result->>'quantity'='6','receipt evidence lost';
 assert not exists(select 1 from private.receipt_ingredient_bindings where store_id=s and name='原貨單新名稱'),'opt-out remembered';
 result:=private.save_receipt_ingredient_match(s,batch,'QA B供應商',line||'{"remember_ingredient_alias":true}','{}','');
 assert exists(select 1 from private.receipt_ingredient_bindings where store_id=s and name='原貨單新名稱' and ingredient_id=a),'opt-in not remembered';
 perform set_config('request.jwt.claim.sub',staff::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 set local role authenticated;
 data:=public.get_count_ingredient_names(s);
 reset role;
 assert data->0->>'code'=code and data->0->>'count_name'='鐵塔鮮奶油' and data->0->'names'?'鮮奶油','staff count identity missing';
 assert not (data->0 ?| array['cost_price','price','suppliers','recipes']),'count reader leaked office data';
 denied:=false;begin perform public.baihuayuan_ingredient_names(s,a);exception when insufficient_privilege then denied:=true;end;assert denied,'staff names management access';
 perform set_config('request.jwt.claim.sub',viewer::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',viewer,'role','authenticated')::text,true);
 data:=public.get_count_ingredient_names(s);
 denied:=false;begin perform public.baihuayuan_ingredient_names(s,a,payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'viewer write allowed';
 perform set_config('request.jwt.claim.sub',outsider::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 denied:=false;begin perform public.get_count_ingredient_names(s);exception when insufficient_privilege then denied:=true;end;assert denied,'outsider count read';
 denied:=false;begin perform public.baihuayuan_ingredient_names(s,a);exception when insufficient_privilege then denied:=true;end;assert denied,'outsider management read';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.get_count_ingredient_names(s);exception when insufficient_privilege then denied:=true;end;assert denied,'anonymous count read';
 assert not has_function_privilege('anon','public.get_count_ingredient_names(uuid)','EXECUTE'),'anonymous grant';
 assert not has_table_privilege('authenticated','private.ingredient_usage_names','SELECT,INSERT,UPDATE,DELETE'),'direct table grant';
 raise exception 'USAGE_NAMES_TEST_ROLLBACK' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;end;
end $test$;
