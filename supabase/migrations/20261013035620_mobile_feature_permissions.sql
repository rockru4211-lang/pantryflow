-- BeApe-only authorization. No changes to counts, recipe snapshots, PINs or source records.
create table private.person_data_access (
 organization_id uuid not null references public.organizations(id),
 user_id uuid not null references auth.users(id),
 permissions jsonb not null default '{}', revision integer not null default 1,
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 primary key(organization_id,user_id)
);
alter table private.person_data_access enable row level security;
revoke all on private.person_data_access from public,anon,authenticated;
create function private.feature_scope(s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.stores st join public.organizations o on o.id=st.organization_id where st.id=s and st.name in ('BeApe','Gras') and o.business_type::text='SINGLE_RESTAURANT')
$$;
create function private.person_data_permissions(org uuid,actor uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select permissions from private.person_data_access where organization_id=org and user_id=actor),
 case when 'OFFICE'=any(private.person_work_functions(org,actor)) then '{"RECIPE":{"view":true,"edit":true},"SUPPLIERS":{"view":true,"edit":true},"SPOT":{"view":true,"edit":true},"EQUIPMENT":{"view":true,"edit":true}}'::jsonb else '{}'::jsonb end)
$$;
create function private.has_data_access(s uuid,feature text,editing boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select auth.uid() is not null and private.app_role(s) is not null
 and (not editing or private.can_edit_store(s)) and (private.app_role(s)='OWNER' or
 (private.person_data_permissions(st.organization_id,auth.uid())#>>array[feature,case when editing then 'edit' else 'view' end])::boolean)
 from public.stores st where st.id=s and st.is_active),false)
$$;
create function private.office_data_access(s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select private.app_role(s)='OWNER' or private.app_role(s)='LOGISTICS' and 'OFFICE'=any(private.person_work_functions(st.organization_id,auth.uid())) from public.stores st where st.id=s),false)
$$;
revoke all on function private.feature_scope(uuid),private.person_data_permissions(uuid,uuid),private.has_data_access(uuid,text,boolean),private.office_data_access(uuid) from public,anon,authenticated;

create function private.save_person_data_access(s uuid,target uuid,permissions jsonb,revision integer,request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; prior private.app_requests; current_row private.person_data_access; item record; payload jsonb; result jsonb;
begin
 if auth.uid() is null or private.app_role(s) is null or not private.feature_scope(s) or not private.can_administer_people(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into org from public.stores where id=s;
 if target=auth.uid() or not exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and private.member_active(m.store_id,target))
 or exists(select 1 from public.store_memberships m where m.organization_id=org and m.user_id=target and m.is_active and not private.can_administer_people(m.store_id))
 or exists(select 1 from public.organization_members m where m.organization_id=org and m.user_id=target and m.is_owner) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if request is null or jsonb_typeof(permissions) is distinct from 'object' or octet_length(permissions::text)>2000 then raise exception 'INVALID_PERMISSIONS' using errcode='22023';end if;
 for item in select * from jsonb_each(permissions) loop
  if item.key not in ('RECIPE','SUPPLIERS','SPOT','EQUIPMENT') or jsonb_typeof(item.value) is distinct from 'object'
   or jsonb_typeof(item.value->'view') is distinct from 'boolean' or jsonb_typeof(item.value->'edit') is distinct from 'boolean'
   or (select count(*) from jsonb_object_keys(item.value))<>2 or (item.value->>'edit')::boolean and not (item.value->>'view')::boolean then raise exception 'INVALID_PERMISSIONS' using errcode='22023';end if;
 end loop;
 payload:=jsonb_build_object('user_id',target,'permissions',permissions,'revision',revision);
 perform pg_advisory_xact_lock(hashtextextended('data-access:'||org::text||target::text,0));
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then
  if prior.actor_id<>auth.uid() or prior.action<>'person.data-access' or prior.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into current_row from private.person_data_access a where a.organization_id=org and a.user_id=target for update;
 if coalesce(current_row.revision,0) is distinct from revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 insert into private.person_data_access values(org,target,permissions,coalesce(current_row.revision,0)+1,auth.uid(),now())
 on conflict(organization_id,user_id) do update set permissions=excluded.permissions,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 result:=jsonb_build_object('saved',true,'revision',coalesce(current_row.revision,0)+1);
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
 values(org,s,'person_data_access',target::text,'person.data-access',current_row.permissions,permissions,auth.uid());
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),'person.data-access',payload,result);
 return result;
