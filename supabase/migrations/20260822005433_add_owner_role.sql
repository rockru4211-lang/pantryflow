-- operations-ui-v2 introduces an organization OWNER role above ADMIN.
-- This migration changes authorization metadata only; it does not update any
-- existing member, profile, receipt, OCR, count, or correction row.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role is null or role in ('OWNER', 'ADMIN', 'SUPERVISOR', 'STAFF'));

alter type public.app_role add value if not exists 'OWNER' before 'ADMIN';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_role() in ('OWNER', 'ADMIN'), false)
$$;

create or replace function public.can_supervise()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_role() in ('OWNER', 'ADMIN', 'SUPERVISOR'), false)
$$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.can_supervise() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_supervise() to authenticated;
