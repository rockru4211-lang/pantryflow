-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260822145005
-- Name: fix_count_actor_profile_relationships
-- DO NOT apply to production; retained for blank-environment reconstruction only.

-- Expose explicit actor -> profile relationships to PostgREST without removing
-- the existing auth.users integrity constraints.

alter table public.count_entries
  add constraint count_entries_entered_by_profile_fkey
  foreign key (entered_by) references public.profiles(id) not valid;
alter table public.inventory_count_sessions
  add constraint inventory_count_sessions_started_by_profile_fkey
  foreign key (started_by) references public.profiles(id) not valid;
alter table public.audit_logs
  add constraint audit_logs_user_profile_fkey
  foreign key (user_id) references public.profiles(id) not valid;
alter table public.discrepancy_reviews
  add constraint discrepancy_reviews_created_by_profile_fkey
  foreign key (created_by) references public.profiles(id) not valid;
alter table public.goods_receipts
  add constraint goods_receipts_reviewed_by_profile_fkey
  foreign key (reviewed_by) references public.profiles(id) not valid;
alter table public.receipt_lines
  add constraint receipt_lines_modified_by_profile_fkey
  foreign key (modified_by) references public.profiles(id) not valid;
alter table public.receipt_upload_batches
  add constraint receipt_upload_batches_uploaded_by_profile_fkey
  foreign key (uploaded_by) references public.profiles(id) not valid;

alter table public.count_entries validate constraint count_entries_entered_by_profile_fkey;
alter table public.inventory_count_sessions validate constraint inventory_count_sessions_started_by_profile_fkey;
alter table public.audit_logs validate constraint audit_logs_user_profile_fkey;
alter table public.discrepancy_reviews validate constraint discrepancy_reviews_created_by_profile_fkey;
alter table public.goods_receipts validate constraint goods_receipts_reviewed_by_profile_fkey;
alter table public.receipt_lines validate constraint receipt_lines_modified_by_profile_fkey;
alter table public.receipt_upload_batches validate constraint receipt_upload_batches_uploaded_by_profile_fkey;

notify pgrst, 'reload schema';

