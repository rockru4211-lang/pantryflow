begin;
do $test$
declare s uuid;u uuid;staff uuid;sid uuid:=gen_random_uuid();staffsid uuid:=gen_random_uuid();d uuid:=gen_random_uuid();r jsonb;denied boolean;req uuid:=gen_random_uuid();
begin
 select id into s from public.stores where store_code='QAFULLINDEP';
 select sm.user_id into u from public.store_memberships sm join public.organization_members om on om.user_id=sm.user_id and om.organization_id=sm.organization_id where sm.store_id=s and om.is_owner;
 select sm.user_id into staff from public.store_memberships sm where sm.store_id=s and sm.role='STAFF' and sm.is_active limit 1;
 assert u is not null and staff is not null,'QA fixtures missing';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u,now()-interval '1 hour',now()),(staffsid,staff,now(),now());
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'role','authenticated')::text,true);
 r:=public.register_app_device(s,d,'SQL rollback device');
 assert r->>'authorized'='false' and r->>'device_type'='SHARED','new device auto-authorized';
 r:=public.app_operation(s,'device.authorize',jsonb_build_object('id',d,'device_type','PERSONAL'),req);
 assert public.app_operation(s,'device.authorize',jsonb_build_object('id',d,'device_type','PERSONAL'),req)=r,'retry changed authorization';
 assert public.register_app_device(s,d)->>'authorized'='true','authorization missing';
 perform set_config('request.jwt.claim.sub',staff::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'session_id',staffsid,'role','authenticated')::text,true);
 denied:=false;begin perform public.app_operation(s,'device.revoke',jsonb_build_object('id',d),gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'staff changed device policy';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'role','authenticated')::text,true);
 perform public.app_operation(s,'device.revoke',jsonb_build_object('id',d),gen_random_uuid());
 assert not private.app_session_valid(s),'revocation did not invalidate existing session';
 assert public.get_app_reauth_reason()='revoked','revocation mistaken for idle timeout';
 denied:=false;begin perform public.app_workspace(s,'settings');exception when insufficient_privilege then denied:=true;end;assert denied,'revoked session read protected data';
 -- A new credential login can work without silently restoring remembered-device authorization.
 sid:=gen_random_uuid();insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u,now()+interval '1 second',now());
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'role','authenticated')::text,true);
 assert public.register_app_device(s,d)->>'authorized'='false','new login silently reauthorized revoked device';
 insert into private.app_session_access(session_id,store_id,user_id,last_active_at) values(sid,s,u,now()-interval '31 days');
 assert not private.app_session_valid(s),'idle session remained valid';
 assert public.get_app_reauth_reason()='expired','idle classification wrong';
end $test$;
rollback;
select 'PASS: device authorization, role denial, retry, revoke, fresh credential login, idle expiration' result;
