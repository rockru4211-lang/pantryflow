begin;
do $$
declare s uuid; actor uuid; manifest jsonb; hash text; first jsonb; again jsonb; b uuid;
begin
 select id into strict s from public.stores where store_code='QA0908RECEIPT';
 select user_id into strict actor from public.store_memberships where store_id=s and role='STAFF';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 manifest:=jsonb_build_array(jsonb_build_object('name','qa-receipt.HEIC','sha256',repeat('a',64),'mime_type','image/heic','byte_size',4567));
 hash:=encode(extensions.digest(convert_to('SAME_RECEIPT:'||repeat('a',64),'UTF8'),'sha256'),'hex');
 first:=public.begin_pilot_receipt_upload(s,hash,manifest,'SAME_RECEIPT');
 again:=public.begin_pilot_receipt_upload(s,hash,manifest,'SAME_RECEIPT');
 b:=(first->>'batch_id')::uuid;
 if (first->>'existing')::boolean or not (again->>'existing')::boolean or first->>'batch_id'<>again->>'batch_id' then raise exception 'ASSERT duplicate HEIC batch'; end if;
 if (select count(*) from public.receipt_documents where batch_id=b)<>1 then raise exception 'ASSERT duplicate HEIC document'; end if;
 if not exists(select 1 from public.receipt_documents where batch_id=b and original_filename='qa-receipt.HEIC' and mime_type='image/heic' and byte_size=4567 and content_sha256=repeat('a',64)) then raise exception 'ASSERT HEIC original manifest lost'; end if;
 if not exists(select 1 from storage.buckets where id='receipt-documents' and not public and 'image/heic'=any(allowed_mime_types) and file_size_limit=10485760) then raise exception 'ASSERT HEIC storage configuration changed'; end if;
end $$;
rollback;
select 'PASS: HEIC original manifest, upload retry idempotency and private storage' as heic_upload_tests;
