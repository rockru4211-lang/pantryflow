-- Extend existing guarded metadata writes; keep immutable costs and history.
do $patch$
declare src text;
begin
 src:=pg_get_functiondef('private.recipe_organization(uuid,text,jsonb,uuid)'::regprocedure);
 if strpos(src,$a$('unset','ready','serving','research','reserve','archived','menu')$a$)=0 then
  if strpos(src,$a$('unset','serving','research','reserve','archived','menu')$a$)=0 then raise exception 'Recipe status validation anchor missing';end if;
  src:=replace(src,$a$('unset','serving','research','reserve','archived','menu')$a$,$a$('unset','ready','serving','research','reserve','archived','menu')$a$);
 end if;
 src:=replace(src,$a$('category','lifecycle')$a$,$a$('category','lifecycle','season')$a$);
 if strpos(src,'-- supervisor menu activation guard')=0 then
  src:=replace(src,$a$if action='menu_save' then$a$,$a$if action='menu_save' then
  -- supervisor menu activation guard
  if data->>'state'='active' and coalesce(private.app_role(s),'') not in ('OWNER','SUPERVISOR') then raise exception 'RECIPE_SUPERVISOR_REQUIRED' using errcode='42501';end if;$a$);
 end if;
 execute src;
 src:=pg_get_functiondef('public.mobile_recipe_workspace(uuid,text)'::regprocedure);
 if strpos(src,$a$'season',c.document->'season'$a$)=0 then
  if strpos(src,$a$'lifecycle',c.document->'lifecycle'$a$)=0 then raise exception 'Mobile metadata anchor missing';end if;
  execute replace(src,$a$'lifecycle',c.document->'lifecycle'$a$,$a$'season',c.document->'season','lifecycle',c.document->'lifecycle'$a$);
 end if;
end $patch$;

-- All write paths, including recipe.save/commit and older clients, enforce
-- supervisor approval when moving into approved or serving states.
create or replace function private.recipe_review_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare next_state text:=new.document->>'lifecycle'; old_state text; approving boolean:=false;
begin
 if new.document ? 'season' and (jsonb_typeof(new.document->'season')<>'string' or length(new.document->>'season')>100) then raise exception 'INVALID_RECIPE_SEASON' using errcode='22023';end if;
 if next_state is not null and next_state not in ('unset','ready','serving','research','reserve','archived','menu') then raise exception 'INVALID_RECIPE_STATUS' using errcode='22023';end if;
 if tg_op='UPDATE' then old_state:=old.document->>'lifecycle';end if;
 approving:=next_state in ('ready','serving') and next_state is distinct from old_state;
 if next_state='menu' and exists(select 1 from private.recipe_menus m where m.store_id=new.store_id and m.state='active' and coalesce(new.document->'menu_ids','[]') ? m.id::text) then
  if tg_op='INSERT' then approving:=true;
  else approving:=old_state is distinct from 'menu' or coalesce(old.document->'menu_ids','[]') is distinct from coalesce(new.document->'menu_ids','[]');end if;
 end if;
 if approving and coalesce(private.app_role(new.store_id),'') not in ('OWNER','SUPERVISOR') then
  raise exception 'RECIPE_SUPERVISOR_REQUIRED' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.recipe_review_guard() from public,anon,authenticated;
drop trigger if exists recipe_review_guard on private.recipe_cards;
create trigger recipe_review_guard before insert or update of document on private.recipe_cards for each row execute function private.recipe_review_guard();
