-- Price-bearing raw tables are management-only; staff read the filtered receipt RPC.
drop policy goods_receipts_read on public.goods_receipts;
create policy goods_receipts_read on public.goods_receipts for select to authenticated using(private.can_read_receipt(source_batch_id) and private.has_active_store_role(store_id,array['ADMIN','SUPERVISOR','LOGISTICS','OWNER']::public.app_role[]));
drop policy receipt_lines_read on public.receipt_lines;
create policy receipt_lines_read on public.receipt_lines for select to authenticated using(exists(select 1 from public.goods_receipts r where r.id=receipt_id and private.can_read_receipt(r.source_batch_id)));

-- Automatic OCR publication keeps an actor on inventory events without falsely
-- recording that the uploader performed an administrative review.
create or replace function public.create_lot_from_receipt_line()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.goods_receipts; b public.receipt_upload_batches; lot uuid; expiry date; actor uuid;
begin
 select * into strict r from public.goods_receipts where id=new.receipt_id;
 select * into b from public.receipt_upload_batches where id=r.source_batch_id;
 actor:=coalesce(r.reviewed_by,b.uploaded_by);
 if nullif(new.batch_or_expiry,'') ~ '^\d{4}-\d{2}-\d{2}$' then expiry:=new.batch_or_expiry::date; end if;
 insert into public.inventory_lots(organization_id,store_name,product_id,lot_code,original_expiry_date,source_type,source_id,created_by)
 values(new.organization_id,coalesce(b.store_name,'未指定門市'),new.product_id,nullif(new.batch_or_expiry,''),expiry,'GOODS_RECEIPT',new.id,actor) returning id into lot;
 insert into public.inventory_lot_events(organization_id,lot_id,event_type,preservation_state,quantity,unit,occurred_on,source_type,source_id,recorded_by)
 values(new.organization_id,lot,'RECEIVED','ORIGINAL_EXPIRY',new.quantity,new.unit,r.receipt_date,'GOODS_RECEIPT',new.id,actor);
 return new;
end $$;
