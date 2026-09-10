-- Wire existing management controls; leave prior receipts, counts and source files intact.
create table private.product_unit_rules(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 product_id uuid not null references public.products(id),supplier_id uuid references public.suppliers(id),
 source_unit text not null,base_unit text not null,factor numeric not null check(factor>0 and factor<1000000000),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create index product_unit_rules_lookup on private.product_unit_rules(organization_id,product_id,supplier_id,source_unit,created_at desc);
alter table private.product_unit_rules enable row level security;
revoke all on private.product_unit_rules from anon,authenticated;

create table private.member_zone_responsibilities(
 store_id uuid not null references public.stores(id),user_id uuid not null references public.profiles(id),zone_id uuid not null references public.count_zones(id),
 assigned_by uuid not null references public.profiles(id),assigned_at timestamptz not null default now(),primary key(store_id,user_id,zone_id),
 foreign key(store_id,user_id) references public.store_memberships(store_id,user_id)
);
alter table private.member_zone_responsibilities enable row level security;
revoke all on private.member_zone_responsibilities from anon,authenticated;

create function private.app_mapping_workspace(p_store uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r text:=private.app_role(p_store);org uuid;t text;
begin
 if r is null or r='STAFF' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select s.organization_id,o.business_type into org,t from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store;
 return jsonb_build_object('editable',r in ('OWNER','LOGISTICS') and t='SINGLE_RESTAURANT',
 'lines',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'batch_id',g.source_batch_id,'name',coalesce(l.ai_original->>'raw_product_name',p.name,'未提供'),'supplier_name',s.name,'quantity',l.quantity,'unit',l.unit,'product_id',l.product_id,'inventory_status',l.inventory_status,'modified_at',l.modified_at,'date',g.receipt_date) order by g.reviewed_at desc,l.source_row_key,l.id),'[]'::jsonb)
 from public.receipt_lines l join public.goods_receipts g on g.id=l.receipt_id left join public.products p on p.id=l.product_id left join public.suppliers s on s.id=l.supplier_id where g.store_id=p_store and l.inventory_status<>'POSTED'),
 'rules',(select coalesce(jsonb_agg(to_jsonb(u)||jsonb_build_object('product_name',p.name,'supplier_name',s.name) order by u.created_at desc),'[]'::jsonb) from private.product_unit_rules u join public.products p on p.id=u.product_id left join public.suppliers s on s.id=u.supplier_id where u.organization_id=org),
 'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit) order by p.name),'[]'::jsonb) from public.products p where p.organization_id=org and p.is_active));
end $$;
revoke all on function private.app_mapping_workspace(uuid) from public,anon,authenticated;

