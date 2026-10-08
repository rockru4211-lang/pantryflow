-- Isolated rollback fixtures; requires both unified-pricing migrations.
-- Every fixture rolls back, including unexpected assertion failures.
do $test$
declare owner_id uuid:=gen_random_uuid();outsider_id uuid:=gen_random_uuid();s uuid;data jsonb;result jsonb;req uuid:=gen_random_uuid();payload jsonb;m uuid;product_id uuid;sheet_value jsonb;sheet_result jsonb;sheet_req uuid;rev int;ref uuid;denied boolean;d jsonb;token uuid:=gen_random_uuid();today date:=(now() at time zone 'Asia/Taipei')::date;code text:='STD'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
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

 payload:=jsonb_build_object('name','測試統一牛肉','unit','g','cost_price',.9,'purchase',jsonb_build_object('amount',900,'quantity',1,'unit','公斤'),'effective_date',today-1,'change_reason','基礎確認');
 result:=public.baihuayuan_ingredient_prices(s,'save',payload,req);m:=(result->>'id')::uuid;rev:=(result->>'revision')::int;
 assert public.baihuayuan_ingredient_prices(s,'save',payload,req)=result,'standard retry must be idempotent';
 assert (select count(*) from private.ingredient_standard_versions where store_id=s and ingredient_id=m)=1,'duplicate standard history';
 assert (private.cost_quote(s,null,'測試統一牛肉','克',today)->>'price')::numeric=.9,'kg conversion failed';
 assert (private.cost_quote(s,null,'測試統一牛肉','台斤',today)->>'price')::numeric=540,'Taiwan jin conversion failed';
 insert into private.recipe_price_entries(store_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,purchase)
 values(s,'測試統一牛肉','g',1.2,'已核對進貨',today,owner_id,'purchase','confirmed','{"amount":1200,"quantity":1,"unit":"公斤"}') returning id into ref;
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,reference_ids) values(s,m,'統一牛肉別名','n:統一牛肉別名','g',array[ref]);
 assert (private.cost_quote(s,null,'測試統一牛肉','克',today)->>'price')::numeric=.9,'new invoice silently overwrote standard';
 assert (select (x->>'price')::numeric from jsonb_array_elements(private.recipe_prices(s)) x where x->>'key'='i:'||m and x->>'unit'='g')=.9,'recipe silently adopted candidate';
 payload:=jsonb_build_object('id',m,'revision',rev,'reference_id',ref,'expected_price',1.2,'effective_date',today,'change_reason','供應商調價');req:=gen_random_uuid();
 result:=public.baihuayuan_ingredient_prices(s,'confirm',payload,req);
 assert public.baihuayuan_ingredient_prices(s,'confirm',payload,req)=result,'confirmation retry duplicated';
 assert (private.cost_quote(s,null,'測試統一牛肉','克',today)->>'price')::numeric=1.2,'confirmed standard missing';
 assert (private.cost_quote(s,null,'測試統一牛肉','克',today-1)->>'price')::numeric=.9,'prior effective price changed';
 assert private.cost_quote(s,null,'測試統一牛肉','ml',today)->>'price' is null,'weight converted to volume';
 -- Explicit incomplete package prices stay unpriced, including server writes.
 insert into public.products(organization_id,name,base_unit,count_unit)
 select organization_id,'測試統一牛肉','公斤','公斤' from public.stores where id=s returning id into product_id;
 sheet_value:=jsonb_build_object('name','測試統一牛肉','quantity','3','unit','克','price','','purchase_price','90','price_unit','瓶','content_quantity','','date',today,'reason','保存不當');
 sheet_req:=gen_random_uuid();
 sheet_result:=public.save_baihuayuan_sheet_row(s,'waste',null,sheet_value,'{}',sheet_req);
 assert sheet_result=public.save_baihuayuan_sheet_row(s,'waste',null,sheet_value,'{}',sheet_req),'sheet retry duplicated';
 assert (select unit_price is null and amount is null from private.waste_reviews where waste_id=(sheet_result->>'id')::uuid),'incomplete package was auto priced';
 sheet_value:=sheet_value||jsonb_build_object('price','0.333333','purchase_price','333.333','price_unit','公斤');
 sheet_result:=public.save_baihuayuan_sheet_row(s,'waste',null,sheet_value,'{}',gen_random_uuid());
 assert (select amount=1 from private.waste_reviews where waste_id=(sheet_result->>'id')::uuid),'saved waste amount not cents rounded';
 d:=public.baihuayuan_sheet_draft(s,'waste','2026-10','save','[{"id":"fixture","values":{"price":"","unit":"克"}}]',null,token);
 assert public.baihuayuan_sheet_draft(s,'waste','2026-10','read')=d,'cross-device read mismatch';
 assert public.baihuayuan_sheet_draft(s,'waste','2026-10','save','[{"id":"fixture","values":{"price":"","unit":"克"}}]',null,token)=d,'draft retry not idempotent';
 denied:=false;begin perform public.baihuayuan_sheet_draft(s,'waste','2026-10','save','[]',null,gen_random_uuid());exception when others then if sqlerrm='DRAFT_CHANGED' then denied:=true;else raise;end if;end;assert denied,'stale device overwrote draft';
 assert public.baihuayuan_sheet_draft(s,'transfer','2026-10','read') is null,'draft leaked across modules';
 assert public.baihuayuan_sheet_draft(s,'waste','2026-09','read') is null,'draft leaked across months';
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_id,'role','authenticated')::text,true);
 denied:=false;begin perform public.baihuayuan_sheet_draft(s,'waste','2026-10','read');exception when insufficient_privilege then denied:=true;end;assert denied,'outsider read allowed';
 denied:=false;begin perform public.save_baihuayuan_sheet_row(s,'waste',null,sheet_value,'{}',sheet_req);exception when insufficient_privilege then denied:=true;end;assert denied,'outsider sheet retry allowed';
 denied:=false;begin perform public.baihuayuan_ingredient_prices(s,'save',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'outsider changed standard';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.baihuayuan_sheet_draft(s,'waste','2026-10','read');exception when insufficient_privilege then denied:=true;end;assert denied,'anonymous read allowed';
 raise exception 'STANDARD_TEST_ROLLBACK' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;end;
end $test$;
