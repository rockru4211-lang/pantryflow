-- Additive supplier-side reminders. Legacy in-store reservations stay untouched.
create table private.custody_reminders (
 id uuid primary key default gen_random_uuid(),store_id uuid not null references public.stores(id),
 product_id uuid not null references public.products(id),kind text not null check(kind in ('supplier','reserved')),
 name text not null,supplier text not null check(length(btrim(supplier)) between 1 and 120),unit text not null check(length(btrim(unit)) between 1 and 30),
 remaining numeric not null check(remaining>=0 and remaining<1e9),note text not null default '' check(length(note)<=2000),revision integer not null default 1,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(store_id,product_id,kind,supplier,unit)
);
create table private.custody_reminder_receipts (
 batch_id uuid not null references public.receipt_upload_batches(id),row_key text not null,reminder_id uuid not null references private.custody_reminders(id),
 quantity numeric not null check(quantity>=0 and quantity<1e9),active boolean not null default true,updated_at timestamptz not null default now(),primary key(batch_id,row_key)
);
create index custody_reminder_receipts_target on private.custody_reminder_receipts(reminder_id);
alter table private.custody_reminders enable row level security;
alter table private.custody_reminder_receipts enable row level security;
revoke all on private.custody_reminders,private.custody_reminder_receipts from public,anon,authenticated;

create function private.custody_reminder_state(s uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.name,r.supplier,r.id) from private.custody_reminders r where r.store_id=s),'[]'),
 'tags',coalesce((select jsonb_agg(t) from (
 select distinct r.name,r.unit,r.kind from private.custody_reminders r
 where r.store_id=s or exists(select 1 from private.store_movements m where m.from_store_id=r.store_id and m.to_store_id=s and m.product_id=r.product_id and m.unit=r.unit and m.kind='TRANSFER' and m.status='COMPLETE')
 ) t),'[]'),
 'products',coalesce((private.custody_state(s,'supplier')->'products'),'[]'));
$$;
revoke all on function private.custody_reminder_state(uuid) from public,anon,authenticated;
create function private.baihuayuan_custody_reminders(p_store_id uuid,p_action text,p_data jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.custody_reminders; old jsonb; cached private.app_requests; result jsonb; org uuid; product_name text;q numeric;payload jsonb;
begin
 if auth.uid() is null or not private.has_active_store_role(p_store_id,null) or not private.app_session_valid(p_store_id)
 or not exists(select 1 from public.stores where id=p_store_id and is_active and name in ('BeApe','Gras')) then raise exception 'REMINDER_FORBIDDEN' using errcode='42501';end if;
 if p_action='read' then return private.custody_reminder_state(p_store_id);end if;
 if not private.has_active_store_role(p_store_id,array['LOGISTICS','OWNER']::public.app_role[]) then raise exception 'REMINDER_FORBIDDEN' using errcode='42501';end if;
 perform private.assert_store_editable(p_store_id);
 if p_action<>'save' or p_request_id is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000 then raise exception 'REMINDER_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('reminder:'||p_store_id::text,0));
 payload:=p_data;
 select * into cached from private.app_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'custody.reminder-save' or cached.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return cached.result;
 end if;
 q:=private.receipt_account_number(p_data->>'remaining');
 if q is null or q<0 or q>=1e9 or coalesce(p_data->>'kind','') not in ('supplier','reserved') or length(coalesce(p_data->>'note',''))>2000 then raise exception 'REMINDER_INVALID' using errcode='22023';end if;
 select organization_id into org from public.stores where id=p_store_id;
 if nullif(p_data->>'id','') is null then
  select p.name into product_name from public.products p where p.id=(p_data->>'product_id')::uuid and p.organization_id=org and p.is_active
   and exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where zp.product_id=p.id and z.store_id=p_store_id and z.is_active);
  if product_name is null or length(btrim(coalesce(p_data->>'supplier',''))) not between 1 and 120 or length(btrim(coalesce(p_data->>'unit',''))) not between 1 and 30 then raise exception 'REMINDER_INVALID' using errcode='22023';end if;
  insert into private.custody_reminders(store_id,product_id,kind,name,supplier,unit,remaining,note,created_by)
   values(p_store_id,(p_data->>'product_id')::uuid,p_data->>'kind',product_name,btrim(p_data->>'supplier'),btrim(p_data->>'unit'),q,coalesce(p_data->>'note',''),auth.uid()) returning * into r;
 else
  select * into r from private.custody_reminders where id=(p_data->>'id')::uuid and store_id=p_store_id for update;
  if r.id is null then raise exception 'REMINDER_FORBIDDEN' using errcode='42501';end if;
  if r.revision is distinct from (p_data->>'revision')::integer then raise exception 'REMINDER_CHANGED' using errcode='PT409';end if;
  old:=to_jsonb(r);
  update private.custody_reminders set remaining=q,note=coalesce(p_data->>'note',''),revision=revision+1,updated_at=now() where id=r.id;
 end if;
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id,attempt_id)
 values(org,p_store_id,'custody_reminder',r.id::text,'custody.reminder-save',old,p_data,auth.uid(),p_request_id);
 result:=private.custody_reminder_state(p_store_id);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,auth.uid(),'custody.reminder-save',payload,result);
 return result;
