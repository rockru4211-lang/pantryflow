-- Entry completion is independent of financial approval. Unknown values stay null.
alter table private.receipt_account_edits add column entry_completed_source text;
do $patch$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
 anchor:='''reviewed'',exists';
 if strpos(src,anchor)=0 then raise exception 'ENTRY_READ_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$code$'entry_completed',exists(select 1 from private.receipt_account_edits entered where entered.batch_id=a.id and entered.entry_completed_source=md5(jsonb_build_array(fingerprint,net,tax,total,coalesce(note,''))::text)),
  'reviewed',exists$code$);execute src;
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='reviewed_source=case when checked';
 if strpos(src,anchor)=0 then raise exception 'ENTRY_SAVE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$code$entry_completed_source=case when coalesce((p_data->>'entry_completed')::boolean,false) then md5(jsonb_build_array(fresh->>'source_fingerprint',fresh->'net',fresh->'tax',fresh->'total',coalesce(fresh->>'note',''))::text) else entry_completed_source end,
  reviewed_source=case when checked$code$);execute src;
end $patch$;

-- Save the current draft and add all selected items atomically. A lost response
-- can be retried with the same request without duplicating rows or writes.
create function public.add_baihuayuan_receipt_items(p_store_id uuid,p_batch_id uuid,p_data jsonb,p_items jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cached private.app_requests; payload jsonb; saved jsonb; account jsonb; run uuid; item jsonb; rowkey text; added jsonb:='{}'; lines jsonb; result jsonb;
begin
 perform private.assert_store_editable(p_store_id);
 if not private.can_review_receipt(p_batch_id) or not exists(select 1 from public.receipt_upload_batches where id=p_batch_id and store_id=p_store_id) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 if p_request_id is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 or octet_length(p_items::text)>100000 then raise exception 'INVALID_APP_INPUT';end if;
 payload:=jsonb_build_object('batch_id',p_batch_id,'data',p_data,'items',p_items);
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_request_id::text,0));
 select * into cached from private.app_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'receipt.quick-add' or cached.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return cached.result;
 end if;
 -- Preserve dispatcher -> batch lock order used by manual takeover.
 run:=public.begin_baihuayuan_receipt_manual_review(p_store_id,p_batch_id);
 saved:=public.save_baihuayuan_receipt_review(p_store_id,p_batch_id,p_data||'{"checked":false,"reviewed":false,"entry_completed":false}'::jsonb,gen_random_uuid());
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' or nullif(btrim(item->>'name'),'') is null then raise exception 'INVALID_RECEIPT_LINE';end if;
  select x->>'row_key' into rowkey from jsonb_array_elements(saved->'account'->'lines') x where not (added ? (x->>'row_key')) and coalesce(x->>'product_name','') in ('','未命名品項') and x->>'quantity' is null and x->>'unit_price' is null and coalesce(x->>'unit','')='' and coalesce(x->>'note','')='' and coalesce(x->>'specification','')='' and coalesce(x->>'handling','NORMAL')='NORMAL' limit 1;
  if rowkey is null then rowkey:=public.add_baihuayuan_receipt_draft_row(p_store_id,p_batch_id,run,gen_random_uuid());end if;
  added:=added||jsonb_build_object(rowkey,jsonb_build_object('product_name',btrim(item->>'name'),'specification',coalesce(item->>'specification',''),'unit',coalesce(item->>'unit',''),'quantity',null,'unit_price',item->'price','subtotal',null,'category','待分類','note','','handling','NORMAL'));
 end loop;
 account:=private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0;
 select jsonb_agg(line||coalesce(added->(line->>'row_key'),'{}') order by ord) into lines from jsonb_array_elements(account->'lines') with ordinality as x(line,ord);
 saved:=public.save_baihuayuan_receipt_review(p_store_id,p_batch_id,p_data||jsonb_build_object('source_fingerprint',account->>'source_fingerprint','revision',account->'revision','lines',lines,'checked',false,'reviewed',false,'entry_completed',false),gen_random_uuid());
 result:=saved;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,auth.uid(),'receipt.quick-add',payload,result);
 return result;
end $$;
revoke all on function public.add_baihuayuan_receipt_items(uuid,uuid,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.add_baihuayuan_receipt_items(uuid,uuid,jsonb,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
