-- Explicit decisions for received products that have never joined this store's count catalog.
create table private.receipt_count_decisions(
 store_id uuid not null references public.stores(id),product_id uuid not null references public.products(id),
 dismissed_by uuid not null references auth.users(id),dismissed_at timestamptz not null default now(),
 primary key(store_id,product_id)
);
alter table private.receipt_count_decisions enable row level security;
revoke all on private.receipt_count_decisions from public,anon,authenticated;

create function private.receipt_count_candidates(p_store uuid)
returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(q) order by q.receipt_date desc,q.name,q.id),'[]'::jsonb) from (
 select distinct on(p.id) p.id,p.name,coalesce(nullif(p.count_unit,''),p.base_unit) unit,
 coalesce(p.specification,'') specification,sp.name supplier,g.receipt_date
 from public.goods_receipts g join public.receipt_upload_batches b on b.id=g.source_batch_id
 join public.receipt_lines l on l.receipt_id=g.id join public.products p on p.id=l.product_id and p.organization_id=b.organization_id
 left join public.suppliers sp on sp.id=coalesce(l.supplier_id,g.supplier_id)
 where b.store_id=p_store and g.store_id=p_store and b.status='COMPLETED' and p.is_active and l.quantity>0
 and coalesce(l.human_correction->>'handling','NORMAL')='NORMAL'
 and not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=b.id)
 and not exists(select 1 from private.baihuayuan_record_flags f where f.store_id=p_store and f.entity_type='RECEIPT_BATCH' and f.entity_id=b.id and f.state<>'LIVE')
 and not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=p_store and z.is_active and zp.product_id=p.id)
 and not exists(select 1 from private.count_catalog_removed r where r.store_id=p_store and r.product_id=p.id)
 and not exists(select 1 from private.receipt_count_decisions d where d.store_id=p_store and d.product_id=p.id)
 order by p.id,g.receipt_date desc,g.id
 ) q
$$;
revoke all on function private.receipt_count_candidates(uuid) from public,anon,authenticated;

create function private.receipt_count_candidate_command(p_store uuid,p_action text,p_data jsonb,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidates jsonb;ids uuid[];target uuid;org uuid;cached private.app_requests;payload jsonb;result jsonb;
begin
 if auth.uid() is null or not private.feature_scope(p_store) or not private.can_count_inline(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_action not in ('list','add','dismiss') then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 if p_action='list' then
  return jsonb_build_object('rows',private.receipt_count_candidates(p_store),'editable',private.can_import_inventory(p_store) and private.can_edit_store(p_store),
   'zones',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by sort_order,id) from public.count_zones where store_id=p_store and is_active),'[]'::jsonb));
 end if;
 perform private.assert_store_editable(p_store);
 if not private.can_import_inventory(p_store) then raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501';end if;
 if p_request is null or jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_data->'ids') is distinct from 'array' or octet_length(p_data::text)>25000 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 payload:=jsonb_build_object('action',p_action,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_request::text,0));
 select * into cached from private.app_requests where store_id=p_store and request_id=p_request;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'receipt.count-candidates' or cached.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return cached.result;
 end if;
 -- Serialize catalog decisions with existing count/import mutations.
 select organization_id into org from public.stores where id=p_store for update;
 select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(p_data->'ids');
 if coalesce(cardinality(ids),0) not between 1 and 500 or array_position(ids,null) is not null then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 perform 1 from public.products where id=any(ids) order by id for update;
 candidates:=private.receipt_count_candidates(p_store);
 if exists(select 1 from unnest(ids) i where not exists(select 1 from jsonb_array_elements(candidates) x where x->>'id'=i::text)) then raise exception 'COUNT_CANDIDATES_CHANGED' using errcode='40001';end if;
 if p_action='dismiss' then
  insert into private.receipt_count_decisions(store_id,product_id,dismissed_by) select p_store,id,auth.uid() from unnest(ids) id;
 else
  target:=nullif(p_data->>'zone_id','')::uuid;
  perform 1 from public.count_zones where id=target and store_id=p_store and is_active for update;
  if not found then raise exception 'COUNT_ZONE_REQUIRED' using errcode='22023';end if;
  insert into public.zone_products(zone_id,product_id,sort_order,count_unit)
  select target,p.id,coalesce((select max(sort_order)+1 from public.zone_products where zone_id=target),0)+row_number() over(order by p.name,p.id)::integer,
   coalesce(nullif(p.count_unit,''),p.base_unit) from public.products p where p.id=any(ids)
  on conflict(zone_id,product_id) do nothing;
  perform public.sync_active_count_after_import(p_store);
 end if;
 result:=jsonb_build_object('saved',true,'count',cardinality(ids));
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store,p_request,auth.uid(),'receipt.count-candidates',payload,result);
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id,attempt_id)
 values(org,p_store,'count_catalog',p_store::text,'receipt.count-'||p_action,p_data,auth.uid(),p_request);
 return result;
end $$;
revoke all on function private.receipt_count_candidate_command(uuid,text,jsonb,uuid) from public,anon;
grant execute on function private.receipt_count_candidate_command(uuid,text,jsonb,uuid) to authenticated;
create function public.baihuayuan_receipt_count_candidates(p_store_id uuid,p_action text default 'list',p_data jsonb default '{}',p_request_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.receipt_count_candidate_command(p_store_id,p_action,p_data,p_request_id)
$$;
revoke all on function public.baihuayuan_receipt_count_candidates(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.baihuayuan_receipt_count_candidates(uuid,text,jsonb,uuid) to authenticated;

-- Quick-create still uses the existing supplier.save authorization, validation and request log.
-- Serialize new supplier names and reject aliases/paused/removed identities, rather than restoring them.
do $$declare src text;anchor text;begin
 src:=pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure);
 anchor:='insert into public.suppliers(organization_id,supplier_code,name,is_active)';
 if strpos(src,anchor)=0 then raise exception 'SUPPLIER_CREATE_ANCHOR';end if;
 src:=replace(src,anchor,$patch$
 perform pg_advisory_xact_lock(hashtextextended(v_org::text||':supplier-create',0));
 if exists(select 1 from public.suppliers s where s.organization_id=v_org and
  (private.history_key(s.name)=private.history_key(p_data->>'name') or exists(select 1 from unnest(private.supplier_display_aliases(s.id)) a where private.history_key(a)=private.history_key(p_data->>'name'))))
 then raise exception 'SUPPLIER_NAME_EXISTS' using errcode='23505';end if;
 insert into public.suppliers(organization_id,supplier_code,name,is_active)$patch$);
 execute src;
end $$;
notify pgrst,'reload schema';
