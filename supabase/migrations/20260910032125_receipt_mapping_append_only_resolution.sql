-- Published receipt rows stay append-only. Later optional mapping is an
-- additional attributed record, not a rewrite of OCR or confirmed evidence.
create table private.receipt_line_resolutions(
 id uuid primary key default gen_random_uuid(),receipt_line_id uuid not null references public.receipt_lines(id),
 product_id uuid not null references public.products(id),inventory_status text not null check(inventory_status in('POSTED','REVIEW_PENDING','UNIT_PENDING','QUANTITY_PENDING')),
 inventory_quantity numeric,inventory_unit text,conversion_factor numeric,rule_id uuid references private.product_unit_rules(id),
 actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create index receipt_line_resolutions_latest on private.receipt_line_resolutions(receipt_line_id,created_at desc);
create unique index receipt_line_resolutions_posted on private.receipt_line_resolutions(receipt_line_id) where inventory_status='POSTED';
alter table private.receipt_line_resolutions enable row level security;
revoke all on private.receipt_line_resolutions from anon,authenticated;
create trigger immutable_history before update or delete on private.receipt_line_resolutions for each row execute function private.prevent_pilot_history_mutation();
drop trigger receipt_line_inventory_resolution on public.receipt_lines;

create or replace function private.app_resolve_receipt_mapping(p_store uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text:=private.app_role(p_store);org uuid;t text;l public.receipt_lines;g public.goods_receipts;p public.products;previous private.receipt_line_resolutions;resolution private.receipt_line_resolutions;
 factor numeric:=nullif(p_data->>'factor','')::numeric;state text;rule uuid;lot uuid;expiry date;old jsonb;result jsonb;
begin
 select s.organization_id,o.business_type into org,t from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store;
 if role_name is null or role_name not in ('OWNER','LOGISTICS') or t<>'SINGLE_RESTAURANT' then raise exception 'CATALOG_ROLE_REQUIRED' using errcode='42501';end if;
 select rl.* into l from public.receipt_lines rl join public.goods_receipts r on r.id=rl.receipt_id where rl.id=(p_data->>'id')::uuid and r.store_id=p_store for update of rl;
 if not found then raise exception 'RECEIPT_LINE_NOT_FOUND' using errcode='P0002';end if;
 select * into previous from private.receipt_line_resolutions where receipt_line_id=l.id order by created_at desc limit 1;
 old:=to_jsonb(l)||case when previous.id is null then '{}'::jsonb else jsonb_build_object('product_id',previous.product_id,'inventory_status',previous.inventory_status,'modified_at',previous.created_at) end;
 if l.inventory_status='POSTED' or previous.inventory_status='POSTED' then return jsonb_build_object('id',l.id,'value',old);end if;
 if (p_data->>'modified_at')::timestamptz is distinct from coalesce(previous.created_at,l.modified_at) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 select * into p from public.products where id=(p_data->>'product_id')::uuid and organization_id=org and is_active;
 if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002';end if;
 select * into strict g from public.goods_receipts where id=l.receipt_id;
 if nullif(l.unit,'') is null then factor:=null;
 elsif l.unit=p.base_unit then factor:=1;
 elsif factor is null or factor<=0 or factor>=1000000000 then raise exception 'UNIT_CONVERSION_REQUIRED' using errcode='22023';
 else
  insert into private.product_unit_rules(organization_id,product_id,supplier_id,source_unit,base_unit,factor,created_by)
  values(org,p.id,l.supplier_id,l.unit,p.base_unit,factor,auth.uid()) returning id into rule;
 end if;
 state:=case when l.inventory_status='REVIEW_PENDING' then 'REVIEW_PENDING' when l.quantity is null or l.quantity<=0 then 'QUANTITY_PENDING' when nullif(l.unit,'') is null or factor is null then 'UNIT_PENDING' else 'POSTED' end;
 insert into private.receipt_line_resolutions(receipt_line_id,product_id,inventory_status,inventory_quantity,inventory_unit,conversion_factor,rule_id,actor_id)
 values(l.id,p.id,state,case when state='POSTED' then l.quantity*factor end,case when state='POSTED' then p.base_unit end,factor,rule,auth.uid()) returning * into resolution;
 if state='POSTED' then
  if nullif(l.batch_or_expiry,'') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then begin expiry:=l.batch_or_expiry::date;exception when datetime_field_overflow or invalid_datetime_format then expiry:=null;end;end if;
  insert into public.inventory_lots(organization_id,store_id,store_name,product_id,lot_code,original_expiry_date,source_type,source_id,created_by)
  values(org,p_store,(select name from public.stores where id=p_store),p.id,nullif(l.batch_or_expiry,''),expiry,'GOODS_RECEIPT',l.id,auth.uid()) returning id into lot;
  insert into public.inventory_lot_events(organization_id,lot_id,event_type,preservation_state,quantity,unit,occurred_on,source_type,source_id,recorded_by)
  values(org,lot,'RECEIVED','ORIGINAL_EXPIRY',resolution.inventory_quantity,resolution.inventory_unit,g.receipt_date,'GOODS_RECEIPT',l.id,auth.uid());
 end if;
 result:=to_jsonb(l)||jsonb_build_object('product_id',p.id,'inventory_status',state,'inventory_quantity',resolution.inventory_quantity,'inventory_unit',resolution.inventory_unit,'modified_at',resolution.created_at,'resolution_id',resolution.id);
 return jsonb_build_object('id',l.id,'value',result,'previous',old);
end $$;

do $migration$
declare source text;next text;
begin
 select pg_get_functiondef('private.app_mapping_workspace(uuid)'::regprocedure) into source;
 next:=replace(source,'''product_id'',l.product_id,''inventory_status'',l.inventory_status,''modified_at'',l.modified_at',
 '''product_id'',coalesce(rs.product_id,l.product_id),''inventory_status'',coalesce(rs.inventory_status,l.inventory_status),''modified_at'',coalesce(rs.created_at,l.modified_at)');
 next:=replace(next,'left join public.products p on p.id=l.product_id',
 'left join lateral(select * from private.receipt_line_resolutions where receipt_line_id=l.id order by created_at desc limit 1) rs on true left join public.products p on p.id=coalesce(rs.product_id,l.product_id)');
 next:=replace(next,'l.inventory_status<>''POSTED''','coalesce(rs.inventory_status,l.inventory_status)<>''POSTED''');
 if next=source then raise exception 'Mapping resolution view source mismatch';end if;execute next;
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into source;
 next:=replace(source,'''inventory_status'',l.inventory_status','''inventory_status'',coalesce((select inventory_status from private.receipt_line_resolutions where receipt_line_id=l.id order by created_at desc limit 1),l.inventory_status)');
 if next=source then raise exception 'Report resolution source mismatch';end if;execute next;
end $migration$;
notify pgrst,'reload schema';
