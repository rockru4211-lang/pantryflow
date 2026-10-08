-- Resolve named supplier references to a unique scoped supplier identity.
create function private.ingredient_supplier_key_for_store(s uuid,ref jsonb) returns text
language plpgsql stable security definer set search_path='' as $$
declare supplier uuid;
begin
 if nullif(ref->>'supplier_id','') is not null then return private.ingredient_supplier_key(ref);end if;
 select min(p.id::text)::uuid into supplier from public.suppliers p join public.stores st on st.organization_id=p.organization_id
 where st.id=s and lower(btrim(normalize(p.name,NFKC)))=lower(btrim(normalize(ref->>'supplier_name',NFKC))) having count(*)=1;
 return coalesce('id:'||supplier,private.ingredient_supplier_key(ref));
end $$;
revoke all on function private.ingredient_supplier_key_for_store(uuid,jsonb) from public,anon,authenticated;
create or replace function private.ingredient_supply_read(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb; result jsonb;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 base:=private.ingredient_catalog(s);
 with refs as materialized (
 select distinct a.ingredient_id,r.id,r.name,private.recipe_unit(r.unit) unit,
 case when r.source_ref->>'missing_price'='true' then null else coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) end price,
 (r.store_id=s) can_apply,r.purchase,r.source,r.source_kind,r.review_status,r.effective_date,r.created_at,r.source_ref,
 private.ingredient_supplier_key_for_store(s,r.source_ref) supplier_key,coalesce(r.source_ref->>'supplier_name','') supplier_name
 from private.ingredient_aliases a join private.recipe_price_entries r on r.id=any(a.reference_ids)
 join public.stores rs on rs.id=r.store_id join public.stores ts on ts.id=a.store_id and ts.organization_id=rs.organization_id
 where a.store_id=s
 ), enriched as (
 select x.value||jsonb_build_object(
 'supplier_id',c.supplier_id,'supplier_name',coalesce(sp.name,selected.source_ref->>'supplier_name',''),
 'supplier_key',coalesce('id:'||c.supplier_id,private.ingredient_supplier_key_for_store(s,selected.source_ref),''),
 'sources',coalesce((select jsonb_agg(to_jsonb(r) order by r.effective_date desc nulls last,r.created_at desc) from refs r where r.ingredient_id=(x.value->>'id')::uuid),'[]'::jsonb),
 'dismissed_reference',c.dismissed_reference,'dismissed_value',c.dismissed_value
 ) value
 from jsonb_array_elements(base->'ingredients') x
 left join private.ingredient_price_choices c on c.store_id=s and c.ingredient_id=(x.value->>'id')::uuid
 left join public.suppliers sp on sp.id=c.supplier_id
 left join private.recipe_price_entries selected on selected.id=nullif(x.value->>'selected_reference','')::uuid
 ) select coalesce(jsonb_agg(value),'[]') into result from enriched;
 return base||jsonb_build_object('ingredients',result,
 'supply_states',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from private.ingredient_supply_state t where store_id=s),
 'supply_events',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('actor_name',coalesce((select display_name from public.profiles where id=t.actor_id),'使用者')) order by created_at desc),'[]') from private.ingredient_supply_events t where store_id=s),
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.name,'active',sp.is_active) order by sp.name),'[]') from public.suppliers sp join public.stores st on st.organization_id=sp.organization_id where st.id=s));
end $$;
create or replace function public.baihuayuan_ingredient_prices(p_store_id uuid,p_action text default 'read',p_data jsonb default '{}',p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.ingredient_masters; st private.ingredient_supply_state; prior private.app_requests; result jsonb; k text; nm text; ref private.recipe_price_entries; sp uuid; reason text; disposition text; note text; stopped boolean; actor uuid:=auth.uid();
begin
 if actor is null or not private.recipe_allowed(p_store_id) or not exists(select 1 from public.stores where id=p_store_id and name in ('BeApe','Gras')) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_action='read' then return private.ingredient_supply_read(p_store_id);end if;
 if not private.recipe_allowed(p_store_id,true) or private.store_access_mode(p_store_id) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if p_request_id is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('ingredient:'||p_store_id::text,0));
 select * into prior from private.app_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
 if prior.actor_id<>actor or prior.action<>'ingredient.hub.'||p_action or prior.payload<>p_data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
 return prior.result;end if;
 if nullif(p_data->>'id','') is not null then
 select * into m from private.ingredient_masters where store_id=p_store_id and id=(p_data->>'id')::uuid for update;
 if not found then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if m.revision is distinct from (p_data->>'revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 end if;
 if p_action='save' then
 sp:=nullif(p_data->>'supplier_id','')::uuid;
 if sp is not null and not exists(select 1 from public.suppliers p join public.stores s on s.organization_id=p.organization_id where s.id=p_store_id and p.id=sp) then raise exception 'INVALID_SUPPLIER_TARGET' using errcode='22023';end if;
 if m.id is not null and exists(select 1 from private.ingredient_supply_state t where t.store_id=p_store_id and t.ingredient_id=m.id and t.stopped and (t.supplier_key='*' or t.supplier_key='id:'||sp or exists(select 1 from public.suppliers p where p.id=sp and t.supplier_key=private.ingredient_supplier_key(jsonb_build_object('supplier_name',p.name))))) then raise exception 'SUPPLY_STOPPED_REVIEW_REQUIRED' using errcode='22023';end if;
 result:=private.ingredient_operation(p_store_id,'ingredient.save',p_data-'supplier_id',gen_random_uuid());
 insert into private.ingredient_price_choices(store_id,ingredient_id,supplier_id) values(p_store_id,(result->>'id')::uuid,sp)
 on conflict(store_id,ingredient_id) do update set supplier_id=excluded.supplier_id;
 elsif p_action='alias' then
 result:=private.ingredient_operation(p_store_id,'ingredient.alias',p_data,gen_random_uuid());
 elsif p_action in ('confirm','keep') then
 if m.id is null then raise exception 'INVALID_INGREDIENT' using errcode='22023';end if;
 select * into ref from private.recipe_price_entries where id=(p_data->>'reference_id')::uuid and store_id=p_store_id and review_status='confirmed';
 if ref.id is null or ref.source_ref->>'missing_price'='true' or private.recipe_unit(ref.unit)<>m.unit or not exists(select 1 from private.ingredient_aliases where store_id=p_store_id and ingredient_id=m.id and ref.id=any(reference_ids)) then raise exception 'INVALID_PRICE_REFERENCE' using errcode='22023';end if;
 if coalesce(ref.cost_price,ref.price)/private.recipe_factor(ref.unit) is distinct from (p_data->>'expected_price')::numeric then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 if exists(select 1 from private.ingredient_supply_state where store_id=p_store_id and ingredient_id=m.id and stopped and supplier_key in ('*',private.ingredient_supplier_key_for_store(p_store_id,ref.source_ref))) then raise exception 'SUPPLY_STOPPED_REVIEW_REQUIRED' using errcode='22023';end if;
 if p_action='confirm' then
 result:=private.ingredient_operation(p_store_id,'ingredient.save',jsonb_build_object('id',m.id,'revision',m.revision,'name',m.name,'unit',m.unit,'cost_price',coalesce(ref.cost_price,ref.price)/private.recipe_factor(ref.unit),'selected_reference',ref.id,'purchase',ref.purchase),gen_random_uuid());
 insert into private.ingredient_price_choices(store_id,ingredient_id,supplier_id) values(p_store_id,m.id,nullif(ref.source_ref->>'supplier_id','')::uuid) on conflict(store_id,ingredient_id) do update set supplier_id=excluded.supplier_id;
 else
 insert into private.ingredient_price_choices(store_id,ingredient_id,dismissed_reference,dismissed_value) values(p_store_id,m.id,ref.id,(p_data->>'expected_price')::numeric) on conflict(store_id,ingredient_id) do update set dismissed_reference=excluded.dismissed_reference,dismissed_value=excluded.dismissed_value;
 -- A conscious keep decision fixes the current standard price as well.
 update private.ingredient_masters set manual=true,revision=revision+1,updated_by=actor,updated_at=now() where id=m.id;
 result:=jsonb_build_object('id',m.id);end if;
 elsif p_action in ('stop','restore') then
 if m.id is null then raise exception 'INVALID_INGREDIENT' using errcode='22023';end if;
 k:=p_data->>'supplier_key';reason:=btrim(coalesce(p_data->>'reason',''));disposition:=btrim(coalesce(p_data->>'disposition',''));note:=btrim(coalesce(p_data->>'note',''));
 if nullif(k,'') is null or length(note)>3000 or length(reason)>100 or length(disposition)>100 then raise exception 'INVALID_SUPPLY_DECISION' using errcode='22023';end if;
 select * into st from private.ingredient_supply_state where store_id=p_store_id and ingredient_id=m.id and supplier_key=k for update;
 if coalesce(st.revision,0) is distinct from coalesce((p_data->>'supply_revision')::integer,0) then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 nm:=case when k='*' then '整項食材' else st.supplier_name end;
 if nm is null then
 select coalesce(r.source_ref->>'supplier_name','') into nm from private.ingredient_aliases a join private.recipe_price_entries r on r.id=any(a.reference_ids) where a.store_id=p_store_id and a.ingredient_id=m.id and private.ingredient_supplier_key_for_store(p_store_id,r.source_ref)=k limit 1;
 if nm is null and k like 'id:%' then select p.name into nm from public.suppliers p join public.stores s on s.organization_id=p.organization_id where s.id=p_store_id and 'id:'||p.id=k;end if;
 end if;
 if nm is null then raise exception 'INVALID_SUPPLIER_TARGET' using errcode='22023';end if;
 stopped:=p_action='stop';
 if stopped and (reason='' or disposition not in ('不建議再採購','可重新詢價','暫停使用')) then raise exception 'SUPPLY_REASON_REQUIRED' using errcode='22023';end if;
 if not stopped and (st.ingredient_id is null or not st.stopped or note='') then raise exception 'RESTORE_NOTE_REQUIRED' using errcode='22023';end if;
 -- Preserve the selected supplier's actual last quote, not another supplier's master price.
 if k<>'*' then
 select r.* into ref from private.ingredient_aliases a join private.recipe_price_entries r on r.id=any(a.reference_ids) where a.store_id=p_store_id and a.ingredient_id=m.id and private.ingredient_supplier_key_for_store(p_store_id,r.source_ref)=k order by r.effective_date desc nulls last,r.created_at desc limit 1;
 end if;
 insert into private.ingredient_supply_events(store_id,ingredient_id,supplier_key,supplier_name,action,reason,disposition,note,snapshot,actor_id)
 values(p_store_id,m.id,k,nm,p_action,case when stopped then reason else st.reason end,case when stopped then disposition else st.disposition end,note,case when ref.id is not null then to_jsonb(m)||jsonb_build_object('unit',private.recipe_unit(ref.unit),'cost_price',coalesce(ref.cost_price,ref.price)/private.recipe_factor(ref.unit),'purchase',ref.purchase) else to_jsonb(m) end,actor);
 insert into private.ingredient_supply_state(store_id,ingredient_id,supplier_key,supplier_name,stopped,reason,disposition,note,updated_by)
 values(p_store_id,m.id,k,nm,stopped,case when stopped then reason else st.reason end,case when stopped then disposition else st.disposition end,note,actor)
 on conflict(store_id,ingredient_id,supplier_key) do update set stopped=excluded.stopped,reason=excluded.reason,disposition=excluded.disposition,note=excluded.note,revision=ingredient_supply_state.revision+1,updated_at=now(),updated_by=actor;
 result:=jsonb_build_object('id',m.id,'supplier_key',k,'stopped',stopped);
 else raise exception 'INVALID_INGREDIENT_ACTION' using errcode='22023';end if;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,actor,'ingredient.hub.'||p_action,p_data,result);
 insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id)
 select organization_id,p_store_id,'ingredient_supply',result->>'id','ingredient.hub.'||p_action,to_jsonb(m),p_data||result,actor from public.stores where id=p_store_id;
 return result;
end $$;
notify pgrst,'reload schema';
