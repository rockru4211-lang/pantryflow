
create or replace function public.remove_baihuayuan_partner(
  p_store_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_owner uuid;
  v_refs integer:=0;
begin
  if auth.uid() is null or not private.can_manage_business(p_store_id) then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;
  select s.organization_id,o.owner_user_id into v_org,v_owner
  from public.stores s join public.organizations o on o.id=s.organization_id
  where s.id=p_store_id;

  if p_user_id=auth.uid() or p_user_id=v_owner or exists(
    select 1 from public.organization_members where organization_id=v_org and user_id=p_user_id and is_owner
  ) then raise exception 'CANNOT_REMOVE_OWNER_OR_SELF' using errcode='42501'; end if;

  select
    (select count(*) from public.count_entries where entered_by=p_user_id)
    +(select count(*) from public.inventory_count_sessions where started_by=p_user_id)
    +(select count(*) from public.receipt_upload_batches where uploaded_by=p_user_id)
    +(select count(*) from public.goods_receipts where reviewed_by=p_user_id)
    +(select count(*) from private.store_movements where created_by=p_user_id)
    +(select count(*) from private.store_movement_events where actor_id=p_user_id)
    +(select count(*) from private.waste_records where created_by=p_user_id)
    +(select count(*) from private.app_records where created_by=p_user_id or completed_by=p_user_id or responsible_id=p_user_id)
  into v_refs;

  if v_refs>0 then
    raise exception 'PARTNER_HAS_HISTORY' using errcode='23503';
  end if;

  delete from private.member_zone_responsibilities
  where user_id=p_user_id and store_id in (select id from public.stores where organization_id=v_org);

  delete from private.app_delegations
  where user_id=p_user_id and store_id in (select id from public.stores where organization_id=v_org);

  delete from private.app_session_access
  where user_id=p_user_id and store_id in (select id from public.stores where organization_id=v_org);

  delete from private.staff_activation_tokens where user_id=p_user_id;
  delete from private.staff_pin_credentials where user_id=p_user_id;

  update private.management_invites
  set status='CANCELLED'
  where organization_id=v_org and user_id=p_user_id and status='PENDING';

  delete from public.store_memberships where organization_id=v_org and user_id=p_user_id;
  delete from public.staff_identities where organization_id=v_org and user_id=p_user_id;
  delete from public.organization_members where organization_id=v_org and user_id=p_user_id;

  update public.profiles set organization_id=null,role=null,store=''
  where id=p_user_id and organization_id=v_org;

  insert into public.audit_logs(organization_id,user_id,entity_type,entity_id,action,new_value)
  values(v_org,auth.uid(),'partner',p_user_id::text,'BAIHUAYUAN_PARTNER_REMOVED',jsonb_build_object('removed',true));

  return jsonb_build_object('removed',true,'user_id',p_user_id);
end;
$$;

do $$
declare
  v_org uuid := '7e6693e0-8530-4903-9b3d-0c1c47730d9f'::uuid;
  v_users uuid[] := array[
    '66bd4ec2-6ab1-4e74-8278-a54bca8ff76d'::uuid,
    '782a8e0d-5a12-488f-9932-d5a621d93328'::uuid
  ];
  v_history bigint;
begin
  select
    (select count(*) from public.count_entries where entered_by=any(v_users))
    +(select count(*) from public.inventory_count_sessions where started_by=any(v_users))
    +(select count(*) from public.receipt_upload_batches where uploaded_by=any(v_users))
    +(select count(*) from public.goods_receipts where reviewed_by=any(v_users))
    +(select count(*) from private.store_movements where created_by=any(v_users))
    +(select count(*) from private.store_movement_events where actor_id=any(v_users))
    +(select count(*) from private.waste_records where created_by=any(v_users))
    +(select count(*) from private.app_records where created_by=any(v_users) or completed_by=any(v_users) or responsible_id=any(v_users))
  into v_history;

  if v_history > 0 then
    raise exception 'Baihuayuan cleanup stopped: selected users have operational history';
  end if;

  delete from private.member_zone_responsibilities
  where user_id=any(v_users) and store_id in (select id from public.stores where organization_id=v_org);

  delete from private.app_delegations
  where user_id=any(v_users) and store_id in (select id from public.stores where organization_id=v_org);

  delete from private.app_session_access
  where user_id=any(v_users) and store_id in (select id from public.stores where organization_id=v_org);

  delete from private.staff_activation_tokens where user_id=any(v_users);
  delete from private.staff_pin_credentials where user_id=any(v_users);

  update private.management_invites
  set status='CANCELLED'
  where organization_id=v_org and user_id=any(v_users) and status='PENDING';

  delete from public.store_memberships where organization_id=v_org and user_id=any(v_users);
  delete from public.staff_identities where organization_id=v_org and user_id=any(v_users);
  delete from public.organization_members where organization_id=v_org and user_id=any(v_users);

  update public.profiles set organization_id=null,role=null,store=''
  where organization_id=v_org and id=any(v_users);
end $$;
