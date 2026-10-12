begin;
do $test$
declare owner_id uuid:=gen_random_uuid();chef uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();org uuid:=gen_random_uuid();s uuid:=gen_random_uuid();other_s uuid:=gen_random_uuid();req uuid:=gen_random_uuid();mid uuid;payload jsonb;result jsonb;code text;rev integer;ws jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select id,id||'@recipe-test.invalid',now(),now(),now() from unnest(array[owner_id,chef,staff,outsider]) id;
 insert into public.profiles(id,display_name) select id,'食譜回滾測試' from unnest(array[owner_id,chef,staff,outsider]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type) values(org,'食譜回滾測試','SINGLE_RESTAURANT');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(s,org,'BeApe','RC'||substr(s::text,1,8),owner_id),(other_s,org,'Gras','RC'||substr(other_s::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,owner_id,'OWNER',true,true),(org,chef,'SUPERVISOR',false,false),(org,staff,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'食譜測試',owner_id from unnest(array[owner_id,chef,staff]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(s,org,owner_id,'rc-owner','OWNER','OWNER',owner_id,true),(s,org,chef,'rc-chef','SUPERVISOR','SUPERVISOR',owner_id,false),(s,org,staff,'rc-staff','STAFF','STAFF',owner_id,false);

 perform set_config('request.jwt.claim.sub',owner_id::text,true);

 payload:='{"name":"固定碼測試","unit":"g","cost_price":2}'::jsonb;
 result:=public.baihuayuan_ingredient_prices(s,'save',payload,req);mid:=(result->>'id')::uuid;
 select ingredient_code,revision into code,rev from private.ingredient_masters where id=mid;
 assert code ~ '^F[0-9]{6,}$','automatic code';
 assert result=public.baihuayuan_ingredient_prices(s,'save',payload,req),'request retry';
 perform public.baihuayuan_ingredient_prices(s,'save',payload||jsonb_build_object('id',mid,'revision',rev,'name','固定碼改名'),gen_random_uuid());
 assert (select ingredient_code from private.ingredient_masters where id=mid)=code,'rename preserves code';
 ws:=public.baihuayuan_ingredient_prices(s,'read');
 assert (select value->>'ingredient_code' from jsonb_array_elements(ws->'ingredients') where value->>'id'=mid::text)=code,'price catalog code';
 ws:=public.get_baihuayuan_ingredient_matching(s);
 assert (select value->>'ingredient_code' from jsonb_array_elements(ws->'ingredients') where value->>'id'=mid::text)=code,'receipt catalog code';
 ws:=public.app_workspace(s,'ingredients');
 assert (select value->>'ingredient_code' from jsonb_array_elements(ws->'ingredients') where value->>'id'=mid::text)=code,'recipe catalog code';
 begin update private.ingredient_masters set ingredient_code='F999999' where id=mid;raise exception 'code modified';exception when sqlstate '22023' then null;end;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin perform public.baihuayuan_ingredient_prices(s,'read');raise exception 'outsider read allowed';exception when insufficient_privilege then null;end;
 begin perform public.get_baihuayuan_ingredient_matching(s);raise exception 'outsider matching allowed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.baihuayuan_ingredient_prices(s,'save',payload,gen_random_uuid());raise exception 'staff write allowed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.get_baihuayuan_ingredient_matching(s);raise exception 'anonymous matching allowed';exception when insufficient_privilege then null;end;
 assert not has_table_privilege('authenticated','private.ingredient_masters','UPDATE'),'no direct code mutation';
end $test$;
rollback;