create function private.app_resolve_receipt_mapping(p_store uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text:=private.app_role(p_store);org uuid;t text;l public.receipt_lines;g public.goods_receipts;p public.products;
 factor numeric:=nullif(p_data->>'factor','')::numeric;state text;old jsonb;rule uuid;
begin
 select s.organization_id,o.business_type into org,t from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store;
 if role_name is null or role_name not in ('OWNER','LOGISTICS') or t<>'SINGLE_RESTAURANT' then raise exception 'CATALOG_ROLE_REQUIRED' using errcode='42501';end if;
 select rl.* into l from public.receipt_lines rl join public.goods_receipts r on r.id=rl.receipt_id where rl.id=(p_data->>'id')::uuid and r.store_id=p_store for update of rl;
 if not found then raise exception 'RECEIPT_LINE_NOT_FOUND' using errcode='P0002';end if;
 if l.inventory_status='POSTED' then return jsonb_build_object('id',l.id,'value',to_jsonb(l));end if;
 if (p_data->>'modified_at')::timestamptz is distinct from l.modified_at then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 select * into p from public.products where id=(p_data->>'product_id')::uuid and organization_id=org and is_active;
 if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002';end if;
 select * into strict g from public.goods_receipts where id=l.receipt_id;
 old:=to_jsonb(l);
 if nullif(l.unit,'') is null then factor:=null;
 elsif l.unit=p.base_unit then factor:=1;
 elsif factor is null or factor<=0 or factor>=1000000000 then raise exception 'UNIT_CONVERSION_REQUIRED' using errcode='22023';
 else
  insert into private.product_unit_rules(organization_id,product_id,supplier_id,source_unit,base_unit,factor,created_by)
  values(org,p.id,l.supplier_id,l.unit,p.base_unit,factor,auth.uid()) returning id into rule;
 end if;
 state:=case when l.inventory_status='REVIEW_PENDING' then 'REVIEW_PENDING' when l.quantity is null or l.quantity<=0 then 'QUANTITY_PENDING' when nullif(l.unit,'') is null or factor is null then 'UNIT_PENDING' else 'POSTED' end;
 update public.receipt_lines set product_id=p.id,inventory_status=state,inventory_quantity=case when state='POSTED' then quantity*factor end,inventory_unit=case when state='POSTED' then p.base_unit end,
 human_correction=coalesce(human_correction,'{}')||jsonb_build_object('mapping',jsonb_build_object('product_id',p.id,'factor',factor,'rule_id',rule,'actor',auth.uid(),'at',now())),modified_by=auth.uid(),modified_at=now()
 where id=l.id returning * into l;
 return jsonb_build_object('id',l.id,'value',to_jsonb(l),'previous',old);
end $$;
revoke all on function private.app_resolve_receipt_mapping(uuid,jsonb) from public,anon,authenticated;

do $migration$
declare source text;next text;
begin
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into source;
 next:=replace(source,'if p_section in (''incidents''','if p_section=''mappings'' then return private.app_mapping_workspace(p_store);end if;'||chr(10)||' if p_section in (''incidents''');
 next:=replace(next,'''amount'',l.line_total_inc_tax,','''amount'',l.line_total_inc_tax,''inventory_status'',l.inventory_status,''source_batch_id'',g.source_batch_id,');
 if next=source then raise exception 'Workspace mapping source mismatch';end if;execute next;

 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 next:=replace(source,'if p_action in (''member.save''','if p_action=''mapping.resolve'' then return private.app_resolve_receipt_mapping(p_store,p_data);end if;'||chr(10)||' if p_action in (''member.save''');
 next:=replace(next,'select * into v_settings from private.app_settings where store_id=p_store for update;',
 'if p_data->''settings''->>''blind_count''=''false'' or (v_type<>''CHAIN_RESTAURANT'' and p_data->''settings''->>''paper_required''=''true'') then raise exception ''INVALID_SETTINGS'' using errcode=''22023'';end if;'||chr(10)||
 'select * into v_settings from private.app_settings where store_id=p_store for update;');
 next:=replace(next,'v_result:=to_jsonb(v_product);',
 'if (v_old->>''current_supplier_id'')::uuid is distinct from v_target then'||chr(10)||
 ' update public.product_supplier_history set is_current=false,effective_to=current_date,valid_to=now() where product_id=v_id and is_current;'||chr(10)||
 ' if v_target is not null then insert into public.product_supplier_history(organization_id,product_id,supplier_id,effective_from,is_current,valid_from,created_by) values(v_org,v_id,v_target,current_date,true,now(),auth.uid());end if;'||chr(10)||
 'end if;'||chr(10)||'v_result:=to_jsonb(v_product);');
 if next=source then raise exception 'Management policy source mismatch';end if;execute next;

 select pg_get_functiondef('private.app_member_workspace(uuid)'::regprocedure) into source;
 next:=replace(source,'''user_id'',sm.user_id,''role''','''zone_ids'',(select coalesce(jsonb_agg(mz.zone_id),''[]''::jsonb) from private.member_zone_responsibilities mz where mz.store_id=p_store and mz.user_id=sm.user_id),''user_id'',sm.user_id,''role''');
 next:=replace(next,'return jsonb_build_object(''members''','return jsonb_build_object(''zones'',(select coalesce(jsonb_agg(jsonb_build_object(''id'',z.id,''name'',z.name) order by z.sort_order,z.id),''[]''::jsonb) from public.count_zones z where z.store_id=p_store and z.is_active),''members''');
 if next=source then raise exception 'Member zones source mismatch';end if;execute next;

 select pg_get_functiondef('private.app_member_operation(uuid,text,jsonb)'::regprocedure) into source;
 next:=replace(source,'return jsonb_build_object(''id'',v_target',
 'if p_action in (''member.save'',''member.assign'') and p_data ? ''zone_ids'' then'||chr(10)||
 ' if jsonb_typeof(p_data->''zone_ids'')<>''array'' or exists(select 1 from jsonb_array_elements_text(p_data->''zone_ids'') x where not exists(select 1 from public.count_zones z where z.id::text=x and z.store_id=p_store and z.is_active)) then raise exception ''INVALID_ZONE'' using errcode=''22023'';end if;'||chr(10)||
 ' delete from private.member_zone_responsibilities where store_id=p_store and user_id=v_target;'||chr(10)||
 ' insert into private.member_zone_responsibilities(store_id,user_id,zone_id,assigned_by) select distinct p_store,v_target,x::uuid,auth.uid() from jsonb_array_elements_text(p_data->''zone_ids'') x;'||chr(10)||
 ' v_result:=v_result||jsonb_build_object(''zone_ids'',p_data->''zone_ids'');end if;'||chr(10)||
 'return jsonb_build_object(''id'',v_target');
 if next=source then raise exception 'Member assignment source mismatch';end if;execute next;

 select pg_get_functiondef('public.start_pilot_count(uuid,jsonb)'::regprocedure) into source;
 next:=replace(source,'not(v_type=''CHAIN_RESTAURANT'' and private.has_active_store_role','not(coalesce((select settings->>''count_cadence'' from private.app_settings where store_id=p_store_id),case when v_type=''CHAIN_RESTAURANT'' then ''DAILY'' else ''MONTHLY'' end)=''DAILY'' and private.has_active_store_role');
 next:=replace(next,'v_snapshot,coalesce((select (settings->>''paper_required'')::boolean from private.app_settings where store_id=p_store_id),v_type=''CHAIN_RESTAURANT''))','v_snapshot,v_type=''CHAIN_RESTAURANT'' and coalesce((select (settings->>''paper_required'')::boolean from private.app_settings where store_id=p_store_id),true))');
 if next=source then raise exception 'Daily count policy source mismatch';end if;execute next;
 select pg_get_functiondef('private.create_daily_store_counts()'::regprocedure) into source;
 next:=replace(source,'(''ADMIN'',''SUPERVISOR'')','(''ADMIN'',''OWNER'',''SUPERVISOR'')');
 next:=replace(next,'o.business_type=''CHAIN_RESTAURANT''','coalesce((select settings->>''count_cadence'' from private.app_settings where store_id=s.id),case when o.business_type=''CHAIN_RESTAURANT'' then ''DAILY'' else ''MONTHLY'' end)=''DAILY''');
 if next=source then raise exception 'Daily scheduler source mismatch';end if;execute next;

 select pg_get_functiondef('private.expiry_waste_command(uuid,uuid,text,jsonb)'::regprocedure) into source;
 next:=replace(source,'select has_erp into erp from public.organizations where id=org;','select has_erp and coalesce((select (settings->>''erp_waste'')::boolean from private.app_settings where store_id=p_store_id),true) into erp from public.organizations where id=org;');
 if next=source then raise exception 'Waste policy source mismatch';end if;execute next;
end $migration$;
notify pgrst,'reload schema';