end $$;
revoke all on function private.baihuayuan_custody_reminders(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.baihuayuan_custody_reminders(uuid,text,jsonb,uuid) to authenticated;
create function public.baihuayuan_custody_reminders(p_store_id uuid,p_action text default 'read',p_data jsonb default '{}',p_request_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$select private.baihuayuan_custody_reminders(p_store_id,p_action,p_data,p_request_id)$$;
revoke all on function public.baihuayuan_custody_reminders(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.baihuayuan_custody_reminders(uuid,text,jsonb,uuid) to authenticated;

-- Called inside the existing authorized revision-checked receipt save transaction.
-- Only the supplier reminder changes: ordinary receipt, stock and money paths remain intact.
create function private.sync_receipt_reminder(s uuid,b uuid,supplier_name text,l jsonb,previous_line jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prior private.custody_reminder_receipts;r private.custody_reminders;target uuid;q numeric;old_amount numeric;delta numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended('reminder:'||s::text,0));
 select * into prior from private.custody_reminder_receipts where batch_id=b and row_key=l->>'row_key' for update;
 -- Old clients must not erase a durable link just because they lack the new field.
 if not (l ? 'custody_reminder_id') then l:=l||jsonb_build_object('custody_reminder_id',coalesce(previous_line->>'custody_reminder_id',prior.reminder_id::text,''));end if;
 target:=nullif(l->>'custody_reminder_id','')::uuid;
 if target is not null then
  select * into r from private.custody_reminders where id=target and store_id=s for update;
  if r.id is null or coalesce(l->>'handling','NORMAL')<>'NORMAL'
   or private.ingredient_match_text(r.name)<>private.ingredient_match_text(l->>'product_name')
   or private.ingredient_match_text(r.supplier)<>private.ingredient_match_text(supplier_name)
   or private.ingredient_match_text(r.unit)<>private.ingredient_match_text(l->>'unit') then raise exception 'REMINDER_MISMATCH' using errcode='22023';end if;
  q:=private.receipt_account_number(l->>'quantity');
  if q is null or q<0 or q>=1e9 then raise exception 'REMINDER_INVALID' using errcode='22023';end if;
 end if;
 if prior.reminder_id is not null and prior.reminder_id is distinct from target then
  update private.custody_reminders set remaining=remaining+case when prior.active then prior.quantity else 0 end,revision=revision+1,updated_at=now() where id=prior.reminder_id and store_id=s;
  delete from private.custody_reminder_receipts where batch_id=b and row_key=l->>'row_key';
 end if;
 if target is not null then
  old_amount:=case when prior.reminder_id=target and prior.active then prior.quantity else 0 end;
  delta:=q-old_amount;
  if r.remaining<delta then raise exception 'REMINDER_INSUFFICIENT' using errcode='22023';end if;
  if delta<>0 then update private.custody_reminders set remaining=remaining-delta,revision=revision+1,updated_at=now() where id=target;end if;
  insert into private.custody_reminder_receipts(batch_id,row_key,reminder_id,quantity) values(b,l->>'row_key',target,q)
   on conflict(batch_id,row_key) do update set reminder_id=excluded.reminder_id,quantity=excluded.quantity,active=true,updated_at=now();
  return l||jsonb_build_object('custody_reminder_kind',r.kind);
 end if;
 return l-'custody_reminder_kind';
end $$;
revoke all on function private.sync_receipt_reminder(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;

-- Removing a receipt restores its reserved amount; restoring it re-applies once.
create function private.custody_reminder_record_state() returns trigger language plpgsql security definer set search_path='' as $$
declare link private.custody_reminder_receipts;s uuid;desired boolean;
begin
 if new.entity_type<>'RECEIPT_BATCH' then return new;end if;
 select store_id into s from public.receipt_upload_batches where id=new.entity_id;
 if s is null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('reminder:'||s::text,0));
 desired:=new.state='LIVE';
 for link in select * from private.custody_reminder_receipts where batch_id=new.entity_id and active is distinct from desired for update loop
  if desired and (select remaining from private.custody_reminders where id=link.reminder_id)<link.quantity then raise exception 'REMINDER_INSUFFICIENT' using errcode='22023';end if;
  update private.custody_reminders set remaining=remaining+case when desired then -link.quantity else link.quantity end,revision=revision+1,updated_at=now() where id=link.reminder_id;
  update private.custody_reminder_receipts set active=desired where batch_id=link.batch_id and row_key=link.row_key;
 end loop;
 return new;
end $$;
revoke all on function private.custody_reminder_record_state() from public,anon,authenticated;
create trigger custody_reminder_record_state after insert or update on private.baihuayuan_record_flags for each row execute function private.custody_reminder_record_state();

do $patch$
declare src text;anchor text;
begin
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='q:=private.receipt_account_number(l->>''quantity'');price:=private.receipt_account_number(l->>''unit_price'');subtotal:=private.receipt_account_number(l->>''subtotal'');';
 if strpos(src,anchor)=0 then raise exception 'REMINDER_SAVE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'l:=private.sync_receipt_reminder(p_store_id,p_batch_id,header->>''supplier_name'',l,(select x from jsonb_array_elements(current_row->''lines'') x where x->>''row_key''=l->>''row_key''));'||chr(10)||anchor);
 anchor:='where key in (''ingredient_id''';
 if strpos(src,anchor)=0 then raise exception 'REMINDER_FIELDS_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'where key in (''custody_reminder_id'',''custody_reminder_kind'',''ingredient_id''');
 execute src;
end $patch$;
notify pgrst,'reload schema';
