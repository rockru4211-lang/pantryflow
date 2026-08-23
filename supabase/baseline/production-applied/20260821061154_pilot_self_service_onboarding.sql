-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260821061154
-- Name: pilot_self_service_onboarding
-- DO NOT apply to production; retained for blank-environment reconstruction only.

-- PantryFlow Pilot v0.1 self-service onboarding
alter table public.profiles alter column organization_id drop not null, alter column role drop not null, alter column store set default '';
create or replace function public.handle_new_pilot_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, organization_id, role, store)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), null, null, '')
  on conflict (id) do update set display_name = coalesce(nullif(trim(excluded.display_name), ''), public.profiles.display_name), updated_at = now();
  return new;
end; $$;
revoke execute on function public.handle_new_pilot_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_pantryflow on auth.users;
create trigger on_auth_user_created_pantryflow after insert on auth.users for each row execute function public.handle_new_pilot_user();
create or replace function public.current_organization_id() returns uuid language sql stable security definer set search_path = '' as $$
 select om.organization_id from public.organization_members om where om.user_id=(select auth.uid()) and om.is_active order by om.created_at limit 1 $$;
create or replace function public.current_role() returns text language sql stable security definer set search_path = '' as $$
 select om.role::text from public.organization_members om where om.user_id=(select auth.uid()) and om.is_active and om.organization_id=public.current_organization_id() limit 1 $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(public.current_role()='ADMIN',false) $$;
create or replace function public.can_supervise() returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(public.current_role() in ('ADMIN','SUPERVISOR'),false) $$;
revoke execute on function public.current_organization_id() from public, anon;
revoke execute on function public.current_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.can_supervise() from public, anon;
grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_supervise() to authenticated;
create or replace function public.create_my_organization(p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user_id uuid := (select auth.uid()); v_name text := nullif(trim(p_name),''); v_org_id uuid;
begin
 if v_user_id is null then raise exception 'Authentication required'; end if;
 if v_name is null then raise exception 'Organization name is required'; end if;
 if exists(select 1 from public.organization_members where user_id=v_user_id and is_active) then raise exception 'User already belongs to an organization'; end if;
 insert into public.organizations(name) values(v_name) returning id into v_org_id;
 insert into public.organization_members(organization_id,user_id,role,is_active) values(v_org_id,v_user_id,'ADMIN',true);
 insert into public.profiles(id,display_name,organization_id,role,store) values(v_user_id,'',v_org_id,'ADMIN',v_name)
 on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,store=excluded.store,updated_at=now();
 return v_org_id;
end; $$;
revoke execute on function public.create_my_organization(text) from public, anon;
grant execute on function public.create_my_organization(text) to authenticated;
do $$ declare p record; begin for p in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('organizations','profiles','organization_members','products','count_zones','zone_products') loop execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename); end loop; end $$;
alter table public.organization_members enable row level security;
create policy organizations_member_select on public.organizations for select to authenticated using(id=public.current_organization_id());
create policy profiles_self_or_org_select on public.profiles for select to authenticated using(id=(select auth.uid()) or organization_id=public.current_organization_id());
create policy profiles_self_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()) and organization_id=public.current_organization_id());
create policy organization_members_org_select on public.organization_members for select to authenticated using(organization_id=public.current_organization_id());
create policy products_org_select on public.products for select to authenticated using(organization_id=public.current_organization_id());
create policy products_admin_insert on public.products for insert to authenticated with check(organization_id=public.current_organization_id() and public.is_admin());
create policy products_admin_update on public.products for update to authenticated using(organization_id=public.current_organization_id() and public.is_admin()) with check(organization_id=public.current_organization_id() and public.is_admin());
create policy count_zones_org_select on public.count_zones for select to authenticated using(organization_id=public.current_organization_id());
create policy count_zones_admin_insert on public.count_zones for insert to authenticated with check(organization_id=public.current_organization_id() and public.is_admin());
create policy count_zones_admin_update on public.count_zones for update to authenticated using(organization_id=public.current_organization_id() and public.is_admin()) with check(organization_id=public.current_organization_id() and public.is_admin());
create policy zone_products_org_select on public.zone_products for select to authenticated using(exists(select 1 from public.count_zones z where z.id=zone_id and z.organization_id=public.current_organization_id()));
create policy zone_products_admin_insert on public.zone_products for insert to authenticated with check(public.is_admin() and exists(select 1 from public.count_zones z where z.id=zone_id and z.organization_id=public.current_organization_id()) and exists(select 1 from public.products p where p.id=product_id and p.organization_id=public.current_organization_id()));
create policy zone_products_admin_update on public.zone_products for update to authenticated using(public.is_admin() and exists(select 1 from public.count_zones z where z.id=zone_id and z.organization_id=public.current_organization_id())) with check(public.is_admin() and exists(select 1 from public.count_zones z where z.id=zone_id and z.organization_id=public.current_organization_id()) and exists(select 1 from public.products p where p.id=product_id and p.organization_id=public.current_organization_id()));
grant select on public.organizations,public.profiles,public.organization_members,public.products,public.suppliers,public.count_zones,public.zone_products,public.inventory_count_sessions,public.count_zone_progress,public.count_entries,public.count_drafts,public.inventory_count_discrepancies to authenticated;
grant insert,update on public.products,public.count_zones,public.zone_products to authenticated;
grant insert,update on public.inventory_count_sessions,public.count_zone_progress,public.count_entries,public.count_drafts,public.inventory_count_discrepancies to authenticated;
grant delete on public.count_drafts to authenticated;
