-- Confirmation preserves the whole document even when inventory mapping is
-- incomplete. Original OCR fields, corrections, images and existing rows stay.
alter table public.goods_receipts alter column receipt_date drop not null;
alter table public.receipt_lines add column source_row_key text,
 add column inventory_status text not null default 'POSTED' check(inventory_status in ('POSTED','MAPPING_PENDING','UNIT_PENDING','QUANTITY_PENDING','REVIEW_PENDING')),
 add column inventory_quantity numeric,add column inventory_unit text;
create unique index receipt_lines_source_row on public.receipt_lines(receipt_id,source_row_key) where source_row_key is not null;

create function private.confirm_receipt_details(p_batch uuid,p_actor uuid,p_issue text) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches;run_id uuid;rid uuid;header jsonb;item record;v jsonb;original jsonb;
 supplier uuid;product public.products;receipt_day date;state text;qty numeric;unit_name text;n int:=0;trusted boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_batch::text,0));
 select id into rid from public.goods_receipts where source_batch_id=p_batch;if found then return rid;end if;
 select * into strict b from public.receipt_upload_batches where id=p_batch;
 select id into run_id from public.receipt_ocr_runs where batch_id=p_batch and status='SUCCEEDED' order by version desc limit 1;
 if run_id is null or not coalesce((private.receipt_review_progress(run_id)->>'complete')::boolean,false) then raise exception 'RECEIPT_REVIEW_REQUIRED';end if;
 select jsonb_object_agg(field_name,value) into header from private.receipt_effective_fields(run_id) where row_key='document';
 if nullif(header->>'receipt_date','') is not null then begin receipt_day:=(header->>'receipt_date')::date;exception when datetime_field_overflow or invalid_datetime_format then receipt_day:=null;end;end if;
 if nullif(btrim(header->>'supplier_name'),'') is not null then
  perform pg_advisory_xact_lock(hashtextextended(b.organization_id::text||lower(btrim(header->>'supplier_name')),0));
  select id into supplier from public.suppliers where organization_id=b.organization_id and lower(btrim(name))=lower(btrim(header->>'supplier_name')) and is_active order by created_at limit 1;
  if supplier is null then insert into public.suppliers(organization_id,name) values(b.organization_id,btrim(header->>'supplier_name')) returning id into supplier;end if;
 end if;
 -- The batch lock prevents retries from making a second receipt. An already
 -- existing invoice number is retained as an exception; it is never posted.
 insert into public.goods_receipts(organization_id,store_id,supplier_id,receipt_date,document_number,subtotal_ex_tax,tax,total_inc_tax,reviewed_by,reviewed_at,source_batch_id)
 values(b.organization_id,b.store_id,supplier,receipt_day,nullif(header->>'document_number',''),(header->>'subtotal_ex_tax')::numeric,(header->>'tax')::numeric,(header->>'total_inc_tax')::numeric,p_actor,now(),p_batch) returning id into rid;
 for item in select row_key,jsonb_object_agg(field_name,value) v from private.receipt_effective_fields(run_id) where row_key<>'document' group by row_key order by row_key loop
  n:=n+1;v:=item.v;qty:=(v->>'quantity')::numeric;unit_name:=nullif(btrim(v->>'unit'),'');
  select p.* into product from public.receipt_product_mappings m join public.products p on p.id=m.product_id where m.batch_id=p_batch and m.row_key=item.row_key and p.organization_id=b.organization_id and p.is_active;
  select not exists(select 1 from private.receipt_effective_fields(run_id) f where f.row_key in ('document',item.row_key) and f.field_name in ('product','quantity','unit') and not(f.corrected or f.review_status='TRUSTED')) into trusted;
  state:=case when receipt_day is null or p_issue in ('DUPLICATE_RECEIPT_NUMBER','RECEIPT_TOTAL_CONFLICT','LINE_TOTAL_CONFLICT') or not trusted then 'REVIEW_PENDING' when qty is null or qty<=0 then 'QUANTITY_PENDING' when unit_name is null then 'UNIT_PENDING' when product.id is null then 'MAPPING_PENDING' when unit_name<>product.base_unit then 'UNIT_PENDING' else 'POSTED' end;
  select jsonb_object_agg(field_name,jsonb_build_object('raw_value',raw_value,'normalized_value',normalized_value,'review_status',review_status)) into original from public.receipt_ocr_fields where ocr_run_id=run_id and row_key=item.row_key;
  insert into public.receipt_lines(organization_id,receipt_id,product_id,supplier_id,quantity,unit,unit_price_ex_tax,line_subtotal_ex_tax,tax,line_total_inc_tax,specification,ai_original,human_correction,modified_by,modified_at,source_row_key,inventory_status,inventory_quantity,inventory_unit)
  values(b.organization_id,rid,product.id,supplier,qty,unit_name,(v->>'unit_price_ex_tax')::numeric,(v->>'subtotal_ex_tax')::numeric,(v->>'tax')::numeric,(v->>'total_inc_tax')::numeric,coalesce(v->>'specification',''),
   jsonb_build_object('raw_product_name',v->>'product','ocr_fields',original,'run_id',run_id,'row_key',item.row_key),jsonb_build_object('effective_fields',v,'confirmation_issue',p_issue),p_actor,now(),item.row_key,state,case when state='POSTED' then qty end,case when state='POSTED' then unit_name end);
 end loop;
 update public.receipt_upload_batches set status='COMPLETED' where id=p_batch;
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id) values(b.organization_id,'goods_receipt',rid::text,'RECEIPT_CONFIRMED',jsonb_build_object('store_id',b.store_id,'batch_id',p_batch,'run_id',run_id,'lines',n,'inventory_issue',p_issue),p_actor);
 return rid;
