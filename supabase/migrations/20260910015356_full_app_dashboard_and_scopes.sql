-- Report only finalized receipt/count records using the deployed enums.
-- Existing services share canonical roles, including automatically expired acting supervisors.
create or replace function private.has_active_store_role(p_store_id uuid,p_roles public.app_role[] default null)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.app_role(p_store_id) is not null and (p_roles is null
  or private.app_role(p_store_id)=any(p_roles::text[])
  or (private.app_role(p_store_id)='OWNER' and 'ADMIN'=any(p_roles::text[]))),false)
$$;
create or replace function private.can_read_count_management(p_store uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.app_role(p_store) in ('SUPERVISOR','LOGISTICS','OWNER'),false)
$$;

create function private.app_dashboard(p_store uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r text:=private.app_role(p_store); today date:=(now() at time zone 'Asia/Taipei')::date; v_month date:=date_trunc('month',today)::date; s public.stores; org public.organizations;
begin
 if r is null then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
 select * into strict s from public.stores where id=p_store;select * into strict org from public.organizations where id=s.organization_id;
 return jsonb_build_object(
  'count',(select jsonb_build_object('id',c.id,'status',c.status,'completed_at',c.completed_at,'paper_required',c.paper_required,'paper_completed_at',c.paper_completed_at) from public.inventory_count_sessions c where c.store_id=p_store order by c.started_at desc limit 1),
  'count_items',(select count(*) from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=p_store and z.is_active),
  'count_completed',(select count(*) from public.inventory_count_sessions c where c.store_id=p_store and c.status::text='CLOSED' and (c.completed_at at time zone 'Asia/Taipei')::date>=v_month),
  'receipt_pending',(select count(*) from public.receipt_upload_batches b where b.store_id=p_store and b.status::text<>'COMPLETED' and private.can_read_receipt(b.id)),
  'receipt_issues',(select count(*) from public.receipt_upload_batches b where b.store_id=p_store and b.status::text<>'COMPLETED' and private.can_read_receipt(b.id) and exists(select 1 from public.receipt_ocr_jobs j where j.batch_id=b.id and j.status in ('FAILED','RETRY'))),
  'expiry_urgent',(select count(*) from private.expiry_current e where e.store_id=p_store and e.expires_on<=today and not exists(select 1 from private.expiry_resolutions er where er.expiry_id=e.id)),
  'incidents',(select count(*) from private.app_records a where a.store_id=p_store and a.kind='incident' and a.status<>'COMPLETE'),
  'handover',(select count(*) from private.app_records a where a.store_id=p_store and a.kind='handover' and a.status<>'COMPLETE'),
  'erp_pending',case when org.has_erp then
    (select count(*) from public.receipt_upload_batches b where b.store_id=p_store and b.erp_required and b.erp_completed_at is null and private.can_read_receipt(b.id))+
    (select count(*) from private.waste_records w where w.store_id=p_store and w.erp_required and not exists(select 1 from private.waste_erp_reports wr where wr.store_id=p_store and w.id=any(wr.waste_ids))) else 0 end,
  'month_receipt_amount',case when r<>'STAFF' then (select sum(g.total_inc_tax) from public.goods_receipts g join public.receipt_upload_batches b on b.id=g.source_batch_id where g.store_id=p_store and b.status::text='COMPLETED' and g.receipt_date>=v_month) end,
  'month_waste_amount',case when r<>'STAFF' and not org.has_erp then (select sum(w.quantity*w.reference_price) from private.waste_records w where w.store_id=p_store and w.work_date>=v_month) end,
  'bulletins',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'actor_name',p.display_name,'created_at',a.created_at) order by a.created_at desc),'[]'::jsonb) from private.app_records a left join public.profiles p on p.id=a.created_by where a.store_id=p_store and a.kind='bulletin' and a.status<>'COMPLETE' and (a.expires_at is null or a.expires_at>now()) and (r=any(a.audience) or r in ('OWNER','SUPERVISOR'))),
  'shortages',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'updated_at',q.updated_at) order by p.name),'[]'::jsonb)
   from public.products p join private.product_details d on d.product_id=p.id
   join lateral (select sum(e.quantity) quantity,max(e.entered_at) updated_at from (
     select distinct on (ce.zone_id,ce.product_id) ce.quantity,ce.unit,ce.entered_at
     from public.count_entries ce where ce.product_id=p.id and ce.session_id=(select cs.id from public.inventory_count_sessions cs where cs.store_id=p_store and cs.status::text='CLOSED' order by cs.completed_at desc limit 1)
     order by ce.zone_id,ce.product_id,ce.entered_at desc,ce.id desc
   ) e where e.unit=p.base_unit) q on true
   where p.organization_id=s.organization_id and p.is_active and d.safety_quantity is not null and q.quantity<d.safety_quantity)

 );
end $$;
create function public.get_app_dashboard(p_store_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.app_dashboard(p_store_id)$$;
revoke all on function private.app_dashboard(uuid),public.get_app_dashboard(uuid) from public,anon;
grant execute on function private.app_dashboard(uuid),public.get_app_dashboard(uuid) to authenticated;
create or replace function private.app_workspace(p_store uuid,p_section text,p_filter jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path='' as $$
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
   'reference_price',case when not v_erp and v_role<>'STAFF' then (select rl.unit_price_ex_tax from public.receipt_lines rl join public.goods_receipts g on g.id=rl.receipt_id join public.receipt_upload_batches b on b.id=g.source_batch_id where g.store_id=p_store and b.status::text='COMPLETED' and rl.product_id=m.product_id and rl.unit=m.unit order by g.receipt_date desc,g.reviewed_at desc limit 1) else null end,
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
   return jsonb_build_object('counts',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'started_at',s.started_at,'completed_at',s.completed_at,'status',s.status,'paper_completed_at',s.paper_completed_at) order by s.started_at desc),'[]'::jsonb) from public.inventory_count_sessions s where s.store_id=p_store and s.status::text='CLOSED' and s.completed_at>=v_start and s.completed_at<v_end),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('supplier_name',sp.name) order by g.receipt_date desc),'[]'::jsonb) from public.goods_receipts g join public.receipt_upload_batches b on b.id=g.source_batch_id left join public.suppliers sp on sp.id=g.supplier_id where g.store_id=p_store and b.status::text='COMPLETED' and g.reviewed_at>=v_start and g.reviewed_at<v_end),
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'receipt_id',g.id,'product_id',l.product_id,'name',coalesce(p.name,l.ai_original->>'raw_product_name','未對應'),'quantity',l.quantity,'unit',l.unit,'unit_price',l.unit_price_ex_tax,'amount',l.line_total_inc_tax,'receipt_date',g.receipt_date,'supplier_name',sp.name)),'[]'::jsonb) from public.receipt_lines l join public.goods_receipts g on g.id=l.receipt_id join public.receipt_upload_batches b on b.id=g.source_batch_id left join public.products p on p.id=l.product_id left join public.suppliers sp on sp.id=g.supplier_id where g.store_id=p_store and b.status::text='COMPLETED' and g.reviewed_at>=v_start and g.reviewed_at<v_end));
  end if;
 end if;
 raise exception 'INVALID_APP_SECTION' using errcode='22023';
end $$;
