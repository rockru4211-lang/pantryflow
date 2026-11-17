-- All writes in these fixtures roll back.
do $test$
declare
 actor uuid:=gen_random_uuid();
 outsider uuid:=gen_random_uuid();
 shop uuid;
 organization uuid;
 supplier uuid;
 kept uuid:=gen_random_uuid();
 alternate uuid:=gen_random_uuid();
 child uuid:=gen_random_uuid();
 different uuid:=gen_random_uuid();
 request uuid:=gen_random_uuid();
 data jsonb;
 payload jsonb;
 result jsonb;
 versions jsonb;
begin
 begin
  insert into auth.users(id,email,email_confirmed_at)
  select id,id||'@merge-qa.invalid',now() from unnest(array[actor,outsider]) id;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  data:=public.owner_setup('business','{"organization_name":"品號合併測試","business_type":"SINGLE_RESTAURANT","store_mode":"MULTI"}',0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object(
   'store_name','BeApe','store_code','QA'||substr(replace(actor::text,'-',''),1,14),'staff_login_mode','NAME_OR_NICKNAME'
  ),(data->>'revision')::integer);
  data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
  data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);
  shop:=(data->>'store_id')::uuid;
  select organization_id into organization from public.stores where id=shop;
  insert into public.suppliers(organization_id,name) values(organization,'測試供應商') returning id into supplier;
  insert into private.ingredient_masters(id,store_id,name,unit,purchase,cost_price,review_status,category,manual) values
   (kept,shop,'測試蘭姆酒 750cc','罐','{"amount":250,"quantity":1,"unit":"罐"}',250,'confirmed','酒水',true),
   (alternate,shop,'測試蘭姆酒 750ml','ml','{"amount":260,"quantity":1,"unit":"罐","content_quantity":750,"content_unit":"ml"}',0.3467,'confirmed','酒水',true),
   (child,shop,'測試蘭姆酒原名','罐','{"amount":245,"quantity":1,"unit":"罐"}',245,'confirmed','酒水',true),
   (different,shop,'測試蘭姆酒 1L','罐','{"amount":300,"quantity":1,"unit":"罐"}',300,'confirmed','酒水',true);
  update private.ingredient_masters set canonical_ingredient_id=alternate where id=child;
  insert into private.ingredient_display_codes(ingredient_id,code) values(alternate,'F901003');
  select jsonb_agg(to_jsonb(v) order by id) into versions
  from private.ingredient_standard_versions v where store_id=shop;
  payload:=jsonb_build_object('id',kept,'revision',1,'receipt_name','測試蘭姆酒 750cc','supplier_key','id:'||supplier,
   'rows',jsonb_build_array(jsonb_build_object('id',alternate,'revision',1),jsonb_build_object('id',child,'revision',1)));

  set local role authenticated;
  begin
   perform public.baihuayuan_ingredient_prices(shop,'remove_duplicates',
    jsonb_set(payload,'{rows,1,revision}','0'),gen_random_uuid());
   raise exception 'Stale member accepted';
  exception when serialization_failure then null;end;
  begin
   perform public.baihuayuan_ingredient_prices(shop,'remove_duplicates',
    jsonb_set(payload,'{rows}',(payload->'rows')||jsonb_build_array(jsonb_build_object('id',different,'revision',1))),gen_random_uuid());
   raise exception 'Different package accepted';
  exception when invalid_parameter_value then
   assert sqlerrm='INVALID_INGREDIENT_DUPLICATE';
  end;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  begin
   perform public.baihuayuan_ingredient_prices(shop,'remove_duplicates',payload,request);
   raise exception 'Outsider changed ingredient codes';
  exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  reset role;
  assert (select canonical_ingredient_id is null and revision=1 from private.ingredient_masters where id=alternate);

  set local role authenticated;
  result:=public.baihuayuan_ingredient_prices(shop,'remove_duplicates',payload,request);
  assert result=jsonb_build_object('id',kept,'count',2),'The existing group was not attached';
  assert result=public.baihuayuan_ingredient_prices(shop,'remove_duplicates',payload,request),'Retry was not idempotent';
  begin
   perform public.baihuayuan_ingredient_prices(shop,'remove_duplicates',payload||'{"receipt_name":"其他名稱"}',request);
   raise exception 'Conflicting retry accepted';
  exception when unique_violation then null;end;
  data:=public.baihuayuan_ingredient_prices(shop);
  assert exists(select 1 from jsonb_array_elements(data->'ingredients') r
   where r->>'id'=alternate::text and r->>'original_display_code'='F901003'
     and r->>'canonical_ingredient_id'=kept::text),'Legacy display code missing';
  assert exists(select 1 from jsonb_array_elements(data->'ingredients') r
   where r->>'id'=kept::text and r#>>'{sheet_receipt_label,name}'='測試蘭姆酒 750cc'),'Kept display name missing';
  reset role;
  assert (select canonical_ingredient_id=kept and cost_price=245 from private.ingredient_masters where id=child);
  assert (select canonical_ingredient_id=kept and cost_price=0.3467 and name='測試蘭姆酒 750ml'
   from private.ingredient_masters where id=alternate);
  assert (select canonical_ingredient_id is null and revision=1 from private.ingredient_masters where id=different);
  assert (select jsonb_agg(to_jsonb(v) order by id) from private.ingredient_standard_versions v where store_id=shop) is not distinct from versions;
  assert not has_function_privilege('authenticated','private.remove_ingredient_sheet_duplicates(uuid,private.ingredient_masters,jsonb)','execute');
  raise exception using errcode='P0001',message='ROLLBACK_INGREDIENT_DUPLICATE_FIXTURES';
 exception when raise_exception then
  if sqlerrm<>'ROLLBACK_INGREDIENT_DUPLICATE_FIXTURES' then raise;end if;
 end;
end $test$;
