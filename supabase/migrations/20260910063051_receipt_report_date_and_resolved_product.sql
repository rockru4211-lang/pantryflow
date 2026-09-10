-- Report months follow the receipt's actual date, as the home summary does.
-- A later mapping resolves identity without changing immutable receipt evidence.
create or replace function private.app_reports(p_store uuid,p_filter jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare role_name text:=private.app_role(p_store);
 start_at timestamptz:=coalesce(nullif(p_filter->>'from','')::timestamptz,date_trunc('month',now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei');
 end_at timestamptz:=coalesce(nullif(p_filter->>'to','')::timestamptz,now()+interval '1 day');
begin
 if role_name is null or role_name='STAFF' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object(
  'counts',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'started_at',s.started_at,'completed_at',s.completed_at,'status',s.status,'paper_completed_at',s.paper_completed_at) order by s.started_at desc),'[]'::jsonb)
   from public.inventory_count_sessions s where s.store_id=p_store and s.status::text='CLOSED' and s.completed_at>=start_at and s.completed_at<end_at),
  'receipts',(select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('supplier_name',sp.name) order by g.receipt_date desc,g.id),'[]'::jsonb)
   from public.goods_receipts g join public.receipt_upload_batches b on b.id=g.source_batch_id left join public.suppliers sp on sp.id=g.supplier_id
   where g.store_id=p_store and b.status::text='COMPLETED' and g.receipt_date>=(start_at at time zone 'Asia/Taipei')::date and g.receipt_date<(end_at at time zone 'Asia/Taipei')::date),
  'lines',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'receipt_id',g.id,'product_id',coalesce(rs.product_id,l.product_id),
   'name',coalesce(p.name,l.human_correction#>>'{effective_fields,product}',l.ai_original->>'raw_product_name','未對應'),
   'quantity',l.quantity,'unit',l.unit,'unit_price',l.unit_price_ex_tax,'amount',l.line_total_inc_tax,
   'inventory_status',coalesce(rs.inventory_status,l.inventory_status),'source_batch_id',g.source_batch_id,'receipt_date',g.receipt_date,'supplier_name',sp.name)
   order by g.receipt_date desc,g.id,l.id),'[]'::jsonb)
   from public.receipt_lines l join public.goods_receipts g on g.id=l.receipt_id join public.receipt_upload_batches b on b.id=g.source_batch_id
   left join lateral(select r.product_id,r.inventory_status from private.receipt_line_resolutions r where r.receipt_line_id=l.id order by r.created_at desc limit 1) rs on true
   left join public.products p on p.id=coalesce(rs.product_id,l.product_id) left join public.suppliers sp on sp.id=g.supplier_id
   where g.store_id=p_store and b.status::text='COMPLETED' and g.receipt_date>=(start_at at time zone 'Asia/Taipei')::date and g.receipt_date<(end_at at time zone 'Asia/Taipei')::date));
end $$;
revoke all on function private.app_reports(uuid,jsonb) from public,anon,authenticated;
do $migration$
declare source text;updated text;needle text:='if p_section=''mappings'' then return private.app_mapping_workspace(p_store);end if;';
begin
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into source;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Report dispatch source mismatch';end if;
 updated:=replace(source,needle,needle||E'\n if p_section in (''reports'',''costs'') then return private.app_reports(p_store,p_filter);end if;');
 execute updated;
end $migration$;
notify pgrst,'reload schema';