end $$;
revoke all on function private.save_person_data_access(uuid,uuid,jsonb,integer,uuid) from public,anon;
grant execute on function private.save_person_data_access(uuid,uuid,jsonb,integer,uuid) to authenticated;
create function public.save_person_data_access(p_store_id uuid,p_user_id uuid,p_permissions jsonb,p_revision integer,p_request_id uuid) returns jsonb language sql set search_path='' as $$select private.save_person_data_access(p_store_id,p_user_id,p_permissions,p_revision,p_request_id)$$;
revoke all on function public.save_person_data_access(uuid,uuid,jsonb,integer,uuid) from public,anon;
grant execute on function public.save_person_data_access(uuid,uuid,jsonb,integer,uuid) to authenticated;

-- Save profile/store membership and data grants in one transaction, each with its own replay key.
create function public.save_person_settings(p_store_id uuid,p_user_id uuid,p_revision text,p_name text,p_stores jsonb,p_functions text[],p_default_store_id uuid,p_request_id uuid,p_features jsonb,p_features_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=public.save_person_function_access(p_store_id,p_user_id,p_revision,p_name,p_stores,p_functions,p_default_store_id,p_request_id);
 perform public.save_person_data_access(p_store_id,p_user_id,p_features,p_features_revision,md5(p_request_id::text||':features')::uuid);
 return result;
end $$;
revoke all on function public.save_person_settings(uuid,uuid,text,text,jsonb,text[],uuid,uuid,jsonb,integer) from public,anon;
grant execute on function public.save_person_settings(uuid,uuid,text,text,jsonb,text[],uuid,uuid,jsonb,integer) to authenticated;

-- Enrich the existing definer functions without weakening their checks.
do $$declare def text;begin
 def:=pg_get_functiondef('private.baihuayuan_people(uuid)'::regprocedure);
 if strpos(def,'''work_functions'',private.person_work_functions(org,target)')=0 then raise exception 'PEOPLE_ANCHOR_MISSING';end if;
 def:=replace(def,'''work_functions'',private.person_work_functions(org,target)', '''data_access'',private.person_data_permissions(org,target),''data_access_revision'',coalesce((select a.revision from private.person_data_access a where a.organization_id=org and a.user_id=target),0),''work_functions'',private.person_work_functions(org,target)');execute def;
 def:=pg_get_functiondef('private.app_context()'::regprocedure);
 if strpos(def,'''work_functions'',private.person_work_functions(s.organization_id,auth.uid())')=0 then raise exception 'CONTEXT_ANCHOR_MISSING';end if;
 def:=replace(def,'''work_functions'',private.person_work_functions(s.organization_id,auth.uid())','''data_access'',private.person_data_permissions(s.organization_id,auth.uid()),''work_functions'',private.person_work_functions(s.organization_id,auth.uid())');execute def;
end $$;

-- The published field workflow is separate from confidential imported notes and recipe lines.
create table private.recipe_field_flows (
 recipe_id uuid primary key references private.recipe_cards(id),
 steps text not null default '' check(length(steps)<=12000),revision integer not null default 1,
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now()
);
alter table private.recipe_field_flows enable row level security;
revoke all on private.recipe_field_flows from public,anon,authenticated;
create function private.field_recipe_workspace(s uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_data_access(s,'RECIPE') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('recipes',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',case when r.document->>'name' in ('出餐','成品','出餐菜色') then coalesce(nullif(r.document->>'source_name',''),r.document->>'name') else r.document->>'name' end,'steps',f.steps) order by r.document->>'name'),'[]') from private.recipe_cards r join private.recipe_field_flows f on f.recipe_id=r.id where r.store_id=s and r.document->>'kind'='dish' and btrim(f.steps)<>''));
end $$;
revoke all on function private.field_recipe_workspace(uuid) from public,anon,authenticated;
create function public.recipe_field_flow(p_store_id uuid,p_recipe_id uuid default null,p_steps text default null,p_revision integer default null,p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare row private.recipe_field_flows; prior private.app_requests; result jsonb; payload jsonb; org uuid;
begin
 if not private.office_data_access(p_store_id) or not private.has_data_access(p_store_id,'RECIPE',p_steps is not null) or not exists(select 1 from private.recipe_cards where id=p_recipe_id and store_id=p_store_id and document->>'kind'='dish') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_steps is null then select * into row from private.recipe_field_flows where recipe_id=p_recipe_id;return jsonb_build_object('steps',coalesce(row.steps,''),'revision',coalesce(row.revision,0));end if;
 if p_request_id is null or length(p_steps)>12000 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 payload:=jsonb_build_object('recipe_id',p_recipe_id,'steps',p_steps,'revision',p_revision);
 perform pg_advisory_xact_lock(hashtextextended('recipe-flow:'||p_recipe_id::text,0));
 select * into prior from private.app_requests where store_id=p_store_id and request_id=p_request_id;
 if found then if prior.actor_id<>auth.uid() or prior.action<>'recipe.field-flow' or prior.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;return prior.result;end if;
 select * into row from private.recipe_field_flows where recipe_id=p_recipe_id for update;
 if coalesce(row.revision,0) is distinct from p_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 insert into private.recipe_field_flows values(p_recipe_id,p_steps,coalesce(row.revision,0)+1,auth.uid(),now()) on conflict(recipe_id) do update set steps=excluded.steps,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 select organization_id into org from public.stores where id=p_store_id;
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,user_id,new_value) values(org,p_store_id,'recipe_field_flow',p_recipe_id::text,'recipe.field-flow',auth.uid(),jsonb_build_object('revision',coalesce(row.revision,0)+1));
 result:=jsonb_build_object('steps',p_steps,'revision',coalesce(row.revision,0)+1);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,auth.uid(),'recipe.field-flow',payload,result);return result;
end $$;
revoke all on function public.recipe_field_flow(uuid,uuid,text,integer,uuid) from public,anon;
grant execute on function public.recipe_field_flow(uuid,uuid,text,integer,uuid) to authenticated;

-- Existing recipe APIs remain administrative, even if a field user requests them directly.
alter function private.recipe_allowed(uuid,boolean) rename to recipe_allowed_before_data_access;
create function private.recipe_allowed(s uuid,prices boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select case when private.feature_scope(s) then private.office_data_access(s) and private.has_data_access(s,'RECIPE',prices) else private.recipe_allowed_before_data_access(s,prices) end
$$;
revoke all on function private.recipe_allowed(uuid,boolean) from public,anon,authenticated;

-- Supplier contacts are optional. Financial details remain office-only.
do $$declare def text;begin
 def:=pg_get_functiondef('private.app_workspace(uuid,text,jsonb)'::regprocedure);
 if strpos(def,'begin')=0 then raise exception 'WORKSPACE_ANCHOR_MISSING';end if;
 def:=replace(def,'begin',E'begin\n if private.feature_scope(p_store) and p_section=''suppliers'' and not private.has_data_access(p_store,''SUPPLIERS'') then raise exception ''APP_FORBIDDEN'' using errcode=''42501'';end if;');
 def:=replace(def,$old$'editable',v_role in ('OWNER','LOGISTICS') and v_type<>'CHAIN_RESTAURANT'$old$,$new$'editable',v_role in ('OWNER','LOGISTICS') and v_type<>'CHAIN_RESTAURANT' and (p_section<>'suppliers' or not private.feature_scope(p_store) or private.has_data_access(p_store,'SUPPLIERS',true))$new$);
 execute def;
end $$;

-- A dedicated safe equipment route returns equipment categories only, never contracts.
create function private.equipment_workspace(s uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_data_access(s,'EQUIPMENT') then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(d)-'contract_start'-'contract_end' order by d.name),'[]') from private.administrative_documents d where d.store_id=s and d.category ~ '(設備|維修|報修|保養)'));
end $$;
revoke all on function private.equipment_workspace(uuid) from public,anon,authenticated;
-- Reuse the existing versioned, audited, idempotent equipment saver after validating both old and new category.
do $$declare def text; anchor text;begin
 def:=pg_get_functiondef('private.administrative_save(uuid,jsonb,uuid)'::regprocedure);
 anchor:='if not private.administrative_access(p_store) or p_request is null then';
 if strpos(def,anchor)=0 then raise exception 'EQUIPMENT_SAVE_ANCHOR_MISSING';end if;
 def:=replace(def,anchor,'if (not private.administrative_access(p_store) and not private.has_data_access(p_store,''EQUIPMENT'',true)) or p_request is null then');
 def:=replace(def,'select * into cached',E'if not private.administrative_access(p_store) and exists(select 1 from jsonb_array_elements(p_data->''rows'') i where coalesce(i->>''category'','''') !~ ''(設備|維修|報修|保養)'' or i ? ''contract_start'' or i ? ''contract_end'' or exists(select 1 from private.administrative_documents d where d.id=(i->>''id'')::uuid and (d.store_id<>p_store or d.category !~ ''(設備|維修|報修|保養)''))) then raise exception ''APP_FORBIDDEN'' using errcode=''42501'';end if;\n select * into cached');execute def;
end $$;

-- Gate public dispatchers and avoid exposing any legacy aliases via PostgREST.
alter function public.app_workspace(uuid,text,jsonb) rename to app_workspace_before_data_access;
alter function public.app_workspace_before_data_access(uuid,text,jsonb) set schema private;
revoke all on function private.app_workspace_before_data_access(uuid,text,jsonb) from public,anon,authenticated;
create function public.app_workspace(p_store_id uuid,p_section text,p_filter jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.feature_scope(p_store_id) then
  if private.app_role(p_store_id) is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  if p_section='recipes.field' then return private.field_recipe_workspace(p_store_id);end if;
  if p_section='equipment' then return private.equipment_workspace(p_store_id);end if;
  if p_section not in ('suppliers','transfers','transfer-search','product-options','settings','activity','tasks','notifications') and not private.office_data_access(p_store_id) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 end if;
 return private.app_workspace_before_data_access(p_store_id,p_section,p_filter);
end $$;
revoke all on function public.app_workspace(uuid,text,jsonb) from public,anon;
grant execute on function public.app_workspace(uuid,text,jsonb) to authenticated;

-- Guard recipe writes including calls from older tabs, not only disabled buttons.
do $$declare p record;def text;begin
 for p in select oid,proname from pg_proc where pronamespace='private'::regnamespace and proname in ('recipe_operation','recipe_price_catalog_operation','recipe_commit','recipe_organization','recipe_confirm_cost','recipe_reprice') loop
  def:=pg_get_functiondef(p.oid);
  if strpos(def,'begin')>0 and strpos(def,'s uuid')>0 then
   def:=replace(def,'begin',E'begin\n if private.feature_scope(s) and not private.has_data_access(s,''RECIPE'',true) then raise exception ''APP_FORBIDDEN'' using errcode=''42501'';end if;');
   -- Menu metadata read remains available to authorized read-only office users.
   if p.proname='recipe_organization' then def:=replace(def,'if private.feature_scope(s) and not private.has_data_access(s,''RECIPE'',true)','if action<>''read'' and private.feature_scope(s) and not private.has_data_access(s,''RECIPE'',true)');end if;
   execute def;
  end if;
 end loop;
 def:=pg_get_functiondef('private.app_management(uuid,text,jsonb)'::regprocedure);
 def:=replace(def,'begin',E'begin\n if private.feature_scope(p_store) and p_action like ''supplier.%'' and not private.has_data_access(p_store,''SUPPLIERS'',true) then raise exception ''APP_FORBIDDEN'' using errcode=''42501'';end if;');execute def;
end $$;

-- Allow separately authorized spot checks while retaining operation/version checks.
alter function private.spot_check_caps(uuid) rename to spot_check_caps_before_data_access;
create function private.spot_check_caps(p_store uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare allowed boolean;office boolean;begin
 if not private.feature_scope(p_store) then return private.spot_check_caps_before_data_access(p_store);end if;
 allowed:=private.has_data_access(p_store,'SPOT',true);office:=private.office_data_access(p_store);
 return jsonb_build_object('plan',allowed and office,'operate',allowed,'review',allowed and office,'close',allowed and office,'export',office and private.has_data_access(p_store,'SPOT') and private.has_app_feature(p_store,'DATA_EXPORT'));
end $$;
revoke all on function private.spot_check_caps(uuid) from public,anon,authenticated;
do $$declare def text;anchor text;begin
 def:=pg_get_functiondef('private.spot_check_command(uuid,text,jsonb)'::regprocedure);
 anchor:='coalesce(v_role,'''') not in (''LOGISTICS'',''OWNER'')';
 if strpos(def,anchor)=0 then raise exception 'SPOT_ACCESS_ANCHOR_MISSING';end if;
 def:=replace(def,anchor,'(case when private.feature_scope(p_store) then not private.has_data_access(p_store,''SPOT'') else coalesce(v_role,'''') not in (''LOGISTICS'',''OWNER'') end)');
 def:=replace(def,$old$coalesce(sm.work_role,sm.role)::text in ('ADMIN','LOGISTICS','OWNER')$old$,$new$(case when private.feature_scope(p_store) then coalesce(sm.work_role,sm.role)::text='OWNER' or coalesce((private.person_data_permissions(v_org,sm.user_id)#>>'{SPOT,edit}')::boolean,false) else coalesce(sm.work_role,sm.role)::text in ('ADMIN','LOGISTICS','OWNER') end)$new$);
 execute def;
end $$;
notify pgrst,'reload schema';

-- Export/report access follows the separately assigned office function for BeApe.
alter function private.has_app_feature(uuid,text) rename to has_app_feature_before_data_access;
create function private.has_app_feature(p_store uuid,p_feature text) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_app_feature_before_data_access(p_store,p_feature) and (not private.feature_scope(p_store) or private.office_data_access(p_store))
$$;
revoke all on function private.has_app_feature(uuid,text) from public,anon;
grant execute on function private.has_app_feature(uuid,text) to authenticated;

alter function public.app_operation(uuid,text,jsonb,uuid) rename to app_operation_before_data_access;
alter function public.app_operation_before_data_access(uuid,text,jsonb,uuid) set schema private;
revoke all on function private.app_operation_before_data_access(uuid,text,jsonb,uuid) from public,anon,authenticated;
create function public.app_operation(p_store_id uuid,p_action text,p_data jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.feature_scope(p_store_id) then
  if private.app_role(p_store_id) is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  if p_action like 'recipe.%' and (not private.office_data_access(p_store_id) or not private.has_data_access(p_store_id,'RECIPE',true)) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
  if p_action like 'supplier.%' and (not private.office_data_access(p_store_id) or not private.has_data_access(p_store_id,'SUPPLIERS',true)) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 end if;
 return private.app_operation_before_data_access(p_store_id,p_action,p_data,p_request_id);
end $$;
revoke all on function public.app_operation(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.app_operation(uuid,text,jsonb,uuid) to authenticated;

-- Verify denial, store isolation, revocation and projection before committing; fixtures roll back.
do $test$
declare owner_id uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();chef uuid:=gen_random_uuid();org uuid:=gen_random_uuid();s uuid:=gen_random_uuid();other_s uuid:=gen_random_uuid();recipe uuid:=gen_random_uuid();prep uuid:=gen_random_uuid();req uuid:=gen_random_uuid();out jsonb;perm jsonb:='{"RECIPE":{"view":true,"edit":false},"SUPPLIERS":{"view":true,"edit":false},"SPOT":{"view":true,"edit":false},"EQUIPMENT":{"view":true,"edit":true}}';before_count bigint;
begin
 begin
 select count(*) into before_count from public.count_entries;
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select u,u||'@data-access-test.invalid',now(),now(),now() from unnest(array[owner_id,staff,chef]) u;
 insert into public.profiles(id,display_name) select u,'權限回滾測試' from unnest(array[owner_id,staff,chef]) u on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type) values(org,'權限回滾測試','SINGLE_RESTAURANT');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(s,org,'BeApe','DA'||substr(s::text,1,8),owner_id),(other_s,org,'Gras','DA'||substr(other_s::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,owner_id,'OWNER',true,true),(org,staff,'STAFF',false,false),(org,chef,'SUPERVISOR',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,u,'權限回滾測試',owner_id from unnest(array[owner_id,staff,chef]) u;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(s,org,owner_id,'da-owner','OWNER','OWNER',owner_id,true),(s,org,staff,'da-staff','STAFF','STAFF',owner_id,false),(s,org,chef,'da-chef','SUPERVISOR','SUPERVISOR',owner_id,false);
 insert into private.recipe_cards(id,store_id,document,updated_by) values(recipe,s,'{"name":"測試主菜","kind":"dish","notes":"SECRET_RATIO","lines":[{"name":"SECRET_INGREDIENT","quantity":"999"}]}',owner_id),(prep,s,'{"name":"SECRET_PREP","kind":"prep","lines":[]}',owner_id);
 perform set_config('request.jwt.claim.sub',chef::text,true);
 assert not private.recipe_allowed(s),'supervisor is not implicit full-recipe permission';
 begin perform public.app_workspace(s,'recipes.field');raise exception 'ungranted recipe exposed';exception when sqlstate '42501' then null;end;
 begin perform public.app_workspace(s,'suppliers');raise exception 'ungranted suppliers exposed';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 out:=public.save_person_data_access(s,staff,perm,0,req);assert (out->>'saved')::boolean;
 assert public.save_person_data_access(s,staff,perm,0,req)=out,'idempotent grants';
 begin perform public.save_person_data_access(s,staff,'{}',0,req);raise exception 'replay payload changed';exception when sqlstate '23505' then null;end;
 begin perform public.save_person_data_access(s,staff,'{}',0,gen_random_uuid());raise exception 'stale permission revision accepted';exception when sqlstate '40001' then null;end;
 perform public.recipe_field_flow(s,recipe,'已確認可供現場使用的出餐步驟',0,gen_random_uuid());
 perform set_config('request.jwt.claim.sub',staff::text,true);
 out:=public.app_workspace(s,'recipes.field');assert jsonb_array_length(out->'recipes')=1;assert out::text like '%出餐步驟%';assert out::text not like '%SECRET%' and out::text not like '%cost%' and out::text not like '%lines%','only allowlisted workflow leaves server';
 begin perform public.app_workspace(s,'recipes.saved');raise exception 'full data leaked';exception when sqlstate '42501' then null;end;
 begin perform public.app_operation(s,'recipe.save','{}',gen_random_uuid());raise exception 'field full recipe edit';exception when sqlstate '42501' then null;end;
 begin perform public.app_workspace(other_s,'recipes.field');raise exception 'cross store leaked';exception when sqlstate '42501' then null;end;
 begin perform public.save_person_data_access(s,chef,perm,0,gen_random_uuid());raise exception 'staff grants escalated';exception when sqlstate '42501' then null;end;
 assert not (private.spot_check_caps(s)->>'operate')::boolean,'view only spot';
 assert private.has_data_access(s,'EQUIPMENT',true),'authorized repair edit';
 begin perform public.app_operation(s,'administrative.save','{"rows":[{"id":"00000000-0000-0000-0000-000000000001","name":"X","category":"合約文件"}]}',gen_random_uuid());raise exception 'equipment grant accessed contracts';exception when sqlstate '42501' then null;end;
 update public.store_memberships set access_mode='VIEW' where store_id=s and user_id=staff;
 assert not private.has_data_access(s,'EQUIPMENT',true),'read-only store denies edit';
 update public.store_memberships set access_mode='EDIT' where store_id=s and user_id=staff;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform public.save_person_data_access(s,staff,'{}',1,gen_random_uuid());
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.app_workspace(s,'recipes.field');raise exception 'revocation failed';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.app_workspace(s,'recipes.field');raise exception 'anonymous access';exception when sqlstate '42501' then null;end;
 assert not has_table_privilege('authenticated','private.recipe_field_flows','SELECT');
 assert not has_function_privilege('authenticated','private.app_workspace_before_data_access(uuid,text,jsonb)','EXECUTE');
 assert not has_function_privilege('anon','public.recipe_field_flow(uuid,uuid,text,integer,uuid)','EXECUTE');
 assert not private.has_data_access(gen_random_uuid(),'RECIPE'),'invalid store is denied';
 assert (select count(*) from public.count_entries)=before_count,'count format/data untouched';
 raise exception using errcode='ZX001',message='rollback permission fixtures';
 exception when sqlstate 'ZX001' then null;end;
end $test$;
