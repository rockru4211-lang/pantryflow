-- Invitations remain service-only; only hashes are stored. Existing PINs and
-- memberships are unchanged. Scope new tokens to the store selected by manager.
alter table private.staff_activation_tokens add column store_id uuid references public.stores(id);
create index staff_activation_token_hash on private.staff_activation_tokens(token_hash);
create function public.bind_staff_invitation(p_user_id uuid,p_store_id uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.member_active(p_store_id,p_user_id) then raise exception 'ACTIVATION_NOT_ALLOWED'; end if;
 update private.staff_activation_tokens set store_id=p_store_id
 where user_id=p_user_id and token_hash=encode(extensions.digest(p_code,'sha256'),'hex') and consumed_at is null;
 if not found then raise exception 'ACTIVATION_NOT_ALLOWED'; end if;
end $$;
revoke all on function public.bind_staff_invitation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bind_staff_invitation(uuid,uuid,text) to service_role;

create function public.get_staff_invitation(p_code text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t private.staff_activation_tokens; result jsonb;
begin
 if length(coalesce(p_code,'')) not between 32 and 128 then return jsonb_build_object('status','INVALID'); end if;
 select * into t from private.staff_activation_tokens where token_hash=encode(extensions.digest(p_code,'sha256'),'hex');
 if not found then return jsonb_build_object('status','INVALID'); end if;
 if t.consumed_at is not null then return jsonb_build_object('status','USED'); end if;
 if t.expires_at<=now() or t.failed_attempts>=10 then return jsonb_build_object('status','EXPIRED'); end if;
 if not private.member_active(t.store_id,t.user_id) then return jsonb_build_object('status','REVOKED'); end if;
 select jsonb_build_object('status','VALID','storeCode',s.store_code,'storeName',s.name,'loginMode',s.staff_login_mode,
 'displayName',i.display_name,'loginIdentifier',m.login_identifier,'role',coalesce(m.work_role,m.role),'expiresAt',t.expires_at)
 into result from public.store_memberships m join public.stores s on s.id=m.store_id
 join public.staff_identities i on i.user_id=m.user_id and i.organization_id=m.organization_id
 where m.user_id=t.user_id and m.store_id=t.store_id;
 return coalesce(result,jsonb_build_object('status','INVALID'));
end $$;
revoke all on function public.get_staff_invitation(text) from public,anon,authenticated;
grant execute on function public.get_staff_invitation(text) to service_role;

-- Preserve the legacy login path while checking the bound store and active org.
do $$ declare source text; begin
 select pg_get_functiondef('public.activate_staff_pin(text,text,text,text)'::regprocedure) into source;
 source:=replace(source,'if not found or v_token.consumed_at',
 'if not found or not exists(select 1 from public.store_memberships m join public.stores s on s.id=m.store_id where m.user_id=v_user and lower(s.store_code)=lower(btrim(p_store_code)) and private.member_active(s.id,v_user) and (v_token.store_id is null or v_token.store_id=s.id)) or v_token.consumed_at');
 execute source;
end $$;
