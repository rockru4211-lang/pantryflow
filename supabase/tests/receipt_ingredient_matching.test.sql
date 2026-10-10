begin;
do $test$
declare owner_id uuid:=gen_random_uuid();chef uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();org uuid:=gen_random_uuid();s uuid:=gen_random_uuid();other_s uuid:=gen_random_uuid();
 before_count integer;mid uuid;other_mid uuid;batch uuid:=gen_random_uuid();run uuid:=gen_random_uuid();line_id uuid:=gen_random_uuid();req uuid:=gen_random_uuid();current_row jsonb;payload jsonb;result jsonb;retry jsonb;line jsonb;before_master text;before_recipe text;fresh_id uuid; bindings_count integer;
begin
 select count(*) into before_count from public.receipt_lines;
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select id,id||'@recipe-test.invalid',now(),now(),now() from unnest(array[owner_id,chef,staff,outsider]) id;
 insert into public.profiles(id,display_name) select id,'食譜回滾測試' from unnest(array[owner_id,chef,staff,outsider]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type) values(org,'食譜回滾測試','SINGLE_RESTAURANT');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(s,org,'BeApe','RC'||substr(s::text,1,8),owner_id),(other_s,org,'Gras','RC'||substr(other_s::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,owner_id,'OWNER',true,true),(org,chef,'SUPERVISOR',false,false),(org,staff,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'食譜測試',owner_id from unnest(array[owner_id,chef,staff]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(s,org,owner_id,'rc-owner','OWNER','OWNER',owner_id,true),(s,org,chef,'rc-chef','SUPERVISOR','SUPERVISOR',owner_id,false),(s,org,staff,'rc-staff','STAFF','STAFF',owner_id,false);

 perform set_config('request.jwt.claim.sub',owner_id::text,true);

 mid:=(public.app_operation(s,'ingredient.save','{"name":"無鹽奶油","unit":"g","cost_price":0.4,"purchase":{"amount":200,"quantity":1,"unit":"包","content_quantity":500,"content_unit":"g","conversion_basis":"package"}}',gen_random_uuid())->>'id')::uuid;
 other_mid:=(public.app_operation(other_s,'ingredient.save','{"name":"外店奶油","unit":"g","cost_price":0.3}',gen_random_uuid())->>'id')::uuid;
 insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,uploaded_by,status,work_date) values(batch,org,s,'BeApe',owner_id,'READY_FOR_REVIEW',current_date);
 insert into public.receipt_ocr_runs(id,organization_id,batch_id,version,provider,model,prompt_version,status,started_by) values(run,org,batch,1,'manual','test','test','SUCCEEDED',owner_id);
 insert into private.receipt_manual_rows(id,batch_id,run_id,supplier_name,product_name,unit,quantity,unit_price_ex_tax,line_subtotal_ex_tax,created_by) values(line_id,batch,run,'大永','無鹽牛油','包',2,160,320,owner_id);
 select md5(to_jsonb(m)::text) into before_master from private.ingredient_masters m where id=mid;
 select md5(coalesce(jsonb_agg(to_jsonb(r) order by id)::text,'')) into before_recipe from private.recipe_cards r;
 current_row:=public.get_baihuayuan_receipt_accounts(s,null,null,null,batch)->0;
 assert jsonb_array_length(current_row->'lines')=1,'manual source readable';
 line:=(current_row->'lines'->0)||jsonb_build_object('product_name','無鹽奶油','ingredient_id',mid,'supplier_item_name','無鹽牛油','supplier_item_unit','包','supplier_item_specification','','ingredient_match_revision',0);
 payload:=jsonb_build_object('revision',current_row->'revision','source_fingerprint',current_row->>'source_fingerprint','header',jsonb_build_object('supplier_name','大永','receipt_date','2026-10-09','document_number','TEST'),'lines',jsonb_build_array(line),'adjustment',0,'adjustment_note','','tax',null,'total',null,'note','','checked',false);
 result:=public.save_baihuayuan_receipt_review(s,batch,payload,req);
 assert result=public.save_baihuayuan_receipt_review(s,batch,payload,req),'retry is idempotent';
 assert result#>>'{account,lines,0,ingredient_id}'=mid::text,'identity persists';
 assert (result#>>'{account,lines,0,unit_price}')::numeric=160,'receipt price retained';
 assert (select count(*) from private.receipt_ingredient_bindings where store_id=s)=1,'memory stored exactly once';
 assert jsonb_array_length(public.get_baihuayuan_ingredient_matching(s)->'bindings')=1,'memory readable';
 assert not exists(select 1 from jsonb_array_elements(public.get_baihuayuan_ingredient_matching(s)->'ingredients') i where i->>'id'=other_mid::text),'cross store catalog excluded';
 current_row:=result->'account';
 payload:=payload||jsonb_build_object('revision',current_row->'revision','source_fingerprint',current_row->>'source_fingerprint','lines',jsonb_build_array(line||jsonb_build_object('ingredient_id',other_mid)));
 begin perform public.save_baihuayuan_receipt_review(s,batch,payload,gen_random_uuid());raise exception 'cross store target accepted';exception when sqlstate '22023' then null;end;
 -- Clearing a binding is explicit, and ordinary unknown lines can still save.
 payload:=payload||jsonb_build_object('lines',jsonb_build_array(line||jsonb_build_object('ingredient_id',null,'create_ingredient',false)));
 result:=public.save_baihuayuan_receipt_review(s,batch,payload,gen_random_uuid());
 assert result#>>'{account,lines,0,ingredient_id}' is null,'clear persists';
 current_row:=result->'account';
 payload:=payload||jsonb_build_object('revision',current_row->'revision','source_fingerprint',current_row->>'source_fingerprint','lines',jsonb_build_array((line-'ingredient_id')||jsonb_build_object('product_name','全新測試食材','supplier_item_name','全新測試食材','create_ingredient',true)));
 req:=gen_random_uuid();result:=public.save_baihuayuan_receipt_review(s,batch,payload,req);
 fresh_id:=(result#>>'{account,lines,0,ingredient_id}')::uuid;
 assert fresh_id is not null,'new ingredient created';
 assert result=public.save_baihuayuan_receipt_review(s,batch,payload,req),'new ingredient retry idempotent';
 assert (select count(*) from private.ingredient_masters where store_id=s and name='全新測試食材')=1,'new ingredient not duplicated';
 assert (select cost_price is null from private.ingredient_masters where id=fresh_id),'receipt price does not become a confirmed standard';
 current_row:=result->'account';
 payload:=payload||jsonb_build_object('revision',current_row->'revision','source_fingerprint',current_row->>'source_fingerprint');
 begin perform public.save_baihuayuan_receipt_review(s,batch,payload,gen_random_uuid());raise exception 'same name new ingredient accepted';exception when sqlstate '22023' then null;end;

 -- A stale browser cannot overwrite a different remembered target.
 begin perform private.save_receipt_ingredient_match(s,batch,'大永',line||jsonb_build_object('ingredient_id',fresh_id,'ingredient_match_revision',0),'{}','大永');raise exception 'stale memory overwrite accepted';exception when sqlstate '40001' then null;end;
 -- Removed ingredients stay excluded; reimport cannot restore them or make a same-name copy.
 insert into private.ingredient_supply_state(store_id,ingredient_id,supplier_key,supplier_name,stopped,reason,disposition,note,updated_by) values(s,fresh_id,'*','整項食材',true,'測試','暫停使用','',owner_id);
 assert not exists(select 1 from jsonb_array_elements(public.get_baihuayuan_ingredient_matching(s)->'ingredients') i where i->>'id'=fresh_id::text),'removed target excluded';
 begin perform private.save_receipt_ingredient_match(s,batch,'大永',line||jsonb_build_object('ingredient_id',fresh_id,'supplier_item_name','再匯入'),'{}','大永');raise exception 'removed target accepted';exception when sqlstate '22023' then null;end;
 begin perform private.save_receipt_ingredient_match(s,batch,'大永',jsonb_build_object('product_name','全新測試食材','unit','包','create_ingredient',true),'{}','大永');raise exception 'removed same name recreated';exception when sqlstate '22023' then null;end;
 assert (select stopped from private.ingredient_supply_state where store_id=s and ingredient_id=fresh_id and supplier_key='*'),'removed target not restored';
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.get_baihuayuan_ingredient_matching(s);raise exception 'staff read accepted';exception when sqlstate '42501' then null;end;
 begin perform public.save_baihuayuan_receipt_review(s,batch,payload,req);raise exception 'staff retry accepted';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.get_baihuayuan_ingredient_matching(s);raise exception 'anonymous read accepted';exception when sqlstate '42501' then null;end;
 assert not has_table_privilege('authenticated','private.receipt_ingredient_bindings','SELECT'),'private memory inaccessible directly';
 assert not has_function_privilege('authenticated','private.save_receipt_ingredient_match(uuid,uuid,text,jsonb,jsonb,text)','EXECUTE'),'private helper inaccessible directly';
 assert before_master=(select md5(to_jsonb(m)::text) from private.ingredient_masters m where id=mid),'existing standard unchanged';
 assert before_recipe=(select md5(coalesce(jsonb_agg(to_jsonb(r) order by id)::text,'')) from private.recipe_cards r),'saved recipes unchanged';
 assert before_count=(select count(*) from public.receipt_lines),'receipt evidence unchanged';
end $test$;
rollback;
