-- Every fixture write rolls back, including on success.
do $test$
declare owner_id uuid:=gen_random_uuid();outsider_id uuid:=gen_random_uuid();s uuid;org uuid;data jsonb;result jsonb;payload jsonb;a uuid;b uuid;sp uuid;req uuid;rev integer;old_code text;denied boolean;versions integer;locked jsonb;
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

 insert into public.suppliers(organization_id,name) values(org,'Hub fixture supplier') returning id into sp;
 result:=public.baihuayuan_ingredient_prices(s,'save',jsonb_build_object('name','測試食材','unit','g','cost_price',2,'supplier_id',sp,'category','食材'),gen_random_uuid());a:=(result->>'id')::uuid;
 select ingredient_code,revision into old_code,rev from private.ingredient_masters where id=a;
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,canonical_ingredient_id) values(s,'原始別名','g',3,true,a) returning id into b;
 -- Explicit canonical link in fixture (insert assignment may normalize it).
 update private.ingredient_masters set canonical_ingredient_id=a where id=b;
 select count(*) into versions from private.ingredient_standard_versions where store_id=s;
 req:=gen_random_uuid();payload:=jsonb_build_object('id',a,'revision',rev,'category','耗材');
 result:=public.baihuayuan_ingredient_prices(s,'category',payload,req);
 assert result=public.baihuayuan_ingredient_prices(s,'category',payload,req),'category retry';
 assert (select canonical_ingredient_id=a from private.ingredient_masters where id=b),'category detached identity';
 assert (select ingredient_code=old_code and cost_price=2 and category='耗材' from private.ingredient_masters where id=a),'category changed price/code';
 assert versions=(select count(*) from private.ingredient_standard_versions where store_id=s),'category invented price change';
 denied:=false;begin perform public.baihuayuan_ingredient_prices(s,'category',payload,gen_random_uuid());exception when serialization_failure then denied:=true;end;assert denied,'stale category accepted';
 select revision into rev from private.ingredient_masters where id=a;
 req:=gen_random_uuid();payload:=jsonb_build_object('id',a,'revision',rev,'supplier_key','id:'||sp,'reason','品質不佳','disposition','可重新詢價','note','原始紀錄','replacement','候選品／乙供應商');
 result:=public.baihuayuan_ingredient_prices(s,'stop',payload,req);
 assert result=public.baihuayuan_ingredient_prices(s,'stop',payload,req),'stop retry';
 assert (select count(*) from private.ingredient_supply_events where store_id=s)=1,'duplicate stop';
 assert (select replacement='候選品／乙供應商' from private.ingredient_supply_events where store_id=s),'replacement missing';
 assert (select is_active from public.suppliers where id=sp),'supplier deactivated';
 assert not exists(select 1 from private.ingredient_supply_state where store_id=s and supplier_key='*'),'whole item stopped unexpectedly';
 req:=gen_random_uuid();payload:=jsonb_build_object('id',a,'revision',rev,'supplier_key','id:'||sp,'supply_revision',1,'note','已詢價','replacement','候選品／乙供應商／報價100');
 result:=public.baihuayuan_ingredient_prices(s,'supply_note',payload,req);
 assert result=public.baihuayuan_ingredient_prices(s,'supply_note',payload,req),'note retry';
 assert (select count(*) from private.ingredient_supply_events where store_id=s)=2,'note not appended';
 assert exists(select 1 from private.ingredient_supply_events where store_id=s and action='stop' and note='原始紀錄' and replacement='候選品／乙供應商'),'prior history overwritten';
 denied:=false;begin perform public.baihuayuan_ingredient_prices(s,'supply_note',payload,gen_random_uuid());exception when serialization_failure then denied:=true;end;assert denied,'stale note accepted';
 perform public.baihuayuan_ingredient_prices(s,'restore',jsonb_build_object('id',a,'revision',rev,'supplier_key','id:'||sp,'supply_revision',2,'note','重新驗收合格'),gen_random_uuid());
 assert (select not stopped and replacement='候選品／乙供應商／報價100' from private.ingredient_supply_state where store_id=s),'restore lost replacement';
 req:=gen_random_uuid();payload:=jsonb_build_object('id',a,'revision',rev,'name','測試食材','unit','g','cost_price',2.5,'supplier_id',sp,'category','耗材','change_reason','測試調價');
 result:=public.baihuayuan_ingredient_prices(s,'save',payload,req);
 assert result=public.baihuayuan_ingredient_prices(s,'save',payload,req),'price retry';
 assert exists(select 1 from private.ingredient_standard_versions where ingredient_id=a and (snapshot->>'cost_price')::numeric=2.5 and (previous_snapshot->>'cost_price')::numeric=2 and supplier_key='id:'||sp and previous_supplier_key='id:'||sp),'price comparison evidence missing';
 assert exists(select 1 from private.ingredient_standard_versions where ingredient_id=a and (snapshot->>'cost_price')::numeric=2),'old standard changed';
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_id,'role','authenticated')::text,true);
 denied:=false;begin perform public.baihuayuan_ingredient_prices(s,'category',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'outsider category allowed';
 denied:=false;begin perform public.baihuayuan_ingredient_prices(s,'supply_note',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'outsider note allowed';
 denied:=false;begin perform public.baihuayuan_ingredient_prices(s);exception when insufficient_privilege then denied:=true;end;assert denied,'outsider read allowed';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.baihuayuan_ingredient_prices(s);exception when insufficient_privilege then denied:=true;end;assert denied,'anonymous read allowed';
 raise exception 'HUB_TEST_ROLLBACK' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;end;
end $test$;
