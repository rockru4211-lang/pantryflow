begin;
do $test$
declare owner_id uuid:=gen_random_uuid();admin_id uuid:=gen_random_uuid();staff_id uuid:=gen_random_uuid();org uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();batch uuid:=gen_random_uuid();run_id uuid;req uuid:=gen_random_uuid();r jsonb;input jsonb;saved jsonb;key text;denied boolean;before_hash text;
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select id,id||'@receipt-review.invalid',now(),now(),now() from unnest(array[owner_id,admin_id,staff_id]) id;
 insert into public.profiles(id,display_name) select id,'隔離核對測試' from unnest(array[owner_id,admin_id,staff_id]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type,store_mode) values(org,'核對隔離測試','SINGLE_RESTAURANT','MULTI');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(a,org,'BeApe','RR'||substr(a::text,1,8),owner_id),(b,org,'Gras','RR'||substr(b::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,owner_id,'OWNER',true,true),(org,admin_id,'LOGISTICS',false,false),(org,staff_id,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'隔離核對測試',owner_id from unnest(array[owner_id,admin_id,staff_id]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(a,org,owner_id,'rr-owner','OWNER','OWNER',owner_id,true),(a,org,admin_id,'rr-admin','LOGISTICS','LOGISTICS',owner_id,false),(a,org,staff_id,'rr-staff','STAFF','STAFF',owner_id,false),(b,org,owner_id,'rr-owner-b','OWNER','OWNER',owner_id,true);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);


 insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,batch_number,status,group_mode) values(batch,org,a,'BeApe',current_date,owner_id,'DISCOUNT-QA','PROCESSING','SAME_RECEIPT');
 insert into public.receipt_documents(organization_id,batch_id,original_filename,storage_path,mime_type,byte_size,content_sha256,page_order) values(org,batch,'fixture.jpg',org||'/'||batch||'/fixture.jpg','image/jpeg',4,repeat('a',64),1);
 insert into storage.objects(bucket_id,name,metadata) values('receipt-documents',org||'/'||batch||'/fixture.jpg','{"size":4}');
 run_id:=public.begin_baihuayuan_receipt_manual_review(a,batch);
 key:=public.add_baihuayuan_receipt_draft_row(a,batch,run_id,gen_random_uuid());
 select md5(jsonb_agg(to_jsonb(f) order by f.id)::text) into before_hash from public.receipt_ocr_fields f where batch_id=batch;
 r:=public.get_baihuayuan_receipt_accounts(a,null,null,null,batch)->0;
 input:=jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','header',jsonb_build_object('supplier_name','折扣測試酒商','receipt_date',current_date,'document_number',''),'lines',jsonb_build_array(jsonb_build_object('row_key',key,'product_name','白酒','specification','','unit','瓶','quantity',6,'unit_price',700,'subtotal',4200,'category','酒水','note','原備註','handling','NORMAL','discount',jsonb_build_object('kind','PERCENT','value',30,'base_price',1000))),'adjustment',0,'adjustment_note','','tax',210,'total',4410,'note','','checked',false);
 assert not has_function_privilege('anon','public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)','execute');
 assert not has_function_privilege('authenticated','private.receipt_discount_line(jsonb,jsonb)','execute');
 denied:=false;begin perform public.save_baihuayuan_receipt_review(b,batch,input,req);exception when insufficient_privilege then denied:=true;end;assert denied;
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 denied:=false;begin perform public.save_baihuayuan_receipt_review(a,batch,input,req);exception when insufficient_privilege then denied:=true;end;assert denied;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 set local role authenticated;
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,req);
 assert public.save_baihuayuan_receipt_review(a,batch,input,req)=saved,'retry changed discount';
 reset role;
 r:=saved->'account';assert (r#>>'{lines,0,unit_price}')::numeric=700;assert (r#>>'{lines,0,discount,base_price}')::numeric=1000;assert (r->>'net')::numeric=4200;
 assert r#>>'{lines,0,note}'='原備註';
 assert before_hash=(select md5(jsonb_agg(to_jsonb(f) order by f.id)::text) from public.receipt_ocr_fields f where batch_id=batch),'source evidence changed';
 input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision');
 denied:=false;begin perform public.save_baihuayuan_receipt_review(a,batch,jsonb_set(input,'{lines,0,discount,value}','101'),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'invalid discount accepted';
 assert public.get_baihuayuan_receipt_accounts(a,null,null,null,batch)->0=r,'invalid discount partially saved';
 -- Older client non-price edit preserves metadata; changed effective prices clear it.
 input:=input #- '{lines,0,discount}';input:=jsonb_set(input,'{lines,0,note}','"新備註"');
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());r:=saved->'account';assert (r#>>'{lines,0,discount,value}')::numeric=30;
 input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision');
 input:=jsonb_set(jsonb_set(input,'{lines,0,unit_price}','800'),'{lines,0,subtotal}','4800');
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());assert saved#>'{account,lines,0,discount}'='null'::jsonb;
 assert (saved#>>'{account,lines,0,unit_price}')::numeric=800;
 r:=saved->'account';
 input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','removed_row_keys','[]'::jsonb,'lines',(r->'lines')||jsonb_build_array(jsonb_build_object('row_key','local-discount','product_name','紅酒','unit','瓶','quantity',3,'unit_price',1800,'subtotal',5400,'category','酒水','handling','NORMAL','discount',jsonb_build_object('kind','AMOUNT','value',600,'base_price',2000))));
 req:=gen_random_uuid();set local role authenticated;
 saved:=public.save_baihuayuan_receipt_entry(a,batch,input,req);
 assert public.save_baihuayuan_receipt_entry(a,batch,input,req)=saved,'structural retry duplicated';
 reset role;
 assert exists(select 1 from jsonb_array_elements(saved#>'{account,lines}') l where l->>'product_name'='紅酒' and (l->>'unit_price')::numeric=1800 and (l#>>'{discount,value}')::numeric=600),'new row lost discount';
end $test$;
rollback;
