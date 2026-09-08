create or replace function public.map_pilot_receipt_product(p_batch_id uuid,p_row_key text,p_product_id uuid default null,p_create boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; r uuid; v jsonb; product public.products; old_id uuid;
begin
 if auth.uid() is null or not private.can_review_receipt(p_batch_id) then raise exception using errcode='42501',message='RECEIPT_REVIEWER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 select * into strict b from public.receipt_upload_batches where id=p_batch_id;
 if b.status='COMPLETED' then raise exception 'PUBLISHED_RECEIPT_IMMUTABLE'; end if;
 select id into r from public.receipt_ocr_runs where batch_id=b.id and status='SUCCEEDED' order by version desc limit 1;
 select jsonb_object_agg(field_name,value) into v from private.receipt_effective_fields(r) where row_key=p_row_key and row_key<>'document';
 if v is null then raise exception 'OCR_LINE_NOT_FOUND'; end if;
 if p_create then
  if exists(select 1 from public.organizations where id=b.organization_id and business_type='CHAIN_RESTAURANT') then raise exception 'COMPANY_PRODUCT_MAPPING_REQUIRED'; end if;
  if nullif(btrim(v->>'product'),'') is null or nullif(btrim(v->>'unit'),'') is null then raise exception 'PRODUCT_NAME_AND_UNIT_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(b.organization_id::text||lower(v->>'product')||coalesce(v->>'specification','')||(v->>'unit'),0));
  select * into product from public.products where organization_id=b.organization_id and lower(name)=lower(btrim(v->>'product')) and coalesce(specification,'')=coalesce(v->>'specification','') and base_unit=v->>'unit' and is_active limit 1;
  if not found then
   insert into public.products(organization_id,product_code,name,specification,base_unit,count_unit,category)
   values(b.organization_id,'RC-'||upper(left(gen_random_uuid()::text,8)),btrim(v->>'product'),coalesce(v->>'specification',''),v->>'unit',v->>'unit','其他') returning * into product;
  end if;
 else
  select * into product from public.products where id=p_product_id and organization_id=b.organization_id and is_active;
  if not found then raise exception 'PRODUCT_NOT_IN_ORGANIZATION'; end if;
 end if;
 select product_id into old_id from public.receipt_product_mappings where batch_id=b.id and row_key=p_row_key;
 insert into public.receipt_product_mappings(organization_id,batch_id,row_key,product_id,selected_by)
 values(b.organization_id,b.id,p_row_key,product.id,auth.uid()) on conflict(batch_id,row_key) do update set product_id=excluded.product_id,selected_by=excluded.selected_by,selected_at=now();
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
 values(b.organization_id,'receipt_product_mapping',b.id::text,'RECEIPT_PRODUCT_MAPPED',jsonb_build_object('row_key',p_row_key,'product_id',old_id),jsonb_build_object('row_key',p_row_key,'product_id',product.id),auth.uid());
 return product.id;
end $$;

create or replace function public.commit_pilot_receipt_ocr(p_job uuid,p_lease uuid,p_run uuid,p_fields jsonb,p_raw jsonb,p_warning text default null)
returns void language plpgsql security definer set search_path='' as $$
declare j public.receipt_ocr_jobs; b public.receipt_upload_batches; item record; candidates uuid[];
begin
 select * into j from public.receipt_ocr_jobs where id=p_job for update;
 if j.status<>'RUNNING' or j.lease_token is distinct from p_lease or not exists(select 1 from public.receipt_ocr_runs where id=p_run and batch_id=j.batch_id and status='PROCESSING') then raise exception 'OCR_JOB_LEASE_LOST'; end if;
 select * into strict b from public.receipt_upload_batches where id=j.batch_id;
 if jsonb_array_length(p_fields)<12 then raise exception 'OCR_NO_LINES'; end if;
 insert into public.receipt_ocr_fields(organization_id,batch_id,document_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status,source_region,validation_notes)
 select b.organization_id,b.id,(f->>'document_id')::uuid,p_run,f->>'row_key',f->>'field_name',f->'raw_value',f->'normalized_value',(f->>'confidence')::numeric,f->>'review_status',f->'source_region',f->'validation_notes' from jsonb_array_elements(p_fields)f;
 update public.receipt_ocr_runs set status='SUCCEEDED',raw_response=p_raw,error_code=case when p_warning is not null then 'OCR_INCOMPLETE_OUTPUT' end,error_message=p_warning,completed_at=now() where id=p_run;
 update public.receipt_upload_batches set status='READY_FOR_REVIEW' where id=b.id;
 perform public.complete_receipt_ocr_job(j.id,p_lease,p_run);
 -- A match is automatic only when name, specification and original unit agree uniquely.
 for item in select row_key,jsonb_object_agg(field_name,value) as v from private.receipt_effective_fields(p_run) where row_key<>'document' group by row_key loop
  select array_agg(id) into candidates from public.products where organization_id=b.organization_id and is_active and lower(btrim(name))=lower(btrim(item.v->>'product')) and btrim(coalesce(specification,''))=btrim(coalesce(item.v->>'specification','')) and base_unit=item.v->>'unit';
  if cardinality(candidates)=1 then
   insert into public.receipt_product_mappings(organization_id,batch_id,row_key,product_id,selected_by) values(b.organization_id,b.id,item.row_key,candidates[1],j.requested_by) on conflict(batch_id,row_key) do nothing;
  end if;
 end loop;
 if b.erp_required then
  begin perform private.publish_receipt(b.id,j.requested_by,true);
  exception when others then
   insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id) values(b.organization_id,'receipt_upload_batch',b.id::text,'RECEIPT_MANAGER_REVIEW_REQUIRED',jsonb_build_object('reason',sqlerrm),j.requested_by);
  end;
 end if;
end $$;
