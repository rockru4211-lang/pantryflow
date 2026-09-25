create table private.custody_accounts (
 id uuid primary key default gen_random_uuid(),store_id uuid not null references public.stores(id),
 product_id uuid not null references public.products(id),kind text not null check(kind in ('supplier','reserved')),
 name text not null,unit text not null check(length(btrim(unit)) between 1 and 30),party text not null check(length(btrim(party)) between 1 and 120),
 minimum numeric not null default 0 check(minimum>=0 and minimum<1000000000),warning_days integer not null default 30 check(warning_days between 1 and 365),
 followup text not null default 'pending' check(followup in ('pending','contacted','ordered','complete')),
 note text not null default '' check(length(note)<=2000),revision integer not null default 1,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(store_id,product_id,kind,unit,party)
);
create table private.custody_lots (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references private.custody_accounts(id),
 label text not null check(length(btrim(label)) between 1 and 120),quantity numeric not null check(quantity>0 and quantity<1000000000),
 remaining numeric not null check(remaining>=0 and remaining<=quantity),expires_on date,
 reference text not null default '' check(length(reference)<=200),created_at timestamptz not null default now()
);
create index custody_lots_account on private.custody_lots(account_id);
create table private.custody_events (
 id uuid primary key,store_id uuid not null references public.stores(id),account_id uuid not null references private.custody_accounts(id),
 lot_id uuid references private.custody_lots(id),action text not null check(action in ('create','batch','collect','settings')),
 quantity numeric,occurred_on date not null,handler text not null check(length(btrim(handler)) between 1 and 120),
 note text not null default '' check(length(note)<=2000),actor_id uuid not null references public.profiles(id),fingerprint text not null,created_at timestamptz not null default now()
);
create index custody_events_account on private.custody_events(account_id,created_at desc);
do $$ declare t text;begin foreach t in array array['custody_accounts','custody_lots','custody_events'] loop
 execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated',t);
end loop;end $$;

create function private.custody_state(s uuid,k text) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('store_id',s,'kind',k,'accounts',coalesce((
 select jsonb_agg(to_jsonb(a)||jsonb_build_object(
 'remaining',coalesce((select sum(l.remaining) from private.custody_lots l where l.account_id=a.id),0),
 'original',coalesce((select sum(l.quantity) from private.custody_lots l where l.account_id=a.id),0),
 'lots',coalesce((select jsonb_agg(to_jsonb(l) order by l.expires_on nulls last,l.created_at,l.id) from private.custody_lots l where l.account_id=a.id),'[]'),
 'events',coalesce((select jsonb_agg(to_jsonb(e)-'fingerprint'||jsonb_build_object('actor',coalesce(p.display_name,'未提供')) order by e.created_at desc,e.id) from private.custody_events e left join public.profiles p on p.id=e.actor_id where e.account_id=a.id),'[]')
 ) order by a.name,a.party,a.id) from private.custody_accounts a where a.store_id=s and a.kind=k),'[]'),
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.count_unit,'supplier',coalesce(sp.name,'')) order by p.name,p.id)
 from public.products p left join public.suppliers sp on sp.id=p.current_supplier_id
 where p.is_active and p.organization_id=(select organization_id from public.stores where id=s)
 and exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where zp.product_id=p.id and z.store_id=s and z.is_active)),'[]'))
$$;
revoke all on function private.custody_state(uuid,text) from public,anon,authenticated;