end $$;
revoke all on function private.confirm_receipt_details(uuid,uuid,text) from public,anon,authenticated;

do $migration$
declare source text;next text;
begin
 select pg_get_functiondef('public.create_lot_from_receipt_line()'::regprocedure) into source;
 next:=replace(source,' select * into strict r from public.goods_receipts where id=new.receipt_id;',
 ' if new.inventory_status<>''POSTED'' or new.product_id is null or coalesce(new.inventory_quantity,new.quantity) is null or coalesce(new.inventory_quantity,new.quantity)<=0 or nullif(coalesce(new.inventory_unit,new.unit),'''') is null then return new;end if;'||chr(10)||
 ' if exists(select 1 from public.inventory_lots where source_type=''GOODS_RECEIPT'' and source_id=new.id) then return new;end if;'||chr(10)||
 ' select * into strict r from public.goods_receipts where id=new.receipt_id;');
 next:=replace(next,'new.quantity,new.unit,r.receipt_date','coalesce(new.inventory_quantity,new.quantity),coalesce(new.inventory_unit,new.unit),r.receipt_date');
 if next=source then raise exception 'Receipt lot source mismatch';end if;execute next;
 select pg_get_functiondef('public.save_pilot_receipt_review(uuid,text,uuid)'::regprocedure) into source;
 next:=replace(source,'  end;'||chr(10)||' end if;'||chr(10)||' return progress',
 '  end;'||chr(10)||'  if receipt is null and issue is distinct from ''DUPLICATE_RECEIPT_NUMBER'' then receipt:=private.confirm_receipt_details(p_batch_id,auth.uid(),issue);end if;'||chr(10)||' end if;'||chr(10)||' return progress');
 if next=source then raise exception 'Receipt save source mismatch';end if;execute next;
end $migration$;
create trigger receipt_line_inventory_resolution after update of inventory_status on public.receipt_lines
 for each row when(old.inventory_status<>'POSTED' and new.inventory_status='POSTED') execute function public.create_lot_from_receipt_line();
notify pgrst,'reload schema';
