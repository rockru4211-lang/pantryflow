create temporary table hub_preservation on commit drop as
select 'ingredients' kind,md5(coalesce(string_agg(to_jsonb(m)::text,'' order by id),'')) hash from private.ingredient_masters m
union all select 'recipes',md5(coalesce(string_agg(to_jsonb(r)::text,'' order by id),'')) from private.recipe_cards r
union all select 'versions',md5(coalesce(string_agg(snapshot::text,'' order by id),'')) from private.ingredient_standard_versions;
-- Add traceability without rewriting historical price snapshots.
alter table private.ingredient_supply_state add column replacement text not null default '';
alter table private.ingredient_supply_events add column replacement text not null default '';
alter table private.ingredient_supply_events drop constraint ingredient_supply_events_action_check;
alter table private.ingredient_supply_events add constraint ingredient_supply_events_action_check check(action in ('stop','restore','note'));
alter table private.ingredient_standard_versions add column previous_snapshot jsonb;
alter table private.ingredient_standard_versions add column supplier_key text;
alter table private.ingredient_standard_versions add column supplier_name text;
alter table private.ingredient_standard_versions add column previous_supplier_key text;

do $patch$
declare src text; anchor text; replacement text;
begin
 src:=pg_get_functiondef('private.assign_ingredient_canonical()'::regprocedure);
 anchor:='if TG_OP=''UPDATE'' then';
 assert strpos(src,anchor)>0,'canonical hook missing';
 execute replace(src,anchor,anchor||' if (new.name,new.unit,new.purchase) is not distinct from (old.name,old.unit,old.purchase) then return new;end if;');
 src:=pg_get_functiondef('private.capture_ingredient_standard()'::regprocedure);
 anchor:='return new;'||chr(10)||'end';
 assert strpos(src,anchor)>0,'standard capture hook missing';
 execute replace(src,anchor,$hook$
 update private.ingredient_standard_versions set
 previous_snapshot=case when TG_OP='UPDATE' then to_jsonb(old) else null end,
 previous_supplier_key=coalesce((select 'id:'||c.supplier_id from private.ingredient_price_choices c where c.store_id=new.store_id and c.ingredient_id=new.id),(select private.ingredient_supplier_key_for_store(new.store_id,prior_ref.source_ref) from private.recipe_price_entries prior_ref where prior_ref.id=case when TG_OP='UPDATE' then old.selected_reference else null end))
 where store_id=new.store_id and ingredient_id=new.id and revision=new.revision;
 return new;
end$hook$);
 src:=pg_get_functiondef('public.baihuayuan_ingredient_prices(uuid,text,jsonb,uuid)'::regprocedure);
 anchor:='if p_action=''save'' then';
 assert strpos(src,anchor)>0,'hub action hook missing';
 replacement:=$hook$if p_action='category' then
 if m.id is null or nullif(p_data->>'category','') is null or p_data->>'category' not in ('食材','酒水','耗材','調料','待分類') then raise exception 'INVALID_CATEGORY' using errcode='22023';end if;
 update private.ingredient_masters set category=p_data->>'category',revision=revision+1,updated_at=now(),updated_by=actor where id=m.id;
 result:=jsonb_build_object('id',m.id);
 elsif p_action='supply_note' then
 k:=p_data->>'supplier_key';
 select * into st from private.ingredient_supply_state where store_id=p_store_id and ingredient_id=m.id and supplier_key=k for update;
 if st.ingredient_id is null or st.revision is distinct from (p_data->>'supply_revision')::int then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 if length(coalesce(p_data->>'note',''))>3000 or length(coalesce(p_data->>'replacement',''))>1000 then raise exception 'INVALID_SUPPLY_DECISION' using errcode='22023';end if;
 update private.ingredient_supply_state set note=coalesce(p_data->>'note',''),replacement=coalesce(p_data->>'replacement',''),revision=revision+1,updated_at=now(),updated_by=actor where store_id=p_store_id and ingredient_id=m.id and supplier_key=k;
 insert into private.ingredient_supply_events(store_id,ingredient_id,supplier_key,supplier_name,action,reason,disposition,note,replacement,snapshot,actor_id)
 values(p_store_id,m.id,k,st.supplier_name,'note',st.reason,st.disposition,coalesce(p_data->>'note',''),coalesce(p_data->>'replacement',''),to_jsonb(m),actor);
 result:=jsonb_build_object('id',m.id);
 elsif p_action='save' then$hook$;
 src:=replace(src,anchor,replacement);
 src:=replace(src,'disposition,note,snapshot,actor_id)','disposition,note,snapshot,actor_id,replacement)');
 src:=replace(src,'else to_jsonb(m) end,actor);','else to_jsonb(m) end,actor,coalesce(p_data->>''replacement'',st.replacement,''''));');
 -- Existing stop/restore paths keep their permission, revision and idempotency guards.
 anchor:='result:=jsonb_build_object(''id'',m.id,''supplier_key'',k,''stopped'',stopped);';
 assert strpos(src,anchor)>0,'supply hook missing';
 src:=replace(src,anchor,$hook$
 if length(coalesce(p_data->>'replacement',''))>1000 then raise exception 'INVALID_SUPPLY_DECISION' using errcode='22023';end if;
 update private.ingredient_supply_state set replacement=coalesce(p_data->>'replacement',replacement) where store_id=p_store_id and ingredient_id=m.id and supplier_key=k;
 $hook$||anchor);
 anchor:='insert into private.app_requests(store_id,request_id,actor_id,action,payload,result)';
 assert strpos(src,anchor)>0,'price supplier hook missing';
 src:=replace(src,anchor,$hook$
 if p_action in ('save','confirm','keep') then
 update private.ingredient_standard_versions v set supplier_key=coalesce('id:'||c.supplier_id,private.ingredient_supplier_key_for_store(p_store_id,r.source_ref)),supplier_name=coalesce(sp.name,r.source_ref->>'supplier_name','')
 from private.ingredient_masters im left join private.ingredient_price_choices c on c.ingredient_id=im.id and c.store_id=im.store_id left join public.suppliers sp on sp.id=c.supplier_id left join private.recipe_price_entries r on r.id=im.selected_reference
 where im.id=(result->>'id')::uuid and v.ingredient_id=im.id and v.store_id=p_store_id and v.revision=im.revision;
 end if;
 $hook$||anchor);
 execute src;
end $patch$;
notify pgrst,'reload schema';

do $$begin
 assert (select hash from hub_preservation where kind='ingredients')=(select md5(coalesce(string_agg(to_jsonb(m)::text,'' order by id),'')) from private.ingredient_masters m),'Ingredients changed during migration';
 assert (select hash from hub_preservation where kind='recipes')=(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by id),'')) from private.recipe_cards r),'Recipes changed during migration';
 assert (select hash from hub_preservation where kind='versions')=(select md5(coalesce(string_agg(snapshot::text,'' order by id),'')) from private.ingredient_standard_versions),'Historical prices changed during migration';
end $$;
