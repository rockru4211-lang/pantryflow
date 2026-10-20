-- Extend existing reminders without changing any existing balance, receipt or price.
alter table private.custody_reminders
 add column safety_stock numeric check(safety_stock>=0 and safety_stock<1e9),
 add column responsible_user_id uuid references public.profiles(id);
create index custody_reminders_responsible on private.custody_reminders(responsible_user_id);
create table private.custody_replenishments (
 id uuid primary key default gen_random_uuid(),reminder_id uuid not null references private.custody_reminders(id),
 ordered_quantity numeric not null check(ordered_quantity>0 and ordered_quantity<1e9),
 received_quantity numeric not null default 0 check(received_quantity>=0 and received_quantity<=ordered_quantity),
 expected_on date,status text not null default 'ORDERED' check(status in ('ORDERED','RECEIVED','CANCELLED')),
 note text not null default '' check(length(note)<=2000),revision integer not null default 1,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index custody_one_open_replenishment on private.custody_replenishments(reminder_id) where status='ORDERED';
create index custody_replenishments_reminder on private.custody_replenishments(reminder_id);
create index custody_replenishments_creator on private.custody_replenishments(created_by);
create table private.custody_daily_notifications (
 reminder_id uuid not null references private.custody_reminders(id),notification_day date not null,
 reason text not null check(reason in ('LOW','WAITING_DATE','OVERDUE')),notified_at timestamptz not null default now(),
 primary key(reminder_id,notification_day)
);
alter table private.custody_replenishments enable row level security;
alter table private.custody_daily_notifications enable row level security;
revoke all on private.custody_replenishments,private.custody_daily_notifications from public,anon,authenticated;

create function private.custody_office_member(s uuid,u uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.store_memberships m where m.store_id=s and m.user_id=u and m.is_active and m.access_mode='EDIT'
 and (coalesce(m.work_role,m.role)='OWNER' or coalesce(m.work_role,m.role)='LOGISTICS' and 'OFFICE'=any(private.person_work_functions(m.organization_id,u))));
$$;
revoke all on function private.custody_office_member(uuid,uuid) from public,anon,authenticated;
create function private.custody_replenishment_status(r private.custody_reminders,day date default (now() at time zone 'Asia/Taipei')::date) returns text
language sql stable set search_path='' as $$
 select coalesce((select case when o.expected_on is null then 'WAITING_DATE' when o.expected_on<day then 'OVERDUE' else 'ORDERED' end
 from private.custody_replenishments o where o.reminder_id=r.id and o.status='ORDERED'),
 case when r.safety_stock is not null and r.remaining<r.safety_stock then 'LOW' else 'OK' end);
$$;
revoke all on function private.custody_replenishment_status(private.custody_reminders,date) from public,anon,authenticated;
create function private.enqueue_custody_notifications(target uuid default null) returns void language sql security definer set search_path='' as $$
 insert into private.custody_daily_notifications(reminder_id,notification_day,reason)
 select r.id,(now() at time zone 'Asia/Taipei')::date,private.custody_replenishment_status(r)
 from private.custody_reminders r join public.stores s on s.id=r.store_id
 where (target is null or r.id=target) and s.is_active and s.name in ('BeApe','Gras')
 and private.custody_replenishment_status(r) in ('LOW','WAITING_DATE','OVERDUE')
 on conflict(reminder_id,notification_day) do update set reason=excluded.reason,notified_at=now()
 where custody_daily_notifications.reason<>excluded.reason;
$$;
revoke all on function private.enqueue_custody_notifications(uuid) from public,anon,authenticated;
create function private.custody_notify_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='custody_reminders' then perform private.enqueue_custody_notifications(new.id);
 else perform private.enqueue_custody_notifications(new.reminder_id);end if;
 return new;
end $$;
revoke all on function private.custody_notify_change() from public,anon,authenticated;
create trigger custody_balance_notify after insert or update of remaining,safety_stock,responsible_user_id on private.custody_reminders for each row execute function private.custody_notify_change();
create trigger custody_order_notify after insert or update on private.custody_replenishments for each row execute function private.custody_notify_change();

-- Exact identity links supply search names; picking always keeps the existing reminder id.
create or replace function private.custody_reminder_state(s uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 with identities as materialized(select value from jsonb_array_elements(public.get_count_ingredient_names(s))),
 rows as materialized(select to_jsonb(r)||jsonb_build_object(
 'supplier',private.supplier_display_name(st.organization_id,r.supplier),
 'code',coalesce(i.value->>'code',p.product_code,''),'names',coalesce(i.value->'names','[]'::jsonb),
 'count_name',coalesce(nullif(i.value->>'count_name',''),p.name,r.name),
 'status',private.custody_replenishment_status(r),
 'order',(select to_jsonb(o) from private.custody_replenishments o where o.reminder_id=r.id and o.status='ORDERED'),
 'orders',case when private.custody_office_member(s,auth.uid()) then coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from private.custody_replenishments o where o.reminder_id=r.id),'[]'::jsonb) else '[]'::jsonb end,
 'notified_at',case when private.custody_office_member(s,auth.uid()) and (r.responsible_user_id is null or r.responsible_user_id=auth.uid()
 or not private.custody_office_member(s,r.responsible_user_id)) then (select max(n.notified_at) from private.custody_daily_notifications n where n.reminder_id=r.id and n.reason=private.custody_replenishment_status(r)) end) data
 from private.custody_reminders r join public.stores st on st.id=r.store_id join public.products p on p.id=r.product_id
 left join identities i on i.value->>'product_id'=r.product_id::text where r.store_id=s)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(data order by data->>'name',data->>'supplier') from rows),'[]'),
 'can_edit',private.custody_office_member(s,auth.uid()),
 'recipients',case when private.custody_office_member(s,auth.uid()) then coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(nullif(m.display_name,''),p.display_name)) order by p.display_name)
 from public.store_memberships m join public.profiles p on p.id=m.user_id where m.store_id=s and private.custody_office_member(s,m.user_id)),'[]'::jsonb) else '[]'::jsonb end,
 'tags',coalesce((select jsonb_agg(t) from (select distinct r.name,r.unit,r.kind from private.custody_reminders r where r.store_id=s or exists(select 1 from private.store_movements m where m.from_store_id=r.store_id and m.to_store_id=s and m.product_id=r.product_id and m.unit=r.unit and m.kind='TRANSFER' and m.status='COMPLETE')) t),'[]'),
 'products',coalesce(private.custody_state(s,'supplier')->'products','[]'));
