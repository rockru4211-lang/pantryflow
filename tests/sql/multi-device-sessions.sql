-- Same administrative identity on two devices. Every row is synthetic and rolled back.
do $test$
declare owner_id uuid:=gen_random_uuid();office_id uuid:=gen_random_uuid();org uuid;a uuid;b uuid;
 sid_a uuid:=gen_random_uuid();sid_b uuid:=gen_random_uuid();sid_new uuid:=gen_random_uuid();device_a uuid:=gen_random_uuid();device_b uuid:=gen_random_uuid();
 data jsonb;clock_a timestamptz;clock_b timestamptz;denied boolean;
 code text:='MULTI'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
begin
 begin
 insert into auth.users(id,email,email_confirmed_at) select id,id||'@multi-device-qa.invalid',now() from unnest(array[owner_id,office_id])id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','多裝置隔離測試','business_type','SINGLE_RESTAURANT','store_mode','MULTI'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code',code,'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);a:=(data->>'store_id')::uuid;org:=(data->>'organization_id')::uuid;
 data:=public.app_operation(a,'store.create','{"name":"Gras"}',gen_random_uuid());b:=(data->>'id')::uuid;
 insert into public.organization_members(organization_id,user_id,role,work_role) values(org,office_id,'LOGISTICS','LOGISTICS');
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,office_id,'Multi-device office',owner_id);
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by)
 select s,org,office_id,'office-'||code,'LOGISTICS','LOGISTICS',owner_id from unnest(array[a,b])s;
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid_a,office_id,now(),now()),(sid_b,office_id,now(),now());
 perform set_config('request.jwt.claim.sub',office_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',office_id,'session_id',sid_a,'role','authenticated')::text,true);
 perform public.choose_app_devices(array[a,b],device_a,false);
 assert private.can_administer_people(a) and private.can_administer_people(b),'first device lost office rights';
 assert jsonb_array_length(public.get_app_context()->'stores')=2,'first device missing shared stores';
 update private.app_session_access set last_active_at=now()-interval '10 minutes' where session_id=sid_a;
 select min(last_active_at) into clock_a from private.app_session_access where session_id=sid_a;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',office_id,'session_id',sid_b,'role','authenticated')::text,true);
 perform public.choose_app_devices(array[a,b],device_b,false);
 perform public.touch_app_session(b,true);
 assert private.can_administer_people(a) and private.can_administer_people(b),'second device missing the same office rights';
 assert jsonb_array_length(public.get_app_context()->'stores')=2,'second device missing shared stores';
 assert (select count(distinct session_id)=2 and count(distinct device_id)=2 from private.app_device_sessions where session_id in(sid_a,sid_b)),'new login replaced another device';
 assert (select bool_and(last_active_at=clock_a) from private.app_session_access where session_id=sid_a),'second device activity changed first device inactivity';
 select min(last_active_at) into clock_b from private.app_session_access where session_id=sid_b;
 -- Expiry on the idle computer leaves the phone usable, with its original membership.
 update private.app_session_access set last_active_at=now()-interval '16 minutes' where session_id=sid_a;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',office_id,'session_id',sid_a,'role','authenticated')::text,true);
 assert not private.app_session_valid(a) and not private.app_session_valid(b),'idle device did not expire';
 denied:=false;begin perform public.touch_app_session(a,true);exception when insufficient_privilege then denied:=true;end;assert denied,'idle device revived without login';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',office_id,'session_id',sid_b,'role','authenticated')::text,true);
 assert private.app_session_valid(a) and private.app_session_valid(b),'another device expiry ended the active login';
 assert private.can_administer_people(a),'phone lost administration after computer expiry';
 -- A local logout deletes only that session, including its own device mappings.
 delete from auth.sessions where id=sid_a;
 assert private.app_session_valid(a) and private.app_session_valid(b),'local logout invalidated another device';
 assert (select bool_and(last_active_at=clock_b) from private.app_session_access where session_id=sid_b),'local logout changed another inactivity clock';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid_new,office_id,now(),now());
 perform set_config('request.jwt.claims',jsonb_build_object('sub',office_id,'session_id',sid_new,'role','authenticated')::text,true);
 perform public.choose_app_devices(array[a,b],device_a,false);
 assert private.app_session_valid(a),'computer could not sign in again';
 update private.app_devices set revoked_at=now()+interval '1 second' where id=device_a;
 assert not private.app_session_valid(a),'device revocation ignored';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',office_id,'session_id',sid_b,'role','authenticated')::text,true);
 assert private.app_session_valid(a) and private.can_administer_people(a),'revoking computer affected phone';
 -- Account/store access remains authoritative across every device.
 update public.store_memberships set is_active=false where user_id=office_id;
 assert private.app_role(a) is null and private.app_role(b) is null,'removed office retains access on phone';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',office_id,'session_id',sid_new,'role','authenticated')::text,true);
 assert private.app_role(a) is null and private.app_role(b) is null,'removed office retains access on computer';
 raise exception using errcode='Z9905',message='MULTI_DEVICE_TEST_ROLLBACK';
 exception when sqlstate 'Z9905' then null;
 end;
end $test$;
