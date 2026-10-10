-- Store-scoped supplier naming memory; no receipt evidence or saved costs are rewritten.
create table private.receipt_ingredient_bindings (
 store_id uuid not null references public.stores(id),
 supplier text not null, name text not null, unit text not null, specification text not null,
 ingredient_id uuid not null, revision integer not null default 1,
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 primary key(store_id,supplier,name,unit,specification),
 foreign key(ingredient_id,store_id) references private.ingredient_masters(id,store_id),
 check(length(supplier)<=160 and length(name)<=160 and length(unit)<=30 and length(specification)<=500)
);
alter table private.receipt_ingredient_bindings enable row level security;
revoke all on private.receipt_ingredient_bindings from public,anon,authenticated;
create index receipt_ingredient_binding_target on private.receipt_ingredient_bindings(ingredient_id,store_id);
create function private.ingredient_match_text(v text) returns text language sql immutable set search_path='' as $$
 select lower(regexp_replace(btrim(normalize(coalesce(v,''),NFKC)),'\s+',' ','g'));
$$;
revoke all on function private.ingredient_match_text(text) from public,anon,authenticated;

create function public.get_baihuayuan_ingredient_matching(p_store_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not private.has_active_store_role(p_store_id,array['LOGISTICS','OWNER']::public.app_role[]) or not exists(select 1 from public.stores where id=p_store_id and is_active and name in ('BeApe','Gras')) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 with aliases as materialized (select ingredient_id,jsonb_agg(distinct name) names from private.ingredient_aliases where store_id=p_store_id group by ingredient_id),
 active as materialized (select m.*,a.names from private.ingredient_masters m left join aliases a on a.ingredient_id=m.id where m.store_id=p_store_id and (m.manual or a.ingredient_id is not null) and not exists(select 1 from private.ingredient_supply_state st where st.store_id=p_store_id and st.ingredient_id=m.id and st.supplier_key='*' and st.stopped))
 select jsonb_build_object('ingredients',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.unit,'category',coalesce(m.category,private.classify_product(m.name)),'purchase',m.purchase,'aliases',coalesce(m.names,'[]')) order by m.name,m.id) from active m),'[]'),
 'bindings',coalesce((select jsonb_agg(jsonb_build_object('supplier',b.supplier,'name',b.name,'unit',b.unit,'specification',b.specification,'ingredient_id',b.ingredient_id,'revision',b.revision)) from private.receipt_ingredient_bindings b join active m on m.id=b.ingredient_id where b.store_id=p_store_id),'[]')) into result;
 return result;
end $$;
revoke all on function public.get_baihuayuan_ingredient_matching(uuid) from public,anon;
grant execute on function public.get_baihuayuan_ingredient_matching(uuid) to authenticated;

