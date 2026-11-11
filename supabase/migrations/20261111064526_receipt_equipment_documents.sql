-- Store entry metadata alongside the already authorized, versioned receipt edit.
alter table private.receipt_account_edits
 add column entry_metadata jsonb not null default '{}'::jsonb
 check (jsonb_typeof(entry_metadata) = 'object');

do $patch$
declare
 definition text;
 anchor text;
begin
 definition:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
 anchor:='e.source_fingerprint edited_source,e.run_id edited_run,';
 if strpos(definition,anchor)=0 then raise exception 'RECEIPT_METADATA_READ_ANCHOR';end if;
 definition:=replace(definition,anchor,anchor||$sql$
   coalesce(e.entry_metadata,'{}'::jsonb) entry_metadata,$sql$);
 anchor:='(jsonb_array_length(lines)=0 or (receipt_id is null and coalesce(run_status,'''')<>''SUCCEEDED'')) pending';
 if strpos(definition,anchor)=0 then raise exception 'RECEIPT_METADATA_PENDING_ANCHOR';end if;
 definition:=replace(definition,anchor,$sql$
   (not (entry_metadata ? 'equipment') and (jsonb_array_length(lines)=0 or (receipt_id is null and coalesce(run_status,'')<>'SUCCEEDED'))) pending$sql$);
 anchor:='''supplier_name'',header->>''supplier_name'',''receipt_date'',';
 if strpos(definition,anchor)=0 then raise exception 'RECEIPT_METADATA_RESULT_ANCHOR';end if;
 execute replace(definition,anchor,$sql$'store_name',a.store_name,'receipt_entry_metadata',a.entry_metadata,
   'supplier_name',header->>'supplier_name','receipt_date',$sql$);

 definition:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='result jsonb; payload jsonb; checked boolean;';
 if strpos(definition,anchor)=0 then raise exception 'RECEIPT_METADATA_DECLARATION_ANCHOR';end if;
 definition:=replace(definition,anchor,anchor||$sql$
 metadata jsonb; equipment jsonb; discount jsonb; was_equipment boolean;
 $sql$);
 anchor:='header:=jsonb_build_object(''supplier_name'',btrim';
 if strpos(definition,anchor)=0 then raise exception 'RECEIPT_METADATA_VALIDATE_ANCHOR';end if;
 definition:=replace(definition,anchor,$sql$
 metadata:=coalesce(p_data->'receipt_entry_metadata',current_row->'receipt_entry_metadata','{}'::jsonb);
 if jsonb_typeof(metadata) is distinct from 'object' or octet_length(metadata::text)>4000
   or metadata-'equipment'-'discount'<>'{}'::jsonb
   or (metadata ? 'equipment' and metadata ? 'discount') then
  raise exception 'INVALID_APP_INPUT' using errcode='22023';
 end if;
 equipment:=metadata->'equipment';
 discount:=metadata->'discount';
 was_equipment:=current_row->'receipt_entry_metadata' ? 'equipment';
 if (equipment is not null) is distinct from was_equipment and (
  b.status='COMPLETED' or current_row->>'received_at' is not null or current_row->>'finance_sent_at' is not null
  or current_row->>'checked_at' is not null or exists(select 1 from public.goods_receipts where source_batch_id=p_batch_id)
 ) then raise exception 'RECEIPT_EQUIPMENT_LOCKED' using errcode='22023';end if;
 if equipment is not null and (
  jsonb_typeof(equipment) is distinct from 'object' or equipment-'kind'-'name'-'date'-'model'-'warranty_until'<>'{}'::jsonb
  or coalesce(equipment->>'kind','') not in ('MAINTENANCE','EQUIPMENT_PURCHASE')
  or jsonb_typeof(equipment->'name') is distinct from 'string' or length(equipment->>'name')>160
  or length(coalesce(equipment->>'model',''))>160 or jsonb_array_length(lines)<>0 or checked
  or (nullif(equipment->>'date','') is not null and private.receipt_account_date(equipment->>'date') is null)
  or (nullif(equipment->>'warranty_until','') is not null and private.receipt_account_date(equipment->>'warranty_until') is null)
 ) then raise exception 'RECEIPT_EQUIPMENT_DATA_REQUIRED' using errcode='22023';end if;
 if discount is not null and (
  jsonb_typeof(discount) is distinct from 'object' or discount-'kind'-'value'-'amount'<>'{}'::jsonb
  or coalesce(discount->>'kind','') not in ('AMOUNT','PERCENT')
  or jsonb_typeof(discount->'value') is distinct from 'number' or jsonb_typeof(discount->'amount') is distinct from 'number'
  or coalesce(private.receipt_account_number(discount->>'value'),-1)<0
  or coalesce(private.receipt_account_number(discount->>'amount'),-1)<0
  or (discount->>'kind'='PERCENT' and private.receipt_account_number(discount->>'value')>100)
  or (discount->>'kind'='AMOUNT' and discount->>'value'<>discount->>'amount')
 ) then raise exception 'INVALID_RECEIPT_DISCOUNT' using errcode='22023';end if;
 $sql$||anchor);

 anchor:='if incomplete then net:=null;else net:=net+adjustment;end if;';
 if strpos(definition,anchor)=0 then raise exception 'RECEIPT_EQUIPMENT_NET_ANCHOR';end if;
 definition:=replace(definition,anchor,$sql$
 if equipment is not null then
  net:=total-coalesce(tax,0);
  if coalesce((p_data->>'review_completed')::boolean,false) and (
    nullif(btrim(equipment->>'name'),'') is null or total is null or total<0
  ) then raise exception 'RECEIPT_EQUIPMENT_DATA_REQUIRED' using errcode='22023';end if;
 elsif incomplete then net:=null;else net:=net+adjustment;end if;
 $sql$);
 anchor:='if coalesce((p_data->>''review_completed'')::boolean,false) and exists(';
 if strpos(definition,anchor)=0 then raise exception 'RECEIPT_EQUIPMENT_EVIDENCE_ANCHOR';end if;
 definition:=replace(definition,anchor,'if equipment is null and coalesce((p_data->>''review_completed'')::boolean,false) and exists(');
 anchor:='incomplete or jsonb_array_length(lines)=0 or nullif(header->>''supplier_name'','''')';
 if strpos(definition,anchor)=0 then raise exception 'RECEIPT_EQUIPMENT_COMPLETION_ANCHOR';end if;
 definition:=replace(definition,anchor,'incomplete or (equipment is null and jsonb_array_length(lines)=0) or nullif(header->>''supplier_name'','''')');

 anchor:='where batch_id=p_batch_id;'||chr(10)||' result:=jsonb_build_object(''saved'',true';
 if strpos(definition,anchor)=0 then raise exception 'RECEIPT_METADATA_WRITE_ANCHOR';end if;
 definition:=replace(definition,anchor,$sql$where batch_id=p_batch_id;
 update private.receipt_account_edits set entry_metadata=metadata where batch_id=p_batch_id and entry_metadata is distinct from metadata;
 result:=jsonb_build_object('saved',true$sql$);
 anchor:='case when (coalesce((p_data->>''review_completed'')::boolean,false)';
 if strpos(definition,anchor)=0 then raise exception 'RECEIPT_EQUIPMENT_FINANCE_ANCHOR';end if;
 definition:=replace(definition,anchor,'case when equipment is null and (coalesce((p_data->>''review_completed'')::boolean,false)');
 anchor:='if coalesce((p_data->>''review_completed'')::boolean,false)'||chr(10)||'    and coalesce((result#>>''{account,review_completed}'')';
 if strpos(definition,anchor)=0 then raise exception 'RECEIPT_EQUIPMENT_PRICE_ANCHOR';end if;
 execute replace(definition,anchor,'if equipment is null and coalesce((p_data->>''review_completed'')::boolean,false)'||chr(10)||'    and coalesce((result#>>''{account,review_completed}'')');
end $patch$;
notify pgrst,'reload schema';
