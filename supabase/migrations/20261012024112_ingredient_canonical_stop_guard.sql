-- Detaching an identity must never bypass the main ingredient's explicit stop.
create or replace function private.check_ingredient_canonical() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='UPDATE' and old.canonical_ingredient_id is not null and new.canonical_ingredient_id is distinct from old.canonical_ingredient_id
 and exists(select 1 from private.ingredient_supply_state st where st.ingredient_id=old.canonical_ingredient_id and st.stopped) then
 raise exception 'INGREDIENT_CANONICAL_STOPPED_RESTORE_FIRST' using errcode='22023';end if;
 if new.canonical_ingredient_id is not null and not exists(select 1 from private.ingredient_masters r where r.id=new.canonical_ingredient_id and r.store_id=new.store_id and r.canonical_ingredient_id is null) then
 raise exception 'INGREDIENT_CANONICAL_ROOT_REQUIRED' using errcode='22023';end if;
 return new;
end $$;
revoke all on function private.check_ingredient_canonical() from public,anon,authenticated;