-- Called only within the existing authorized, revision-checked receipt save transaction.
create function private.save_receipt_ingredient_match(s uuid,batch uuid,supplier_name text,l jsonb,previous_line jsonb,previous_supplier text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target private.ingredient_masters; prior private.receipt_ingredient_bindings; source_name text; source_unit text; source_spec text; supplier_key text; created jsonb; new_id uuid; rev integer;
begin
 if auth.uid() is null or not private.can_review_receipt(batch) or not exists(select 1 from public.receipt_upload_batches where id=batch and store_id=s) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 perform private.assert_store_editable(s);
 if not (l ? 'ingredient_id' or l ? 'create_ingredient') then
  -- Legacy clients preserve an unchanged binding, but never carry it to a different name or supplier.
  if (l->>'product_name',l->>'unit',l->>'specification',supplier_name) is not distinct from (previous_line->>'product_name',previous_line->>'unit',previous_line->>'specification',previous_supplier) then
   return l||coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(previous_line,'{}')) where key in ('ingredient_id','supplier_item_name','supplier_item_unit','supplier_item_specification','ingredient_match_revision')),'{}');
  end if;
  return l;
 end if;
 if coalesce(l->>'handling','NORMAL')<>'NORMAL' then return l-'ingredient_id'-'create_ingredient'-'supplier_item_name'-'supplier_item_unit'-'supplier_item_specification'-'ingredient_match_revision';end if;
 if nullif(l->>'ingredient_id','') is null and not coalesce((l->>'create_ingredient')::boolean,false) then return l-'create_ingredient';end if;
 supplier_key:=private.ingredient_match_text(supplier_name);
 source_name:=private.ingredient_match_text(coalesce(nullif(l->>'supplier_item_name',''),l->>'product_name'));
 source_unit:=private.ingredient_match_text(coalesce(l->>'supplier_item_unit',l->>'unit'));
 source_spec:=private.ingredient_match_text(coalesce(l->>'supplier_item_specification',l->>'specification'));
 if source_name='' or length(source_name)>160 or length(supplier_key)>160 or length(source_unit)>30 or length(source_spec)>500 then raise exception 'INGREDIENT_MATCH_INVALID' using errcode='22023';end if;
 -- Serialize naming-memory edits for this store, preserving optimistic conflict checks.
 perform pg_advisory_xact_lock(hashtextextended('ingredient-match:'||s::text,0));
 select * into prior from private.receipt_ingredient_bindings where store_id=s and supplier=supplier_key and name=source_name and unit=source_unit and specification=source_spec;
 if coalesce((l->>'create_ingredient')::boolean,false) then
  if exists(select 1 from private.ingredient_masters m where m.store_id=s and private.ingredient_match_text(regexp_replace(normalize(m.name,NFKC),'\s*·\s*原表計價基準:.*$',''))=private.ingredient_match_text(l->>'product_name')) then raise exception 'INGREDIENT_ALREADY_EXISTS' using errcode='22023';end if;
  created:=private.ingredient_operation(s,'ingredient.save',jsonb_build_object('name',l->>'product_name','unit',coalesce(nullif(l->>'unit',''),'待確認'),'cost_price',null,'category',case when l->>'category' in ('食材','耗材','調料','酒水') then l->>'category' else '待分類' end),gen_random_uuid());
  new_id:=(created->>'id')::uuid;
 else new_id:=nullif(l->>'ingredient_id','')::uuid;end if;
 select * into target from private.ingredient_masters where store_id=s and id=new_id;
 if target.id is null or exists(select 1 from private.ingredient_supply_state st where st.store_id=s and st.ingredient_id=new_id and st.supplier_key='*' and st.stopped) then raise exception 'INGREDIENT_MATCH_INVALID' using errcode='22023';end if;
 if prior.ingredient_id is not null and prior.ingredient_id<>new_id and prior.revision<>coalesce((l->>'ingredient_match_revision')::integer,0) then raise exception 'INGREDIENT_MATCH_CONFLICT' using errcode='40001';end if;
 rev:=coalesce(prior.revision,0);
 if supplier_key<>'' and prior.ingredient_id is distinct from new_id then
  insert into private.receipt_ingredient_bindings(store_id,supplier,name,unit,specification,ingredient_id,updated_by)
  values(s,supplier_key,source_name,source_unit,source_spec,new_id,auth.uid())
  on conflict(store_id,supplier,name,unit,specification) do update set ingredient_id=excluded.ingredient_id,revision=private.receipt_ingredient_bindings.revision+1,updated_at=now(),updated_by=auth.uid()
  returning revision into rev;
 end if;
 return (l-'create_ingredient')||jsonb_build_object('ingredient_id',new_id,'supplier_item_name',coalesce(nullif(l->>'supplier_item_name',''),l->>'product_name'),'supplier_item_unit',coalesce(l->>'supplier_item_unit',l->>'unit',''),'supplier_item_specification',coalesce(l->>'supplier_item_specification',l->>'specification',''),'ingredient_match_revision',rev);
end $$;
revoke all on function private.save_receipt_ingredient_match(uuid,uuid,text,jsonb,jsonb,text) from public,anon,authenticated;

do $patch$
declare src text; changed text; anchor text;
begin
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='q:=private.receipt_account_number(l->>''quantity'');price:=private.receipt_account_number(l->>''unit_price'');subtotal:=private.receipt_account_number(l->>''subtotal'');';
 if strpos(src,anchor)=0 then raise exception 'receipt numeric anchor missing';end if;
 changed:=replace(src,anchor,'l:=private.save_receipt_ingredient_match(p_store_id,p_batch_id,header->>''supplier_name'',l,(select x from jsonb_array_elements(current_row->''lines'') x where x->>''row_key''=l->>''row_key''),current_row->>''supplier_name'');'||chr(10)||anchor);
 anchor:='where key in (''product_name'',''specification'',''unit'',''quantity'',''unit_price'',''subtotal'',''category'',''note''';
 if strpos(changed,anchor)=0 then raise exception 'receipt fields anchor missing';end if;
 changed:=replace(changed,anchor,'where key in (''ingredient_id'',''supplier_item_name'',''supplier_item_unit'',''supplier_item_specification'',''ingredient_match_revision'',''product_name'',''specification'',''unit'',''quantity'',''unit_price'',''subtotal'',''category'',''note''');
 execute changed;
end $patch$;
notify pgrst,'reload schema';