$$;

create or replace function private.baihuayuan_custody_reminders(p_store_id uuid,p_action text,p_data jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.custody_reminders;o private.custody_replenishments;old jsonb;cached private.app_requests;result jsonb;org uuid;product_name text;q numeric;threshold numeric;recipient uuid;action_key text;
begin
 if auth.uid() is null or not private.has_active_store_role(p_store_id,null) or not private.app_session_valid(p_store_id)
 or not exists(select 1 from public.stores where id=p_store_id and is_active and name in ('BeApe','Gras')) then raise exception 'REMINDER_FORBIDDEN' using errcode='42501';end if;
 if p_action='read' then return private.custody_reminder_state(p_store_id);end if;
 if not private.custody_office_member(p_store_id,auth.uid()) then raise exception 'REMINDER_FORBIDDEN' using errcode='42501';end if;
 perform private.assert_store_editable(p_store_id);
 if p_action not in ('save','order','receive','cancel_order') or p_request_id is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000 then raise exception 'REMINDER_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('reminder:'||p_store_id::text,0));
 action_key:='custody.reminder-'||p_action;
 select * into cached from private.app_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>action_key or cached.payload<>p_data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return cached.result;
 end if;
 select organization_id into org from public.stores where id=p_store_id;
 if nullif(p_data->>'id','') is not null then
  select * into r from private.custody_reminders where id=(p_data->>'id')::uuid and store_id=p_store_id for update;
  if r.id is null then raise exception 'REMINDER_FORBIDDEN' using errcode='42501';end if;
  if r.revision is distinct from (p_data->>'revision')::integer then raise exception 'REMINDER_CHANGED' using errcode='PT409';end if;
  old:=to_jsonb(r);
 elsif p_action<>'save' then raise exception 'REMINDER_INVALID' using errcode='22023';
 end if;
 if p_action='save' then
  q:=private.receipt_account_number(p_data->>'remaining');
  threshold:=case when p_data?'safety_stock' then private.receipt_account_number(p_data->>'safety_stock') else r.safety_stock end;
  recipient:=case when p_data?'responsible_user_id' then nullif(p_data->>'responsible_user_id','')::uuid else r.responsible_user_id end;
  if q is null or q<0 or q>=1e9 or coalesce(p_data->>'kind','') not in ('supplier','reserved') or length(coalesce(p_data->>'note',''))>2000
   or threshold<0 or threshold>=1e9 or (nullif(btrim(p_data->>'safety_stock'),'') is not null and threshold is null)
   or recipient is not null and not private.custody_office_member(p_store_id,recipient) then raise exception 'REMINDER_INVALID' using errcode='22023';end if;
  if r.id is null then
   select p.name into product_name from public.products p where p.id=(p_data->>'product_id')::uuid and p.organization_id=org and p.is_active
    and exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where zp.product_id=p.id and z.store_id=p_store_id and z.is_active);
   if product_name is null or length(btrim(coalesce(p_data->>'supplier',''))) not between 1 and 120 or length(btrim(coalesce(p_data->>'unit',''))) not between 1 and 30 then raise exception 'REMINDER_INVALID' using errcode='22023';end if;
   insert into private.custody_reminders(store_id,product_id,kind,name,supplier,unit,remaining,note,created_by,safety_stock,responsible_user_id)
   values(p_store_id,(p_data->>'product_id')::uuid,p_data->>'kind',product_name,btrim(p_data->>'supplier'),btrim(p_data->>'unit'),q,coalesce(p_data->>'note',''),auth.uid(),threshold,recipient) returning * into r;
  else
   update private.custody_reminders set remaining=q,note=coalesce(p_data->>'note',''),safety_stock=threshold,responsible_user_id=recipient,revision=revision+1,updated_at=now() where id=r.id;
  end if;
 else
  if nullif(p_data->>'order_id','') is not null then
   select * into o from private.custody_replenishments where id=(p_data->>'order_id')::uuid and reminder_id=r.id for update;
   if o.id is null then raise exception 'REMINDER_FORBIDDEN' using errcode='42501';end if;
   if o.status<>'ORDERED' or o.revision is distinct from (p_data->>'order_revision')::integer then raise exception 'REMINDER_CHANGED' using errcode='PT409';end if;
  elsif p_action<>'order' then raise exception 'REMINDER_INVALID' using errcode='22023';end if;
  old:=old||jsonb_build_object('order',to_jsonb(o));
  if p_action='order' then
   q:=private.receipt_account_number(p_data->>'ordered_quantity');
   if q is null or q<=0 or q>=1e9 or q<=coalesce(o.received_quantity,0) or length(coalesce(p_data->>'note',''))>2000 then raise exception 'REMINDER_INVALID' using errcode='22023';end if;
   if o.id is null then
    if exists(select 1 from private.custody_replenishments where reminder_id=r.id and status='ORDERED') then raise exception 'REMINDER_CHANGED' using errcode='PT409';end if;
    insert into private.custody_replenishments(reminder_id,ordered_quantity,expected_on,note,created_by)
    values(r.id,q,nullif(p_data->>'expected_on','')::date,coalesce(p_data->>'note',''),auth.uid()) returning * into o;
   else
    update private.custody_replenishments set ordered_quantity=q,expected_on=nullif(p_data->>'expected_on','')::date,note=coalesce(p_data->>'note',''),revision=revision+1,updated_at=now() where id=o.id;
   end if;
  elsif p_action='receive' then
   q:=private.receipt_account_number(p_data->>'quantity');
   if q is null or q<=0 or q>o.ordered_quantity-o.received_quantity or r.remaining+q>=1e9 then raise exception 'REMINDER_INVALID' using errcode='22023';end if;
   update private.custody_replenishments set received_quantity=received_quantity+q,status=case when received_quantity+q=ordered_quantity then 'RECEIVED' else 'ORDERED' end,revision=revision+1,updated_at=now() where id=o.id;
   update private.custody_reminders set remaining=remaining+q where id=r.id;
  else
   update private.custody_replenishments set status='CANCELLED',revision=revision+1,updated_at=now() where id=o.id;
  end if;
  update private.custody_reminders set revision=revision+1,updated_at=now() where id=r.id;
 end if;
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id,attempt_id)
 values(org,p_store_id,'custody_reminder',r.id::text,action_key,old,p_data,auth.uid(),p_request_id);
 result:=private.custody_reminder_state(p_store_id);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,auth.uid(),action_key,p_data,result);
 return result;
end $$;

-- Confirmed supplier renames still point to the same custody record.
do $patch$
declare src text;anchor text;
begin
 src:=pg_get_functiondef('private.sync_receipt_reminder(uuid,uuid,text,jsonb,jsonb)'::regprocedure);
 anchor:='private.ingredient_match_text(r.supplier)<>private.ingredient_match_text(supplier_name)';
 if strpos(src,anchor)=0 then raise exception 'CUSTODY_SUPPLIER_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'private.ingredient_match_text(private.supplier_display_name((select organization_id from public.stores where id=s),r.supplier))<>private.ingredient_match_text(private.supplier_display_name((select organization_id from public.stores where id=s),supplier_name))');
 execute src;
end $patch$;
-- UTC 02:00 = Taipei 10:00. Writes also enqueue immediately; one row per item/day.
select cron.schedule('beape-custody-daily-reminders','0 2 * * *','select private.enqueue_custody_notifications()');
notify pgrst,'reload schema';
