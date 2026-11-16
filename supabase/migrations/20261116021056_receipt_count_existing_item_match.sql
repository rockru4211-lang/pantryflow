-- A count-catalog match is a store decision. The receipt product and its
-- original purchase unit continue to identify the original evidence.
create table private.receipt_count_matches (
 store_id uuid not null references public.stores(id),
 source_product_id uuid not null references public.products(id),
 supplier_key text not null,
 source_signature jsonb not null,
 target_product_id uuid not null references public.products(id),
 matched_by uuid not null references auth.users(id),
 matched_at timestamptz not null default now(),
 primary key (store_id,source_product_id,supplier_key),
 check (source_product_id<>target_product_id)
);
alter table private.receipt_count_matches enable row level security;
revoke all on private.receipt_count_matches from public,anon,authenticated;
create index receipt_count_matches_target on private.receipt_count_matches(target_product_id);
create index receipt_count_matches_source on private.receipt_count_matches(source_product_id);

create or replace function private.receipt_count_candidates(p_store uuid)
returns jsonb language sql stable set search_path='' as $$
 with sources as (
  select b.id batch_id,l.id::text row_id,l.product_id,sp.id supplier_id,sp.name supplier,g.receipt_date,
    l.unit purchase_unit,l.specification,l.human_correction line
  from public.goods_receipts g
  join public.receipt_upload_batches b on b.id=g.source_batch_id
  join public.receipt_lines l on l.receipt_id=g.id
  left join public.suppliers sp on sp.id=coalesce(l.supplier_id,g.supplier_id)
  where b.store_id=p_store and g.store_id=p_store and b.status='COMPLETED' and l.quantity>0
    and coalesce(l.human_correction->>'handling','NORMAL')='NORMAL'
  union all
  select i.batch_id,i.row_key,i.product_id,sp.id,coalesce(sp.name,i.supplier_name),i.receipt_date,
    i.unit,null,e.line_values->i.row_key
  from private.receipt_entry_items i
  join public.receipt_upload_batches b on b.id=i.batch_id and b.store_id=p_store
  left join public.suppliers sp on sp.id=i.supplier_id
  left join private.receipt_account_edits e on e.batch_id=i.batch_id and e.store_id=p_store
    and e.run_id is not distinct from i.run_id
  where b.status<>'COMPLETED' and i.retired_at is null
 ), pending as (
  select p.id,p.name,coalesce(nullif(p.count_unit,''),p.base_unit) unit,
    s.supplier,s.receipt_date,s.batch_id,s.row_id,s.line->>'ingredient_id' ingredient_id,
    coalesce('id:'||s.supplier_id::text,'name:'||private.ingredient_match_text(s.supplier)) supplier_key,
    coalesce(nullif(s.line->>'supplier_item_name',''),p.name) receipt_name,
    coalesce(nullif(s.line->>'supplier_item_unit',''),nullif(s.purchase_unit,''),p.base_unit) purchase_unit,
    coalesce(s.line->>'supplier_item_specification',s.specification,p.specification,'') specification
  from sources s join public.stores st on st.id=p_store
  join public.products p on p.id=s.product_id and p.organization_id=st.organization_id and p.is_active
  where not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=s.batch_id)
    and not exists(select 1 from private.baihuayuan_record_flags f where f.store_id=p_store
      and f.entity_type='RECEIPT_BATCH' and f.entity_id=s.batch_id and f.state<>'LIVE')
    and not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
      where z.store_id=p_store and z.is_active and zp.product_id=p.id)
    and not exists(select 1 from private.count_catalog_removed r where r.store_id=p_store and r.product_id=p.id)
    and not exists(select 1 from private.receipt_count_decisions d where d.store_id=p_store and d.product_id=p.id)
 ), named as (
  select p.*,jsonb_build_array(
    private.ingredient_match_text(p.receipt_name),private.ingredient_match_text(p.purchase_unit),
    private.ingredient_match_text(p.specification)
  ) signature from pending p
 ), assigned as materialized (
  select distinct zp.product_id from public.zone_products zp
  join public.count_zones z on z.id=zp.zone_id and z.store_id=p_store and z.is_active
  join public.products p on p.id=zp.product_id and p.is_active
  where not exists(select 1 from private.count_catalog_removed r where r.store_id=p_store and r.product_id=p.id)
 ), ingredient_assignments as materialized (
  select distinct coalesce(m.canonical_ingredient_id,m.id) id
  from assigned p join private.ingredient_aliases a on a.store_id=p_store and a.source_key='p:'||p.product_id
  join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=p_store
 )
 select coalesce(jsonb_agg(to_jsonb(q) order by q.receipt_date desc,q.name,q.id),'[]'::jsonb) from (
  select distinct on(p.id) p.id,p.name,p.receipt_name,p.unit,p.purchase_unit,p.specification,
    p.supplier,p.supplier_key,p.receipt_date,p.signature,
    md5(jsonb_build_array(p.id,p.batch_id,p.row_id,p.supplier_key,p.signature,p.receipt_date)::text) revision
  from named p
  where not exists(
   select 1 from private.receipt_count_matches m join assigned a on a.product_id=m.target_product_id
   where m.store_id=p_store and m.source_product_id=p.id and m.supplier_key=p.supplier_key and m.source_signature=p.signature
  ) and not exists(
   select 1 from private.ingredient_masters m join ingredient_assignments a on a.id=coalesce(m.canonical_ingredient_id,m.id)
   where p.ingredient_id is not null and m.store_id=p_store and m.id::text=p.ingredient_id
  )
  order by p.id,p.receipt_date desc,p.batch_id,p.row_id
 ) q
