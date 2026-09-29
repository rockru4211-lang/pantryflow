-- Spot-check plans and results are administrative information.
do $$
declare src text;
begin
 src:=pg_get_functiondef('private.spot_check_command(uuid,text,jsonb)'::regprocedure);
 if strpos(src,$q$coalesce(v_role,'') not in ('SUPERVISOR','LOGISTICS','OWNER')$q$)=0 then raise exception 'SPOT_ROLE_ANCHOR_MISSING';end if;
 src:=replace(src,$q$coalesce(v_role,'') not in ('SUPERVISOR','LOGISTICS','OWNER')$q$,$q$coalesce(v_role,'') not in ('LOGISTICS','OWNER')$q$);
 src:=replace(src,$q$in ('SUPERVISOR','ADMIN','LOGISTICS','OWNER')$q$,$q$in ('ADMIN','LOGISTICS','OWNER')$q$);
 execute src;
 src:=pg_get_functiondef('private.spot_check_caps(uuid)'::regprocedure);
 src:=replace(src,$q$role in ('SUPERVISOR','LOGISTICS','OWNER')$q$,$q$role in ('LOGISTICS','OWNER')$q$);
 src:=replace(src,$q$role in ('SUPERVISOR','OWNER')$q$,$q$role in ('LOGISTICS','OWNER')$q$);
 src:=replace(src,$q$'operate',editable and not finance$q$,$q$'operate',editable and not finance and role in ('LOGISTICS','OWNER')$q$);
 execute src;
end $$;

create function private.inventory_edit_field_notes(s uuid,session uuid,row_data jsonb,notes jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare item record; draft public.count_drafts; cs public.inventory_count_sessions;
begin
 if auth.uid() is null or coalesce(private.app_role(s),'') not in ('LOGISTICS','OWNER') then raise exception 'INVENTORY_ADMIN_REQUIRED' using errcode='42501';end if;
 perform private.assert_store_editable(s);
 if jsonb_typeof(notes) is distinct from 'object' or octet_length(notes::text)>12000 then raise exception 'INVALID_INVENTORY_NOTE';end if;
 select * into cs from public.inventory_count_sessions where id=session and store_id=s for update;
 for item in select * from jsonb_each_text(notes) loop
  select * into draft from public.count_drafts d where d.session_id=session and d.id::text=item.key and d.product_id=(row_data->>'product_id')::uuid for update;
  if draft.id is null or not exists(select 1 from jsonb_array_elements(row_data->'zones')z where z->>'id'=item.key and coalesce((z->>'editable_note')::boolean,false)) or cs.status not in ('DRAFT','IN_PROGRESS') then raise exception 'INVENTORY_REVISION_CHANGED' using errcode='40001';end if;
  if length(coalesce(item.value,''))>2000 then raise exception 'INVALID_INVENTORY_NOTE';end if;
  if coalesce(draft.note,'') is distinct from coalesce(item.value,'') then
   update public.count_drafts set note=nullif(item.value,''),updated_at=clock_timestamp() where id=draft.id;
   insert into public.audit_logs(organization_id,store_id,user_id,entity_type,entity_id,action,old_value,new_value)
   values(cs.organization_id,s,auth.uid(),'count_draft',draft.id::text,'ADMIN_COUNT_NOTE_EDIT',jsonb_build_object('note',draft.note),jsonb_build_object('note',item.value,'quantity_preserved',true));
  end if;
 end loop;
end $$;
revoke all on function private.inventory_edit_field_notes(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

do $$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.inventory_month_source(uuid)'::regprocedure);
 anchor:=$q$'note',note,'entered_by',actor_name$q$;
 if strpos(src,anchor)=0 then raise exception 'FIELD_NOTE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$q$'note',note,'editable_note',exists(select 1 from public.count_drafts d join public.inventory_count_sessions c on c.id=d.session_id where d.id::text=entries.id and c.id=p_session and c.status in ('DRAFT','IN_PROGRESS') and not exists(select 1 from public.count_entries ce where ce.session_id=c.id and ce.product_id=d.product_id and ce.zone_id=d.zone_id and ce.entry_type='INITIAL_COUNT')),'entered_by',actor_name$q$);
 execute src;
 src:=pg_get_functiondef('private.baihuayuan_inventory_month(uuid,date,text,jsonb)'::regprocedure);
 anchor:='state:=private.inventory_month_state(p_store_id,p_month,nullif(p_data->>''session_id'','''')::uuid);';
 if strpos(src,anchor)=0 then raise exception 'FIELD_NOTE_LOCK_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$q$if p_action='review' and p_data?'field_notes' then perform 1 from public.inventory_count_sessions where store_id=p_store_id and id=nullif(p_data->>'session_id','')::uuid for update;end if; $q$||anchor);
 anchor:=$q$if row_data is null then raise exception using errcode='22023',message='INVENTORY_ROW_NOT_FOUND';end if;$q$;
 if strpos(src,anchor)=0 then raise exception 'FIELD_NOTE_EDIT_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,anchor||$patch$
  if p_data?'field_notes' then
   perform private.inventory_edit_field_notes(p_store_id,source_id,row_data,p_data->'field_notes');
   state:=private.inventory_month_state(p_store_id,p_month,source_id);
   select r into row_data from jsonb_array_elements(state->'rows')r where r->>'row_key'=p_data->>'row_key';
  end if;
 $patch$);
 execute src;
end $$;
notify pgrst,'reload schema';
