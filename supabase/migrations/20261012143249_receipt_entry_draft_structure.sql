-- Add/remove draft lines and save their values as one transaction. OCR evidence is retained.
create function public.save_baihuayuan_receipt_entry(p_store_id uuid,p_batch_id uuid,p_data jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 b public.receipt_upload_batches; cached private.app_requests; payload jsonb; account jsonb;
 lines jsonb; removed jsonb; line jsonb; prior jsonb; mapped jsonb:='[]'; key text; run uuid; result jsonb;
begin
 if auth.uid() is null or not private.can_review_receipt(p_batch_id) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 perform private.assert_store_editable(p_store_id);
 select * into b from public.receipt_upload_batches where id=p_batch_id and store_id=p_store_id and store_name in ('BeApe','Gras');
 if not found then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';end if;
 if p_request_id is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>250000 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 lines:=p_data->'lines';removed:=p_data->'removed_row_keys';
 if jsonb_typeof(lines) is distinct from 'array' or jsonb_typeof(removed) is distinct from 'array' then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 if jsonb_array_length(lines)>500 or jsonb_array_length(removed)>500 then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 payload:=jsonb_build_object('batch_id',p_batch_id,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_request_id::text,0));
 select * into cached from private.app_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'receipt.entry-edit' or cached.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return cached.result;
 end if;
 -- Same ordering as manual takeover and OCR dispatcher; hold through final save.
 perform pg_advisory_xact_lock(hashtextextended('receipt-ocr-dispatch',0));
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 select * into b from public.receipt_upload_batches where id=p_batch_id;
 account:=private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0;
 if account is null or account->>'record_state' is distinct from 'LIVE' then raise exception 'RECEIPT_ACCOUNT_NOT_LIVE' using errcode='42501';end if;
 if p_data->>'source_fingerprint' is distinct from account->>'source_fingerprint' or p_data->>'revision' is distinct from account->>'revision' then raise exception 'REVISION_CONFLICT' using errcode='PT409';end if;
 if b.status='COMPLETED' or b.group_mode='ADMIN_DIRECT' or exists(select 1 from public.goods_receipts where source_batch_id=b.id) then raise exception 'PUBLISHED_RECEIPT_IMMUTABLE' using errcode='22023';end if;
 -- Explicit removal is required: missing, duplicate, overlapping and foreign identities fail closed.
 if exists(select 1 from jsonb_array_elements(lines) l where jsonb_typeof(l) is distinct from 'object' or nullif(l->>'row_key','') is null)
 or (select count(distinct l->>'row_key') from jsonb_array_elements(lines) l)<>jsonb_array_length(lines)
 or exists(select 1 from jsonb_array_elements(removed) k where jsonb_typeof(k)<>'string')
 or (select count(distinct k) from jsonb_array_elements_text(removed) k)<>jsonb_array_length(removed)
 or exists(select 1 from jsonb_array_elements(account->'lines') l where
  (case when exists(select 1 from jsonb_array_elements(lines) n where n->>'row_key'=l->>'row_key') then 1 else 0 end)+
  (case when removed ? (l->>'row_key') then 1 else 0 end)<>1)
 or exists(select 1 from jsonb_array_elements_text(removed) k where not exists(select 1 from jsonb_array_elements(account->'lines') l where l->>'row_key'=k))
 or exists(select 1 from jsonb_array_elements(lines) l where l->>'row_key' not like 'local-%' and not exists(select 1 from jsonb_array_elements(account->'lines') n where n->>'row_key'=l->>'row_key'))
 then raise exception 'RECEIPT_LINES_CHANGED' using errcode='PT409';end if;
 run:=nullif(account->>'run_id','')::uuid;
 for key in select value from jsonb_array_elements_text(removed) loop
  select l into prior from jsonb_array_elements(account->'lines') l where l->>'row_key'=key;
  if coalesce((prior->>'custody_posted')::boolean,false) or nullif(prior->>'custody_reminder_id','') is not null or nullif(prior->>'custody_event_id','') is not null then raise exception 'RECEIPT_CUSTODY_LOCKED' using errcode='22023';end if;
  if key like 'manual-%' then
   perform public.set_baihuayuan_manual_receipt_line_deleted(p_store_id,p_batch_id,substr(key,8)::uuid,true);
  else
   perform public.set_baihuayuan_receipt_line_decision(p_store_id,p_batch_id,run,key,'IGNORE');
  end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(lines) l where l->>'row_key' like 'local-%') then run:=public.begin_baihuayuan_receipt_manual_review(p_store_id,p_batch_id);end if;
 for line in select value from jsonb_array_elements(lines) loop
  if line->>'row_key' like 'local-%' then
   key:=public.add_baihuayuan_receipt_draft_row(p_store_id,p_batch_id,run,gen_random_uuid());
   line:=line||jsonb_build_object('row_key',key);
  end if;
  mapped:=mapped||jsonb_build_array(line);
 end loop;
 account:=private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0;
 result:=public.save_baihuayuan_receipt_review(p_store_id,p_batch_id,(p_data-'removed_row_keys')||jsonb_build_object('source_fingerprint',account->>'source_fingerprint','revision',account->'revision','lines',mapped),gen_random_uuid());
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,auth.uid(),'receipt.entry-edit',payload,result);
 return result;
end $$;
revoke all on function public.save_baihuayuan_receipt_entry(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.save_baihuayuan_receipt_entry(uuid,uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
