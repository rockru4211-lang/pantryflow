-- Handoff is independent of receiving, pricing approval and payment.
alter table private.receipt_account_edits add column finance_sent_at timestamptz;
alter table private.receipt_account_edits add column finance_sent_by uuid references auth.users(id);
update private.receipt_account_edits e set finance_sent_at=coalesce(e.reviewed_at,c.checked_at),finance_sent_by=coalesce(e.reviewed_by,c.checked_by)
from private.receipt_reconciliations c where c.batch_id=e.batch_id and coalesce(e.reviewed_at,c.checked_at) is not null;
do $patch$
declare src text; anchor text := '''entry_completed'',exists';
begin
 src:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
 if strpos(src,anchor)=0 then raise exception 'FINANCE_HANDOFF_READ_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$code$'finance_sent_at',(select sent.finance_sent_at from private.receipt_account_edits sent where sent.batch_id=a.id),
  'entry_completed',exists$code$);
 execute src;
end $patch$;
create function public.submit_baihuayuan_receipt_finance(p_store_id uuid,p_batch_id uuid,p_revision integer,p_source text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; r jsonb; result jsonb; payload jsonb; cached private.app_requests;
begin
 perform private.assert_store_editable(p_store_id);
 select * into b from public.receipt_upload_batches where id=p_batch_id and store_id=p_store_id;
 if auth.uid() is null or b.id is null or not private.can_review_receipt(p_batch_id) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 if p_request_id is null or p_revision is null or p_source is null then raise exception 'INVALID_APP_INPUT' using errcode='22023';end if;
 payload:=jsonb_build_object('batch_id',p_batch_id,'revision',p_revision,'source',p_source);
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_request_id::text,0));
 select * into cached from private.app_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'receipt.finance-handoff' or cached.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return cached.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 perform 1 from public.receipt_upload_batches where id=p_batch_id for update;
 r:=private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0;
 if r is null or r->>'record_state'<>'LIVE' then raise exception 'RECEIPT_ACCOUNT_NOT_LIVE' using errcode='42501';end if;
 -- Already handed off is an idempotent no-op, including after later corrections.
 if r->>'finance_sent_at' is null and not coalesce((r->>'reviewed')::boolean,false) and r->>'status'<>'CHECKED' then
  if (r->>'revision')::integer is distinct from p_revision or r->>'source_fingerprint' is distinct from p_source then raise exception 'REVISION_CONFLICT' using errcode='PT409';end if;
  if coalesce((r->>'edit_revision')::integer,0)=0 or nullif(btrim(r->>'supplier_name'),'') is null or r->>'receipt_date' is null or jsonb_array_length(r->'lines')=0
   or exists(select 1 from jsonb_array_elements(r->'lines') l where nullif(btrim(l->>'product_name'),'') is null or nullif(btrim(l->>'unit'),'') is null or coalesce((l->>'quantity')::numeric,0)<=0 or (coalesce(l->>'handling','NORMAL')<>'CUSTODY_RELEASE' and (l->>'unit_price' is null or (l->>'unit_price')::numeric<0 or l->>'subtotal' is null)))
  then raise exception 'RECEIPT_FINANCE_DATA_REQUIRED' using errcode='22023';end if;
  update private.receipt_account_edits set finance_sent_at=now(),finance_sent_by=auth.uid() where batch_id=p_batch_id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id,attempt_id,store_id)
   values(b.organization_id,'receipt_review',p_batch_id::text,'receipt.finance-handoff',jsonb_build_object('revision',p_revision,'source',p_source),auth.uid(),p_request_id,p_store_id);
 end if;
 result:=jsonb_build_object('saved',true,'account',private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,auth.uid(),'receipt.finance-handoff',payload,result);
 return result;
end $$;
revoke all on function public.submit_baihuayuan_receipt_finance(uuid,uuid,integer,text,uuid) from public,anon;
grant execute on function public.submit_baihuayuan_receipt_finance(uuid,uuid,integer,text,uuid) to authenticated;
notify pgrst,'reload schema';
