begin;
do $test$
declare u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); second_sid uuid:=gen_random_uuid(); outsider_sid uuid:=gen_random_uuid(); result jsonb; denied boolean;
begin
 insert into auth.users(id,aud,role) values(u,'authenticated','authenticated'),(other_user,'authenticated','authenticated');
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u,now(),now()),(second_sid,u,now(),now()),(outsider_sid,other_user,now(),now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'role','authenticated')::text,true);
 result:=public.get_my_login_devices();
 assert jsonb_array_length(result)=2,'must return only own sessions';
 assert result->0->>'current'='true','current session first';
 assert not exists(select 1 from jsonb_array_elements(result) row where row->>'id'=outsider_sid::text),'other user exposed';
 assert result=public.get_my_login_devices(),'read changed sessions';
 assert (select count(*)=3 from auth.sessions where user_id in(u,other_user)),'read mutated sessions';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',outsider_sid,'role','authenticated')::text,true);
 denied:=false;begin perform public.get_my_login_devices();exception when insufficient_privilege then denied:=true;end;assert denied,'foreign current session accepted';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.get_my_login_devices();exception when insufficient_privilege then denied:=true;end;assert denied,'anonymous call accepted';
 assert not has_function_privilege('anon','public.get_my_login_devices()','execute'),'anonymous execute allowed';
 assert has_function_privilege('authenticated','public.get_my_login_devices()','execute'),'authenticated wrapper missing';
 assert not has_table_privilege('authenticated','auth.sessions','select'),'session table exposed';
end $test$;
rollback;
select 'PASS: own sessions only, current first, repeat read, no mutations, foreign-session and anonymous denial, grants; fixtures rolled back' result;
