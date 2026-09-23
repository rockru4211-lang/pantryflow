
create table if not exists private.baihuayuan_record_flags (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  entity_type text not null check (entity_type in ('RECEIPT_BATCH','TRANSFER','WASTE')),
  entity_id uuid not null,
  state text not null default 'LIVE' check (state in ('LIVE','TEST','REMOVED')),
  reason text,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(entity_type,entity_id)
);

create index if not exists baihuayuan_record_flags_store_state
  on private.baihuayuan_record_flags(store_id,state,updated_at desc);

create or replace function private.baihuayuan_record_state(p_type text,p_id uuid)
returns text
language sql
stable security definer
set search_path=''
as $$
  select coalesce((
    select f.state
    from private.baihuayuan_record_flags f
    where f.entity_type=p_type and f.entity_id=p_id
  ),'LIVE');
$$;

revoke all on function private.baihuayuan_record_state(text,uuid) from public,anon,authenticated;

create or replace function public.set_baihuayuan_record_state(
  p_store_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_state text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_valid boolean:=false;
begin
  if auth.uid() is null or not private.baihuayuan_can_confirm_backoffice(p_store_id) then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;

  select organization_id into v_org
  from public.stores
  where id=p_store_id and is_active and name in ('BeApe','Gras');

  if v_org is null then raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501'; end if;
  if p_entity_type not in ('RECEIPT_BATCH','TRANSFER','WASTE') then raise exception 'INVALID_ENTITY_TYPE' using errcode='22023'; end if;
  if p_state not in ('LIVE','TEST','REMOVED') then raise exception 'INVALID_RECORD_STATE' using errcode='22023'; end if;
  if p_state='REMOVED' and btrim(coalesce(p_reason,''))='' then raise exception 'REMOVE_REASON_REQUIRED' using errcode='22023'; end if;

  if p_entity_type='RECEIPT_BATCH' then
    select exists(
      select 1 from public.receipt_upload_batches b
      where b.id=p_entity_id and b.store_id=p_store_id and b.organization_id=v_org
    ) into v_valid;
  elsif p_entity_type='TRANSFER' then
    select exists(
      select 1 from private.store_movements m
      where m.id=p_entity_id and m.organization_id=v_org
        and m.kind='TRANSFER' and p_store_id in (m.from_store_id,m.to_store_id)
    ) into v_valid;
  else
    select exists(
      select 1 from private.waste_records w
      where w.id=p_entity_id and w.organization_id=v_org and w.store_id=p_store_id
    ) into v_valid;
  end if;

  if not v_valid then raise exception 'RECORD_NOT_FOUND' using errcode='P0002'; end if;

  insert into private.baihuayuan_record_flags(
    organization_id,store_id,entity_type,entity_id,state,reason,updated_by,updated_at
  )
  values(v_org,p_store_id,p_entity_type,p_entity_id,p_state,nullif(btrim(coalesce(p_reason,'')),''),auth.uid(),now())
  on conflict(entity_type,entity_id) do update set
    state=excluded.state,
    reason=excluded.reason,
    updated_by=excluded.updated_by,
    updated_at=now();

  insert into public.audit_logs(
    organization_id,entity_type,entity_id,action,new_value,user_id,store_id
  )
  values(
    v_org,'baihuayuan_record_flag',p_entity_id::text,'BAIHUAYUAN_RECORD_STATE_CHANGED',
    jsonb_build_object('record_type',p_entity_type,'state',p_state,'reason',nullif(btrim(coalesce(p_reason,'')),'')),
    auth.uid(),p_store_id
  );

  return jsonb_build_object('entity_type',p_entity_type,'entity_id',p_entity_id,'state',p_state,'reason',nullif(btrim(coalesce(p_reason,'')),''));
end;
$$;

revoke all on function public.set_baihuayuan_record_state(uuid,text,uuid,text,text) from public;
grant execute on function public.set_baihuayuan_record_state(uuid,text,uuid,text,text) to authenticated;
