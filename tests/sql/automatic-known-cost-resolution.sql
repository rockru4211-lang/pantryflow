-- Synthetic fixtures always roll back; no real operation is mutated.
do $test$
declare owner_id uuid:=gen_random_uuid();outsider_id uuid:=gen_random_uuid();s uuid;dest uuid;data jsonb;result jsonb;m uuid;movement uuid;before_row jsonb;q jsonb;denied boolean;today date:=(now() at time zone 'Asia/Taipei')::date;code text:='AUTO'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
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

 insert into public.stores(organization_id,store_code,name,created_by) select organization_id,code||'B','Gras',owner_id from public.stores where id=s returning id into dest;
 result:=public.baihuayuan_ingredient_prices(s,'save',jsonb_build_object('name','法國唯一測試蘋果酒','unit','瓶','cost_price',125,'purchase','{"amount":125,"quantity":1,"unit":"瓶"}'::jsonb,'effective_date',today-2,'change_reason','fixture'),gen_random_uuid());m:=(result->>'id')::uuid;
 assert (private.resolved_cost_quote(s,null,'唯一測試蘋果酒','瓶',today)->>'price')::numeric=125,'unique short name missing';
 assert private.resolved_cost_quote(s,null,'唯一測試蘋果酒','瓶',today-3)->>'price' is null,'future standard leaked';
 assert private.resolved_cost_quote(s,null,'唯一測試蘋果酒','包',today)->>'price' is null,'guessed package conversion';
 result:=public.baihuayuan_ingredient_prices(s,'save',jsonb_build_object('name','另一款唯一測試蘋果酒','unit','瓶','cost_price',150,'purchase','{"amount":150,"quantity":1,"unit":"瓶"}'::jsonb,'effective_date',today-2,'change_reason','fixture'),gen_random_uuid());
 assert private.resolved_cost_quote(s,null,'唯一測試蘋果酒','瓶',today)->>'price' is null,'ambiguous short name guessed';
 insert into private.ingredient_supply_state(store_id,ingredient_id,supplier_key,stopped,updated_by) values(s,m,'*',true,owner_id);
 assert private.resolved_cost_quote(s,null,'法國唯一測試蘋果酒','瓶',today)->>'price' is null,'stopped price reused';
 result:=public.baihuayuan_ingredient_prices(s,'save',jsonb_build_object('name','測試包裝生菜 · 原表計價基準：450 元／1000 g','unit','g','cost_price',.45,'purchase','{"amount":450,"quantity":1,"unit":"公斤"}'::jsonb,'effective_date',today-2,'change_reason','fixture'),gen_random_uuid());
 assert private.resolved_cost_quote(s,null,'測試包裝生菜','包',today)->>'price' is null,'canonical name manufactured package size';
 insert into private.store_movements(organization_id,from_store_id,to_store_id,kind,name,quantity,unit,status,created_by,review_status,unit_price_snapshot,amount_snapshot,occurred_at)
 select organization_id,s,dest,'TRANSFER','已知歷史測試品',2,'公斤','COMPLETE',owner_id,'CONFIRMED',300,600,(today-2)::timestamptz from public.stores where id=s returning id into movement;
 select to_jsonb(t) into before_row from private.store_movements t where id=movement;
 q:=public.baihuayuan_cost_quotes(s,jsonb_build_array(jsonb_build_object('name','已知歷史測試品','unit','克','date',today)));
 assert (q->0->>'price')::numeric=.3,'known historical unit conversion missing';
 assert q=public.baihuayuan_cost_quotes(s,jsonb_build_array(jsonb_build_object('name','已知歷史測試品','unit','克','date',today))),'read not idempotent';
 assert (select to_jsonb(t)=before_row from private.store_movements t where id=movement),'history rewritten';
 assert private.resolved_cost_quote(s,null,'已知歷史測試品','克',today-3)->>'price' is null,'future history leaked';
 assert private.resolved_cost_quote(dest,null,'已知歷史測試品','克',today)->>'price' is null,'other store price leaked';
 insert into private.baihuayuan_record_flags(organization_id,store_id,entity_type,entity_id,state,updated_by) select organization_id,s,'TRANSFER',movement,'REMOVED',owner_id from public.stores where id=s;
 assert private.resolved_cost_quote(s,null,'已知歷史測試品','克',today)->>'price' is null,'removed history reused';
 update private.baihuayuan_record_flags set state='LIVE' where entity_id=movement;
 insert into private.store_movements(organization_id,from_store_id,to_store_id,kind,name,quantity,unit,status,created_by,review_status,unit_price_snapshot,amount_snapshot,occurred_at)
 select organization_id,s,dest,'TRANSFER','已知歷史測試品',2,'公斤','COMPLETE',owner_id,'CONFIRMED',400,800,(today-2)::timestamptz from public.stores where id=s;
 assert private.resolved_cost_quote(s,null,'已知歷史測試品','克',today)->>'price' is null,'conflicting same-date history guessed';
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_id,'role','authenticated')::text,true);
 denied:=false;begin perform public.baihuayuan_cost_quotes(s,'[]');exception when insufficient_privilege then denied:=true;end;assert denied,'outsider quote access';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.baihuayuan_cost_quotes(s,'[]');exception when insufficient_privilege then denied:=true;end;assert denied,'anonymous quote access';
 assert not has_function_privilege('authenticated','private.resolved_cost_quote(uuid,uuid,text,text,date)','EXECUTE'),'private helper exposed';
 raise exception 'KNOWN_COST_TEST_ROLLBACK' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;end;
end $test$;
