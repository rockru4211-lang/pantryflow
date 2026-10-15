-- Isolated tenant fixtures; all fixture data rolls back, including on success.
do $test$
declare owner_id uuid:=gen_random_uuid();outsider_id uuid:=gen_random_uuid();s uuid;s2 uuid;org uuid;data jsonb;result jsonb;payload jsonb;a uuid;b uuid;c uuid;r uuid:=gen_random_uuid();req uuid:=gen_random_uuid();old_code text;new_code text;denied boolean;
begin
 begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@code-qa.invalid',now() from unnest(array[owner_id,outsider_id])id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','編碼隔離測試','business_type','SINGLE_RESTAURANT','store_mode','MULTI'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code','CODE'||substr(replace(owner_id::text,'-',''),1,16),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);s:=(data->>'store_id')::uuid;
 select organization_id into org from public.stores where id=s;
 insert into public.stores(organization_id,store_code,name,created_by) values(org,'SECOND','Gras',owner_id) returning id into s2;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by) select s2,organization_id,user_id,login_identifier,role,work_role,assigned_by from public.store_memberships where store_id=s and user_id=owner_id;
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual) values(s,'測試麵粉','kg',32,true) returning id,ingredient_code into a,old_code;
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual) values(s2,'另一店麵粉','g',.04,true) returning id,ingredient_code into b,new_code;
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual) values(s,'測試液體','ml',1,true) returning id into c;
 insert into private.recipe_cards(id,store_id,document,updated_by) values(r,s,'{"name":"測試配件","kind":"prep","yield":"1","unit":"份","lines":[],"notes":"保留"}',owner_id);
 assert (select recipe_code like 'P%' from private.recipe_cards where id=r),'prep code missing';
 data:=public.baihuayuan_code_management(s);
 assert exists(select 1 from jsonb_array_elements(data->'rows') x where x->>'id'=b::text),'authorized cross-store row missing';
 payload:=jsonb_build_object('id',a,'target_id',b,'expected_code',old_code,'target_code',new_code);
 result:=public.baihuayuan_code_management(s,'link',payload,req);
 assert result=public.baihuayuan_code_management(s,'link',payload,req),'retry not idempotent';
 assert private.managed_ingredient_code(a)=new_code,'shared code not applied';
 assert (select ingredient_code=old_code and cost_price=32 from private.ingredient_masters where id=a),'source price or original code changed';
 assert (select cost_price=.04 from private.ingredient_masters where id=b),'target price changed';
 denied:=false;begin perform public.baihuayuan_code_management(s,'link',jsonb_build_object('id',b,'target_id',a,'expected_code',new_code,'target_code',old_code),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'cycle accepted';
 denied:=false;begin perform public.baihuayuan_code_management(s,'link',jsonb_build_object('id',c,'target_id',b,'expected_code',private.managed_ingredient_code(c),'target_code',new_code),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'incompatible units accepted';
 denied:=false;begin update private.recipe_cards set recipe_code='WRONG' where id=r;exception when invalid_parameter_value then denied:=true;end;assert denied,'recipe renumber allowed';
 perform public.baihuayuan_code_management(s,'unlink',jsonb_build_object('id',a,'expected_code',new_code),gen_random_uuid());
 assert private.managed_ingredient_code(a)=old_code,'unlink lost original';
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_id,'role','authenticated')::text,true);
 denied:=false;begin perform public.baihuayuan_code_management(s);exception when insufficient_privilege then denied:=true;end;assert denied,'outsider read allowed';
 denied:=false;begin perform public.baihuayuan_code_management(s,'link',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'outsider write allowed';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.baihuayuan_code_management(s);exception when insufficient_privilege then denied:=true;end;assert denied,'anonymous read allowed';
 raise exception 'CODE_TEST_ROLLBACK' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;end;
end $test$;
