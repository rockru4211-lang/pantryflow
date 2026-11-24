create or replace function private.can_set_beape_onboarding_access(p_store uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from private.beape_onboarding_stores() s
    join public.stores st on st.id = s.id
    join public.organizations o on o.id = st.organization_id
    where s.id = p_store
      and private.member_active(s.id, p_user)
      and private.member_active(s.id, auth.uid())
      and private.can_administer_people(s.id)
      and (
        o.owner_user_id = auth.uid()
        or (
          p_user = '1e6b9487-0b9e-4a30-b4fd-60382d32d7a3'::uuid
          and private.can_manage_business(s.id, p_user)
          and (p_user = auth.uid() or private.can_manage_member_store_access(s.id, p_user))
        )
        or (
          private.can_manage_member_store_access(s.id, p_user)
          and not private.can_manage_business(s.id, p_user)
        )
      )
  )
$$;
