create or replace function public.get_pilot_count_completion(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.inventory_count_sessions%rowtype; result jsonb;
begin
 select * into s from public.inventory_count_sessions where id=p_session_id;
 if not found or not private.has_active_store_role(s.store_id,null) then raise exception using errcode='42501',message='STORE_MEMBERSHIP_REQUIRED'; end if;
 select jsonb_build_object('completed_at',s.completed_at,'completed_by',coalesce(i.display_name,p.display_name))
 into result from public.count_zone_progress z left join public.staff_identities i on i.user_id=z.completed_by
 left join public.profiles p on p.id=z.completed_by where z.session_id=s.id and z.status='COMPLETED' order by z.completed_at desc limit 1;
 return coalesce(result,'{}'::jsonb);
end $$;
revoke all on function public.get_pilot_count_completion(uuid) from public,anon;
grant execute on function public.get_pilot_count_completion(uuid) to authenticated;
