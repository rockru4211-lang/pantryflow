begin;
select '1..1';
do $test$
#variable_conflict use_variable
declare
 actor uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); admin_user uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 data jsonb; org uuid; store_id uuid; other_store uuid; current_session uuid; next_session uuid;
 ham uuid; milk uuid; chicken uuid; unclassified uuid; cold uuid; frozen uuid; ambient uuid; other_zone uuid;
 stamp timestamptz; prior_stamp timestamptz; count_actor uuid; request_id uuid:=gen_random_uuid();
 result jsonb; replay jsonb; payload jsonb; before_snapshot jsonb; after_snapshot jsonb; before_prices jsonb; before_openings jsonb;
 before_other jsonb; before_entries jsonb; before_result jsonb; before_details jsonb; old_zone_version timestamptz;
 selected_session uuid; selected_source uuid; selected_target uuid;
 note_text text:='本期用完，下期可移除。';
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
 select id,id||'@inline-count.invalid',now(),now(),now() from unnest(array[actor,staff,admin_user,outsider]) id;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business','{"organization_name":"行內盤點測試","business_type":"SINGLE_RESTAURANT","store_mode":"MULTI"}',0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','測試門市','store_code','IN'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),(data->>'revision')::int);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);
 store_id:=(data->>'store_id')::uuid; org:=(data->>'organization_id')::uuid;
 insert into public.organization_members(organization_id,user_id,role) values(org,staff,'STAFF'),(org,admin_user,'LOGISTICS');
 insert into public.staff_identities(organization_id,user_id,display_name,created_by)
 values(org,staff,'盤點員工',actor),(org,admin_user,'行政',actor);
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by)
 values(store_id,org,staff,'inline-staff','STAFF','STAFF',actor),(store_id,org,admin_user,'inline-admin','LOGISTICS','LOGISTICS',actor);
 other_store:=(public.app_operation(store_id,'store.create','{"name":"另一門市"}',gen_random_uuid())->>'id')::uuid;
 result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',jsonb_build_object(
   'original_filename','盤點.xlsx','file_sha256',repeat('a',64),'storage_path',org||'/'||store_id||'/inline.xlsx','sheet_names','["盤點"]'::jsonb),
   'rows','[{"source_id":"ham","name":"伊比利火腿","product_code":"HAM","count_unit":"包","unit_price":100,"opening_quantity":0},
   {"source_id":"milk","name":"鮮奶","product_code":"MILK","count_unit":"瓶","unit_price":10,"opening_quantity":3},
   {"source_id":"chicken","name":"雞胸肉","product_code":"CHICKEN","count_unit":"包","unit_price":50,"opening_quantity":2}]'::jsonb));
 assert not exists(select 1 from jsonb_array_elements(result) r where r->>'status'='FAILED'),result::text;
 ham:=(result->0->>'product_id')::uuid; milk:=(result->1->>'product_id')::uuid; chicken:=(result->2->>'product_id')::uuid;
 select id into unclassified from public.count_zones where count_zones.store_id=store_id and name='未分類';
 other_zone:=public.create_pilot_zone(other_store,'另一店冷藏');
 perform public.assign_pilot_product_to_zone(other_zone,ham);
 select jsonb_agg(to_jsonb(zp)) into before_other from public.zone_products zp where zp.zone_id=other_zone;

 -- Staff can begin area setup, without gaining catalogue editing or management.
 perform set_config('request.jwt.claim.sub',staff::text,true);
 result:=public.app_operation(store_id,'count.ensure-zones','{}',gen_random_uuid());
 assert (select count(*) from public.count_zones z where z.store_id=store_id and z.is_active and z.name<>'未分類')=3,'three defaults on first use';
 perform public.app_operation(store_id,'count.ensure-zones','{}',gen_random_uuid());
 assert (select count(*) from public.count_zones z where z.store_id=store_id and z.is_active)=4,'defaults are idempotent';
 select id into cold from public.count_zones z where z.store_id=store_id and z.name='冷藏區';
 select id into frozen from public.count_zones z where z.store_id=store_id and z.name='冷凍區';
 select id into ambient from public.count_zones z where z.store_id=store_id and z.name='常溫區';
 result:=public.app_operation(store_id,'count.zone-create','{"name":"吧台冰箱"}',request_id);
 assert public.app_operation(store_id,'count.zone-create','{"name":"吧台冰箱"}',request_id)=result,'create retry returns same area';
 assert public.app_operation(store_id,'count.zone-create','{"name":" 吧台冰箱 "}',gen_random_uuid())->>'id'=result->>'id','normalized create is idempotent';
 begin
   perform public.app_operation(store_id,'count.zone-create','{"name":"未分類"}',gen_random_uuid());
   raise exception 'reserved unclassified accepted';
 exception when sqlstate '22023' then assert sqlerrm='UNCLASSIFIED_ZONE_RESERVED'; end;
 begin
   perform public.app_operation(store_id,'count.zone-create',jsonb_build_object('name',repeat('甲',81)),gen_random_uuid());
   raise exception 'long zone accepted';
 exception when sqlstate '22023' then assert sqlerrm='ZONE_NAME_REQUIRED'; end;
 begin
   perform public.app_operation(store_id,'count.catalog-edit',jsonb_build_object('id',ham,'name','火腿','unit','包','unit_price',1,'updated_at',(select updated_at from public.products where id=ham)),gen_random_uuid());
   raise exception 'staff edited catalogue';
 exception when insufficient_privilege then null; end;
 begin
   perform public.app_operation(store_id,'count.zone-rename',jsonb_build_object('id',cold,'name','staff rename','updated_at',(select updated_at from public.count_zones where id=cold)),gen_random_uuid());
   raise exception 'staff renamed manager configuration';
 exception when insufficient_privilege then null; end;
 begin
   perform public.app_operation(other_store,'count.ensure-zones','{}',gen_random_uuid());
   raise exception 'staff created areas in another store';
 exception when insufficient_privilege then null; end;

 -- Independent backoffice can edit basics and prices, as agreed for this role.
 perform set_config('request.jwt.claim.sub',admin_user::text,true);
 result:=public.app_operation(store_id,'count.catalog-edit',jsonb_build_object('id',ham,'name','伊比利火腿','unit','包','unit_price',100,'updated_at',(select updated_at from public.products where id=ham)),gen_random_uuid());
 assert result->>'unit_price'='100','administration can edit unit price';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 current_session:=public.start_pilot_count(store_id,null);
 assert (select count(*) from public.count_zone_progress where session_id=current_session)=1,'empty defaults do not block completion';

 -- Note-only work survives preparation without pretending a quantity was counted.
 perform set_config('request.jwt.claim.sub',staff::text,true);
 result:=public.save_pilot_count_drafts(current_session,jsonb_build_array(jsonb_build_object('zone_id',unclassified,'product_id',ham,'note',note_text,'expected_updated_at',null)));
 stamp:=(result->0->>'updated_at')::timestamptz;
 assert (select quantity is null and observation_state='BLANK' from public.count_drafts where session_id=current_session and product_id=ham),'a note is not a count';
 assert private.count_has_work(current_session),'note-only protects current work';
 select snapshot into before_snapshot from public.inventory_count_sessions where id=current_session;
 select jsonb_agg(to_jsonb(x) order by x.product_id) into before_prices from private.count_price_snapshots x where session_id=current_session;
 select jsonb_agg(to_jsonb(x) order by x.product_id) into before_openings from private.count_opening_snapshots x where session_id=current_session;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform public.app_operation(store_id,'count.prepare','{}',gen_random_uuid());
 begin
   perform public.set_pilot_count_next_period(store_id,ham,'EXCLUDE_CURRENT');
   raise exception 'legacy exclusion discarded note-only draft';
 exception when sqlstate '22023' then assert sqlerrm='PRODUCT_ALREADY_COUNTED'; end;
 assert (select note=note_text and updated_at=stamp from public.count_drafts where session_id=current_session and product_id=ham),'prepare preserves note-only draft and version';
 assert (select snapshot=before_snapshot from public.inventory_count_sessions where id=current_session),'prepare preserves work snapshot';
 perform set_config('request.jwt.claim.sub',staff::text,true);
 prior_stamp:=stamp;
 stamp:=public.save_pilot_count_draft(current_session,unclassified,ham,0,stamp);
 assert stamp>prior_stamp,'zero is counted and version advances';
 assert (select note=note_text and entered_by=staff from public.count_drafts where session_id=current_session and product_id=ham),'legacy quantity save preserves note';
 begin
   perform public.save_pilot_count_drafts(current_session,jsonb_build_array(jsonb_build_object('zone_id',unclassified,'product_id',ham,'quantity',0,'note','覆寫別人的備註','expected_updated_at',prior_stamp)));
   raise exception 'stale note silently overwrote';
 exception when serialization_failure then assert sqlerrm='COUNT_DRAFT_CHANGED'; end;
 begin
   perform public.save_pilot_count_drafts(current_session,jsonb_build_array(jsonb_build_object('zone_id',unclassified,'product_id',ham,'note',repeat('甲',2001),'expected_updated_at',stamp)));
   raise exception 'long note accepted';
 exception when sqlstate '22023' then assert sqlerrm='COUNT_NOTE_TOO_LONG'; end;
 -- A colleague's memo change preserves who entered the unchanged count.
 perform set_config('request.jwt.claim.sub',admin_user::text,true);
 result:=public.save_pilot_count_drafts(current_session,jsonb_build_array(jsonb_build_object('zone_id',unclassified,'product_id',ham,'quantity',0,'note','行政已收到，待確認。','expected_updated_at',stamp)));
 prior_stamp:=stamp;stamp:=(result->0->>'updated_at')::timestamptz;
 assert (select entered_by=staff from public.count_drafts where session_id=current_session and product_id=ham),'note edit preserves count actor';
 assert public.save_pilot_count_drafts(current_session,jsonb_build_array(jsonb_build_object('zone_id',unclassified,'product_id',ham,'quantity',0,'note','行政已收到，待確認。','expected_updated_at',prior_stamp)))=result,'identical lost-response note retry acknowledged';
 result:=public.save_pilot_count_drafts(current_session,jsonb_build_array(jsonb_build_object('zone_id',unclassified,'product_id',ham,'note',note_text,'expected_updated_at',stamp)));
 stamp:=(result->0->>'updated_at')::timestamptz;
 assert (select quantity=0 from public.count_drafts where session_id=current_session and product_id=ham),'note-only edit retains zero';

 perform set_config('request.jwt.claim.sub',staff::text,true);
 payload:=jsonb_build_object('session_id',current_session,'product_id',ham,'source_zone_id',unclassified,'target_zone_id',cold,'expected_updated_at',stamp);
 begin
   perform public.app_operation(store_id,'count.assign-zone',payload||jsonb_build_object('expected_updated_at',prior_stamp),gen_random_uuid());
   raise exception 'stale move accepted';
 exception when serialization_failure then assert sqlerrm='COUNT_DRAFT_CHANGED'; end;
 begin
   perform public.app_operation(store_id,'count.assign-zone',payload||jsonb_build_object('target_zone_id',other_zone),gen_random_uuid());
   raise exception 'cross-store move accepted';
 exception when insufficient_privilege then assert sqlerrm='ZONE_NOT_IN_STORE'; end;
 request_id:=gen_random_uuid();
 result:=public.app_operation(store_id,'count.assign-zone',payload,request_id);
 assert (result->>'quantity')::numeric=0 and result->>'note'=note_text,'move preserves zero and note: '||result::text;
 assert (result->>'updated_at')::timestamptz>stamp,'move returns a fresh draft version';
 assert public.app_operation(store_id,'count.assign-zone',payload,request_id)=result,'move retry is idempotent';
 assert (select count(*) from public.count_drafts where session_id=current_session and product_id=ham)=1,'move cannot duplicate draft';
 assert (select quantity=0 and note=note_text and entered_by=staff and unit='包' from public.count_drafts where session_id=current_session and product_id=ham and zone_id=cold),'draft attribution and unit preserved';
 assert (select jsonb_agg(to_jsonb(zp)) from public.zone_products zp where zp.zone_id=other_zone)=before_other,'other store configuration unchanged';
 assert (select jsonb_agg(to_jsonb(x) order by x.product_id) from private.count_price_snapshots x where session_id=current_session)=before_prices,'prices unchanged by move';
 assert (select jsonb_agg(to_jsonb(x) order by x.product_id) from private.count_opening_snapshots x where session_id=current_session)=before_openings,'opening quantities unchanged by move';
 select snapshot into after_snapshot from public.inventory_count_sessions where id=current_session;
 assert (select i-'zone_id'-'zone_name' from jsonb_array_elements(after_snapshot->'zones') i where i->>'product_id'=ham::text)
   =(select i-'zone_id'-'zone_name' from jsonb_array_elements(before_snapshot->'zones') i where i->>'product_id'=ham::text),'original source metadata stays intact';
 assert (select jsonb_agg(i) from jsonb_array_elements(after_snapshot->'zones') i where i->>'product_id'<>ham::text)
   =(select jsonb_agg(i) from jsonb_array_elements(before_snapshot->'zones') i where i->>'product_id'<>ham::text),'other cards unchanged';
 begin
   perform public.app_operation(store_id,'count.assign-zone',payload||jsonb_build_object('source_zone_id',cold,'target_zone_id',frozen,'expected_updated_at',result->'updated_at'),gen_random_uuid());
   raise exception 'general destructive reassignment accepted';
 exception when sqlstate '22023' then assert sqlerrm='UNCLASSIFIED_SOURCE_REQUIRED'; end;
 begin
   perform public.save_pilot_count_draft(current_session,unclassified,ham,2,(result->>'updated_at')::timestamptz);
   raise exception 'old source save accepted';
 exception when insufficient_privilege then assert sqlerrm='PRODUCT_NOT_IN_COUNT'; end;
 perform public.complete_pilot_count_zone(current_session,cold);
 perform public.complete_pilot_count_zone(current_session,cold);
 assert (select count(*) from public.count_entries where session_id=current_session and product_id=ham)=1,'completion retry is immutable and idempotent';
 assert (select note=note_text and quantity=0 from public.count_entries where session_id=current_session and product_id=ham),'completion carries note';
 begin
   perform public.app_operation(store_id,'count.assign-zone',jsonb_build_object('session_id',current_session,'product_id',milk,'source_zone_id',unclassified,'target_zone_id',cold,'expected_updated_at',null),gen_random_uuid());
   raise exception 'completed target reopened';
 exception when sqlstate '22023' then assert sqlerrm='COUNT_ZONE_NOT_AVAILABLE'; end;

 -- General configuration remains locked, but a name-only change is safe.
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
   perform public.set_pilot_count_next_period(store_id,ham,'EXCLUDE_CURRENT');
   raise exception 'legacy exclusion discarded completed card snapshot';
 exception when sqlstate '22023' then assert sqlerrm='PRODUCT_ALREADY_COUNTED'; end;
 begin
   perform public.save_pilot_zone_configuration_v2(frozen,'冷凍區',array[milk],'{}',false);
   raise exception 'general configuration unlocked by inline move feature';
 exception when sqlstate '22023' then assert sqlerrm='COUNT_IN_PROGRESS'; end;
 select updated_at into old_zone_version from public.count_zones where id=cold;
 result:=public.app_operation(store_id,'count.zone-rename',jsonb_build_object('id',cold,'name','內場冰箱','updated_at',old_zone_version),gen_random_uuid());
 assert (result->>'updated_at')::timestamptz>old_zone_version,'rename version advances';
 assert (select snapshot=after_snapshot from public.inventory_count_sessions where id=current_session),'rename does not rewrite existing snapshot';
 begin
   perform public.app_operation(store_id,'count.zone-rename',jsonb_build_object('id',cold,'name','舊版本改名','updated_at',old_zone_version),gen_random_uuid());
   raise exception 'stale rename accepted';
 exception when serialization_failure then assert sqlerrm='ZONE_CONFIGURATION_CHANGED'; end;

 perform set_config('request.jwt.claim.sub',staff::text,true);
 stamp:=public.save_pilot_count_draft(current_session,unclassified,milk,3,null);
 result:=public.app_operation(store_id,'count.assign-zone',jsonb_build_object('session_id',current_session,'product_id',milk,'source_zone_id',unclassified,'target_zone_id',frozen,'expected_updated_at',stamp),gen_random_uuid());
 result:=public.app_operation(store_id,'count.assign-zone',jsonb_build_object('session_id',current_session,'product_id',chicken,'source_zone_id',unclassified,'target_zone_id',ambient,'expected_updated_at',null),gen_random_uuid());
 assert result->>'updated_at' is null and result->>'quantity' is null,'unentered move stays unentered';
 assert not exists(select 1 from public.count_zone_progress where session_id=current_session and zone_id=unclassified),'last move removes empty source progress';
 begin
   perform public.complete_pilot_count_zone(current_session,ambient);
   raise exception 'blank moved item counted as zero';
 exception when sqlstate '22023' then assert sqlerrm='COUNT_ZONE_INCOMPLETE'; end;
 perform public.save_pilot_count_drafts(current_session,jsonb_build_array(jsonb_build_object('zone_id',ambient,'product_id',chicken,'quantity',2,'note','實盤確認','expected_updated_at',null)));
 perform public.complete_pilot_count_zone(current_session,frozen);
 perform public.complete_pilot_count_zone(current_session,ambient);
 assert (select status='CLOSED' from public.inventory_count_sessions where id=current_session),'default empty areas cannot prevent closing';
 assert (select is_active from public.products where id=ham),'note and zero never deactivate item';
 assert not exists(select 1 from private.count_catalog_removed where count_catalog_removed.store_id=store_id and product_id=ham),'note never removes item';
 before_result:=public.get_pilot_count_results(current_session);
 assert exists(select 1 from jsonb_array_elements(before_result) r where r->>'product_id'=ham::text and r->>'note'=note_text),'result contains saved note';
 assert not exists(select 1 from jsonb_array_elements(before_result) r where r ? 'unit_price' or r ? 'amount' or r ? 'opening_quantity'),'staff result remains blind';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 before_details:=public.get_pilot_count_details(current_session);
 assert exists(select 1 from jsonb_array_elements(before_details) r where r->>'product_id'=ham::text and r->>'note'=note_text and r->>'zone'='冷藏區'),'details keep entry note and original area name';
 assert (select sum((r->>'amount')::numeric) from jsonb_array_elements(before_details) r)=130,'valuation remains quantity multiplied by captured price';
 select jsonb_agg(to_jsonb(e) order by e.id) into before_entries from public.count_entries e where session_id=current_session;
 next_session:=public.start_pilot_count(store_id,null);
 assert next_session<>current_session,'next count starts';
 assert (select snapshot->'zones' @> jsonb_build_array(jsonb_build_object('zone_id',cold,'zone_name','內場冰箱','product_id',ham)) from public.inventory_count_sessions where id=next_session),'next count retains assigned area and new name';
 assert not exists(select 1 from public.count_drafts where session_id=next_session),'notes belong to the original count';
 assert public.get_pilot_count_details(current_session)=before_details,'next count cannot alter historical details';
 assert public.get_pilot_count_results(current_session)=before_result,'next count cannot alter historical results';
 assert (select jsonb_agg(to_jsonb(e) order by e.id) from public.count_entries e where session_id=current_session)=before_entries,'historical entries unchanged';

 -- An explicitly selected, still-empty count can be organized before typing.
 -- Its selection must move too, or a later prepare would silently drop the item.
 perform public.app_operation(other_store,'count.ensure-zones','{}',gen_random_uuid());
 assert (select count(*) from public.count_zones z where z.store_id=other_store)=1,'custom areas suppress default seeding';
 selected_source:=public.create_pilot_zone(other_store,'未分類');
 selected_target:=(public.app_operation(other_store,'count.zone-create','{"name":"指定儲物區"}',gen_random_uuid())->>'id')::uuid;
 perform public.assign_pilot_product_to_zone(selected_source,ham);
 selected_session:=public.start_pilot_count(other_store,jsonb_build_array(jsonb_build_object('zone_id',selected_source,'product_id',ham)));
 begin
   perform public.app_operation(other_store,'count.assign-zone',jsonb_build_object('session_id',selected_session,'source_zone_id',selected_source,'target_zone_id',other_zone,'product_id',ham,'expected_updated_at',null),gen_random_uuid());
   raise exception 'existing target silently merged';
 exception when sqlstate '22023' then assert sqlerrm='COUNT_TARGET_ALREADY_HAS_PRODUCT'; end;
 perform public.app_operation(other_store,'count.assign-zone',jsonb_build_object('session_id',selected_session,'source_zone_id',selected_source,'target_zone_id',selected_target,'product_id',ham,'expected_updated_at',null),gen_random_uuid());
 perform public.app_operation(other_store,'count.prepare','{}',gen_random_uuid());
 assert (select jsonb_array_length(snapshot->'zones')=1 and snapshot->'selection' @> jsonb_build_array(jsonb_build_object('zone_id',selected_target,'product_id',ham)) from public.inventory_count_sessions where id=selected_session),'selected blank card survives prepare in new area';
 assert not exists(select 1 from public.count_zone_progress where session_id=selected_session and zone_id=selected_source),'empty source does not return after prepare';

 -- Cache replay must reauthorize current membership, not only recognize a UUID.
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin
   perform public.app_operation(store_id,'count.assign-zone',payload,request_id);
   raise exception 'outsider replay accepted';
 exception when insufficient_privilege then null; end;
 begin
   perform public.save_pilot_count_drafts(next_session,'[]');
   raise exception 'outsider batch accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 update public.store_memberships set is_active=false where store_memberships.store_id=store_id and user_id=staff;
 begin
   perform public.app_operation(store_id,'count.assign-zone',payload,request_id);
   raise exception 'revoked staff replay accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
   perform public.app_operation(store_id,'count.ensure-zones','{}',gen_random_uuid());
   raise exception 'anonymous defaults accepted';
 exception when insufficient_privilege then null; end;
 assert not has_function_privilege('authenticated','private.count_inline_operation(uuid,text,jsonb)','EXECUTE'),'private dispatcher helper is not an API';
 assert not has_function_privilege('authenticated','private.save_count_card(uuid,jsonb)','EXECUTE'),'private draft helper is not an API';
 assert not has_function_privilege('anon','public.save_pilot_count_drafts(uuid,jsonb)','EXECUTE'),'anonymous saves are revoked';
 assert not has_table_privilege('authenticated','public.count_drafts','UPDATE'),'direct writes remain prohibited';
end $test$;
select 'ok 1 - inline areas and notes preserve counting, history, scope and authorization';
rollback;
