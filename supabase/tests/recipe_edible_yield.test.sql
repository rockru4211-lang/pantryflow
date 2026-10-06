begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();chef uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();s uuid:=gen_random_uuid();other_s uuid:=gen_random_uuid();p uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();dish uuid:=gen_random_uuid();req uuid:=gen_random_uuid();
 doc jsonb;payload jsonb;result jsonb;retry jsonb;ws jsonb;before_count integer; mid uuid; rev integer; saved_hash text; prep uuid:=gen_random_uuid(); salt uuid:=gen_random_uuid(); review jsonb; first_request uuid; newdoc jsonb; before_hash text; started timestamptz; elapsed numeric;
begin
 select count(*) into before_count from public.receipt_lines;
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select id,id||'@recipe-test.invalid',now(),now(),now() from unnest(array[owner_id,chef,staff,outsider]) id;
 insert into public.profiles(id,display_name) select id,'食譜回滾測試' from unnest(array[owner_id,chef,staff,outsider]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type) values(org,'食譜回滾測試','SINGLE_RESTAURANT');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(s,org,'食譜測試','RC'||substr(s::text,1,8),owner_id),(other_s,org,'另一店','RC'||substr(other_s::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,owner_id,'OWNER',true,true),(org,chef,'SUPERVISOR',false,false),(org,staff,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'食譜測試',owner_id from unnest(array[owner_id,chef,staff]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(s,org,owner_id,'rc-owner','OWNER','OWNER',owner_id,true),(s,org,chef,'rc-chef','SUPERVISOR','SUPERVISOR',owner_id,false),(s,org,staff,'rc-staff','STAFF','STAFF',owner_id,false);

 perform set_config('request.jwt.claim.sub',owner_id::text,true);



 -- Explicit net yield must be saved exactly once with the manual purchase quote.
 doc:=jsonb_build_object('name','可食用率回滾測試','kind','prep','yield','250','unit','g','notes','取皮切絲 汁40g','lines',jsonb_build_array(jsonb_build_object('id','fennel','name','茴香頭','quantity','300','unit','g','edible_rate','0.96','quantity_basis','net','note','可食用率0.96')));
 payload:=jsonb_build_object('id',rid,'revision',0,'document',doc,'prices',jsonb_build_array(jsonb_build_object('line_id','fennel','name','茴香頭','unit','g','source','手動補價','purchase',jsonb_build_object('amount',500,'quantity',1,'unit','公斤'))));
 result:=public.app_operation(s,'recipe.commit',payload,req);
 assert abs((result#>>'{cost,total}')::numeric-156.25)<0.00000001,'net 300g / .96 costs 156.25';
 assert result=public.app_operation(s,'recipe.commit',payload,req),'net save retry is idempotent';
 assert (private.recipe_saved_snapshot(rid)->'cost')=result->'cost','reloaded snapshot agrees';
 assert (select document#>>'{lines,0,edible_rate}' from private.recipe_cards where id=rid)='0.96','yield factor stored';
 -- Save again without quotes, change quantity, then select gross: never reload prices.
 result:=public.app_operation(s,'recipe.commit',jsonb_build_object('id',rid,'revision',1,'document',doc,'prices','[]'::jsonb),gen_random_uuid());
 assert abs((result#>>'{cost,total}')::numeric-156.25)<0.00000001,'repeat save does not double apply loss';
 doc:=jsonb_set(doc,'{lines,0,quantity}','"600"');
 result:=public.app_operation(s,'recipe.commit',jsonb_build_object('id',rid,'revision',2,'document',doc,'prices','[]'::jsonb),gen_random_uuid());
 assert abs((result#>>'{cost,total}')::numeric-312.5)<0.00000001,'locked quote scales quantity once';
 doc:=jsonb_set(jsonb_set(doc,'{lines,0,quantity}','"300"'),'{lines,0,quantity_basis}','"gross"');
 result:=public.app_operation(s,'recipe.commit',jsonb_build_object('id',rid,'revision',3,'document',doc,'prices','[]'::jsonb),gen_random_uuid());
 assert abs((result#>>'{cost,total}')::numeric-150)<0.00000001,'gross weight removes prior net adjustment';
 -- Invalid factors are saved for later correction, not coerced to zero or blocked.
 doc:=jsonb_set(jsonb_set(doc,'{lines,0,edible_rate}','"0"'),'{lines,0,quantity_basis}','"net"');
 result:=public.app_operation(s,'recipe.commit',jsonb_build_object('id',rid,'revision',4,'document',doc,'prices','[]'::jsonb),gen_random_uuid());
 assert result#>>'{cost,total}' is null,'invalid factor stays missing';
 doc:=jsonb_set(doc,'{lines,0,edible_rate}','"0.96"');
 result:=public.app_operation(s,'recipe.commit',jsonb_build_object('id',rid,'revision',5,'document',doc,'prices','[]'::jsonb),gen_random_uuid());
 assert abs((result#>>'{cost,total}')::numeric-156.25)<0.00000001,'fix factor reuses saved quote';
 newdoc:=jsonb_build_object('name','主食譜','kind','dish','yield','1','unit','份','notes','','lines',jsonb_build_array(jsonb_build_object('id','prep','name','醃茴香頭','recipe_id',rid,'quantity','15','unit','g')));
 result:=public.app_operation(s,'recipe.commit',jsonb_build_object('id',dish,'revision',0,'document',newdoc,'prices','[]'::jsonb),gen_random_uuid());
 assert abs((result#>>'{cost,total}')::numeric-9.375)<0.00000001,'parent uses 15g / 250g of saved net component';
 -- No pricing rights or store boundary changes.
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin
  perform public.app_operation(s,'recipe.commit',jsonb_build_object('id',rid,'revision',6,'document',doc,'prices','[]'::jsonb),gen_random_uuid());
  raise exception 'staff unexpectedly saved recipe';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin
  perform private.recipe_cost_indexed(s,doc,array[rid],'{}'::jsonb);
  raise exception 'outsider unexpectedly read recipe costs';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 assert (select count(*) from public.receipt_lines)=before_count,'receipts untouched';
 raise notice 'edible yield save, reload, retry, partial completion, nested cost and role checks passed';
end $test$;
rollback;