$$;

-- Use the current store's active, assigned count products. The ingredient link
-- is optional for the count decision and must be unique to remember a vendor name.
create function private.receipt_count_match_targets(p_store uuid)
returns table(id uuid,name text,units text[],supplier text,specification text,code text,can_remember boolean,revision text,ingredient_id uuid)
language sql stable set search_path='' as $$
 with zones as (
  select zp.product_id,array_agg(distinct nullif(zp.count_unit,'') order by nullif(zp.count_unit,'')) units
  from public.zone_products zp join public.count_zones z on z.id=zp.zone_id and z.store_id=p_store and z.is_active
  group by zp.product_id
 ), targets as (
  select p.id,coalesce(nullif(n.count_name,''),p.name) name,
    coalesce(nullif(array_remove(z.units,null),'{}'::text[]),array[coalesce(nullif(p.count_unit,''),p.base_unit)]) units,
    coalesce(nullif(imp.supplier,''),sp.name,'') supplier,coalesce(p.specification,'') specification,
    coalesce(private.managed_ingredient_code(m.id),p.product_code,'') code,m.id ingredient_id
  from zones z join public.products p on p.id=z.product_id and p.is_active
  join public.stores s on s.id=p_store and s.organization_id=p.organization_id
  left join public.suppliers sp on sp.id=p.current_supplier_id
  left join lateral (
   select ir.normalized_values->>'supplier' supplier from public.inventory_import_rows ir
   join public.inventory_import_files f on f.id=ir.import_file_id
   where ir.store_id=p_store and ir.product_id=p.id
   order by (f.removed_at is null and ir.status in ('ADDED','EXISTING','PENDING')) desc,ir.created_at,ir.id limit 1
  ) imp on true
  left join lateral (
   select (array_agg(distinct coalesce(i.canonical_ingredient_id,i.id)))[1] id
   from private.ingredient_aliases a join private.ingredient_masters i on i.id=a.ingredient_id and i.store_id=p_store
   where a.store_id=p_store and a.source_key='p:'||p.id
   having count(distinct coalesce(i.canonical_ingredient_id,i.id))=1
  ) linked on true
  left join private.ingredient_masters m on m.id=linked.id and m.store_id=p_store
    and not exists(select 1 from private.ingredient_supply_state st
      where st.store_id=p_store and st.ingredient_id=m.id and st.supplier_key='*' and st.stopped)
  left join private.ingredient_usage_names n on n.ingredient_id=m.id and n.store_id=p_store
  where not exists(select 1 from private.count_catalog_removed r where r.store_id=p_store and r.product_id=p.id)
 )
 select t.id,t.name,t.units,t.supplier,t.specification,t.code,t.ingredient_id is not null,
   md5(jsonb_build_array(t.id,t.name,t.units,t.supplier,t.specification,t.ingredient_id)::text),t.ingredient_id
 from targets t
$$;
revoke all on function private.receipt_count_match_targets(uuid) from public,anon,authenticated;

