-- Standard prices are confirmed snapshots, never recomputed from a newly uploaded invoice.
create table private.ingredient_standard_versions (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 ingredient_id uuid not null,
 effective_date date not null,
 snapshot jsonb not null,
 reason text not null default '',
 actor_id uuid,
 request_id uuid,
 created_at timestamptz not null default now(),
 foreign key(ingredient_id,store_id) references private.ingredient_masters(id,store_id),
 unique(store_id,request_id,ingredient_id)
);
alter table private.ingredient_standard_versions enable row level security;
revoke all on private.ingredient_standard_versions from public,anon,authenticated;
create index ingredient_standard_version_lookup on private.ingredient_standard_versions(store_id,ingredient_id,effective_date desc,created_at desc);
-- Retain the existing baseline, including verified alias/package evidence.
insert into private.ingredient_standard_versions(store_id,ingredient_id,effective_date,snapshot,reason)
select m.store_id,m.id,'0001-01-01',to_jsonb(m)||jsonb_build_object('purchase',case when private.recipe_unit(m.purchase->>'unit')=private.recipe_unit(r.purchase->>'unit') and (m.purchase->>'amount')::numeric/(m.purchase->>'quantity')::numeric=(r.purchase->>'amount')::numeric/(r.purchase->>'quantity')::numeric then r.purchase||m.purchase else coalesce(m.purchase,r.purchase) end), '既有確認價格基準'
from private.ingredient_masters m left join private.recipe_price_entries r on r.id=m.selected_reference;

alter table private.ingredient_standard_versions add column revision integer;
create unique index ingredient_standard_revision on private.ingredient_standard_versions(store_id,ingredient_id,revision) where revision is not null;
create function private.capture_ingredient_standard() returns trigger
language plpgsql security definer set search_path='' as $$
declare r private.recipe_price_entries; p jsonb;
begin
 if auth.uid() is null or not new.manual then return new;end if;
 if tg_op='UPDATE' and (new.cost_price,new.unit,new.purchase,new.review_status,new.selected_reference,new.manual) is not distinct from (old.cost_price,old.unit,old.purchase,old.review_status,old.selected_reference,old.manual) then return new;end if;
 select * into r from private.recipe_price_entries where id=new.selected_reference;
 p:=coalesce(new.purchase,case when new.cost_price=coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) then r.purchase end);
 insert into private.ingredient_standard_versions(store_id,ingredient_id,effective_date,snapshot,reason,actor_id,revision)
 values(new.store_id,new.id,coalesce(nullif(current_setting('app.standard_effective_date',true),'')::date,(now() at time zone 'Asia/Taipei')::date),to_jsonb(new)||jsonb_build_object('purchase',p),coalesce(nullif(current_setting('app.standard_change_reason',true),''),'確認標準進價'),auth.uid(),new.revision)
 on conflict(store_id,ingredient_id,revision) where revision is not null do update set snapshot=excluded.snapshot;
 return new;
end $$;
revoke all on function private.capture_ingredient_standard() from public,anon,authenticated;
create trigger capture_ingredient_standard after insert or update on private.ingredient_masters for each row execute function private.capture_ingredient_standard();

