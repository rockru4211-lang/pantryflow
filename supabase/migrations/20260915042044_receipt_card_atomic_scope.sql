-- Simplify the existing workflow without changing any operational ownership or history.
create or replace function private.receipt_edit_card(s uuid,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; f record; change jsonb; current_run uuid; mapped uuid; mode text:=coalesce(d->>'mapping_mode','KEEP'); new_product uuid; v_row_key text:=d->>'row_key';
begin
 select * into b from public.receipt_upload_batches where id=(d->>'batch_id')::uuid and store_id=s;
 if b.id is null or not private.can_review_receipt(b.id) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(b.id::text,0));
 if b.status='COMPLETED' or exists(select 1 from public.goods_receipts where source_batch_id=b.id) then raise exception 'PUBLISHED_RECEIPT_IMMUTABLE';end if;
 select id into current_run from public.receipt_ocr_runs where batch_id=b.id order by version desc limit 1;
 if current_run is null or current_run is distinct from (d->>'run_id')::uuid then raise exception 'OCR_VERSION_CHANGED';end if;
 if jsonb_typeof(d->'fields') is distinct from 'array' or jsonb_array_length(d->'fields')=0 or mode not in ('KEEP','SELECT','CREATE','NONE') then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 -- Validate the whole card before making any correction. The surrounding operation
 -- owns the request ID, actor/scope check and audit; any failure rolls back every field.
 if (select count(*) from private.receipt_effective_fields(current_run) where receipt_effective_fields.row_key=v_row_key) <> jsonb_array_length(d->'fields')
 or (select count(distinct x->>'id') from jsonb_array_elements(d->'fields') x)<>jsonb_array_length(d->'fields') then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 for change in select value from jsonb_array_elements(d->'fields') loop
  select * into f from private.receipt_effective_fields(current_run) ef where ef.id=(change->>'id')::uuid and ef.row_key=v_row_key;
  if not found or f.value is distinct from coalesce(change->'old','null'::jsonb) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 end loop;
 select product_id into mapped from public.receipt_product_mappings m where m.batch_id=b.id and m.row_key=v_row_key;
 if mapped is distinct from nullif(d->>'previous_product_id','')::uuid then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 for change in select value from jsonb_array_elements(d->'fields') loop
  if change->'old' is distinct from change->'value' then perform public.correct_pilot_receipt_field((change->>'id')::uuid,coalesce(change->'value','null'::jsonb));end if;
 end loop;
 if v_row_key<>'document' then
  if mode in ('SELECT','CREATE') then new_product:=public.map_pilot_receipt_product(b.id,v_row_key,nullif(d->>'product_id','')::uuid,mode='CREATE');
  elsif mode='NONE' then delete from public.receipt_product_mappings m where m.batch_id=b.id and m.row_key=v_row_key;
  end if;
 end if;
 return jsonb_build_object('id',b.id,'row_key',v_row_key,'saved',true);
end $$;
revoke all on function private.receipt_edit_card(uuid,jsonb) from public,anon,authenticated;
