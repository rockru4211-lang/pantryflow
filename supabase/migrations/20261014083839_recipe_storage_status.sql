-- Preserve all recipe documents and saved costs. Classification uses original source flags.
-- Extend only the existing guarded metadata API; keep authorization and revision checks.
do $patch$
declare src text; old text; replacement text;
begin
 src:=pg_get_functiondef('private.recipe_organization(uuid,text,jsonb,uuid)'::regprocedure);
 old:=$a$('unset','serving','research','archived','menu')$a$;
 replacement:=$a$('unset','serving','research','reserve','archived','menu')$a$;
 if strpos(src,replacement)=0 then
  if strpos(src,old)=0 then raise exception 'Recipe status validation anchor missing';end if;
  execute replace(src,old,replacement);
 end if;
 src:=pg_get_functiondef('public.mobile_recipe_workspace(uuid,text)'::regprocedure);
 old:=$a$'kind',c.document->>'kind','yield'$a$;
 replacement:=$a$'lifecycle',c.document->'lifecycle','source_status',c.document->'source_status','source_sheet_hidden',c.document->'source_sheet_hidden','menu_ids',c.document->'menu_ids','kind',c.document->>'kind','yield'$a$;
 if strpos(src,replacement)=0 then
  if strpos(src,old)=0 then raise exception 'Mobile recipe fields anchor missing';end if;
  src:=replace(src,old,replacement);
  src:=replace(src,$a$ and coalesce(c.document->>'lifecycle','')<>'archived'$a$,'');
  src:=replace(src,$a$return jsonb_build_object('recipes',result);$a$,$a$return jsonb_build_object('recipes',result,'menus',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'state',m.state,'revision',m.revision)),'[]') from private.recipe_menus m where m.store_id=p_store_id));$a$);
  execute src;
 end if;
end $patch$;
