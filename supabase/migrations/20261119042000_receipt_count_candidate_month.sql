create or replace function private.receipt_count_candidates(p_store uuid, p_month date)
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
  where s.receipt_date >= p_month and s.receipt_date < p_month + interval '1 month'
    and not (coalesce(trim(p.category),'') in ('蔬果','蔬果類','水果','水果類','蔬菜','蔬菜類')
      or coalesce(trim(s.line->>'category'),'') in ('蔬果','蔬果類','水果','水果類','蔬菜','蔬菜類')
      or (coalesce(trim(p.category),'') in ('','其他','食材','未分類')
        and coalesce(trim(s.line->>'category'),'') in ('','其他','食材','未分類')
        and coalesce(trim(s.supplier),'') in ('雄泉','雄泉鮮食')))
    and not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=s.batch_id)
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
revoke all on function private.receipt_count_candidates(uuid,date) from public, anon, authenticated;

create or replace function private.receipt_count_month(selected text)
returns date language plpgsql stable set search_path='' as $$
begin
 if selected is null then
  return date_trunc('month',now() at time zone 'Asia/Taipei')::date;
 end if;
 if selected !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_COUNT_MONTH' using errcode='22023'; end if;
 return (selected||'-01')::date;
end $$;
revoke all on function private.receipt_count_month(text) from public, anon, authenticated;

create or replace function private.receipt_count_candidates(p_store uuid)
returns jsonb language sql stable set search_path='' as $$
 select private.receipt_count_candidates(p_store,private.receipt_count_month(null))
$$;

-- Reuse the existing authorization, locks, revision checks and retry handling.
do $$
declare command regprocedure; definition text;
begin
 foreach command in array array[
  'private.receipt_count_candidate_command(uuid,text,jsonb,uuid)'::regprocedure,
  'private.receipt_count_match_command(uuid,text,jsonb,uuid)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(command);
  if strpos(definition,'private.receipt_count_candidates(p_store)')=0 then raise exception 'MISSING_CANDIDATE_LOOKUP'; end if;
  execute replace(definition,'private.receipt_count_candidates(p_store)',
    'private.receipt_count_candidates(p_store,private.receipt_count_month(p_data->>''month''))');
 end loop;
end $$;
