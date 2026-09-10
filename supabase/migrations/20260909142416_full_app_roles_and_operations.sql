-- Additive operational records. Existing counts, receipts and original evidence stay intact.
create table private.app_requests (
  store_id uuid not null references public.stores(id), request_id uuid not null,
  actor_id uuid not null references auth.users(id), action text not null,
  payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
  primary key(store_id,request_id)
);
create table private.app_settings (
  store_id uuid primary key references public.stores(id),
  settings jsonb not null default '{}'::jsonb, revision integer not null default 1,
  updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table private.app_records (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
  kind text not null check(kind in ('incident','handover','bulletin','company_task')),
  title text not null check(length(btrim(title)) between 1 and 160), body text not null default '',
  category text, status text not null default 'OPEN' check(status in ('OPEN','IN_PROGRESS','COMPLETE')),
  responsible_id uuid references auth.users(id), due_at timestamptz, expires_at timestamptz,
  audience text[] not null default array['STAFF','SUPERVISOR','LOGISTICS','OWNER'],
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  completed_by uuid references auth.users(id), completed_at timestamptz,
  revision integer not null default 1, updated_at timestamptz not null default now()
);
create index app_records_store_kind_status on private.app_records(store_id,kind,status,created_at desc);
create table private.app_record_events (
  id uuid primary key default gen_random_uuid(), record_id uuid not null references private.app_records(id),
  action text not null, note text not null default '', snapshot jsonb not null,
  actor_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index app_record_events_record on private.app_record_events(record_id,created_at);
create table private.app_record_reads (
  record_id uuid not null references private.app_records(id), user_id uuid not null references auth.users(id),
  read_at timestamptz not null default now(), primary key(record_id,user_id)
);
create table private.store_movements (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  from_store_id uuid not null references public.stores(id), to_store_id uuid not null references public.stores(id),
  kind text not null check(kind in ('LOAN','TRANSFER')), product_id uuid references public.products(id),
  name text not null check(length(btrim(name)) between 1 and 160),
  quantity numeric not null check(quantity>0 and quantity<1000000000), unit text not null check(length(btrim(unit)) between 1 and 30),
  returned_quantity numeric not null default 0 check(returned_quantity>=0 and returned_quantity<=quantity),
  expected_return_on date, status text not null check(status in ('OPEN','RETURNED','EXCHANGED','COMPLETE')),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  closed_at timestamptz, revision integer not null default 1,
  check(from_store_id<>to_store_id), check(kind='LOAN' or status='COMPLETE')
);
create index store_movements_from on private.store_movements(from_store_id,status,created_at desc);
create index store_movements_to on private.store_movements(to_store_id,status,created_at desc);
create table private.store_movement_events (
  id uuid primary key default gen_random_uuid(), movement_id uuid not null references private.store_movements(id),
  store_id uuid not null references public.stores(id), action text not null check(action in ('CREATE','RETURN','EXCHANGE')),
  name text not null, quantity numeric not null check(quantity>0 and quantity<1000000000), unit text not null,
  actor_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index store_movement_events_movement on private.store_movement_events(movement_id,created_at);
create table private.product_details (
  product_id uuid primary key references public.products(id), aliases text[] not null default '{}',
  safety_quantity numeric check(safety_quantity>=0), note text not null default '',
  updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table private.supplier_details (
  supplier_id uuid primary key references public.suppliers(id), contact_name text not null default '',
  phone text not null default '', delivery_note text not null default '',
  updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table private.app_delegations (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
  user_id uuid not null references auth.users(id), starts_at timestamptz not null, ends_at timestamptz not null,
  granted_by uuid not null references auth.users(id), revoked_at timestamptz,
  check(ends_at>starts_at), check(ends_at<=starts_at+interval '90 days')
);
create index app_delegations_user_store on private.app_delegations(user_id,store_id,ends_at);
do $$ declare t text; begin
  foreach t in array array['app_requests','app_settings','app_records','app_record_events','app_record_reads','store_movements','store_movement_events','product_details','supplier_details','app_delegations'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on table private.%I from public,anon,authenticated',t);
  end loop;
end $$;

-- Identity is always derived from active database memberships, never editable Auth metadata.
create function private.app_role(p_store uuid) returns text language sql stable security definer set search_path='' as $$
 select case when om.is_owner or o.owner_user_id=auth.uid() or sm.role='OWNER' then 'OWNER'
   when sm.role='ADMIN' then 'SUPERVISOR'
   when sm.role='STAFF' and exists(select 1 from private.app_delegations d where d.store_id=sm.store_id and d.user_id=sm.user_id and d.revoked_at is null and now()>=d.starts_at and now()<d.ends_at) then 'SUPERVISOR'
   else sm.role::text end
 from public.store_memberships sm join public.stores s on s.id=sm.store_id and s.organization_id=sm.organization_id
 join public.organizations o on o.id=s.organization_id
 join public.organization_members om on om.organization_id=sm.organization_id and om.user_id=sm.user_id
 join public.staff_identities si on si.organization_id=sm.organization_id and si.user_id=sm.user_id
 where sm.store_id=p_store and sm.user_id=auth.uid() and sm.is_active and om.is_active and si.is_active and s.is_active
$$;
create function private.app_context() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('user_id',auth.uid(),'stores',coalesce((select jsonb_agg(jsonb_build_object(
 'id',s.id,'organization_id',s.organization_id,'name',s.name,'store_code',s.store_code,'staff_login_mode',s.staff_login_mode,
 'business_type',coalesce(o.business_type::text,'SINGLE_RESTAURANT'),'has_erp',o.has_erp,'store_mode',o.store_mode,
 'role',private.app_role(s.id),'settings',coalesce(st.settings,'{}'::jsonb),
 'linked_store_count',(select count(*) from public.stores other where other.organization_id=s.organization_id and other.is_active),
 'settings_revision',coalesce(st.revision,0)) order by s.name)
 from public.stores s join public.organizations o on o.id=s.organization_id left join private.app_settings st on st.store_id=s.id
 where private.app_role(s.id) is not null),'[]'::jsonb))
$$;
create function public.get_app_context() returns jsonb language sql stable security invoker set search_path='' as $$select private.app_context()$$;

create function private.app_workspace(p_store uuid,p_section text,p_filter jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text:=private.app_role(p_store); v_org uuid; v_type text; v_erp boolean; v_mode text; v_data jsonb;
 v_start timestamptz:=coalesce(nullif(p_filter->>'from','')::timestamptz,date_trunc('month',now()));
 v_end timestamptz:=coalesce(nullif(p_filter->>'to','')::timestamptz,now()+interval '1 day');
begin
 if v_role is null then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
 select s.organization_id,o.business_type::text,o.has_erp,o.store_mode into v_org,v_type,v_erp,v_mode from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store;
 if p_section in ('incidents','handover','bulletins','company-tasks','activity','tasks','notifications') then
  select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('actor_name',p.display_name,'responsible_name',rp.display_name,'read_at',rd.read_at,
    'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'note',e.note,'actor_name',ep.display_name,'created_at',e.created_at) order by e.created_at),'[]'::jsonb) from private.app_record_events e left join public.profiles ep on ep.id=e.actor_id where e.record_id=r.id)) order by r.created_at desc),'[]'::jsonb) into v_data
  from private.app_records r left join public.profiles p on p.id=r.created_by left join public.profiles rp on rp.id=r.responsible_id
  left join private.app_record_reads rd on rd.record_id=r.id and rd.user_id=auth.uid()
  where r.store_id=p_store and (p_section in ('activity','tasks','notifications') or r.kind=case p_section when 'incidents' then 'incident' when 'handover' then 'handover' when 'bulletins' then 'bulletin' when 'company-tasks' then 'company_task' end)
  and (r.kind<>'bulletin' or v_role=any(r.audience) or v_role in ('OWNER','SUPERVISOR'));
  return jsonb_build_object('records',v_data,'role',v_role);
 elsif p_section='transfers' then
  if v_mode<>'MULTI' or (select count(*) from public.stores where organization_id=v_org and is_active)<2 then raise exception 'MULTI_STORE_REQUIRED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('from_name',fs.name,'to_name',ts.name,'actor_name',p.display_name,
   'reference_price',case when not v_erp and v_role<>'STAFF' then (select rl.unit_price_ex_tax from public.receipt_lines rl join public.goods_receipts g on g.id=rl.receipt_id join public.receipt_upload_batches b on b.id=g.source_batch_id where g.store_id=p_store and b.status::text='PUBLISHED' and rl.product_id=m.product_id and rl.unit=m.unit order by g.receipt_date desc,g.reviewed_at desc limit 1) else null end,
   'events',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',ep.display_name) order by e.created_at),'[]'::jsonb) from private.store_movement_events e left join public.profiles ep on ep.id=e.actor_id where e.movement_id=m.id)) order by m.created_at desc),'[]'::jsonb) into v_data
  from private.store_movements m join public.stores fs on fs.id=m.from_store_id join public.stores ts on ts.id=m.to_store_id left join public.profiles p on p.id=m.created_by
  where m.organization_id=v_org and (m.from_store_id=p_store or m.to_store_id=p_store) and (m.status='OPEN' or (m.created_at>=v_start and m.created_at<v_end));
  return jsonb_build_object('records',v_data,'role',v_role,'has_erp',v_erp,'stores',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name),'[]'::jsonb) from public.stores s where s.organization_id=v_org and s.is_active and s.id<>p_store),
   'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit) order by p.name),'[]'::jsonb) from public.products p where p.organization_id=v_org and p.is_active));
 elsif p_section='transfer-search' then
  if v_mode<>'MULTI' then raise exception 'MULTI_STORE_REQUIRED' using errcode='42501'; end if;
  if length(btrim(coalesce(p_filter->>'search','')))<1 then return jsonb_build_object('stores','[]'::jsonb); end if;
  -- Only store name and evidence freshness; no physical count, safety or availability quantities.
  select coalesce(jsonb_agg(x order by x.updated_at desc nulls last),'[]'::jsonb) into v_data from (
   select s.id,s.name,max(cs.completed_at) updated_at from public.stores s
   join public.count_zones z on z.store_id=s.id and z.is_active join public.zone_products zp on zp.zone_id=z.id
   join public.products p on p.id=zp.product_id and p.is_active
   left join public.inventory_count_sessions cs on cs.store_id=s.id and cs.status::text in ('CLOSED','REVIEWING')
   where s.organization_id=v_org and s.is_active and s.id<>p_store and p.name ilike '%'||(p_filter->>'search')||'%' group by s.id,s.name) x;
  return jsonb_build_object('stores',v_data);
 elsif p_section in ('catalog','suppliers','members','business','permissions','settings','audit','reports','costs') then
  if v_role='STAFF' and p_section<>'settings' then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  if p_section='catalog' then
   return jsonb_build_object('editable',v_role in ('OWNER','LOGISTICS') and v_type<>'CHAIN_RESTAURANT','products',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('aliases',coalesce(d.aliases,'{}'),'safety_quantity',d.safety_quantity,'note',d.note,'supplier_name',s.name) order by p.name),'[]'::jsonb) from public.products p left join private.product_details d on d.product_id=p.id left join public.suppliers s on s.id=p.current_supplier_id where p.organization_id=v_org));
  elsif p_section='suppliers' then
   return jsonb_build_object('editable',v_role in ('OWNER','LOGISTICS') and v_type<>'CHAIN_RESTAURANT','suppliers',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('contact_name',d.contact_name,'phone',d.phone,'delivery_note',d.delivery_note) order by s.name),'[]'::jsonb) from public.suppliers s left join private.supplier_details d on d.supplier_id=s.id where s.organization_id=v_org));
  elsif p_section in ('members','permissions') then
   if v_role not in ('SUPERVISOR','OWNER') then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   return jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',sm.user_id,'role',sm.role,'login_identifier',sm.login_identifier,'is_active',sm.is_active,'display_name',si.display_name,'is_owner',om.is_owner,'zone_ids',null) order by si.display_name),'[]'::jsonb) from public.store_memberships sm join public.staff_identities si on si.user_id=sm.user_id and si.organization_id=sm.organization_id join public.organization_members om on om.user_id=sm.user_id and om.organization_id=sm.organization_id where sm.store_id=p_store),
    'delegations',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('display_name',p.display_name)),'[]'::jsonb) from private.app_delegations d left join public.profiles p on p.id=d.user_id where d.store_id=p_store));
  elsif p_section='business' then
   if v_role<>'OWNER' then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   return jsonb_build_object('organization',(select to_jsonb(o) from public.organizations o where o.id=v_org),'stores',(select jsonb_agg(to_jsonb(s) order by s.name) from public.stores s where s.organization_id=v_org and private.app_role(s.id) is not null));
  elsif p_section='settings' then
   return jsonb_build_object('settings',coalesce((select settings from private.app_settings where store_id=p_store),'{}'::jsonb),'editable',v_role in ('OWNER','SUPERVISOR'),'revision',coalesce((select revision from private.app_settings where store_id=p_store),0));
  elsif p_section='audit' then
   if v_role<>'OWNER' then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   return jsonb_build_object('events',(select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from (select a.* ,p.display_name actor_name from public.audit_logs a left join public.profiles p on p.id=a.user_id where a.organization_id=v_org and (a.new_value->>'store_id'=p_store::text or a.entity_id=p_store::text) and a.created_at>=v_start and a.created_at<v_end limit 500) x));
  elsif p_section in ('reports','costs') then
   return jsonb_build_object('counts',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'started_at',s.started_at,'completed_at',s.completed_at,'status',s.status,'paper_completed_at',s.paper_completed_at) order by s.started_at desc),'[]'::jsonb) from public.inventory_count_sessions s where s.store_id=p_store and s.status::text in ('CLOSED','REVIEWING') and s.completed_at>=v_start and s.completed_at<v_end),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('supplier_name',sp.name) order by g.receipt_date desc),'[]'::jsonb) from public.goods_receipts g join public.receipt_upload_batches b on b.id=g.source_batch_id left join public.suppliers sp on sp.id=g.supplier_id where g.store_id=p_store and b.status::text='PUBLISHED' and g.reviewed_at>=v_start and g.reviewed_at<v_end),
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'receipt_id',g.id,'product_id',l.product_id,'name',coalesce(p.name,l.ai_original->>'raw_product_name','未對應'),'quantity',l.quantity,'unit',l.unit,'unit_price',l.unit_price_ex_tax,'amount',l.line_total_inc_tax,'receipt_date',g.receipt_date,'supplier_name',sp.name)),'[]'::jsonb) from public.receipt_lines l join public.goods_receipts g on g.id=l.receipt_id join public.receipt_upload_batches b on b.id=g.source_batch_id left join public.products p on p.id=l.product_id left join public.suppliers sp on sp.id=g.supplier_id where g.store_id=p_store and b.status::text='PUBLISHED' and g.reviewed_at>=v_start and g.reviewed_at<v_end));
  end if;
 end if;
 raise exception 'INVALID_APP_SECTION' using errcode='22023';
