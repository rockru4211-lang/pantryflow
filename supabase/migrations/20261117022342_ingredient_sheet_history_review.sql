-- Store-scoped price-sheet organization and source attribution leave price snapshots intact.
create table private.ingredient_sheet_classifications (
 store_id uuid not null references public.stores(id),
 ingredient_id uuid not null references private.ingredient_masters(id) on delete cascade,
 archived boolean not null,
 reason text not null,
 revision integer not null default 1,
 primary key(store_id,ingredient_id)
);

create table private.ingredient_sheet_source_suppliers (
 store_id uuid not null references public.stores(id),
 ingredient_id uuid not null references private.ingredient_masters(id) on delete cascade,
 source_id uuid not null,
 supplier_id uuid not null references public.suppliers(id) on delete cascade,
 primary key(store_id,ingredient_id,source_id)
);

alter table private.ingredient_sheet_classifications enable row level security;
alter table private.ingredient_sheet_source_suppliers enable row level security;
revoke all on private.ingredient_sheet_classifications,private.ingredient_sheet_source_suppliers from public,anon,authenticated;

do $migration$
declare
 definition text := pg_get_functiondef('public.baihuayuan_ingredient_prices(uuid,text,jsonb,uuid)'::regprocedure);
 read_anchor text := 'if p_action=''read'' then return private.ingredient_supply_read(p_store_id);end if;';
 write_anchor text := 'if p_action=''category'' then';
begin
 if strpos(definition,read_anchor)=0 or strpos(definition,write_anchor)=0 then
  raise exception 'Unexpected ingredient prices function';
 end if;
 definition:=replace(definition,read_anchor,$read$
 if p_action='read' then
  return private.ingredient_supply_read(p_store_id)||jsonb_build_object(
   'sheet_classifications',(select coalesce(jsonb_object_agg(c.ingredient_id,jsonb_build_object(
      'archived',c.archived,'reason',c.reason,'revision',c.revision)),'{}')
    from private.ingredient_sheet_classifications c where c.store_id=p_store_id),
   'sheet_source_suppliers',(select coalesce(jsonb_object_agg(a.ingredient_id::text||':'||a.source_id,a.supplier_id),'{}')
    from private.ingredient_sheet_source_suppliers a where a.store_id=p_store_id)
  );
 end if;
 $read$);
 definition:=replace(definition,write_anchor,$write$
 if p_action='sheet_classify' then
  if jsonb_typeof(p_data->'rows') is distinct from 'array'
     or jsonb_typeof(p_data->'archived') is distinct from 'boolean' then
   raise exception 'INVALID_SHEET_CLASSIFICATION' using errcode='22023';
  end if;
  stopped:=(p_data->>'archived')::boolean;
  reason:=coalesce(p_data->>'reason','');
  if jsonb_array_length(p_data->'rows') not between 1 and 5000
     or (stopped and reason not in ('已停用','已換品','季節暫停','其他'))
     or (not stopped and reason<>'') then
   raise exception 'INVALID_SHEET_CLASSIFICATION' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_data->'rows') item(id uuid) group by id having count(*)>1) then
   raise exception 'INVALID_SHEET_CLASSIFICATION' using errcode='22023';
  end if;
  if exists(
   select 1 from jsonb_to_recordset(p_data->'rows') item(id uuid,revision integer,sheet_revision integer)
   left join private.ingredient_masters master on master.id=item.id and master.store_id=p_store_id
   left join private.ingredient_sheet_classifications existing on existing.store_id=p_store_id and existing.ingredient_id=item.id
   where master.id is null or master.revision is distinct from item.revision
      or coalesce(existing.revision,0) is distinct from item.sheet_revision
  ) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;

  insert into private.ingredient_sheet_classifications as current(store_id,ingredient_id,archived,reason)
  select p_store_id,item.id,stopped,reason from jsonb_to_recordset(p_data->'rows') item(id uuid)
  on conflict(store_id,ingredient_id) do update
    set archived=excluded.archived,reason=excluded.reason,revision=current.revision+1;
  result:=jsonb_build_object('id',p_data->'rows'->0->>'id','count',jsonb_array_length(p_data->'rows'));
 elsif p_action='sheet_assign_source' then
  sp:=nullif(p_data->>'supplier_id','')::uuid;
  if m.id is null or sp is null or not exists(
   select 1 from public.suppliers supplier join public.stores store on store.organization_id=supplier.organization_id
   where store.id=p_store_id and supplier.id=sp and supplier.is_active
  ) then raise exception 'INVALID_SUPPLIER_TARGET' using errcode='22023';end if;
  if not exists(
   select 1 from private.ingredient_aliases a
   join private.recipe_price_entries entry on entry.id=(p_data->>'source_id')::uuid and entry.id=any(a.reference_ids)
   join public.stores source_store on source_store.id=entry.store_id
   join public.stores target_store on target_store.id=p_store_id and target_store.organization_id=source_store.organization_id
   where a.store_id=p_store_id and a.ingredient_id=m.id
   union all
   select 1 from private.live_ingredient_receipt_prices receipt
   join private.ingredient_aliases a on a.store_id=receipt.store_id and a.source_key='p:'||receipt.product_id
      and a.source_unit=private.recipe_unit(receipt.unit) and a.specification=receipt.specification
   where receipt.store_id=p_store_id and receipt.id=(p_data->>'source_id')::uuid and a.ingredient_id=m.id
  ) then raise exception 'INVALID_PRICE_REFERENCE' using errcode='22023';end if;

  insert into private.ingredient_sheet_source_suppliers values(p_store_id,m.id,(p_data->>'source_id')::uuid,sp)
  on conflict do nothing;
  if not found then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  result:=jsonb_build_object('id',m.id,'supplier_id',sp);
 elsif p_action='category' then
 $write$);
 execute definition;
end $migration$;
