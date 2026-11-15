-- Directory visibility is separate from recipe documents and saved cost versions.
alter table private.recipe_cards add column removed_at timestamptz;

do $migration$
declare
 source text := pg_get_functiondef('private.recipe_organization(uuid,text,jsonb,uuid)'::regprocedure);
 menu_read text := $old$return jsonb_build_object('menus',(select coalesce(jsonb_agg(to_jsonb(m) order by m.updated_at desc),'[]') from private.recipe_menus m where store_id=s));$old$;
 clone_branch text := $old$elsif action='clone' then$old$;
begin
 if strpos(source,menu_read)=0 or strpos(source,clone_branch)=0 then
  raise exception 'Unexpected recipe_organization definition';
 end if;

 source := replace(source,menu_read,$read$return jsonb_build_object(
   'menus',(select coalesce(jsonb_agg(to_jsonb(m) order by m.updated_at desc),'[]') from private.recipe_menus m where store_id=s),
   'removed',(select coalesce(jsonb_object_agg(c.id,c.removed_at),'{}') from private.recipe_cards c
              where c.store_id=s and c.removed_at is not null)
  );$read$);

 source := replace(source,clone_branch,$remove$elsif action in ('remove','restore') then
  if not private.recipe_allowed(s,true) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  select * into card from private.recipe_cards where id=(data->>'id')::uuid and store_id=s for update;
  if not found then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  if card.revision is distinct from (data->>'revision')::integer
     or card.removed_at is distinct from (data->>'removed_at')::timestamptz
     or (action='remove') is distinct from (card.removed_at is null) then
   raise exception 'REVISION_CONFLICT' using errcode='40001';
  end if;

  update private.recipe_cards
  set removed_at=case when action='remove' then clock_timestamp() else null end
  where id=card.id
  returning jsonb_build_object('id',id,'revision',revision,'removed_at',removed_at) into result;
 elsif action='clone' then$remove$);

 execute source;
end $migration$;
