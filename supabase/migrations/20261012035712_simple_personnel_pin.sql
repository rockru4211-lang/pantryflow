-- Direct administrative PIN setting; never persist a plaintext PIN in audit/request data.
create function private.set_person_pin(p_store uuid,p_user uuid,p_pin text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; person jsonb; cached private.app_requests; result jsonb;
begin
 if auth.uid() is null or p_user=auth.uid() or not private.can_administer_people(p_store) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_pin is null or p_pin !~ '^[0-9]{6}$' or p_request is null then raise exception 'PIN_MUST_BE_SIX_DIGITS' using errcode='22023';end if;
 select organization_id into org from public.stores where id=p_store;
 perform pg_advisory_xact_lock(hashtextextended(org::text||p_user::text,927));
 select value into person from jsonb_array_elements(private.baihuayuan_people(p_store)->'partners') where value->>'user_id'=p_user::text;
 if person is null or person->>'pin_reset_store_id' is null or coalesce((person->>'is_removed')::boolean,true) or coalesce((person->>'is_owner')::boolean,true) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select * into cached from private.app_requests where store_id=p_store and request_id=p_request;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'person.pin' or cached.payload<>jsonb_build_object('user',p_user) then raise exception 'REQUEST_CONFLICT' using errcode='40001';end if;
  return cached.result;
 end if;
 perform public.set_staff_pin(p_user,p_pin);
 update private.staff_activation_tokens set consumed_at=now() where user_id=p_user and consumed_at is null;
 delete from auth.sessions where user_id=p_user;
 result:=jsonb_build_object('saved',true,'user_id',p_user);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store,p_request,auth.uid(),'person.pin',jsonb_build_object('user',p_user),result);
 insert into public.audit_logs(organization_id,store_id,user_id,entity_type,entity_id,action,new_value) values(org,p_store,auth.uid(),'partner',p_user::text,'PERSON_PIN_SET',result);
 return result;
end $$;
revoke all on function private.set_person_pin(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.set_person_pin(uuid,uuid,text,uuid) to authenticated;
create function public.set_person_pin(p_store_id uuid,p_user_id uuid,p_pin text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.set_person_pin(p_store_id,p_user_id,p_pin,p_request_id)$$;
revoke all on function public.set_person_pin(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.set_person_pin(uuid,uuid,text,uuid) to authenticated;
notify pgrst,'reload schema';