-- Only explicitly confirming a price creates a new standard version.
do $patch$
declare src text; revised text;
begin
 src:=pg_get_functiondef('public.baihuayuan_ingredient_prices(uuid,text,jsonb,uuid)'::regprocedure);
 revised:=replace(src,'if p_action=''save'' then', 'if p_action in (''save'',''confirm'',''keep'') and coalesce(nullif(p_data->>''effective_date'','''')::date,(now() at time zone ''Asia/Taipei'')::date)>(now() at time zone ''Asia/Taipei'')::date then raise exception ''FUTURE_PRICE_NOT_SUPPORTED'' using errcode=''22023'';end if;'||chr(10)||' if p_action=''save'' then');
 revised:=replace(revised,'if p_action=''save'' then', 'perform set_config(''app.standard_effective_date'',coalesce(nullif(p_data->>''effective_date'',''''),(now() at time zone ''Asia/Taipei'')::date::text),true);perform set_config(''app.standard_change_reason'',coalesce(p_data->>''change_reason'',''確認標準進價''),true); if p_action=''save'' then');
 if revised=src then raise exception 'STANDARD_PRICE_HOOK_MISSING';end if;execute revised;
 src:=pg_get_functiondef('private.sync_ingredient_prices(uuid,uuid)'::regprocedure);
 revised:=replace(src,'and not m.manual','and false /* New invoices are candidates; explicit confirmation alone changes standards. */');
 if revised=src then raise exception 'STANDARD_SYNC_HOOK_MISSING';end if;execute revised;
 src:=pg_get_functiondef('private.seed_ingredient_masters(uuid)'::regprocedure);
 revised:=replace(src,'and not m.manual','and false /* Imported prices await confirmation. */');
 if revised=src then raise exception 'STANDARD_SEED_HOOK_MISSING';end if;execute revised;
 src:=pg_get_functiondef('private.ingredient_supply_read(uuid)'::regprocedure);
 revised:=replace(src,'''supply_states'',','''price_history'',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object(''actor_name'',coalesce((select display_name from public.profiles where id=v.actor_id),''系統'')) order by v.created_at desc),''[]'') from private.ingredient_standard_versions v where v.store_id=s and v.actor_id is not null),''supply_states'',');
 if revised=src then raise exception 'STANDARD_HISTORY_HOOK_MISSING';end if;execute revised;
end $patch$;

-- Freeze the already reviewed product/alias/package quotes at cutover. Some
-- legacy aliases intentionally use another source package than their master.
-- New invoices never touch these; explicit master confirmation supersedes them.
create table private.ingredient_standard_baselines(
 store_id uuid not null references public.stores(id),product_id uuid not null references public.products(id),
 name text not null,unit text not null,quote jsonb not null,captured_at timestamptz not null default now(),
 primary key(store_id,product_id,unit)
);
alter table private.ingredient_standard_baselines enable row level security;
revoke all on private.ingredient_standard_baselines from public,anon,authenticated;
create index ingredient_standard_baseline_name on private.ingredient_standard_baselines(store_id,private.cost_name_key(name),unit);
with existing as materialized (
 select st.id store_id,pr.id product_id,pr.name,coalesce(nullif(pr.count_unit,''),pr.base_unit) unit,
 private.cost_quote(st.id,pr.id,pr.name,coalesce(nullif(pr.count_unit,''),pr.base_unit),(now() at time zone 'Asia/Taipei')::date) quote
 from public.stores st join public.products pr on pr.organization_id=st.organization_id
 where st.name in ('BeApe','Gras') and st.is_active and pr.is_active
)
insert into private.ingredient_standard_baselines(store_id,product_id,name,unit,quote)
select e.store_id,e.product_id,e.name,e.unit,e.quote||jsonb_build_object('basis','confirmed_baseline','purchase',case when private.cost_purchase_price(r.purchase,e.unit)=(e.quote->>'price')::numeric then r.purchase else jsonb_build_object('amount',(e.quote->>'price')::numeric,'quantity',1,'unit',e.unit) end)
from existing e left join private.recipe_price_entries r on r.id=nullif(e.quote->>'reference_id','')::uuid where e.quote->>'price' is not null;