create function private.baihuayuan_custody(p_store_id uuid,p_kind text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare a private.custody_accounts;l private.custody_lots;prior private.custody_events;
 org uuid;request_id uuid;product uuid;q numeric;minimum numeric;days integer;date_value date;expiry date;
 fingerprint text;handler text;party text;unit_value text;label_value text;name_value text;followup text;
begin
 if auth.uid() is null or coalesce(private.app_role(p_store_id),'') not in ('LOGISTICS','OWNER')
 or not private.has_active_store_role(p_store_id,null) or not private.app_session_valid(p_store_id)
 then raise exception using errcode='42501',message='CUSTODY_ADMIN_REQUIRED';end if;
 select organization_id into org from public.stores where id=p_store_id and is_active and name in ('BeApe','Gras');
 if org is null then raise exception using errcode='42501',message='CUSTODY_ADMIN_REQUIRED';end if;
 if p_kind is null or p_kind not in ('supplier','reserved') or p_action is null or p_action not in ('read','create','batch','collect','settings')
 or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then raise exception using errcode='22023',message='CUSTODY_INVALID';end if;
 if p_action='read' then return private.custody_state(p_store_id,p_kind);end if;
 request_id:=nullif(p_data->>'request_id','')::uuid;
 if request_id is null then raise exception using errcode='22023',message='CUSTODY_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('custody:'||p_store_id::text,0));
 fingerprint:=md5(jsonb_build_object('store',p_store_id,'kind',p_kind,'action',p_action,'data',p_data-'request_id')::text);
 select * into prior from private.custody_events where id=request_id;
 if found then
  if prior.store_id<>p_store_id or prior.actor_id<>auth.uid() or prior.fingerprint<>fingerprint then raise exception using errcode='22023',message='CUSTODY_REQUEST_REUSED';end if;
  return private.custody_state(p_store_id,p_kind);
 end if;
 date_value:=coalesce(nullif(p_data->>'occurred_on','')::date,(now() at time zone 'Asia/Taipei')::date);
 handler:=btrim(coalesce(p_data->>'handler',(select display_name from public.profiles where id=auth.uid()),''));
 if length(handler) not between 1 and 120 or length(coalesce(p_data->>'note',''))>2000
 or date_value<'2000-01-01' or date_value>(now() at time zone 'Asia/Taipei')::date then raise exception using errcode='22023',message='CUSTODY_INVALID';end if;
 if p_action='create' then
  product:=nullif(p_data->>'product_id','')::uuid;unit_value:=btrim(coalesce(p_data->>'unit',''));party:=btrim(coalesce(p_data->>'party',''));
  select p.name into name_value from public.products p where p.id=product and p.organization_id=org and p.is_active
  and exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where zp.product_id=p.id and z.store_id=p_store_id and z.is_active);
  if name_value is null or length(unit_value) not between 1 and 30 or length(party) not between 1 and 120 then raise exception using errcode='22023',message='CUSTODY_INVALID';end if;
  if exists(select 1 from private.custody_accounts ca where ca.store_id=p_store_id and ca.product_id=product and ca.kind=p_kind and ca.unit=unit_value and ca.party=party) then raise exception using errcode='22023',message='CUSTODY_EXISTS';end if;
  minimum:=coalesce(nullif(p_data->>'minimum','')::numeric,0);days:=coalesce(nullif(p_data->>'warning_days','')::integer,30);
  if minimum<0 or minimum>=1000000000 or minimum::text in ('NaN','Infinity','-Infinity') or days not between 1 and 365 then raise exception using errcode='22023',message='CUSTODY_INVALID';end if;
  insert into private.custody_accounts(store_id,product_id,kind,name,unit,party,minimum,warning_days,note,created_by)
  values(p_store_id,product,p_kind,name_value,unit_value,party,minimum,days,coalesce(p_data->>'note',''),auth.uid()) returning * into a;
 else
  select * into a from private.custody_accounts where id=nullif(p_data->>'account_id','')::uuid and store_id=p_store_id and kind=p_kind for update;
  if not found then raise exception using errcode='22023',message='CUSTODY_NOT_FOUND';end if;
  if (p_data->>'revision') is distinct from a.revision::text then raise exception using errcode='40001',message='CUSTODY_CHANGED';end if;
 end if;
 if p_action in ('create','batch','collect') then
  q:=nullif(p_data->>'quantity','')::numeric;
  if q is null or q<=0 or q>=1000000000 or q::text in ('NaN','Infinity','-Infinity') then raise exception using errcode='22023',message='CUSTODY_INVALID';end if;
 end if;
 if p_action in ('create','batch') then
  label_value:=btrim(coalesce(p_data->>'label',''));expiry:=nullif(p_data->>'expires_on','')::date;
  if length(label_value) not between 1 and 120 or length(coalesce(p_data->>'reference',''))>200
   or (p_kind='supplier' and expiry is null) or expiry<'2000-01-01' or expiry>'2200-12-31'
  then raise exception using errcode='22023',message='CUSTODY_INVALID';end if;
  insert into private.custody_lots(account_id,label,quantity,remaining,expires_on,reference)
  values(a.id,label_value,q,q,expiry,coalesce(p_data->>'reference','')) returning * into l;
  -- Purchased/existing goods only: never add a second receipt or purchase amount.
 elsif p_action='collect' then
  select * into l from private.custody_lots where id=nullif(p_data->>'lot_id','')::uuid and account_id=a.id for update;
  if not found then raise exception using errcode='22023',message='CUSTODY_NOT_FOUND';end if;
  if q>l.remaining then raise exception using errcode='22023',message='CUSTODY_INSUFFICIENT';end if;
  if l.expires_on<(now() at time zone 'Asia/Taipei')::date then raise exception using errcode='22023',message='CUSTODY_EXPIRED';end if;
  perform private.stock_post(p_store_id,a.product_id,a.unit,case when p_kind='supplier' then q else -q end,'CUSTODY',request_id,true);
  update private.custody_lots set remaining=remaining-q where id=l.id;
 elsif p_action='settings' then
  minimum:=nullif(p_data->>'minimum','')::numeric;days:=nullif(p_data->>'warning_days','')::integer;followup:=p_data->>'followup';
  if minimum is null or minimum<0 or minimum>=1000000000 or minimum::text in ('NaN','Infinity','-Infinity') or days is null or days not between 1 and 365
   or followup is null or followup not in ('pending','contacted','ordered','complete') then raise exception using errcode='22023',message='CUSTODY_INVALID';end if;
  update private.custody_accounts set minimum=minimum,warning_days=days,followup=followup,note=coalesce(p_data->>'note','') where id=a.id;
 end if;
 if p_action<>'create' then update private.custody_accounts set revision=revision+1 where id=a.id;end if;
 insert into private.custody_events(id,store_id,account_id,lot_id,action,quantity,occurred_on,handler,note,actor_id,fingerprint)
 values(request_id,p_store_id,a.id,l.id,p_action,q,date_value,handler,coalesce(p_data->>'note',''),auth.uid(),fingerprint);
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
 values(org,p_store_id,'custody',a.id::text,'CUSTODY_'||upper(p_action),p_data||jsonb_build_object('kind',p_kind),auth.uid());
 return private.custody_state(p_store_id,p_kind);
end $$;
revoke all on function private.baihuayuan_custody(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function private.baihuayuan_custody(uuid,text,text,jsonb) to authenticated;
create function public.baihuayuan_custody(p_store_id uuid,p_kind text,p_action text default 'read',p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.baihuayuan_custody(p_store_id,p_kind,p_action,p_data)$$;
revoke all on function public.baihuayuan_custody(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.baihuayuan_custody(uuid,text,text,jsonb) to authenticated;