end $$;
create function public.app_workspace(p_store_id uuid,p_section text,p_filter jsonb default '{}') returns jsonb language sql stable security invoker set search_path='' as $$ select private.app_workspace(p_store_id,p_section,p_filter) $$;

create function private.app_operation(p_store uuid,p_action text,p_data jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role text:=private.app_role(p_store); v_org uuid; v_type text; v_mode text; v_old jsonb; v_result jsonb;
 v_cached private.app_requests; v_record private.app_records; v_move private.store_movements;
 v_id uuid; v_other uuid; v_target uuid; v_qty numeric; v_name text; v_unit text; v_kind text;
begin
 if v_role is null or p_request is null then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>64000 then raise exception 'INVALID_APP_INPUT' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_request::text,0));
 select * into v_cached from private.app_requests where store_id=p_store and request_id=p_request;
 if found then
  if v_cached.actor_id<>auth.uid() or v_cached.action<>p_action or v_cached.payload<>p_data then raise exception 'REQUEST_CONFLICT' using errcode='23505'; end if;
  return v_cached.result;
 end if;
 select s.organization_id,o.business_type::text,o.store_mode into v_org,v_type,v_mode from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store;
 if p_action='record.create' then
  v_kind:=p_data->>'kind';
  if v_kind not in ('incident','handover','bulletin','company_task') or (v_kind in ('bulletin','company_task') and v_role='STAFF') then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  v_target:=nullif(p_data->>'responsible_id','')::uuid;
  if v_target is not null and not exists(select 1 from public.store_memberships sm join public.organization_members om on om.organization_id=sm.organization_id and om.user_id=sm.user_id where sm.store_id=p_store and sm.user_id=v_target and sm.is_active and om.is_active) then raise exception 'INVALID_RESPONSIBLE' using errcode='22023'; end if;
  if v_kind='company_task' and not exists(select 1 from public.organizations where id=v_org and has_erp) then raise exception 'ERP_NOT_ENABLED' using errcode='22023'; end if;
  insert into private.app_records(store_id,kind,title,body,category,responsible_id,due_at,expires_at,audience,created_by)
  values(p_store,v_kind,btrim(p_data->>'title'),coalesce(p_data->>'body',''),nullif(p_data->>'category',''),v_target,nullif(p_data->>'due_at','')::timestamptz,nullif(p_data->>'expires_at','')::timestamptz,
   coalesce((select array_agg(value) from jsonb_array_elements_text(p_data->'audience') where value in ('STAFF','SUPERVISOR','LOGISTICS','OWNER')),array['STAFF','SUPERVISOR','LOGISTICS','OWNER']),auth.uid()) returning * into v_record;
  v_id:=v_record.id; v_result:=to_jsonb(v_record);
  insert into private.app_record_events(record_id,action,snapshot,actor_id) values(v_id,'CREATE',v_result,auth.uid());
 elsif p_action in ('record.take','record.complete','record.read','record.update') then
  select * into v_record from private.app_records where id=(p_data->>'id')::uuid and store_id=p_store for update;
  if not found then raise exception 'RECORD_NOT_FOUND' using errcode='P0002'; end if;
  if v_record.kind='bulletin' and not (v_role=any(v_record.audience) or v_role in ('SUPERVISOR','OWNER')) then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  v_id:=v_record.id; v_old:=to_jsonb(v_record);
  if p_action='record.read' then
   insert into private.app_record_reads(record_id,user_id) values(v_id,auth.uid()) on conflict do nothing;
   v_result:=jsonb_build_object('id',v_id,'read_at',(select read_at from private.app_record_reads where record_id=v_id and user_id=auth.uid()));
  else
   if v_record.kind='bulletin' and v_role='STAFF' then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   if p_action='record.update' and v_role='STAFF' and v_record.created_by<>auth.uid() then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   if p_action='record.complete' and v_record.kind='incident' and v_role='STAFF' and coalesce(v_record.responsible_id,v_record.created_by)<>auth.uid() then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
   if v_record.status='COMPLETE' then v_result:=v_old;
   else
    if (p_data->>'revision')::int is distinct from v_record.revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
    if p_action='record.take' then
     update private.app_records set responsible_id=auth.uid(),status='IN_PROGRESS',revision=revision+1,updated_at=now() where id=v_id returning * into v_record;
    elsif p_action='record.complete' then
     update private.app_records set status='COMPLETE',completed_by=auth.uid(),completed_at=now(),revision=revision+1,updated_at=now() where id=v_id returning * into v_record;
    else
     update private.app_records set title=btrim(p_data->>'title'),body=coalesce(p_data->>'body',''),revision=revision+1,updated_at=now() where id=v_id returning * into v_record;
    end if;
    v_result:=to_jsonb(v_record);
    insert into private.app_record_events(record_id,action,note,snapshot,actor_id) values(v_id,p_action,coalesce(p_data->>'note',''),v_result,auth.uid());
   end if;
  end if;
 elsif p_action in ('movement.create','movement.return','movement.exchange') then
  if v_role not in ('STAFF','SUPERVISOR') then raise exception 'FIELD_ROLE_REQUIRED' using errcode='42501'; end if;
  if v_mode<>'MULTI' then raise exception 'MULTI_STORE_REQUIRED' using errcode='42501'; end if;
  v_qty:=(p_data->>'quantity')::numeric;
  if v_qty is null or v_qty<=0 or v_qty>=1000000000 then raise exception 'INVALID_QUANTITY' using errcode='22023'; end if;
  if p_action='movement.create' then
   v_kind:=p_data->>'mode'; v_other:=(p_data->>'other_store_id')::uuid;
   if v_kind not in ('loan','loan_out','move') or v_other=p_store or not exists(select 1 from public.stores where id=v_other and organization_id=v_org and is_active) then raise exception 'INVALID_MOVEMENT' using errcode='22023'; end if;
   v_target:=nullif(p_data->>'product_id','')::uuid;
   if v_target is not null and not exists(select 1 from public.products where id=v_target and organization_id=v_org and is_active) then raise exception 'INVALID_PRODUCT' using errcode='22023'; end if;
   v_name:=btrim(p_data->>'name'); v_unit:=btrim(p_data->>'unit');
   insert into private.store_movements(organization_id,from_store_id,to_store_id,kind,product_id,name,quantity,unit,expected_return_on,status,created_by,closed_at)
   values(v_org,case when v_kind='loan' then v_other else p_store end,case when v_kind='loan' then p_store else v_other end,case when v_kind='move' then 'TRANSFER' else 'LOAN' end,v_target,v_name,v_qty,v_unit,case when v_kind<>'move' then nullif(p_data->>'expected_return_on','')::date end,case when v_kind='move' then 'COMPLETE' else 'OPEN' end,auth.uid(),case when v_kind='move' then now() end) returning * into v_move;
  else
   select * into v_move from private.store_movements where id=(p_data->>'id')::uuid and organization_id=v_org and p_store in (from_store_id,to_store_id) for update;
   if not found then raise exception 'MOVEMENT_NOT_FOUND' using errcode='P0002'; end if;
   if v_move.status<>'OPEN' then raise exception 'MOVEMENT_ALREADY_CLOSED' using errcode='22023'; end if;
   if (p_data->>'revision')::int is distinct from v_move.revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
   v_old:=to_jsonb(v_move);
   if p_action='movement.return' then
    if v_qty>v_move.quantity-v_move.returned_quantity then raise exception 'RETURN_EXCEEDS_REMAINING' using errcode='22023'; end if;
    v_name:=v_move.name; v_unit:=v_move.unit;
    update private.store_movements set returned_quantity=returned_quantity+v_qty,status=case when returned_quantity+v_qty=quantity then 'RETURNED' else 'OPEN' end,closed_at=case when returned_quantity+v_qty=quantity then now() end,revision=revision+1 where id=v_move.id returning * into v_move;
   else
    v_name:=btrim(p_data->>'name'); v_unit:=btrim(p_data->>'unit');
    if length(coalesce(v_name,'')) not between 1 and 160 or length(coalesce(v_unit,'')) not between 1 and 30 then raise exception 'INVALID_EXCHANGE' using errcode='22023'; end if;
    update private.store_movements set status='EXCHANGED',closed_at=now(),revision=revision+1 where id=v_move.id returning * into v_move;
   end if;
  end if;
  v_id:=v_move.id; v_result:=to_jsonb(v_move);
  insert into private.store_movement_events(movement_id,store_id,action,name,quantity,unit,actor_id) values(v_id,p_store,case p_action when 'movement.create' then 'CREATE' when 'movement.return' then 'RETURN' else 'EXCHANGE' end,v_name,v_qty,v_unit,auth.uid());
 else
  -- Management operations continue below; the dispatcher does not accept arbitrary table names.
  v_result:=private.app_management(p_store,p_action,p_data);
  v_id:=nullif(v_result->>'id','')::uuid;
 end if;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store,p_request,auth.uid(),p_action,p_data,v_result);
 if p_action<>'record.read' then
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
  values(v_org,'app_operation',coalesce(v_id,p_store)::text,p_action,v_old,v_result||jsonb_build_object('store_id',p_store),auth.uid());
 end if;
 return v_result;
