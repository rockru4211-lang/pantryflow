-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260822142832
-- Name: harden_controlled_pilot_functions
-- DO NOT apply to production; retained for blank-environment reconstruction only.

revoke execute on function public.sync_receipt_batch_work_date() from public, anon, authenticated;
