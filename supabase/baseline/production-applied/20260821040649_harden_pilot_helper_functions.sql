-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260821040649
-- Name: harden_pilot_helper_functions
-- DO NOT apply to production; retained for blank-environment reconstruction only.

alter function public.set_updated_at() set search_path = '';
alter function public.prevent_record_change() set search_path = '';
revoke execute on function public.current_organization_id() from public, anon;
revoke execute on function public.current_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.can_supervise() from public, anon;
grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_supervise() to authenticated;
