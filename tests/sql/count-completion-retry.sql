begin;
do $$
declare before_entries jsonb; before_progress jsonb; before_session jsonb; before_audit bigint; denied boolean;
begin
 select jsonb_agg(to_jsonb(e) order by id) into before_entries from public.count_entries e where session_id='67c44eef-1c9b-4667-be0a-e955b9e259b9';
 select jsonb_agg(to_jsonb(z) order by zone_id) into before_progress from public.count_zone_progress z where session_id='67c44eef-1c9b-4667-be0a-e955b9e259b9';
 select to_jsonb(s) into before_session from public.inventory_count_sessions s where id='67c44eef-1c9b-4667-be0a-e955b9e259b9';
 select count(*) into before_audit from public.audit_logs where entity_id='67c44eef-1c9b-4667-be0a-e955b9e259b9';
 perform set_config('request.jwt.claims',jsonb_build_object('sub','f8f6c64d-09ab-434d-ab8c-cda95da1b213','role','authenticated')::text,true);
 perform public.complete_pilot_count_zone('67c44eef-1c9b-4667-be0a-e955b9e259b9','0f5dbdd1-ad55-4fa9-8573-619a7dd9f2ac');
 perform public.complete_pilot_count_zone('67c44eef-1c9b-4667-be0a-e955b9e259b9','0f5dbdd1-ad55-4fa9-8573-619a7dd9f2ac');
 if before_entries is distinct from (select jsonb_agg(to_jsonb(e) order by id) from public.count_entries e where session_id='67c44eef-1c9b-4667-be0a-e955b9e259b9')
 or before_progress is distinct from (select jsonb_agg(to_jsonb(z) order by zone_id) from public.count_zone_progress z where session_id='67c44eef-1c9b-4667-be0a-e955b9e259b9')
 or before_session is distinct from (select to_jsonb(s) from public.inventory_count_sessions s where id='67c44eef-1c9b-4667-be0a-e955b9e259b9')
 or before_audit<>(select count(*) from public.audit_logs where entity_id='67c44eef-1c9b-4667-be0a-e955b9e259b9')
 then raise exception 'ASSERT successful completion retry changed count history'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 denied:=false;
 begin perform public.complete_pilot_count_zone('67c44eef-1c9b-4667-be0a-e955b9e259b9','0f5dbdd1-ad55-4fa9-8573-619a7dd9f2ac'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'ASSERT completion retry bypassed membership'; end if;
end $$;
rollback;
select 'PASS: repeated completed-zone submission preserves entries, progress, session and audit; membership still required' as retry_tests;
