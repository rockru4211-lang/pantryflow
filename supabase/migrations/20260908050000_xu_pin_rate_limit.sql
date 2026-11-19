-- Service-only, atomic rate limits; denied requests still commit their counter.
create table if not exists private.staff_login_limits(key_hash text primary key,window_start timestamptz not null,hits integer not null);
alter table private.staff_login_limits enable row level security;
revoke all on private.staff_login_limits from public,anon,authenticated;
create or replace function public.check_staff_login_rate(p_key_hash text,p_limit integer default 30) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_key_hash !~ '^[0-9a-f]{64}$' then return false; end if;
 insert into private.staff_login_limits values(p_key_hash,clock_timestamp(),1)
 on conflict(key_hash) do update set hits=case when staff_login_limits.window_start<clock_timestamp()-interval '1 minute' then 1 else staff_login_limits.hits+1 end,
 window_start=case when staff_login_limits.window_start<clock_timestamp()-interval '1 minute' then clock_timestamp() else staff_login_limits.window_start end returning hits into n;
 delete from private.staff_login_limits where window_start<clock_timestamp()-interval '1 day';
 return n<=least(greatest(p_limit,5),120);
end $$;
revoke all on function public.check_staff_login_rate(text,integer) from public,anon,authenticated;
grant execute on function public.check_staff_login_rate(text,integer) to service_role;