end $$;
create function public.app_operation(p_store_id uuid,p_action text,p_data jsonb,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.app_operation(p_store_id,p_action,p_data,p_request_id)$$;

create function private.app_management(p_store uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role text:=private.app_role(p_store); v_org uuid; v_type text; v_id uuid; v_target uuid; v_old jsonb; v_result jsonb;
 v_product public.products; v_supplier public.suppliers; v_member public.store_memberships; v_settings private.app_settings;
begin
 if v_role is null or v_role='STAFF' then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
 select s.organization_id,o.business_type::text into v_org,v_type from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store;
 if p_action in ('product.save','supplier.save') then
  if v_role not in ('LOGISTICS','OWNER') or v_type='CHAIN_RESTAURANT' then raise exception 'CATALOG_ROLE_REQUIRED' using errcode='42501'; end if;
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 160 then raise exception 'INVALID_NAME' using errcode='22023'; end if;
  v_id:=nullif(p_data->>'id','')::uuid;
  if p_action='product.save' then
   if length(btrim(coalesce(p_data->>'unit',''))) not between 1 and 30 then raise exception 'INVALID_UNIT' using errcode='22023'; end if;
   v_target:=nullif(p_data->>'supplier_id','')::uuid;
   if v_target is not null and not exists(select 1 from public.suppliers where id=v_target and organization_id=v_org) then raise exception 'INVALID_SUPPLIER' using errcode='22023'; end if;
   if v_id is null then
    insert into public.products(organization_id,product_code,name,category,base_unit,count_unit,current_supplier_id,specification)
    values(v_org,coalesce(nullif(btrim(p_data->>'code'),''),'P-'||gen_random_uuid()::text),btrim(p_data->>'name'),nullif(p_data->>'category',''),btrim(p_data->>'unit'),btrim(p_data->>'unit'),v_target,nullif(p_data->>'specification','')) returning * into v_product;
    v_id:=v_product.id;
   else
    select * into v_product from public.products where id=v_id and organization_id=v_org for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002'; end if;
    v_old:=to_jsonb(v_product);
    if (p_data->>'updated_at')::timestamptz is distinct from v_product.updated_at then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
    update public.products set name=btrim(p_data->>'name'),product_code=coalesce(nullif(btrim(p_data->>'code'),''),product_code),category=nullif(p_data->>'category',''),base_unit=btrim(p_data->>'unit'),count_unit=btrim(p_data->>'unit'),specification=nullif(p_data->>'specification',''),current_supplier_id=v_target,is_active=coalesce((p_data->>'is_active')::boolean,true),updated_at=now() where id=v_id returning * into v_product;
   end if;
   insert into private.product_details(product_id,aliases,safety_quantity,note,updated_by) values(v_id,coalesce((select array_agg(btrim(value)) from jsonb_array_elements_text(p_data->'aliases') where btrim(value)<>''),'{}'),nullif(p_data->>'safety_quantity','')::numeric,coalesce(p_data->>'note',''),auth.uid())
   on conflict(product_id) do update set aliases=excluded.aliases,safety_quantity=excluded.safety_quantity,note=excluded.note,updated_by=excluded.updated_by,updated_at=now();
   v_result:=to_jsonb(v_product);
  else
   if v_id is null then
    insert into public.suppliers(organization_id,supplier_code,name) values(v_org,coalesce(nullif(btrim(p_data->>'code'),''),'S-'||gen_random_uuid()::text),btrim(p_data->>'name')) returning * into v_supplier;
    v_id:=v_supplier.id;
   else
    select * into v_supplier from public.suppliers where id=v_id and organization_id=v_org for update;
    if not found then raise exception 'SUPPLIER_NOT_FOUND' using errcode='P0002'; end if;
    v_old:=to_jsonb(v_supplier);
    if (p_data->>'updated_at')::timestamptz is distinct from v_supplier.updated_at then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
    update public.suppliers set name=btrim(p_data->>'name'),supplier_code=coalesce(nullif(btrim(p_data->>'code'),''),supplier_code),is_active=coalesce((p_data->>'is_active')::boolean,true),updated_at=now() where id=v_id returning * into v_supplier;
   end if;
   insert into private.supplier_details(supplier_id,contact_name,phone,delivery_note,updated_by) values(v_id,coalesce(p_data->>'contact_name',''),coalesce(p_data->>'phone',''),coalesce(p_data->>'delivery_note',''),auth.uid())
   on conflict(supplier_id) do update set contact_name=excluded.contact_name,phone=excluded.phone,delivery_note=excluded.delivery_note,updated_by=excluded.updated_by,updated_at=now();
   v_result:=to_jsonb(v_supplier);
  end if;
 elsif p_action='settings.save' then
  if v_role not in ('OWNER','SUPERVISOR') then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  if jsonb_typeof(p_data->'settings')<>'object' or exists(select 1 from jsonb_object_keys(p_data->'settings') k where k not in ('remember_device','reauth_days','device_type','erp_receiving','erp_waste','erp_time','paper_required','count_cadence','blind_count')) then raise exception 'INVALID_SETTINGS' using errcode='22023'; end if;
  if (p_data->'settings' ? 'reauth_days') and (p_data->'settings'->>'reauth_days') not in ('0','1','7','30') then raise exception 'INVALID_SETTINGS' using errcode='22023'; end if;
  if (p_data->'settings' ? 'device_type') and (p_data->'settings'->>'device_type') not in ('PERSONAL','SHARED') then raise exception 'INVALID_SETTINGS' using errcode='22023'; end if;
  if (p_data->'settings' ? 'erp_time') and (p_data->'settings'->>'erp_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'INVALID_SETTINGS' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(p_data->'settings') e where e.key in ('remember_device','erp_receiving','erp_waste','paper_required','blind_count') and jsonb_typeof(e.value)<>'boolean') then raise exception 'INVALID_SETTINGS' using errcode='22023'; end if;
  select * into v_settings from private.app_settings where store_id=p_store for update;
  if coalesce(v_settings.revision,0) is distinct from (p_data->>'revision')::int then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  v_old:=to_jsonb(v_settings);
  insert into private.app_settings(store_id,settings,updated_by) values(p_store,p_data->'settings',auth.uid()) on conflict(store_id) do update set settings=private.app_settings.settings||excluded.settings,updated_by=excluded.updated_by,updated_at=now(),revision=private.app_settings.revision+1 returning * into v_settings;
  if v_settings.settings ? 'erp_time' then update public.stores set waste_erp_reminder_time=(v_settings.settings->>'erp_time')::time where id=p_store; end if;
  v_result:=to_jsonb(v_settings);
 elsif p_action='business.save' then
  if v_role<>'OWNER' then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 160 or p_data->>'business_type' not in ('SINGLE_RESTAURANT','CHAIN_RESTAURANT') or p_data->>'store_mode' not in ('SINGLE','MULTI') or jsonb_typeof(p_data->'has_erp')<>'boolean' then raise exception 'INVALID_BUSINESS' using errcode='22023'; end if;
  select to_jsonb(o) into v_old from public.organizations o where o.id=v_org for update;
  if (p_data->>'updated_at')::timestamptz is distinct from (v_old->>'updated_at')::timestamptz then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  update public.organizations o set name=btrim(p_data->>'name'),business_type=(jsonb_populate_record(null::public.organizations,p_data)).business_type,store_mode=p_data->>'store_mode',has_erp=(p_data->>'has_erp')::boolean,updated_at=now() where o.id=v_org returning to_jsonb(o) into v_result;
 elsif p_action='store.save' then
  if v_role not in ('OWNER','SUPERVISOR') then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  v_id:=(p_data->>'id')::uuid;
  if v_id<>p_store or length(btrim(coalesce(p_data->>'name',''))) not between 1 and 160 or p_data->>'staff_login_mode' not in ('NAME_OR_NICKNAME','EMPLOYEE_NUMBER') then raise exception 'INVALID_STORE' using errcode='22023'; end if;
  if not coalesce((p_data->>'is_active')::boolean,true) then
   if v_role<>'OWNER' or (select count(*) from public.stores where organization_id=v_org and is_active)<=1 then raise exception 'ACTIVE_STORE_REQUIRED' using errcode='22023'; end if;
  end if;
  select to_jsonb(s) into v_old from public.stores s where id=v_id for update;
  if (p_data->>'updated_at')::timestamptz is distinct from (v_old->>'updated_at')::timestamptz then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  update public.stores s set name=btrim(p_data->>'name'),staff_login_mode=p_data->>'staff_login_mode',is_active=coalesce((p_data->>'is_active')::boolean,true),updated_at=now() where id=v_id returning to_jsonb(s) into v_result;
 elsif p_action in ('member.save','member.assign','delegation.create','delegation.revoke') then
  if v_role not in ('OWNER','SUPERVISOR') then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  v_target:=(p_data->>'user_id')::uuid;
  if v_target=auth.uid() or exists(select 1 from public.organization_members om join public.organizations o on o.id=om.organization_id where om.organization_id=v_org and om.user_id=v_target and (om.is_owner or o.owner_user_id=v_target)) then raise exception 'CANNOT_CHANGE_OWNER_OR_SELF' using errcode='42501'; end if;
  select * into v_member from public.store_memberships where store_id=p_store and user_id=v_target for update;
  if p_action<>'member.assign' and not found then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002'; end if;
  if v_role='SUPERVISOR' and (v_member.role<>'STAFF' or p_action<>'member.save' or p_data->>'role'<>'STAFF') then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  if p_action in ('member.save','member.assign') then
   if p_data->>'role' not in ('STAFF','SUPERVISOR','LOGISTICS','OWNER') or length(btrim(coalesce(p_data->>'login_identifier',''))) not between 1 and 64 then raise exception 'INVALID_MEMBER' using errcode='22023'; end if;
   if not exists(select 1 from public.organization_members where organization_id=v_org and user_id=v_target and is_active) then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002'; end if;
   v_old:=to_jsonb(v_member);
   insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,is_active,assigned_by)
   values(p_store,v_org,v_target,btrim(p_data->>'login_identifier'),(p_data->>'role')::public.app_role,coalesce((p_data->>'is_active')::boolean,true),auth.uid())
   on conflict(store_id,user_id) do update set login_identifier=excluded.login_identifier,role=excluded.role,is_active=excluded.is_active,assigned_by=excluded.assigned_by,updated_at=now() returning * into v_member;
   if length(btrim(coalesce(p_data->>'display_name','')))>0 then
    update public.staff_identities set display_name=btrim(p_data->>'display_name'),updated_at=now() where user_id=v_target and organization_id=v_org;
    update public.profiles set display_name=btrim(p_data->>'display_name') where id=v_target;
   end if;
   v_result:=to_jsonb(v_member);
  elsif p_action='delegation.create' then
   if v_role<>'OWNER' or v_member.role<>'STAFF' or not v_member.is_active then raise exception 'INVALID_DELEGATE' using errcode='42501'; end if;
   insert into private.app_delegations(store_id,user_id,starts_at,ends_at,granted_by) values(p_store,v_target,(p_data->>'starts_at')::timestamptz,(p_data->>'ends_at')::timestamptz,auth.uid()) returning to_jsonb(private.app_delegations.*) into v_result;
  else
   if v_role<>'OWNER' then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
   update private.app_delegations d set revoked_at=now() where id=(p_data->>'id')::uuid and store_id=p_store and user_id=v_target returning to_jsonb(d) into v_result;
   if v_result is null then raise exception 'DELEGATION_NOT_FOUND' using errcode='P0002'; end if;
  end if;
 else raise exception 'INVALID_APP_ACTION' using errcode='22023';
 end if;
 return jsonb_build_object('id',coalesce(v_id,p_store),'value',v_result,'previous',v_old);
end $$;

revoke all on function private.app_role(uuid),private.app_context(),private.app_workspace(uuid,text,jsonb),private.app_operation(uuid,text,jsonb,uuid),private.app_management(uuid,text,jsonb) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.app_role(uuid),private.app_context(),private.app_workspace(uuid,text,jsonb),private.app_operation(uuid,text,jsonb,uuid) to authenticated;
revoke all on function public.get_app_context(),public.app_workspace(uuid,text,jsonb),public.app_operation(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.get_app_context(),public.app_workspace(uuid,text,jsonb),public.app_operation(uuid,text,jsonb,uuid) to authenticated;
