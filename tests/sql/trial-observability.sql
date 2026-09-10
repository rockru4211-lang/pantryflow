begin;
do $$
declare actor uuid; store uuid; attempt uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); report jsonb; first_result jsonb; count_before bigint; receipt_before bigint;
begin
 select o.owner_user_id,s.id into actor,store from public.stores s join public.organizations o on o.id=s.organization_id where s.store_code='QAFULLINDEP';
 assert actor is not null,'Existing isolated QA fixture is required';
 select count(*) into count_before from public.count_entries;select count(*) into receipt_before from public.receipt_documents;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into private.trial_stores(store_id,cohort,activated_at,enrollment_reason) values(store,'QA',clock_timestamp(),'rollback acceptance') on conflict(store_id) do update set activated_at=clock_timestamp();
 perform public.record_app_attempt(attempt,'START',jsonb_build_object('operation','inventory_import','store_id',store,'app_version',repeat('a',40)));
 perform public.record_app_attempt(attempt,'PROGRESS','{"source_rows":3,"opening_pending":2,"password":"must-never-be-stored","signed_url":"https://private.invalid?token=secret","reasons":{"MISSING_NAME":1,"PIN_123456":99}}');
 -- A failed main transaction is deliberately rolled back; the previously recorded start remains.
 begin perform public.app_operation(store,'invalid.action','{}',gen_random_uuid());exception when others then null;end;
 perform public.record_app_attempt(attempt,'FAILED','{"error_code":"INVALID_OPERATION","stage":"database"}');
 perform public.record_app_attempt(attempt,'SUCCEEDED','{"added":999}');
 assert (select phase='FAILED' and not(stats ?| array['password','signed_url','added']) and stats->'reasons'='{"MISSING_NAME":1}'::jsonb from private.app_attempts where id=attempt),'trace filtering or immutable finish failed';
 assert (select count(*)=1 from private.app_attempts where id=attempt),'trace delivery duplicated';
 attempt:=gen_random_uuid();
 perform public.record_app_attempt(attempt,'START',jsonb_build_object('operation','app_operation','store_id',store,'operation_id',req,'app_version',repeat('b',40)));
 perform set_config('request.headers',jsonb_build_object('x-pf-attempt-id',attempt)::text,true);
 first_result:=public.app_operation(store,'record.create','{"kind":"incident","title":"Trace rollback verification","body":"No permanent test data"}',req);
 assert public.app_operation(store,'record.create','{"kind":"incident","title":"Trace rollback verification","body":"No permanent test data"}',req)=first_result,'business retry duplicated';
 assert exists(select 1 from public.audit_logs where attempt_id=attempt and app_version=repeat('b',40) and store_id=store),'audit link missing';
 perform public.record_app_attempt(attempt,'SUCCEEDED','{}');
 report:=private.trial_daily_report(store);
 assert report->>'cohort'='QA' and jsonb_array_length(report->'days')=7,'trial window incorrect';
 assert report->'days'->0->'imports'->>'attempts'='1' and report->'days'->0->'imports'->>'failed'='1','failed attempts lost';
 assert report->'days'->0->'imports'->>'opening_pending'='2','opening pending incorrectly classified';
 assert report->'days'->1->'imports'->>'attempts'='0','empty day counted as an attempt';
 assert report->'days'->1->>'day_state'='FUTURE','future day presented as actual usage';
 assert not has_table_privilege('authenticated','private.app_attempts','SELECT,INSERT,UPDATE,DELETE'),'attempt table exposed';
 assert not has_function_privilege('authenticated','private.trial_daily_report(uuid)','EXECUTE'),'operator trial report exposed';
 assert not has_function_privilege('anon','public.check_staff_login_rate(text,integer)','EXECUTE'),'rate counter can be bypassed';
 for n in 1..5 loop assert public.check_staff_login_rate(repeat('c',64),5),'rate limit prematurely rejected';end loop;
 assert not public.check_staff_login_rate(repeat('c',64),5),'rate limit failed';
 assert (select count(*) from public.count_entries)=count_before,'count history changed';
 assert (select count(*) from public.receipt_documents)=receipt_before,'source images changed';
end $$;
rollback;
