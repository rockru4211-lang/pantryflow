-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260820155258
-- Name: harden_rls_helper_permissions
-- DO NOT apply to production; retained for blank-environment reconstruction only.

revoke execute on function public.is_org_member(uuid) from public, anon, authenticated;
revoke execute on function public.has_org_role(uuid, public.app_role[]) from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

grant execute on function public.is_org_member(uuid) to postgres, service_role;
grant execute on function public.has_org_role(uuid, public.app_role[]) to postgres, service_role;
