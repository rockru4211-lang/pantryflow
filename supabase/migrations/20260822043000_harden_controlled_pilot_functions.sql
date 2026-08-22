-- Trigger-only functions must not be callable through the public API.
revoke execute on function public.sync_receipt_batch_work_date() from public, anon, authenticated;

