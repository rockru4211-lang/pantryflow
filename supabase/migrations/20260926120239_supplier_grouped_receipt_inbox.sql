-- Confirmed name links are projections: original supplier IDs, OCR and receipts stay intact.
create table private.supplier_name_links (
 organization_id uuid not null references public.organizations(id),
 name_key text not null,
 source_name text not null,
 supplier_id uuid not null references public.suppliers(id),
 confirmed_by uuid references auth.users(id),
 evidence text not null,
 updated_at timestamptz not null default now(),
 primary key (organization_id,name_key),
 check (length(source_name) between 1 and 160),
 check (name_key=private.history_key(source_name))
);
create index supplier_name_links_target on private.supplier_name_links(supplier_id);
alter table private.supplier_name_links enable row level security;
revoke all on private.supplier_name_links from public,anon,authenticated;

create function private.supplier_identity(p_org uuid,p_name text) returns uuid
language plpgsql stable set search_path='' as $$
declare result uuid; matches uuid[];
begin
 if coalesce(private.history_key(p_name),'') in ('','未提供') then return null;end if;
 select l.supplier_id into result from private.supplier_name_links l
 join public.suppliers s on s.id=l.supplier_id and s.organization_id=l.organization_id
 where l.organization_id=p_org and l.name_key=private.history_key(p_name) and s.is_active;
 if found then return result;end if;
 -- Do not silently fall back to a shadow supplier when its confirmed target is inactive.
 if exists(select 1 from private.supplier_name_links l where l.organization_id=p_org and l.name_key=private.history_key(p_name)) then return null;end if;
 select array_agg(distinct s.id) into matches from public.suppliers s
 left join private.supplier_details d on d.supplier_id=s.id
 where s.organization_id=p_org and s.is_active
 and not exists(select 1 from private.supplier_name_links l where l.organization_id=p_org and l.name_key=private.history_key(s.name) and l.supplier_id<>s.id)
 and (private.history_key(s.name)=private.history_key(p_name) or exists(select 1 from unnest(d.aliases) a where private.history_key(a)=private.history_key(p_name)));
 if cardinality(matches)=1 then return matches[1];end if;
 return null;
end $$;
create function private.supplier_display_name(p_org uuid,p_name text) returns text
language sql stable set search_path='' as $$
 select coalesce((select name from public.suppliers where id=private.supplier_identity(p_org,p_name)),p_name)
$$;
create function private.supplier_display_aliases(p_supplier uuid) returns text[]
language sql stable set search_path='' as $$
 select coalesce(array_agg(distinct name),'{}'::text[]) from (
 select unnest(aliases) name from private.supplier_details where supplier_id=p_supplier
 union all select source_name from private.supplier_name_links where supplier_id=p_supplier
 ) a
$$;
create function private.supplier_canonical_rows(p_org uuid,p_rows jsonb) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(r||jsonb_build_object('raw_supplier_name',r->>'supplier_name',
 'supplier_name',private.supplier_display_name(p_org,r->>'supplier_name'),
 'supplier_id',private.supplier_identity(p_org,r->>'supplier_name')) order by n),'[]'::jsonb)
 from jsonb_array_elements(p_rows) with ordinality t(r,n)
$$;

