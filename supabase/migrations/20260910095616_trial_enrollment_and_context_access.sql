-- Applied only after the client uses the rate-limited Edge lookup.
revoke all on function public.get_pilot_staff_login_context(text,text) from public,anon,authenticated;
grant execute on function public.get_pilot_staff_login_context(text,text) to service_role;

-- New stores created through the authorized App flow join the trial without an extra form.
-- Existing stores require an explicit enrollment; they are not relabeled from their names.
create function private.enroll_new_trial_store() returns trigger language plpgsql security definer set search_path='' as $$
declare c text;
begin
 select case when bool_and(t.cohort='QA') then 'QA' when bool_and(t.cohort='EXCLUDED') then 'EXCLUDED' else 'TRIAL' end into c
 from private.trial_stores t join public.stores s on s.id=t.store_id where s.organization_id=new.organization_id and s.id<>new.id;
 insert into private.trial_stores(store_id,cohort,enrollment_reason) values(new.id,coalesce(c,'TRIAL'),'New store created through App after trial release');
 return new;
end $$;
create trigger enroll_new_trial_store after insert on public.stores for each row execute function private.enroll_new_trial_store();
revoke all on function private.enroll_new_trial_store() from public,anon,authenticated;