create function private.receipt_count_match_command(p_store uuid,p_action text,p_data jsonb,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 candidate jsonb;
 target record;
 source_id uuid;
 target_id uuid;
 org uuid;
 old_request private.app_requests;
 result jsonb;
 vendor_name text;
 vendor_id uuid;
 vendor_key text;
 remember boolean;
begin
 if auth.uid() is null or not private.feature_scope(p_store) or not private.can_count_inline(p_store)
   or not private.has_active_store_role(p_store,array['LOGISTICS','OWNER']::public.app_role[])
   or not exists(select 1 from public.stores where id=p_store and is_active and name in ('BeApe','Gras'))
 then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
 if p_action='match-options' then
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(t)-'ingredient_id' order by t.name,t.id)
    from private.receipt_count_match_targets(p_store) t),'[]'::jsonb));
 end if;
 perform private.assert_store_editable(p_store);
 if not private.can_import_inventory(p_store) then raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501';end if;
 if p_action is distinct from 'match' or p_request is null or jsonb_typeof(p_data) is distinct from 'object'
   or jsonb_typeof(p_data->'remember') is distinct from 'boolean' or octet_length(p_data::text)>1500
 then raise exception 'INVALID_APP_INPUT' using errcode='22023'; end if;
 source_id:=nullif(p_data->>'source_id','')::uuid;
 target_id:=nullif(p_data->>'target_id','')::uuid;
 remember:=(p_data->>'remember')::boolean;
 if source_id is null or target_id is null or source_id=target_id then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;

 perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_request::text,0));
 select * into old_request from private.app_requests where store_id=p_store and request_id=p_request;
 if found then
  if old_request.actor_id<>auth.uid() or old_request.action<>'receipt.count-match' or old_request.payload is distinct from p_data
  then raise exception 'REQUEST_CONFLICT' using errcode='23505'; end if;
  return old_request.result;
 end if;
 if remember then perform pg_advisory_xact_lock(hashtextextended('ingredient-match:'||p_store::text,0));end if;
 select organization_id into org from public.stores where id=p_store for update;
 perform 1 from public.products where organization_id=org and id in (source_id,target_id) order by id for update;
 select x into candidate from jsonb_array_elements(private.receipt_count_candidates(p_store)) x where x->>'id'=source_id::text;
 if candidate is null or candidate->>'revision' is distinct from p_data->>'source_revision'
 then raise exception 'COUNT_CANDIDATES_CHANGED' using errcode='40001';end if;
 select * into target from private.receipt_count_match_targets(p_store) t where t.id=target_id;
 if not found or target.revision is distinct from p_data->>'target_revision'
 then raise exception 'COUNT_TARGET_CHANGED' using errcode='40001';end if;

 if remember then
  vendor_name:=private.ingredient_match_text(private.supplier_display_name(org,candidate->>'supplier'));
  vendor_id:=private.supplier_identity(org,candidate->>'supplier');
  vendor_key:=coalesce('id:'||vendor_id::text,'name:'||vendor_name);
  if not target.can_remember or vendor_name in ('','未提供','供應商未提供') then
   raise exception 'COUNT_ALIAS_UNAVAILABLE' using errcode='22023';
  end if;
  if exists(select 1 from private.ingredient_supply_state st where st.store_id=p_store
    and st.ingredient_id=target.ingredient_id and st.supplier_key in (vendor_key,'name:'||vendor_name) and st.stopped)
  then raise exception 'COUNT_ALIAS_STOPPED' using errcode='22023';end if;
  if length(vendor_name)>160 or length(candidate#>>'{signature,0}') not between 1 and 160
    or length(candidate#>>'{signature,1}')>30 or length(candidate#>>'{signature,2}')>500
  then raise exception 'COUNT_ALIAS_UNAVAILABLE' using errcode='22023';end if;
  if exists(
   select 1 from private.receipt_ingredient_bindings b join private.ingredient_masters m on m.id=b.ingredient_id
   where b.store_id=p_store and b.name=candidate#>>'{signature,0}' and b.unit=candidate#>>'{signature,1}'
     and b.specification=candidate#>>'{signature,2}'
     and (b.supplier=vendor_name or vendor_id=private.supplier_identity(org,b.supplier))
     and coalesce(m.canonical_ingredient_id,m.id)<>target.ingredient_id
  ) then raise exception 'COUNT_ALIAS_CONFLICT' using errcode='40001';end if;
  insert into private.receipt_ingredient_bindings(store_id,supplier,name,unit,specification,ingredient_id,updated_by)
  values(p_store,vendor_name,candidate#>>'{signature,0}',candidate#>>'{signature,1}',candidate#>>'{signature,2}',target.ingredient_id,auth.uid())
  on conflict (store_id,supplier,name,unit,specification) do nothing;
 end if;

 insert into private.receipt_count_matches(store_id,source_product_id,supplier_key,source_signature,target_product_id,matched_by)
 values(p_store,source_id,candidate->>'supplier_key',candidate->'signature',target_id,auth.uid())
 on conflict(store_id,source_product_id,supplier_key) do update
 set source_signature=excluded.source_signature,target_product_id=excluded.target_product_id,
   matched_by=excluded.matched_by,matched_at=now();
 result:=jsonb_build_object('saved',true,'target_name',target.name);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result)
 values(p_store,p_request,auth.uid(),'receipt.count-match',p_data,result);
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id,attempt_id)
 values(org,p_store,'count_catalog',target_id::text,'receipt.count-match',p_data,auth.uid(),p_request);
 return result;
end $$;
revoke all on function private.receipt_count_match_command(uuid,text,jsonb,uuid) from public,anon;
grant execute on function private.receipt_count_match_command(uuid,text,jsonb,uuid) to authenticated;

create or replace function public.baihuayuan_receipt_count_candidates(p_store_id uuid,p_action text default 'list',p_data jsonb default '{}',p_request_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select case when p_action in ('match-options','match')
  then private.receipt_count_match_command(p_store_id,p_action,p_data,p_request_id)
  else private.receipt_count_candidate_command(p_store_id,p_action,p_data,p_request_id) end
$$;
notify pgrst,'reload schema';