alter function private.cost_quote(uuid,uuid,text,text,date) rename to cost_quote_before_standard_versions;
revoke all on function private.cost_quote_before_standard_versions(uuid,uuid,text,text,date) from public,anon,authenticated;
create function private.cost_quote(s uuid,product uuid,nm text,u text,at_date date) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off set plan_cache_mode=force_custom_plan as $$
declare ids uuid[]; v jsonb; master_id uuid; p jsonb; q numeric; linked record; measure jsonb; target date:=coalesce(at_date,(now() at time zone 'Asia/Taipei')::date); version_date date; standard_unit text; nmkey text;
begin
 if nullif(btrim(u),'') is null then return jsonb_build_object('price',null,'reason','待補計價單位');end if;
 if product is not null then select pr.name into nm from public.products pr join public.stores st on st.organization_id=pr.organization_id where st.id=s and pr.id=product;end if;
 nmkey:=private.cost_name_key(nm);
 select array_agg(distinct id) into ids from (
 select m.id from private.ingredient_masters m where m.store_id=s and private.cost_name_key(m.name)=nmkey
 union select a.ingredient_id from private.ingredient_aliases a where a.store_id=s and (a.source_key='p:'||product::text or private.cost_name_key(a.name)=nmkey)
 ) matches;
 if not exists(select 1 from private.ingredient_standard_versions where store_id=s and ingredient_id=any(ids) and actor_id is not null and effective_date<=target)
 and not exists(select 1 from private.ingredient_supply_state where store_id=s and ingredient_id=any(ids) and supplier_key='*' and stopped) then
 select b.quote into v from private.ingredient_standard_baselines b where b.store_id=s and b.unit=u and (b.product_id=product or (product is null and private.cost_name_key(b.name)=nmkey)) order by b.product_id limit 1;
 if v is not null then return v;end if;
 end if;
 if coalesce(cardinality(ids),0)=0 then return jsonb_build_object('price',null,'reason','名稱尚未完成對應，請至食材價格表確認');end if;
 for master_id in select id from private.ingredient_masters where id=any(ids) order by manual desc,updated_at desc,id loop
  if exists(select 1 from private.ingredient_supply_state where store_id=s and ingredient_id=master_id and supplier_key='*' and stopped) then continue;end if;
  select snapshot,effective_date into v,version_date from private.ingredient_standard_versions where store_id=s and ingredient_id=master_id and effective_date<=target order by effective_date desc,created_at desc,id desc limit 1;
  if v is null or v->>'review_status'<>'confirmed' or v->>'cost_price' is null then continue;end if;
  p:=nullif(v->'purchase','null'::jsonb);standard_unit:=v->>'unit';q:=null;
  -- Confirmed per-piece mapping is explicit evidence, not an inferred weight.
  select a.* into linked from private.ingredient_aliases a where a.store_id=s and a.ingredient_id=master_id and a.corrected and a.cost_mapping is not null and a.source_unit=private.recipe_unit(u) and (a.source_key='p:'||product::text or private.cost_name_key(a.name)=nmkey) and nullif(v->>'selected_reference','')::uuid=any(a.reference_ids) limit 1;
  if found and p is not null then q:=private.cost_purchase_price(p,linked.cost_mapping->>'unit')*(linked.cost_mapping->>'quantity')::numeric*private.recipe_factor(u)/private.recipe_factor(linked.cost_mapping->>'target_unit');end if;
  if q is null then
   measure:=private.cost_package_measure(u,nm);
   q:=case when standard_unit=private.recipe_unit(u) then (v->>'cost_price')::numeric*private.recipe_factor(u)
    when standard_unit=measure->>'unit' then (v->>'cost_price')::numeric*(measure->>'quantity')::numeric
    else private.cost_purchase_price(p,u) end;
  end if;
  if q is not null then return jsonb_build_object('price',q,'source','食材價格表・確認進價','date',case when version_date='0001-01-01' then null else version_date end,'reference_id',v->>'selected_reference','basis','standard','unit',u,'purchase',case when private.cost_purchase_price(p,u)=q then p else jsonb_build_object('amount',q,'quantity',1,'unit',u) end);end if;
 end loop;
 return jsonb_build_object('price',null,'reason','已找到食材，待確認價格或包裝換算');
end $$;
revoke all on function private.cost_quote(uuid,uuid,text,text,date) from public,anon,authenticated;

