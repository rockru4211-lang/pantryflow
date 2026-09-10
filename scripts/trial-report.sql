-- Product operator only; execute through authorized Supabase SQL access.
-- QA enrollment is explicit, and unclassified stores are never counted as real trial stores.
select s.store_code,t.cohort,t.activated_at,private.trial_daily_report(s.id) as seven_day_report
from public.stores s left join private.trial_stores t on t.store_id=s.id
where s.is_active order by t.cohort,s.store_code;
-- For an error shown by its first eight trace characters, query only metadata:
-- select id,store_id,actor_id,operation,operation_id,resource_id,app_version,phase,started_at,finished_at,stats
-- from private.app_attempts where id::text like '<trace-prefix>%' order by started_at desc;
