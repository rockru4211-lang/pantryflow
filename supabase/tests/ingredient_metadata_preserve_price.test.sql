-- Isolated rollback regression. Never use customer data as fixtures.
begin;
create function private.test_metadata_protected_digest() returns jsonb language plpgsql as $$
declare t text; h text; result jsonb:='{}';begin
 foreach t in array array['private.ingredient_standard_baselines','private.ingredient_standard_versions','private.recipe_cards','private.recipe_versions','private.recipe_cost_approvals','private.recipe_price_entries','private.receipt_entry_items','public.goods_receipts','public.receipt_lines'] loop
 execute format('select md5(coalesce(string_agg(to_jsonb(x)::text,'''' order by to_jsonb(x)::text),'''')) from %s x',t) into h;
 result:=result||jsonb_build_object(t,h);end loop;return result;end $$;
create function private.test_metadata_price_fields(i uuid) returns jsonb language sql as $$
 select jsonb_build_object('unit',unit,'cost_price',cost_price,'purchase',purchase,'selected_reference',selected_reference,'manual',manual,'review_status',review_status) from private.ingredient_masters where id=i
$$;
do $test$
<<metadata_test>>
declare actor uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();shop uuid:=gen_random_uuid();peer uuid:=gen_random_uuid();
 ref_id uuid:=gen_random_uuid();supplier1 uuid:=gen_random_uuid();supplier2 uuid:=gen_random_uuid();card uuid:=gen_random_uuid();
 ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];i uuid;idx integer;rev integer;req uuid;original_name text;
 before_quote jsonb;canonical_history jsonb;child_fields jsonb;root_id uuid:=gen_random_uuid();child_id uuid:=gen_random_uuid();payload jsonb;result jsonb;again jsonb;before_fields jsonb;before_history jsonb;bad_key text;bad jsonb;row_before jsonb;request_count bigint;version_count bigint;
begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@metadata-test.invalid',now() from unnest(array[actor,staff])id;
 insert into public.profiles(id,display_name) select id,'metadata fixture' from unnest(array[actor,staff])id on conflict do nothing;
 insert into public.organizations(id,name,business_type,store_mode) values(org,'metadata fixture','SINGLE_RESTAURANT','MULTI');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(shop,org,'BeApe','META'||upper(substr(shop::text,1,8)),actor),(peer,org,'Gras','META'||upper(substr(peer::text,1,8)),actor);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,actor,'OWNER',true,true),(org,staff,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'metadata fixture',actor from unnest(array[actor,staff])id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values
 (shop,org,actor,'meta-owner','OWNER','OWNER',actor,true),(peer,org,actor,'meta-owner-peer','OWNER','OWNER',actor,true),(shop,org,staff,'meta-staff','STAFF','STAFF',actor,false);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.suppliers(id,organization_id,name) values(supplier1,org,'Metadata supplier A'),(supplier2,org,'Metadata supplier B');
 insert into private.recipe_price_entries(id,store_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,purchase,source_ref)
 values(ref_id,shop,'Original source','g',.4,'fixture','2026-10-01',actor,'purchase','confirmed','{"amount":400,"quantity":1,"unit":"公斤"}',jsonb_build_object('supplier_id',supplier1,'supplier_name','Metadata supplier A'));
 perform set_config('app.standard_effective_date','2026-10-01',true);
 for idx in 1..4 loop
  insert into private.ingredient_masters(id,store_id,name,unit,cost_price,manual,review_status,purchase,selected_reference,category,updated_by)
  values(ids[idx],shop,'Metadata original '||idx,'g',case idx when 3 then null when 4 then 0 else .4 end,idx<>1,case when idx=3 then 'pending' else 'confirmed' end,
   case when idx=3 then null else jsonb_build_object('amount',case when idx=4 then 0 else 400 end,'quantity',1,'unit','公斤') end,
   case when idx in (1,2) then ref_id end,'食材',actor);
  insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,reference_ids) values(shop,ids[idx],'source '||idx,'metadata:'||idx,'g',array[ref_id]);
  insert into private.ingredient_price_choices(store_id,ingredient_id,supplier_id) values(shop,ids[idx],supplier1);
 end loop;
 insert into private.recipe_cards(id,store_id,document,updated_by) values(card,shop,jsonb_build_object('name','preserved recipe','kind','dish','yield',1,'unit','份','lines',jsonb_build_array(jsonb_build_object('id','x','ingredient_id',ids[1],'name','Metadata original 1','quantity',10,'unit','g'))),actor);
 insert into private.recipe_versions(recipe_id,revision,document,cost_snapshot,actor_id) select id,1,document,'{"total":4,"missing":0}',actor from private.recipe_cards where id=card;
 before_history:=private.test_metadata_protected_digest();
 for idx in 1..4 loop
  i:=ids[idx];original_name:='Metadata original '||idx;
  before_quote:=private.automatic_cost_quote(shop,null,null,'g','2026-11-01',i);
  before_fields:=private.test_metadata_price_fields(i);select revision into rev from private.ingredient_masters where id=i;
  req:=gen_random_uuid();payload:=jsonb_build_object('id',i,'revision',rev,'name','Metadata renamed '||idx,'category','調料','supplier_id',supplier2,'preserve_price',true);
  set local role authenticated;
  result:=public.baihuayuan_ingredient_prices(shop,'save',payload,req);
  again:=public.baihuayuan_ingredient_prices(shop,'save',payload,req);assert again=result,'same request replay differs';
  begin perform public.baihuayuan_ingredient_prices(shop,'save',payload||'{"name":"different"}',req);raise exception 'request payload conflict accepted';exception when unique_violation then null;end;
  begin perform public.baihuayuan_ingredient_prices(shop,'save',payload,gen_random_uuid());raise exception 'stale revision accepted';exception when serialization_failure then null;end;
  reset role;
  assert private.test_metadata_price_fields(i)=before_fields,'metadata changed price fields';
  assert private.automatic_cost_quote(shop,null,null,'g','2026-11-01',i)=before_quote,'noncollision quote/provenance changed';
  assert (select revision=rev+1 and name='Metadata renamed '||idx and category='調料' from private.ingredient_masters where id=i),'metadata/revision not saved';
  assert exists(select 1 from private.ingredient_aliases where ingredient_id=i and name=original_name and corrected),'old name alias missing';
  assert (select supplier_id=supplier2 from private.ingredient_price_choices where store_id=shop and ingredient_id=i),'supplier choice not saved';
  assert private.test_metadata_protected_digest()=before_history,'metadata mutated history/recipes/source evidence';
 end loop;
 -- Existing canonical trigger may detach children on root rename. That must
 -- not rewrite their price fields or any saved history/evidence.
 begin
  insert into private.ingredient_masters(id,store_id,name,unit,cost_price,manual,review_status,purchase,updated_by) values
  (root_id,shop,'Canonical grouping root','g',.4,true,'confirmed','{"amount":400,"quantity":1,"unit":"包","content_quantity":1000,"content_unit":"g"}',actor),
  (child_id,shop,'Canonical grouping child','g',.3,false,'confirmed','{"amount":300,"quantity":1,"unit":"包","content_quantity":1000,"content_unit":"g"}',actor);
  update private.ingredient_masters set canonical_ingredient_id=root_id where id=child_id;
  canonical_history:=private.test_metadata_protected_digest();child_fields:=private.test_metadata_price_fields(child_id);
  select revision into rev from private.ingredient_masters where id=root_id;
  set local role authenticated;
  result:=public.baihuayuan_ingredient_prices(shop,'save',jsonb_build_object('id',root_id,'revision',rev,'name','Canonical changed root','category','食材','supplier_id',supplier2,'preserve_price',true),gen_random_uuid());
  reset role;
  assert (select canonical_ingredient_id is null from private.ingredient_masters where id=child_id),'fixture did not exercise canonical detach';
  assert private.test_metadata_price_fields(child_id)=child_fields,'canonical detach rewrote child price';
  assert private.test_metadata_protected_digest()=canonical_history,'canonical rename rewrote protected history';
  raise exception using errcode='ZX003',message='rollback isolated canonical grouping scenario';
 exception when sqlstate 'ZX003' then null;end;
 -- Strict flag is not an alternate price-write API, even for null fields.
 i:=ids[1];select revision into rev from private.ingredient_masters where id=i;
 payload:=jsonb_build_object('id',i,'revision',rev,'name','Metadata renamed 1','category','調料','supplier_id',supplier2,'preserve_price',true);
 select to_jsonb(m) into row_before from private.ingredient_masters m where id=i;
 select count(*) into request_count from private.app_requests;
 foreach bad_key in array array['cost_price','unit','purchase','selected_reference','effective_date','change_reason','review_status','manual','unexpected'] loop
  bad:=payload||jsonb_build_object(bad_key,null);
  set local role authenticated;
  begin perform public.baihuayuan_ingredient_prices(shop,'save',bad,gen_random_uuid());raise exception 'forbidden price field accepted: %',bad_key;exception when invalid_parameter_value then null;end;
  reset role;
 end loop;
 foreach bad in array array['"true"'::jsonb,'null'::jsonb,'1'::jsonb,'{}'::jsonb,'[]'::jsonb] loop
  set local role authenticated;
  begin perform public.baihuayuan_ingredient_prices(shop,'save',jsonb_set(payload,'{preserve_price}',bad),gen_random_uuid());raise exception 'nonboolean preserve flag accepted';exception when invalid_parameter_value then assert sqlerrm='INVALID_PRESERVE_PRICE';end;
  reset role;
 end loop;
 set local role authenticated;
 begin perform public.baihuayuan_ingredient_prices(shop,'save',payload-'id'-'revision',gen_random_uuid());raise exception 'preserve create accepted';exception when invalid_parameter_value then null;end;
 begin perform public.baihuayuan_ingredient_prices(shop,'save',payload||jsonb_build_object('id',gen_random_uuid()),gen_random_uuid());raise exception 'unknown preserve id accepted';exception when insufficient_privilege or invalid_parameter_value then null;end;
 begin perform public.baihuayuan_ingredient_prices(peer,'save',payload,gen_random_uuid());raise exception 'cross-store preserve accepted';exception when insufficient_privilege then null;end;
 reset role;
 assert (select to_jsonb(m)=row_before from private.ingredient_masters m where id=i),'failed request changed ingredient';
 assert (select count(*)=request_count from private.app_requests),'failed request consumed token';
 -- Existing supply, VIEW, role and revoked-replay gates remain ahead of saves.
 insert into private.ingredient_supply_state(store_id,ingredient_id,supplier_key,stopped,updated_by) values(shop,i,'*',true,actor);
 set local role authenticated;
 begin perform public.baihuayuan_ingredient_prices(shop,'save',payload,gen_random_uuid());raise exception 'all-stopped save accepted';exception when invalid_parameter_value then assert sqlerrm='SUPPLY_STOPPED_REVIEW_REQUIRED';end;
 reset role;
 update private.ingredient_supply_state set supplier_key='id:'||supplier2 where store_id=shop and ingredient_id=i and supplier_key='*';
 set local role authenticated;
 begin perform public.baihuayuan_ingredient_prices(shop,'save',payload,gen_random_uuid());raise exception 'supplier-stopped save accepted';exception when invalid_parameter_value then assert sqlerrm='SUPPLY_STOPPED_REVIEW_REQUIRED';end;
 reset role;
 delete from private.ingredient_supply_state where store_id=shop and ingredient_id=i;
 update public.store_memberships set access_mode='VIEW' where store_id=shop and user_id=actor;
 set local role authenticated;
 begin perform public.baihuayuan_ingredient_prices(shop,'save',payload,gen_random_uuid());raise exception 'VIEW save accepted';exception when insufficient_privilege then null;end;
 reset role;
 update public.store_memberships set access_mode='EDIT' where store_id=shop and user_id=actor;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 set local role authenticated;
 begin perform public.baihuayuan_ingredient_prices(shop,'save',payload,gen_random_uuid());raise exception 'staff save accepted';exception when insufficient_privilege then null;end;
 reset role;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 update public.store_memberships set is_active=false where store_id=shop and user_id=actor;
 update public.organization_members set is_active=false where organization_id=org and user_id=actor;
 set local role authenticated;
 begin perform public.baihuayuan_ingredient_prices(shop,'save',jsonb_build_object('id',ids[4],'revision',1,'name','Metadata renamed 4','category','調料','supplier_id',supplier2,'preserve_price',true),req);raise exception 'revoked replay accepted';exception when insufficient_privilege then null;end;
 reset role;
 update public.organization_members set is_active=true where organization_id=org and user_id=actor;
 update public.store_memberships set is_active=true where store_id=shop and user_id=actor;
 assert private.test_metadata_protected_digest()=before_history,'denied edits mutated history/recipes/source evidence';
 -- Legacy explicit price save still captures its new dated standard normally.
 i:=ids[2];select revision into rev from private.ingredient_masters where id=i;
 select count(*) into version_count from private.ingredient_standard_versions where ingredient_id=i;
 set local role authenticated;
 result:=public.baihuayuan_ingredient_prices(shop,'save',jsonb_build_object('id',i,'revision',rev,'name','Metadata renamed 2','unit','g','cost_price',.8,'purchase',jsonb_build_object('amount',800,'quantity',1,'unit','公斤'),'effective_date','2026-11-01','change_reason','explicit baseline change','supplier_id',supplier2),gen_random_uuid());
 reset role;
 assert (select cost_price=.8 and manual and review_status='confirmed' from private.ingredient_masters where id=i),'legacy price save no longer changes cost';
 assert (select count(*)>version_count from private.ingredient_standard_versions where ingredient_id=i),'legacy save failed to capture standard';
 assert exists(select 1 from private.ingredient_standard_versions where ingredient_id=i and effective_date='2026-11-01' and (snapshot->>'cost_price')::numeric=.8),'legacy effective standard incorrect';
 assert not has_function_privilege('anon','public.baihuayuan_ingredient_prices(uuid,text,jsonb,uuid)','EXECUTE');
end $test$;
rollback;
