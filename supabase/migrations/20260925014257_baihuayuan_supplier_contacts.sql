-- Extend existing private supplier records; keep identity, original receipts and CAS writes.
alter table private.supplier_details
 add column order_method text not null default '',
 add column order_url text not null default '',
 add column cutoff_time text not null default '',
 add column order_note text not null default '',
 add column aliases text[] not null default '{}';
alter table private.supplier_details enable row level security;
revoke all on private.supplier_details from public,anon,authenticated;

-- Guard every replacement, preserving the deployed management and request handlers.
do $migration$
declare source text; anchor text; addition text;
begin
 select pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure) into source;
 anchor:='v_old:=to_jsonb(v_supplier);';
 if strpos(source,anchor)=0 then raise exception 'SUPPLIER_CAS_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,$patch$v_old:=to_jsonb(v_supplier)||coalesce((select to_jsonb(d)-'supplier_id' from private.supplier_details d where d.supplier_id=v_id),'{}'::jsonb);$patch$);
 anchor:='   v_result:=to_jsonb(v_supplier);';
 if strpos(source,anchor)=0 then raise exception 'SUPPLIER_RESULT_ANCHOR_MISSING';end if;
 addition:=$patch$
   if length(coalesce(p_data->>'order_method',''))>80 or length(coalesce(p_data->>'order_url',''))>2000
    or length(coalesce(p_data->>'cutoff_time',''))>160 or length(coalesce(p_data->>'order_note',''))>4000
    or length(coalesce(p_data->>'delivery_note',''))>2000
    or (coalesce(p_data->>'order_url','')<>'' and (p_data->>'order_url')!~* '^https?://[^[:space:]]+$') then
    raise exception 'INVALID_SUPPLIER_CONTACT' using errcode='22023';end if;
   if p_data ? 'aliases' then
    if jsonb_typeof(p_data->'aliases') is distinct from 'array' then raise exception 'INVALID_SUPPLIER_ALIASES' using errcode='22023';end if;
    if jsonb_array_length(p_data->'aliases')>50 or exists(select 1 from jsonb_array_elements(p_data->'aliases') x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>160) then raise exception 'INVALID_SUPPLIER_ALIASES' using errcode='22023';end if;
   end if;
   update private.supplier_details set
    order_method=case when p_data ? 'order_method' then btrim(p_data->>'order_method') else order_method end,
    order_url=case when p_data ? 'order_url' then btrim(p_data->>'order_url') else order_url end,
    cutoff_time=case when p_data ? 'cutoff_time' then btrim(p_data->>'cutoff_time') else cutoff_time end,
    order_note=case when p_data ? 'order_note' then btrim(p_data->>'order_note') else order_note end,
    aliases=case when p_data ? 'aliases' then coalesce((select array_agg(distinct btrim(value)) from jsonb_array_elements_text(p_data->'aliases') where btrim(value)<>''),'{}') else aliases end
   where supplier_id=v_id;
   -- A rename retains the previous invoice spelling as an alias.
   if v_old->>'name' is not null and v_old->>'name'<>v_supplier.name then
    update private.supplier_details set aliases=array(select distinct unnest(aliases||array[v_old->>'name'])) where supplier_id=v_id;
   end if;
   v_result:=to_jsonb(v_supplier)||coalesce((select to_jsonb(d)-'supplier_id' from private.supplier_details d where d.supplier_id=v_id),'{}'::jsonb);
$patch$;
 source:=replace(source,anchor,addition);execute source;
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into source;
 anchor:='''phone'',d.phone,''delivery_note'',d.delivery_note';
 if strpos(source,anchor)=0 then raise exception 'SUPPLIER_READ_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,anchor||',''order_method'',d.order_method,''order_url'',d.order_url,''cutoff_time'',d.cutoff_time,''order_note'',d.order_note,''aliases'',coalesce(d.aliases,''{}''::text[])');execute source;
 select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into source;
 anchor:=' perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_request::text,0));';
 if strpos(source,anchor)=0 then raise exception 'SUPPLIER_REQUEST_ANCHOR_MISSING';end if;
 source:=replace(source,anchor,$patch$
 if p_action='supplier.save' then
  if auth.uid() is null or v_role not in ('OWNER','LOGISTICS') or not exists(select 1 from public.stores s join public.organizations o on o.id=s.organization_id where s.id=p_store and o.business_type<>'CHAIN_RESTAURANT') then raise exception 'CATALOG_ROLE_REQUIRED' using errcode='42501';end if;
 end if;
$patch$||anchor);execute source;
end $migration$;
notify pgrst,'reload schema';
