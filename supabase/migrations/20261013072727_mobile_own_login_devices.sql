-- Read only the caller's own login sessions; never expose tokens or other users.
create function private.my_login_devices() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=auth.uid(); current_session uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 if caller is null or not exists(select 1 from auth.sessions where id=current_session and user_id=caller and (not_after is null or not_after>now())) then
  raise insufficient_privilege using message='LOGIN_REQUIRED';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',s.id,'current',s.id=current_session,'label',coalesce(d.label,'瀏覽器登入'),
  'device_type',d.device_choice,'created_at',s.created_at,
  'last_seen_at',coalesce(a.last_active_at,s.updated_at,s.created_at)) order by (s.id=current_session) desc,s.created_at desc)
 from auth.sessions s
 left join lateral (select ad.label,ds.device_choice from private.app_device_sessions ds
  join private.app_devices ad on ad.id=ds.device_id and ad.store_id=ds.store_id
  where ds.session_id=s.id order by ds.created_at desc limit 1) d on true
 left join lateral (select max(last_active_at) last_active_at from private.app_session_access where session_id=s.id and user_id=caller) a on true
 where s.user_id=caller and (s.not_after is null or s.not_after>now())), '[]'::jsonb);
end $$;
revoke all on function private.my_login_devices() from public,anon,authenticated;
grant execute on function private.my_login_devices() to authenticated;
create function public.get_my_login_devices() returns jsonb language sql stable security invoker set search_path='' as $$
 select private.my_login_devices()
$$;
revoke all on function public.get_my_login_devices() from public,anon,authenticated;
grant execute on function public.get_my_login_devices() to authenticated;
