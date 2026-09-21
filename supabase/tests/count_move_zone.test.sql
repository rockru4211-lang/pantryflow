begin;
select '1..1';
do $test$
#variable_conflict use_variable
declare
 owner_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
 org uuid; store_id uuid; other_store uuid; ham uuid; milk uuid; blank_item uuid;
 cold uuid; frozen uuid; ambient uuid; unclassified uuid; other_zone uuid; other_target uuid;
 history_session uuid; current_session uuid; next_session uuid; selected_session uuid;
 data jsonb; result jsonb; saved jsonb; payload jsonb; cached_result jsonb; request_id uuid:=gen_random_uuid(); item jsonb;
 before_draft jsonb; before_snapshot jsonb; before_prices jsonb; before_openings jsonb; before_other jsonb;
 historical_snapshot jsonb; historical_entries jsonb; historical_details jsonb; before_progress jsonb;
 stamp timestamptz; prior_stamp timestamptz; zone uuid;
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
 select id,id||'@count-move.invalid',now(),now(),now() from unnest(array[owner_id,staff_id,admin_id,stranger]) id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business','{"organization_name":"更正區域測試","business_type":"SINGLE_RESTAURANT","store_mode":"MULTI"}',0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','測試門市','store_code','MV'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),(data->>'revision')::int);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);
 store_id:=(data->>'store_id')::uuid; org:=(data->>'organization_id')::uuid;
 insert into public.organization_members(organization_id,user_id,role) values(org,staff_id,'STAFF'),(org,admin_id,'LOGISTICS');
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,staff_id,'員工',owner_id),(org,admin_id,'行政',owner_id);
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by)
 values(store_id,org,staff_id,'move-staff','STAFF','STAFF',owner_id),(store_id,org,admin_id,'move-admin','LOGISTICS','LOGISTICS',owner_id);
 other_store:=(public.app_operation(store_id,'store.create','{"name":"另店"}',gen_random_uuid())->>'id')::uuid;
 result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',jsonb_build_object('original_filename','盤點.xlsx','file_sha256',repeat('c',64),'storage_path',org||'/'||store_id||'/move.xlsx','sheet_names','["盤點"]'::jsonb),
 'rows','[{"source_id":"ham","name":"伊比利火腿","product_code":"HAM","count_unit":"包","unit_price":100,"opening_quantity":0},
 {"source_id":"milk","name":"鮮奶","product_code":"MILK","count_unit":"瓶","unit_price":10,"opening_quantity":4},
 {"source_id":"blank","name":"雞胸肉","product_code":"CHICKEN","count_unit":"包","unit_price":20,"opening_quantity":2}]'::jsonb));
 assert not exists(select 1 from jsonb_array_elements(result) r where r->>'status'='FAILED'),result::text;
 ham:=(result->0->>'product_id')::uuid;milk:=(result->1->>'product_id')::uuid;blank_item:=(result->2->>'product_id')::uuid;
 select id into unclassified from public.count_zones z where z.store_id=store_id and z.name='未分類';
 cold:=public.create_pilot_zone(store_id,'冷藏區');frozen:=public.create_pilot_zone(store_id,'冷凍區');ambient:=public.create_pilot_zone(store_id,'常溫區');
 -- Synthetic fixture begins with named-area configuration, including a real
 -- multi-area product. User data is never used to construct this scenario.
 perform public.assign_pilot_product_to_zone(cold,ham);perform public.assign_pilot_product_to_zone(cold,blank_item);
 perform public.assign_pilot_product_to_zone(frozen,milk);perform public.assign_pilot_product_to_zone(ambient,milk);
 delete from public.zone_products where zone_id=unclassified;
 other_zone:=public.create_pilot_zone(other_store,'另一店冷藏');
 perform public.assign_pilot_product_to_zone(other_zone,ham);
 select jsonb_agg(to_jsonb(zp)) into before_other from public.zone_products zp where zp.zone_id=other_zone;

 history_session:=public.start_pilot_count(store_id,null);
 for item in select value from public.inventory_count_sessions s,jsonb_array_elements(s.snapshot->'zones') where s.id=history_session loop
   perform public.save_pilot_count_draft(history_session,(item->>'zone_id')::uuid,(item->>'product_id')::uuid,0,null);
 end loop;
 foreach zone in array array[cold,frozen,ambient] loop perform public.complete_pilot_count_zone(history_session,zone);end loop;
 select snapshot into historical_snapshot from public.inventory_count_sessions where id=history_session;
 select jsonb_agg(to_jsonb(e) order by e.id) into historical_entries from public.count_entries e where session_id=history_session;
 historical_details:=public.get_pilot_count_details(history_session);
 current_session:=public.start_pilot_count(store_id,null);
 assert current_session<>history_session,'new count starts after prior completion';
 select snapshot into before_snapshot from public.inventory_count_sessions where id=current_session;
 select jsonb_agg(to_jsonb(x) order by x.product_id) into before_prices from private.count_price_snapshots x where session_id=current_session;
 select jsonb_agg(to_jsonb(x) order by x.product_id) into before_openings from private.count_opening_snapshots x where session_id=current_session;

 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 saved:=public.save_pilot_count_drafts(current_session,jsonb_build_array(jsonb_build_object('zone_id',cold,'product_id',ham,'quantity',0,'note','本期用完，下期可移除。','expected_updated_at',null),
 jsonb_build_object('zone_id',frozen,'product_id',milk,'quantity',3,'note','本區三瓶','expected_updated_at',null),jsonb_build_object('zone_id',ambient,'product_id',milk,'quantity',1,'expected_updated_at',null)));
 stamp:=(saved->0->>'updated_at')::timestamptz;
 select to_jsonb(d) into before_draft from public.count_drafts d where session_id=current_session and zone_id=cold and product_id=ham;
 select to_jsonb(p) into before_progress from public.count_zone_progress p where session_id=current_session and zone_id=frozen;
 payload:=jsonb_build_object('session_id',current_session,'product_id',ham,'source_zone_id',cold,'target_zone_id',frozen,'expected_updated_at',stamp);
 begin
   perform public.app_operation(store_id,'count.assign-zone',payload,gen_random_uuid());raise exception 'old assign accepted named source';
 exception when sqlstate '22023' then assert sqlerrm='UNCLASSIFIED_SOURCE_REQUIRED';end;
 begin
   perform public.app_operation(store_id,'count.move-zone',payload||jsonb_build_object('target_zone_id',cold),gen_random_uuid());raise exception 'same area accepted';
 exception when sqlstate '22023' then assert sqlerrm='INVALID_COUNT_ZONE_DESTINATION';end;
 begin
   perform public.app_operation(store_id,'count.move-zone',payload||jsonb_build_object('target_zone_id',unclassified),gen_random_uuid());raise exception 'unclassified target accepted';
 exception when sqlstate '22023' then assert sqlerrm='INVALID_COUNT_ZONE_DESTINATION';end;
 begin
   perform public.app_operation(store_id,'count.move-zone',payload||jsonb_build_object('target_zone_id',other_zone),gen_random_uuid());raise exception 'foreign target accepted';
 exception when insufficient_privilege then assert sqlerrm='ZONE_NOT_IN_STORE';end;
 begin
   perform public.app_operation(store_id,'count.move-zone',payload||jsonb_build_object('source_zone_id',other_zone),gen_random_uuid());raise exception 'foreign source accepted';
 exception when insufficient_privilege then assert sqlerrm='ZONE_NOT_IN_STORE';end;
 begin
   perform public.app_operation(other_store,'count.move-zone',payload,gen_random_uuid());raise exception 'foreign store accepted';
 exception when insufficient_privilege then null;end;
 begin
   perform public.app_operation(store_id,'count.move-zone',jsonb_build_object('session_id',current_session,'product_id',milk,'source_zone_id',frozen,'target_zone_id',ambient,'expected_updated_at',(saved->1->>'updated_at')::timestamptz),gen_random_uuid());
   raise exception 'existing same-product target silently merged';
 exception when sqlstate '22023' then assert sqlerrm='COUNT_TARGET_ALREADY_HAS_PRODUCT';end;
 assert (select sum(quantity)=4 from public.count_drafts where session_id=current_session and product_id=milk),'collision does not change either count';

 cached_result:=public.app_operation(store_id,'count.move-zone',payload,request_id);
 assert (cached_result->>'quantity')::numeric=0 and cached_result->>'note'='本期用完，下期可移除。','move preserves zero and note';
 assert (cached_result->>'updated_at')::timestamptz>stamp,'move advances version';
 assert public.app_operation(store_id,'count.move-zone',payload,request_id)=cached_result,'exact retry is idempotent';
 assert (select to_jsonb(d)-'zone_id'-'updated_at' from public.count_drafts d where session_id=current_session and product_id=ham)=before_draft-'zone_id'-'updated_at','draft identity, unit, actor and state preserved';
 assert (select to_jsonb(p) from public.count_zone_progress p where session_id=current_session and zone_id=frozen)=before_progress,'existing target progress retained';
 assert exists(select 1 from public.count_zone_progress where session_id=current_session and zone_id=cold),'nonempty source progress retained';
 assert (select jsonb_agg(i-'zone_id'-'zone_name' order by i->>'product_id',i->>'unit') from public.inventory_count_sessions s,jsonb_array_elements(s.snapshot->'zones') i where s.id=current_session)
   =(select jsonb_agg(i-'zone_id'-'zone_name' order by i->>'product_id',i->>'unit') from jsonb_array_elements(before_snapshot->'zones') i),'source metadata unchanged';
 assert (select jsonb_agg(to_jsonb(x) order by x.product_id) from private.count_price_snapshots x where session_id=current_session)=before_prices,'price snapshot unchanged';
 assert (select jsonb_agg(to_jsonb(x) order by x.product_id) from private.count_opening_snapshots x where session_id=current_session)=before_openings,'opening snapshot unchanged';
 assert (select jsonb_agg(to_jsonb(zp)) from public.zone_products zp where zp.zone_id=other_zone)=before_other,'other store unchanged';

 -- A later correction uses the current draft version; independent administration
 -- has the same correction permission without rewriting the original counter.
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 begin
   perform public.app_operation(store_id,'count.move-zone',payload||jsonb_build_object('source_zone_id',frozen,'target_zone_id',cold),gen_random_uuid());raise exception 'stale correction accepted';
 exception when serialization_failure then assert sqlerrm='COUNT_DRAFT_CHANGED';end;
 result:=public.app_operation(store_id,'count.move-zone',payload||jsonb_build_object('source_zone_id',frozen,'target_zone_id',cold,'expected_updated_at',cached_result->'updated_at'),gen_random_uuid());
 result:=public.app_operation(store_id,'count.move-zone',payload||jsonb_build_object('expected_updated_at',result->'updated_at'),gen_random_uuid());
 assert (select entered_by=staff_id from public.count_drafts where session_id=current_session and product_id=ham),'admin correction preserves original actor';
 perform set_config('request.jwt.claim.sub',staff_id::text,true);

 -- An untouched blank card moves without creating a draft or a zero quantity.
 result:=public.app_operation(store_id,'count.move-zone',jsonb_build_object('session_id',current_session,'product_id',blank_item,'source_zone_id',cold,'target_zone_id',ambient,'expected_updated_at',null),gen_random_uuid());
 assert result->>'quantity' is null and result->>'updated_at' is null,'blank move stays blank';
 assert not exists(select 1 from public.count_drafts where session_id=current_session and product_id=blank_item),'blank move does not invent draft';
 assert not exists(select 1 from public.count_zone_progress where session_id=current_session and zone_id=cold),'last move removes empty source progress';
 result:=public.save_pilot_count_drafts(current_session,jsonb_build_array(jsonb_build_object('zone_id',ambient,'product_id',blank_item,'note','待盤，剛才放錯區','expected_updated_at',null)));
 stamp:=(result->0->>'updated_at')::timestamptz;
 select to_jsonb(d) into before_draft from public.count_drafts d where session_id=current_session and product_id=blank_item;
 result:=public.app_operation(store_id,'count.move-zone',jsonb_build_object('session_id',current_session,'product_id',blank_item,'source_zone_id',ambient,'target_zone_id',cold,'expected_updated_at',stamp),gen_random_uuid());
 assert result->>'quantity' is null and result->>'note'='待盤，剛才放錯區','note-only move stays blank';
 assert (result->>'updated_at')::timestamptz>stamp,'note-only move advances version';
 assert (select to_jsonb(d)-'zone_id'-'updated_at' from public.count_drafts d where session_id=current_session and product_id=blank_item)=before_draft-'zone_id'-'updated_at','note-only draft identity and BLANK state preserved';
 prior_stamp:=stamp;stamp:=(result->>'updated_at')::timestamptz;
 begin
   perform public.save_pilot_count_draft(current_session,ambient,blank_item,2,prior_stamp);raise exception 'old source write accepted';
 exception when insufficient_privilege then assert sqlerrm='PRODUCT_NOT_IN_COUNT';end;
 result:=public.app_operation(store_id,'count.move-zone',jsonb_build_object('session_id',current_session,'product_id',blank_item,'source_zone_id',cold,'target_zone_id',ambient,'expected_updated_at',stamp),gen_random_uuid());
 perform public.save_pilot_count_draft(current_session,ambient,blank_item,2,(result->>'updated_at')::timestamptz);
 perform public.complete_pilot_count_zone(current_session,frozen);
 begin
   perform public.app_operation(store_id,'count.move-zone',payload||jsonb_build_object('source_zone_id',frozen,'target_zone_id',cold,'expected_updated_at',null),gen_random_uuid());raise exception 'completed source reopened';
 exception when sqlstate '22023' then assert sqlerrm='COUNT_ZONE_NOT_AVAILABLE';end;
 begin
   perform public.app_operation(store_id,'count.move-zone',jsonb_build_object('session_id',current_session,'product_id',blank_item,'source_zone_id',ambient,'target_zone_id',frozen,'expected_updated_at',null),gen_random_uuid());raise exception 'completed target reopened';
 exception when sqlstate '22023' then assert sqlerrm='COUNT_ZONE_NOT_AVAILABLE';end;
 perform public.complete_pilot_count_zone(current_session,ambient);
 assert (select status='CLOSED' from public.inventory_count_sessions where id=current_session),'empty source never blocks completion';
 begin
   perform public.app_operation(store_id,'count.move-zone',payload,gen_random_uuid());raise exception 'completed count changed';
 exception when sqlstate '22023' then assert sqlerrm='COUNT_SESSION_NOT_ACTIVE';end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 assert (select snapshot=historical_snapshot from public.inventory_count_sessions where id=history_session),'historical snapshot unchanged';
 assert (select jsonb_agg(to_jsonb(e) order by e.id) from public.count_entries e where session_id=history_session)=historical_entries,'historical entries unchanged';
 assert public.get_pilot_count_details(history_session)=historical_details,'historical values and notes unchanged';
 next_session:=public.start_pilot_count(store_id,null);
 assert (select snapshot->'zones' @> jsonb_build_array(jsonb_build_object('product_id',ham,'zone_id',frozen),jsonb_build_object('product_id',blank_item,'zone_id',ambient)) from public.inventory_count_sessions where id=next_session),'next count uses corrected areas';
 assert not exists(select 1 from public.zone_products where zone_id=cold),'future configuration has no obsolete source assignment';

 -- The same rewrite preserves explicit selections even before typing any value.
 other_target:=public.create_pilot_zone(other_store,'另一店冷凍');
 selected_session:=public.start_pilot_count(other_store,jsonb_build_array(jsonb_build_object('zone_id',other_zone,'product_id',ham)));
 perform public.app_operation(other_store,'count.move-zone',jsonb_build_object('session_id',selected_session,'product_id',ham,'source_zone_id',other_zone,'target_zone_id',other_target,'expected_updated_at',null),gen_random_uuid());
 perform public.app_operation(other_store,'count.prepare','{}',gen_random_uuid());
 assert (select jsonb_array_length(snapshot->'zones')=1 and snapshot->'selection' @> jsonb_build_array(jsonb_build_object('zone_id',other_target,'product_id',ham)) from public.inventory_count_sessions where id=selected_session),'selected blank card survives prepare in corrected area';
 begin
   perform public.app_operation(store_id,'count.move-zone',payload||jsonb_build_object('session_id',selected_session),gen_random_uuid());raise exception 'foreign session accepted';
 exception when insufficient_privilege then assert sqlerrm='COUNT_NOT_IN_STORE';end;

 perform set_config('request.jwt.claim.sub',stranger::text,true);
 begin
   perform public.app_operation(store_id,'count.move-zone',payload,request_id);raise exception 'stranger replay accepted';
 exception when insufficient_privilege then null;end;
 update public.store_memberships set is_active=false where store_memberships.store_id=store_id and user_id=staff_id;
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 begin
   perform public.app_operation(store_id,'count.move-zone',payload,request_id);raise exception 'revoked staff replay accepted';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
   perform public.app_operation(store_id,'count.move-zone',payload,gen_random_uuid());raise exception 'anonymous move accepted';
 exception when insufficient_privilege then null;end;
 assert not has_function_privilege('authenticated','private.count_inline_operation(uuid,text,jsonb)','EXECUTE'),'private helper remains inaccessible';
end $test$;
select 'ok 1 - classified area correction preserves counts, notes, scope, versions and history';
rollback;