create function private.resolve_supplier_name(p_store uuid,p_data jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare org uuid; target uuid; raw text:=btrim(p_data->>'source_name'); name text:=btrim(p_data->>'new_name');
 previous uuid; old_link jsonb; result jsonb;
begin
 if auth.uid() is null or coalesce(private.app_role(p_store),'') not in ('OWNER','LOGISTICS') then raise exception 'CATALOG_ROLE_REQUIRED' using errcode='42501';end if;
 select s.organization_id into org from public.stores s join public.organizations o on o.id=s.organization_id
 where s.id=p_store and s.is_active and o.business_type<>'CHAIN_RESTAURANT';
 if org is null then raise exception 'CATALOG_ROLE_REQUIRED' using errcode='42501';end if;
 if coalesce(length(raw),0) not between 1 and 160 or raw='未提供' or not (p_data ? 'expected_supplier_id') then raise exception 'INVALID_SUPPLIER_NAME' using errcode='22023';end if;
 -- Organization-wide identity changes serialize with each other, and never alter receipts.
 perform pg_advisory_xact_lock(hashtextextended(org::text||':supplier-names',0));
 previous:=private.supplier_identity(org,raw);
 if previous is distinct from nullif(p_data->>'expected_supplier_id','')::uuid then raise exception 'SUPPLIER_NAME_CHANGED' using errcode='40001';end if;
 if not exists(select 1 from jsonb_array_elements(public.get_baihuayuan_receipt_inbox(p_store)) r where private.history_key(r->>'raw_supplier_name')=private.history_key(raw)) then raise exception 'SUPPLIER_SOURCE_REQUIRED' using errcode='22023';end if;
 target:=nullif(p_data->>'supplier_id','')::uuid;
 if target is null then
  if coalesce(length(name),0) not between 1 and 160 or name='未提供' then raise exception 'INVALID_SUPPLIER_NAME' using errcode='22023';end if;
  if private.supplier_identity(org,name) is not null or exists(select 1 from public.suppliers where organization_id=org and private.history_key(suppliers.name)=private.history_key(name)) then raise exception 'SUPPLIER_NAME_EXISTS' using errcode='23505';end if;
  insert into public.suppliers(organization_id,name) values(org,name) returning id into target;
 end if;
 if not exists(select 1 from public.suppliers s where s.id=target and s.organization_id=org and s.is_active
  and private.supplier_identity(org,s.name)=s.id) then raise exception 'INVALID_SUPPLIER_TARGET' using errcode='22023';end if;
 -- Reject chains/cycles instead of changing the meaning of already confirmed aliases.
 if exists(select 1 from public.suppliers s join private.supplier_name_links l on l.supplier_id=s.id
  where s.organization_id=org and private.history_key(s.name)=private.history_key(raw) and s.id<>target) then raise exception 'SUPPLIER_HAS_NAME_LINKS' using errcode='22023';end if;
 select to_jsonb(l) into old_link from private.supplier_name_links l where l.organization_id=org and l.name_key=private.history_key(raw);
 insert into private.supplier_name_links(organization_id,name_key,source_name,supplier_id,confirmed_by,evidence)
 values(org,private.history_key(raw),raw,target,auth.uid(),'INBOX_NAME_SELECTION')
 on conflict(organization_id,name_key) do update set source_name=excluded.source_name,supplier_id=excluded.supplier_id,
 confirmed_by=excluded.confirmed_by,evidence=excluded.evidence,updated_at=clock_timestamp();
 result:=jsonb_build_object('id',target,'name',(select s.name from public.suppliers s where s.id=target),'source_name',raw,'previous',old_link);
 return result;
end $$;

revoke all on function private.supplier_identity(uuid,text),private.supplier_display_name(uuid,text),private.supplier_display_aliases(uuid),private.supplier_canonical_rows(uuid,jsonb),private.resolve_supplier_name(uuid,jsonb) from public,anon,authenticated;

-- Patch the current guarded RPCs in place; fail deployment if an expected anchor changed.
do $migration$
declare source text; anchor text;
begin
 select pg_get_functiondef('public.get_baihuayuan_receipt_inbox(uuid)'::regprocedure) into source;
 anchor:='''supplier_name'',coalesce(fs.supplier_name,''''),';
 if strpos(source,anchor)=0 then raise exception 'INBOX_NAME_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,$patch$'raw_supplier_name',coalesce(fs.supplier_name,''),
        'supplier_id',private.supplier_identity(v_org,fs.supplier_name),
        'supplier_name',coalesce(private.supplier_display_name(v_org,fs.supplier_name),''),$patch$);
 execute source;

 select pg_get_functiondef('public.get_pilot_receipt_ledger(uuid)'::regprocedure) into source;
 anchor:='''supplier_name'',supplier_name,';
 if strpos(source,anchor)=0 then raise exception 'LEDGER_NAME_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,$patch$'raw_supplier_name',supplier_name,
        'supplier_id',private.supplier_identity((select organization_id from public.stores where id=p_store_id),supplier_name),
        'supplier_name',private.supplier_display_name((select organization_id from public.stores where id=p_store_id),supplier_name),$patch$);
 execute source;

 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into source;
 anchor:='return private.historical_price_sources(p_store,p_filter);';
 if strpos(source,anchor)=0 then raise exception 'HISTORICAL_NAME_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,'return private.supplier_canonical_rows((select organization_id from public.stores where id=p_store),private.historical_price_sources(p_store,p_filter));');
 anchor:='''aliases'',coalesce(d.aliases,''{}''::text[])';
 if strpos(source,anchor)=0 then raise exception 'SUPPLIER_ALIAS_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,'''aliases'',private.supplier_display_aliases(s.id)');
 anchor:='where s.organization_id=v_org));';
 if strpos(source,anchor)=0 then raise exception 'SUPPLIER_GROUP_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,'where s.organization_id=v_org and not exists(select 1 from private.supplier_name_links l where l.organization_id=v_org and l.name_key=private.history_key(s.name) and l.supplier_id<>s.id)));');
 anchor:='''supplier_name'',s.name,''product_is_active''';
 if strpos(source,anchor)=0 then raise exception 'CATALOG_SUPPLIER_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,'''supplier_name'',private.supplier_display_name(v_org,s.name),''current_supplier_id'',coalesce(private.supplier_identity(v_org,s.name),p.current_supplier_id),''product_is_active''');
 execute source;

 select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into source;
 anchor:=' if p_action=''supplier.save'' then';
 if strpos(source,anchor)=0 then raise exception 'SUPPLIER_GUARD_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,' if p_action in (''supplier.save'',''supplier.resolve-name'') then');
 anchor:=' perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_request::text,0));';
 if strpos(source,anchor)=0 then raise exception 'SUPPLIER_REPLAY_GUARD_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,$patch$ if p_action='supplier.resolve-name' and (auth.uid() is null or coalesce(private.app_role(p_store),'') not in ('OWNER','LOGISTICS') or not exists(select 1 from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store and s.is_active and o.business_type<>'CHAIN_RESTAURANT')) then raise exception 'CATALOG_ROLE_REQUIRED' using errcode='42501';end if;
$patch$||anchor);
 anchor:=' elsif p_action=''receipt.edit-card'' then';
 if strpos(source,anchor)=0 then raise exception 'SUPPLIER_DISPATCH_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,' elsif p_action=''supplier.resolve-name'' then v_result:=private.resolve_supplier_name(p_store,p_data);'||anchor);
 execute source;

 select pg_get_functiondef('private.publish_receipt(uuid,uuid,boolean)'::regprocedure) into source;
 anchor:=$old$  select id into supplier
  from public.suppliers
  where organization_id=b.organization_id
    and lower(btrim(name))=lower(btrim(header->>'supplier_name'))
    and is_active
  order by created_at
  limit 1;$old$;
 if strpos(source,anchor)=0 then raise exception 'PUBLISH_SUPPLIER_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,$patch$  supplier:=private.supplier_identity(b.organization_id,header->>'supplier_name');
  if supplier is null and baihuayuan and not chain then raise exception 'SUPPLIER_NAME_REQUIRED';end if;$patch$);
 anchor:=$old$      select id into line_supplier
      from public.suppliers
      where organization_id=b.organization_id
        and lower(btrim(name))=lower(btrim(coalesce(nullif(manual.supplier_name,''),header->>'supplier_name')))
        and is_active
      order by created_at
      limit 1;$old$;
 if strpos(source,anchor)=0 then raise exception 'MANUAL_SUPPLIER_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,$patch$      line_supplier:=private.supplier_identity(b.organization_id,coalesce(nullif(manual.supplier_name,''),header->>'supplier_name'));
      if line_supplier is null then raise exception 'SUPPLIER_NAME_REQUIRED';end if;$patch$);
 -- Old published supplier IDs remain intact, but duplicate checks use the same canonical identity.
 source:=replace(source,'and g.supplier_id=supplier','and coalesce(private.supplier_identity(b.organization_id,(select name from public.suppliers where id=g.supplier_id)),g.supplier_id)=supplier');
 execute source;

 select pg_get_functiondef('public.create_baihuayuan_direct_receipt(uuid,text,date,text,jsonb)'::regprocedure) into source;
 anchor:=$old$  select id into v_supplier
  from public.suppliers
  where organization_id=v_store.organization_id
    and lower(btrim(name))=lower(btrim(p_supplier_name))
    and is_active
  order by created_at
  limit 1;$old$;
 if strpos(source,anchor)=0 then raise exception 'DIRECT_SUPPLIER_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,'  v_supplier:=private.supplier_identity(v_store.organization_id,p_supplier_name);');
 source:=replace(source,'and g.supplier_id=v_supplier','and coalesce(private.supplier_identity(v_store.organization_id,(select name from public.suppliers where id=g.supplier_id)),g.supplier_id)=v_supplier');
 execute source;
end $migration$;
notify pgrst,'reload schema';