-- User/store/module/month scoped cloud drafts, with compare-and-swap across devices.
create table private.operations_cloud_drafts(
 store_id uuid not null references public.stores(id),actor_id uuid not null references auth.users(id),scope text not null,month text not null,
 token uuid not null,rows jsonb not null,updated_at timestamptz not null default now(),primary key(store_id,actor_id,scope,month)
);
alter table private.operations_cloud_drafts enable row level security;
revoke all on private.operations_cloud_drafts from public,anon,authenticated;
create function public.baihuayuan_sheet_draft(p_store_id uuid,p_scope text,p_month text,p_action text default 'read',p_rows jsonb default '[]',p_expected uuid default null,p_token uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.operations_cloud_drafts; actor uuid:=auth.uid();
begin
 if actor is null or not private.recipe_allowed(p_store_id,true) or private.store_access_mode(p_store_id) is distinct from 'EDIT' or not exists(select 1 from public.stores where id=p_store_id and name in ('BeApe','Gras')) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_scope not in ('receipt','inventory','transfer','waste','ingredient') or p_month !~ '^([0-9]{4}-[0-9]{2}|all)$' then raise exception 'INVALID_DRAFT_SCOPE';end if;
 perform pg_advisory_xact_lock(hashtextextended('draft:'||p_store_id||actor||p_scope||p_month,0));
 select * into d from private.operations_cloud_drafts where store_id=p_store_id and actor_id=actor and scope=p_scope and month=p_month;
 if p_action='read' then return case when d.token is null then null else jsonb_build_object('version',1,'token',d.token,'updatedAt',d.updated_at,'rows',d.rows) end;end if;
 if p_action<>'save' or p_token is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>2000 or octet_length(p_rows::text)>4000000 then raise exception 'INVALID_DRAFT';end if;
 if d.token=p_token and d.rows=p_rows then return jsonb_build_object('version',1,'token',d.token,'updatedAt',d.updated_at,'rows',d.rows);end if;
 if d.token is distinct from p_expected then raise exception 'DRAFT_CHANGED' using errcode='P0001';end if;
 insert into private.operations_cloud_drafts(store_id,actor_id,scope,month,token,rows) values(p_store_id,actor,p_scope,p_month,p_token,p_rows)
 on conflict(store_id,actor_id,scope,month) do update set token=excluded.token,rows=excluded.rows,updated_at=now() returning * into d;
 return jsonb_build_object('version',1,'token',d.token,'updatedAt',d.updated_at,'rows',d.rows);
end $$;
revoke all on function public.baihuayuan_sheet_draft(uuid,text,text,text,jsonb,uuid,uuid) from public,anon;
grant execute on function public.baihuayuan_sheet_draft(uuid,text,text,text,jsonb,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
-- Recipe candidates must not silently replace the confirmed standard either.
do $patch$
declare src text; revised text; r record;
begin
 src:=pg_get_functiondef('private.recipe_prices(uuid)'::regprocedure);
 revised:=replace(src,'left join preferred_prices preferred on preferred.ingredient_id=m.id','left join preferred_prices preferred on false and preferred.ingredient_id=m.id');
 if revised=src then raise exception 'RECIPE_STANDARD_HOOK_MISSING';end if;
 revised:=replace(revised,'select 1 from resolved m'||chr(10)||'     where m.key','select 1 from maps m'||chr(10)||'     where m.key');execute revised;
 -- Keep historic reason values valid while offering more precise choices.
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.prokind='f' and pg_get_functiondef(p.oid) like '%''效期到期'',''品質異常'',''製作或操作損耗''%' loop
  src:=pg_get_functiondef(r.oid);
  revised:=replace(src,'''效期到期'',''品質異常'',''製作或操作損耗''','''效期到期'',''品質異常／變質'',''保存不當'',''備料／修切耗損'',''製作失誤'',''破損／污染'',''備料過量／未售完'',''品質異常'',''製作或操作損耗''');
  execute revised;
 end loop;
end $patch$;
alter table private.waste_records drop constraint waste_records_reason_check;
alter table private.waste_records add constraint waste_records_reason_check check(reason in ('效期到期','品質異常','製作或操作損耗','保存或設備異常','供應商問題','其他','品質異常／變質','保存不當','備料／修切耗損','製作失誤','破損／污染','備料過量／未售完'));
