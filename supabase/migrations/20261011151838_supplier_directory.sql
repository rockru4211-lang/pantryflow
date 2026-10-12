-- Additive supplier information; existing identities, prices and transaction history stay intact.
alter table private.supplier_details
 add column primary_supplies text not null default '' check (length(primary_supplies)<=2000),
 add column line_id text not null default '' check (length(line_id)<=2000),
 add column line_group text not null default '' check (length(line_group)<=2000),
 add column minimum_order text not null default '' check (length(minimum_order)<=2000),
 add column supply_note text not null default '' check (length(supply_note)<=4000),
 add column company_name text not null default '' check (length(company_name)<=2000),
 add column tax_id text not null default '' check (length(tax_id)<=2000),
 add column address text not null default '' check (length(address)<=2000),
 add column bank_name text not null default '' check (length(bank_name)<=2000),
 add column bank_account text not null default '' check (length(bank_account)<=2000),
 add column account_name text not null default '' check (length(account_name)<=2000),
 add column billing_cycle text not null default '' check (length(billing_cycle)<=2000),
 add column payment_terms text not null default '' check (length(payment_terms)<=2000),
 add column cooperation_note text not null default '' check (length(cooperation_note)<=4000),
 add column cooperation_status text not null default 'COMMON' check (cooperation_status in ('COMMON','BACKUP'));

alter table private.supplier_details enable row level security;
revoke all on private.supplier_details from public, anon, authenticated;

do $migration$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure);
 anchor:='   update private.supplier_details set
    supplier_category=';
 if strpos(definition,anchor)=0 then raise exception 'supplier directory save anchor missing';end if;
 definition:=replace(definition,anchor,$patch$   if p_data ? 'cooperation_status' and (jsonb_typeof(p_data->'cooperation_status') is distinct from 'string' or p_data->>'cooperation_status' not in ('COMMON','BACKUP')) then
    raise exception 'INVALID_SUPPLIER_STATUS' using errcode='22023';
   end if;
   if exists(select 1 from jsonb_each(p_data) e where e.key in ('primary_supplies','line_id','line_group','minimum_order','supply_note','company_name','tax_id','address','bank_name','bank_account','account_name','billing_cycle','payment_terms','cooperation_note') and (jsonb_typeof(e.value) is distinct from 'string' or length(e.value#>>'{}')>case when e.key in ('supply_note','cooperation_note') then 4000 else 2000 end)) then
    raise exception 'INVALID_SUPPLIER_DIRECTORY' using errcode='22023';
   end if;
   update private.supplier_details set
    primary_supplies=case when p_data ? 'primary_supplies' then btrim(p_data->>'primary_supplies') else primary_supplies end,
    line_id=case when p_data ? 'line_id' then btrim(p_data->>'line_id') else line_id end,
    line_group=case when p_data ? 'line_group' then btrim(p_data->>'line_group') else line_group end,
    minimum_order=case when p_data ? 'minimum_order' then btrim(p_data->>'minimum_order') else minimum_order end,
    supply_note=case when p_data ? 'supply_note' then btrim(p_data->>'supply_note') else supply_note end,
    company_name=case when p_data ? 'company_name' then btrim(p_data->>'company_name') else company_name end,
    tax_id=case when p_data ? 'tax_id' then btrim(p_data->>'tax_id') else tax_id end,
    address=case when p_data ? 'address' then btrim(p_data->>'address') else address end,
    bank_name=case when p_data ? 'bank_name' then btrim(p_data->>'bank_name') else bank_name end,
    bank_account=case when p_data ? 'bank_account' then btrim(p_data->>'bank_account') else bank_account end,
    account_name=case when p_data ? 'account_name' then btrim(p_data->>'account_name') else account_name end,
    billing_cycle=case when p_data ? 'billing_cycle' then btrim(p_data->>'billing_cycle') else billing_cycle end,
    payment_terms=case when p_data ? 'payment_terms' then btrim(p_data->>'payment_terms') else payment_terms end,
    cooperation_note=case when p_data ? 'cooperation_note' then btrim(p_data->>'cooperation_note') else cooperation_note end,
    cooperation_status=case when p_data ? 'cooperation_status' then btrim(p_data->>'cooperation_status') else cooperation_status end,
    supplier_category=$patch$);
 anchor:='insert into public.suppliers(organization_id,supplier_code,name) values(v_org,coalesce(nullif(btrim(p_data->>''code''),''''),''S-''||gen_random_uuid()::text),btrim(p_data->>''name''))';
 if strpos(definition,anchor)=0 then raise exception 'supplier directory create anchor missing';end if;
 definition:=replace(definition,anchor,'insert into public.suppliers(organization_id,supplier_code,name,is_active) values(v_org,coalesce(nullif(btrim(p_data->>''code''),''''),''S-''||gen_random_uuid()::text),btrim(p_data->>''name''),coalesce((p_data->>''is_active'')::boolean,true))');
 execute definition;

 definition:=pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure);
 anchor:='v_role=''STAFF'' and p_section<>''settings''';
 if strpos(definition,anchor)=0 then raise exception 'supplier directory role anchor missing';end if;
 definition:=replace(definition,anchor,anchor||' and not (p_section=''suppliers'' and v_type<>''CHAIN_RESTAURANT'')');
 anchor:='''aliases'',private.supplier_display_aliases(s.id)) order by s.name';
 if strpos(definition,anchor)=0 then raise exception 'supplier directory read anchor missing';end if;
 definition:=replace(definition,anchor,$patch$'aliases',private.supplier_display_aliases(s.id),
    'cooperation_status',coalesce(d.cooperation_status,'COMMON'),
'primary_supplies',d.primary_supplies,'line_id',d.line_id,'line_group',d.line_group,'minimum_order',d.minimum_order,'supply_note',d.supply_note)
    ||case when v_role in ('OWNER','LOGISTICS') then jsonb_build_object('company_name',d.company_name,'tax_id',d.tax_id,'address',d.address,'bank_name',d.bank_name,'bank_account',d.bank_account,'account_name',d.account_name,'billing_cycle',d.billing_cycle,'payment_terms',d.payment_terms,'cooperation_note',d.cooperation_note) else '{}'::jsonb end order by s.name$patch$);
 execute definition;
end $migration$;
notify pgrst,'reload schema';
