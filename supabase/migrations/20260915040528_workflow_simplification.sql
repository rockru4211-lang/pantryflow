-- Simplify the existing workflow without changing any operational ownership or history.
create or replace function private.receipt_edit_card(s uuid,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; f record; change jsonb; current_run uuid; mapped uuid; mode text:=coalesce(d->>'mapping_mode','KEEP'); new_product uuid; row_key text:=d->>'row_key';
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
 if (select count(*) from private.receipt_effective_fields(current_run) where receipt_effective_fields.row_key=receipt_edit_card.row_key) <> jsonb_array_length(d->'fields')
 or (select count(distinct x->>'id') from jsonb_array_elements(d->'fields') x)<>jsonb_array_length(d->'fields') then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 for change in select value from jsonb_array_elements(d->'fields') loop
  select * into f from private.receipt_effective_fields(current_run) ef where ef.id=(change->>'id')::uuid and ef.row_key=receipt_edit_card.row_key;
  if not found or f.value is distinct from coalesce(change->'old','null'::jsonb) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 end loop;
 select product_id into mapped from public.receipt_product_mappings m where m.batch_id=b.id and m.row_key=receipt_edit_card.row_key;
 if mapped is distinct from nullif(d->>'previous_product_id','')::uuid then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 for change in select value from jsonb_array_elements(d->'fields') loop
  if change->'old' is distinct from change->'value' then perform public.correct_pilot_receipt_field((change->>'id')::uuid,coalesce(change->'value','null'::jsonb));end if;
 end loop;
 if row_key<>'document' then
  if mode in ('SELECT','CREATE') then new_product:=public.map_pilot_receipt_product(b.id,row_key,nullif(d->>'product_id','')::uuid,mode='CREATE');
  elsif mode='NONE' then delete from public.receipt_product_mappings m where m.batch_id=b.id and m.row_key=receipt_edit_card.row_key;
  end if;
 end if;
 return jsonb_build_object('id',b.id,'row_key',row_key,'saved',true);
end $$;
revoke all on function private.receipt_edit_card(uuid,jsonb) from public,anon,authenticated;
create or replace function private.valid_attention_reason(reason text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(reason in ('包裝效期','保存期限短','使用速度慢','容易被遺忘','高單價食材（主管自訂）') or (reason like '其他：%' and length(btrim(substr(reason,4))) between 1 and 160),false)
$$;
revoke all on function private.valid_attention_reason(text) from public,anon,authenticated;
do $$
declare src text; original text;
begin
 select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src;
 original:=src;src:=replace(src,'elsif p_action=''product.edit-basic'' then','elsif p_action=''receipt.edit-card'' then v_result:=private.receipt_edit_card(p_store,p_data);'||chr(10)||' elsif p_action=''product.edit-basic'' then');
 if src=original then raise exception 'APP_OPERATION_PATCH_MISSING';end if;execute src;
 select pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure) into src;
 original:=src;src:=replace(src,'jsonb_build_object(''name'',pr.name,''unit'',pr.base_unit','jsonb_build_object(''id'',pr.id,''name'',pr.name,''unit'',pr.base_unit');
 if src=original then raise exception 'TRANSFER_SEARCH_PATCH_MISSING';end if;execute src;
 select pg_get_functiondef('private.expiry_waste_command(uuid,uuid,text,jsonb)'::regprocedure) into src;
 original:=src;src:=replace(src,'coalesce(p_data->>''attention_reason'','''') not in (''保存期限短'',''使用速度慢'',''容易被遺忘'',''高單價食材（主管自訂）'')','not private.valid_attention_reason(p_data->>''attention_reason'')');
 if src=original then raise exception 'EXPIRY_COMMAND_PATCH_MISSING';end if;execute src;
 select pg_get_functiondef('private.context_expiry_save(uuid,uuid,text,uuid,uuid,jsonb)'::regprocedure) into src;
 original:=src;src:=replace(src,'reason is null or reason not in (''包裝效期'',''保存期限短'',''使用速度慢'',''容易被遺忘'',''高單價食材（主管自訂）'')','not private.valid_attention_reason(reason)');
 if src=original then raise exception 'CONTEXT_EXPIRY_PATCH_MISSING';end if;execute src;
 select pg_get_functiondef('private.expiry_waste_workspace(uuid,date,date)'::regprocedure) into src;
 original:=src;src:=replace(src,'e.attention_reason in (''使用速度慢'',''容易被遺忘'',''高單價食材（主管自訂）'')','(e.attention_reason in (''使用速度慢'',''容易被遺忘'',''高單價食材（主管自訂）'') or e.attention_reason like ''其他：%'')');
 if src=original then raise exception 'EXPIRY_WORKSPACE_PATCH_MISSING';end if;execute src;
end $$;

