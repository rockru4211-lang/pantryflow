-- Explicit reassignment supersedes a reviewed source/unit mapping.
do $patch$
declare original text; revised text;
begin
 original:=pg_get_functiondef('private.ingredient_operation(uuid,text,jsonb,uuid)'::regprocedure);
 revised:=replace(original,'update private.ingredient_aliases set ingredient_id=target.id,corrected=true where id=a.id;',
 'update private.ingredient_aliases set ingredient_id=target.id,corrected=true,cost_mapping=null,reference_ids=array(select distinct rid from (select target.selected_reference rid union select unnest(linked.reference_ids) from private.ingredient_aliases linked where linked.ingredient_id=target.id and linked.id<>a.id) refs where rid is not null) where id=a.id;');
 if revised=original then raise exception 'Alias reassignment hook missing';end if;execute revised;
end $patch$;
notify pgrst,'reload schema';
