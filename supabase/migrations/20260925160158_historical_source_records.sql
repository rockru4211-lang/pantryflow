-- Historical sources are retained without publishing stock, prices or verified receipts.
create table private.historical_imports (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 dataset_key text not null, source_month date not null,
 source_file text not null, source_sha256 text not null,
 state text not null default 'LOADING' check(state in ('LOADING','READY')),
 expected_records integer not null check(expected_records>0),
 metadata jsonb not null default '{}', imported_at timestamptz not null default now(),
 unique(store_id,dataset_key),check(source_month=date_trunc('month',source_month)::date)
);
create table private.historical_source_records (
 import_id uuid not null references private.historical_imports(id),
 kind text not null check(kind in ('RECEIVING','INVENTORY')),
 source_id text not null, ordinal integer not null,
 data jsonb not null check(jsonb_typeof(data)='object'),
 raw_source jsonb not null check(jsonb_typeof(raw_source)='object'),
 issues jsonb not null default '[]' check(jsonb_typeof(issues)='array'),
 needs_confirmation boolean not null,
 primary key(import_id,kind,source_id)
);
alter table private.historical_imports enable row level security;
alter table private.historical_source_records enable row level security;
revoke all on private.historical_imports,private.historical_source_records from public,anon,authenticated;

create function private.historical_workspace(p_store uuid,p_filter jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare kind_filter text:=p_filter->>'kind'; month_filter text; months jsonb; result jsonb; total integer; pending integer;
 page_no integer:=greatest(1,least(10000,coalesce((p_filter->>'page')::integer,1)));
begin
 if auth.uid() is null or coalesce(private.app_role(p_store),'') not in ('OWNER','LOGISTICS')
  or not private.has_active_store_role(p_store,null)
  or not exists(select 1 from public.stores s join public.organizations o on o.id=s.organization_id
    where s.id=p_store and s.is_active and o.business_type<>'CHAIN_RESTAURANT') then
  raise exception 'HISTORY_ADMIN_REQUIRED' using errcode='42501';end if;
 if kind_filter is null or kind_filter not in ('RECEIVING','INVENTORY') then raise exception 'INVALID_HISTORY_KIND' using errcode='22023';end if;
 select coalesce(jsonb_agg(m order by m desc),'[]') into months from (
  select distinct to_char(i.source_month,'YYYY-MM') m from private.historical_imports i
  where i.store_id=p_store and i.state='READY' and exists(select 1 from private.historical_source_records r where r.import_id=i.id and r.kind=kind_filter)
 ) x;
 month_filter:=coalesce(nullif(p_filter->>'month',''),months->>0);
 select count(*),count(*) filter(where r.needs_confirmation) into total,pending
 from private.historical_source_records r join private.historical_imports i on i.id=r.import_id
 where i.store_id=p_store and i.state='READY' and to_char(i.source_month,'YYYY-MM')=month_filter and r.kind=kind_filter;
 select coalesce(jsonb_agg(x.payload order by x.ordinal,x.source_id),'[]') into result from (
  select r.ordinal,r.source_id,jsonb_build_object('id',r.source_id,'data',r.data,'issues',r.issues,
   'needs_confirmation',r.needs_confirmation,'source_file',i.source_file) payload
  from private.historical_source_records r join private.historical_imports i on i.id=r.import_id
  where i.store_id=p_store and i.state='READY' and to_char(i.source_month,'YYYY-MM')=month_filter and r.kind=kind_filter
   and (not coalesce((p_filter->>'pending')::boolean,false) or r.needs_confirmation)
   and (coalesce(p_filter->>'search','')='' or strpos(lower((r.data->>'name')||' '||coalesce(r.data->>'supplier','')),lower(p_filter->>'search'))>0)
  order by r.ordinal,r.source_id limit 50 offset (page_no-1)*50
 ) x;
 return jsonb_build_object('months',months,'month',month_filter,'rows',result,'total',total,'pending',pending,'page',page_no);
end $$;
revoke all on function private.historical_workspace(uuid,jsonb) from public,anon,authenticated;
do $$ declare src text; anchor text:=' if v_role is null then'; begin
 src:=pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure);
 if strpos(src,anchor)=0 then raise exception 'HISTORY_WORKSPACE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,' if p_section=''historical-records'' then return private.historical_workspace(p_store,p_filter);end if;'||chr(10)||anchor);
 execute src;
end $$;
notify pgrst,'reload schema';
