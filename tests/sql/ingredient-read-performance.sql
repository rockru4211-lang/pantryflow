-- Isolated tenant regression; always rolls back fixture rows.
do $test$
declare owner_id uuid:=gen_random_uuid();outsider_id uuid:=gen_random_uuid();s uuid;data jsonb;result jsonb;req uuid:=gen_random_uuid();payload jsonb;org uuid;sa uuid;sb uuid;m uuid;rev int;ref uuid;denied boolean;before_price numeric;started timestamptz;code text:='SUPPLY'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
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

 select organization_id into org from public.stores where id=s;
 insert into public.suppliers(organization_id,supplier_code,name) values(org,'SUPPLY-A','測試甲供應商') returning id into sa;
 insert into public.suppliers(organization_id,supplier_code,name) values(org,'SUPPLY-B','測試乙供應商') returning id into sb;
 result:=public.baihuayuan_ingredient_prices(s,'save',jsonb_build_object('name','測試奶油','unit','kg','cost_price',280,'supplier_id',sa),gen_random_uuid());m:=(result->>'id')::uuid;rev:=(result->>'revision')::int;
 select cost_price into before_price from private.ingredient_masters where id=m;
 payload:=jsonb_build_object('id',m,'revision',rev,'supplier_key','id:'||sa,'supply_revision',0,'reason','品質不佳','disposition','不建議再採購','note','連續兩批不穩定');
 result:=public.baihuayuan_ingredient_prices(s,'stop',payload,req);
 assert public.baihuayuan_ingredient_prices(s,'stop',payload,req)=result,'retry not idempotent';
 assert (select count(*) from private.ingredient_supply_events where store_id=s)=1,'duplicate event';
 assert not exists(select 1 from private.ingredient_supply_state where store_id=s and supplier_key='*'),'supplier stop removed whole ingredient';
 assert (select cost_price from private.ingredient_masters where id=m)=before_price,'stopping altered price';
 denied:=false;begin perform public.baihuayuan_ingredient_prices(s,'save',jsonb_build_object('id',m,'revision',rev,'name','測試奶油','unit','g','cost_price',.3,'supplier_id',sa),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'stopped supplier can silently be selected';
 result:=public.baihuayuan_ingredient_prices(s,'save',jsonb_build_object('id',m,'revision',rev,'name','測試奶油','unit','g','cost_price',.3,'supplier_id',sb),gen_random_uuid());rev:=(result->>'revision')::int;
 assert (select cost_price from private.ingredient_masters where id=m)=.3,'other supplier blocked';
 payload:=jsonb_build_object('id',m,'revision',rev,'supplier_key','id:'||sa,'supply_revision',1,'note','重新試用後已確認品質');
 result:=public.baihuayuan_ingredient_prices(s,'restore',payload,gen_random_uuid());
 assert (select count(*) from private.ingredient_supply_events where store_id=s)=2,'history overwritten on restore';
 assert exists(select 1 from private.ingredient_supply_events where store_id=s and action='stop' and note='連續兩批不穩定'),'original reason lost';
 assert not (select stopped from private.ingredient_supply_state where store_id=s and supplier_key='id:'||sa),'restore failed';
 denied:=false;begin perform public.baihuayuan_ingredient_prices(s,'stop',payload||jsonb_build_object('reason','價格偏高','disposition','可重新詢價'),gen_random_uuid());exception when serialization_failure then denied:=true;end;assert denied,'stale revision accepted';
 result:=public.baihuayuan_ingredient_prices(s,'read');assert jsonb_array_length(result->'supply_events')=2,'read history missing';assert jsonb_array_length(result->'suppliers')=2,'supplier scope wrong';

 assert private.ingredient_supplier_key_for_store(s,jsonb_build_object('supplier_name','測試甲供應商'))='id:'||sa,'named supplier not canonical';
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,source_ref) values(s,'測試奶油','g',.35,'已核對進貨',current_date,owner_id,'purchase','confirmed',jsonb_build_object('supplier_id',sb,'supplier_name','測試乙供應商')) returning id into ref;
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,reference_ids) values(s,m,'奶油塊','n:奶油塊','g',array[ref]);
 result:=public.baihuayuan_ingredient_prices(s,'read');assert jsonb_array_length(result->'ingredients'->0->'sources')=1,'source quote missing';
 payload:=jsonb_build_object('id',m,'revision',rev,'reference_id',ref,'expected_price',.35);req:=gen_random_uuid();
 result:=public.baihuayuan_ingredient_prices(s,'confirm',payload,req);
 assert public.baihuayuan_ingredient_prices(s,'confirm',payload,req)=result,'confirm retry duplicated';
 assert (select cost_price from private.ingredient_masters where id=m)=.35,'confirmed quote not saved';
 assert (select manual from private.ingredient_masters where id=m),'confirmed standard not locked';
 assert (select count(*) from private.ingredient_supply_events where store_id=s)=2,'confirm rewrote sourcing history';
 -- Multiple aliases referencing the same quote must still yield one source.
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,reference_ids)
 values(s,m,'奶油另一別名','n:奶油另一別名','g',array[ref]);
 result:=public.baihuayuan_ingredient_prices(s,'read');
 assert jsonb_array_length(result->'ingredients'->0->'sources')=1,'duplicate source after aggregation';
 assert (result->'ingredients'->0->'sources'->0->>'supplier_key')='id:'||sb,'supplier identity changed';
 assert jsonb_array_length(result->'price_history')>0,'price history lost';
 -- A representative-size isolated catalog: all fixture rows are rolled back below.
 insert into private.ingredient_masters(store_id,name,unit,cost_price,manual,updated_by)
 select s,'規模測試'||lpad(i::text,4,'0'),'g',.25,true,owner_id from generate_series(1,1800) i;
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,reference_ids)
 select s,id,name,'n:'||name,'g',array[ref] from private.ingredient_masters where store_id=s and id<>m;
 started:=clock_timestamp();result:=public.baihuayuan_ingredient_prices(s,'read');
 assert extract(epoch from clock_timestamp()-started)<4,'catalog read exceeded four seconds';
 assert jsonb_array_length(result->'ingredients')=1801,'scale read lost ingredients';
 assert not exists(select 1 from jsonb_array_elements(result->'ingredients') x where jsonb_array_length(x->'sources')<>1),'scale read lost sources';
 assert (select jsonb_agg(x->>'id') from jsonb_array_elements(result->'ingredients') x)=(select jsonb_agg(x->>'id') from jsonb_array_elements(private.ingredient_catalog(s)->'ingredients') x),'catalog order changed';
 assert (select cost_price from private.ingredient_masters where id=m)=.35,'read changed saved price';
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_id,'role','authenticated')::text,true);
 denied:=false;begin perform public.baihuayuan_ingredient_prices(s,'read');exception when insufficient_privilege then denied:=true;end;assert denied,'outsider read allowed';
 denied:=false;begin perform public.baihuayuan_ingredient_prices(s,'stop',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'outsider write allowed';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.baihuayuan_ingredient_prices(s,'read');exception when insufficient_privilege then denied:=true;end;assert denied,'anonymous read allowed';
 raise exception 'SUPPLY_TEST_ROLLBACK' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;end;
end $test$;
