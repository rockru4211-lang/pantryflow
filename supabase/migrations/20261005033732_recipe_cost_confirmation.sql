-- Saved costs are immutable approvals; live prices remain a reviewable proposal.
create table if not exists private.recipe_cost_approvals (
 id uuid primary key default gen_random_uuid(),
 recipe_id uuid not null references private.recipe_cards(id),
 document jsonb not null, cost_snapshot jsonb not null,
 source_revision integer not null, actor_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 origin text not null check(origin in ('saved_version','confirmed'))
);
alter table private.recipe_cost_approvals enable row level security;
revoke all on private.recipe_cost_approvals from public,anon,authenticated;
create index if not exists recipe_cost_approvals_latest on private.recipe_cost_approvals(recipe_id,created_at desc,id);
-- Restore the exact latest saved version, including partial amounts and missing items.
-- Never select an unrelated older complete recipe or recompute historical values.
insert into private.recipe_cost_approvals(recipe_id,document,cost_snapshot,source_revision,actor_id,created_at,origin)
select r.id,v.document,v.cost_snapshot,v.revision,v.actor_id,v.created_at,'saved_version'
from private.recipe_cards r join private.recipe_versions v on v.recipe_id=r.id and v.revision=r.revision
where not exists(select 1 from private.recipe_cost_approvals a where a.recipe_id=r.id);
CREATE OR REPLACE FUNCTION private.recipe_workspace_live(s uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_prices jsonb; price_index jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 current_prices:=private.recipe_prices(s);
 select private.recipe_price_index(coalesce(jsonb_agg(p.value),'[]')) into price_index
 from jsonb_array_elements(current_prices) p
 where p.value->>'key' in (
 select case when nullif(l.value->>'ingredient_id','') is not null then 'i:'||(l.value->>'ingredient_id') when nullif(l.value->>'product_id','') is not null then 'p:'||(l.value->>'product_id') else 'n:'||lower(btrim(l.value->>'name')) end
 from private.recipe_cards c cross join lateral jsonb_array_elements(coalesce(c.document->'lines','[]')) l where c.store_id=s
 );
 return jsonb_build_object('can_price',private.recipe_allowed(s,true),
 'recipes',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('cost',private.recipe_cost_indexed(s,r.document,array[r.id],price_index)) order by updated_at desc),'[]') from private.recipe_cards r where store_id=s),
 'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'unit',p.base_unit,'specification',p.specification) order by p.name),'[]') from public.products p join public.stores st on st.organization_id=p.organization_id where st.id=s and p.is_active),
 'prices',current_prices,
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.name) order by sp.name),'[]') from public.suppliers sp join public.stores st on st.organization_id=sp.organization_id where st.id=s and sp.is_active),
 'price_references',(select coalesce(jsonb_agg(jsonb_build_object(
 'key',case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,
 'name',r.name,'product_id',r.product_id,'unit',private.recipe_unit(r.unit),'price',r.price/private.recipe_factor(r.unit),
 'cost_price',r.cost_price/private.recipe_factor(r.unit),'purchase',r.purchase,'source',r.source,'source_kind',r.source_kind,
 'source_ref',r.source_ref,'supplier_name',r.source_ref->>'supplier_name','reference_id',r.id,'effective_date',r.effective_date,
 'review_status',r.review_status,'created_at',r.created_at) order by r.effective_date desc nulls last,r.created_at desc),'[]')
 from private.recipe_price_entries r where r.store_id=s and (r.review_status='confirmed' or not exists(
 select 1 from private.recipe_price_entries c where c.store_id=s and c.review_status='confirmed' and c.source_ref->>'import_key'=r.source_ref->>'import_key'))),
 'price_candidates',(select coalesce(jsonb_agg(jsonb_build_object(
 'key',case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,
 'name',r.name,'product_id',r.product_id,'unit',private.recipe_unit(r.unit),'price',r.price/private.recipe_factor(r.unit),
 'purchase',r.purchase,'source',r.source,'source_kind',r.source_kind,'source_ref',r.source_ref,'reference_id',r.id,'effective_date',r.effective_date
 ) order by r.source_kind,r.effective_date desc nulls last),'[]') from private.recipe_price_entries r
 where r.store_id=s and r.review_status='pending' and not exists (
 select 1 from private.recipe_price_entries c where c.store_id=s and c.review_status='confirmed'
 and c.source_ref->>'import_key'=r.source_ref->>'import_key')));
end $function$
;


revoke all on function private.recipe_workspace_live(uuid) from public,anon,authenticated;
create or replace function private.recipe_workspace(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; cards jsonb;
begin
 result:=private.recipe_workspace_live(s); -- retains the existing authorization check
 select coalesce(jsonb_agg(c.value||jsonb_build_object(
  'proposed_cost',c.value->'cost','proposed_cost_token',md5((c.value->'cost')::text),
  'cost_history',(select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'at',h.created_at,'cost',h.cost_snapshot) order by h.created_at desc),'[]') from private.recipe_cost_approvals h where h.recipe_id=(c.value->>'id')::uuid),
  'approved_cost',case when a.id is null then null else jsonb_build_object('id',a.id,'document',a.document,'cost',a.cost_snapshot,'at',a.created_at,'origin',a.origin) end,
  'cost',case when a.document=c.value->'document' then a.cost_snapshot else c.value->'cost' end
 ) order by c.value->>'updated_at' desc),'[]') into cards
 from jsonb_array_elements(result->'recipes') c
 left join lateral(select * from private.recipe_cost_approvals where recipe_id=(c.value->>'id')::uuid order by created_at desc,id desc limit 1) a on true;
 return jsonb_set(result,'{recipes}',cards);
end $$;

create or replace function private.recipe_confirm_cost(s uuid,data jsonb,request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare card private.recipe_cards; prior private.app_requests; approved private.recipe_cost_approvals;
 current_cost jsonb; result jsonb; approval_id uuid;
begin
 if auth.uid() is null or not private.recipe_allowed(s,true) or private.store_access_mode(s) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if request is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('recipe:'||s::text,0));
 select * into prior from private.app_requests where store_id=s and request_id=request;
 if found then
  if prior.actor_id<>auth.uid() or prior.action<>'recipe.cost.confirm' or prior.payload<>data then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into card from private.recipe_cards where id=(data->>'id')::uuid and store_id=s for update;
 if card.id is null then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if card.revision is distinct from (data->>'revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 select * into approved from private.recipe_cost_approvals where recipe_id=card.id order by created_at desc,id desc limit 1;
 if approved.id is distinct from nullif(data->>'approval_id','')::uuid then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 current_cost:=private.recipe_cost(s,card.document,array[card.id]);
 if md5(current_cost::text) is distinct from data->>'expected_token' then raise exception 'COST_REVIEW_CHANGED: 價格或備料已異動，請重新查看後確認' using errcode='40001';end if;
 if jsonb_typeof(current_cost->'total') is distinct from 'number' then raise exception 'COST_INCOMPLETE: 請先補齊成本資料' using errcode='22023';end if;
 insert into private.recipe_cost_approvals(recipe_id,document,cost_snapshot,source_revision,actor_id,origin)
 values(card.id,card.document,current_cost,card.revision,auth.uid(),'confirmed') returning id into approval_id;
 result:=jsonb_build_object('id',card.id,'approval_id',approval_id,'cost',current_cost);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(s,request,auth.uid(),'recipe.cost.confirm',data,result);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
 select organization_id,'recipe',card.id::text,'recipe.cost.confirm',approved.cost_snapshot,current_cost,auth.uid() from public.stores where id=s;
 return result;
end $$;
revoke all on function private.recipe_confirm_cost(uuid,jsonb,uuid) from public,anon,authenticated;
create or replace function private.recipe_safe_operation(s uuid,action text,data jsonb,request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
 if not private.recipe_allowed(s,action='recipe.price') or private.store_access_mode(s) is distinct from 'EDIT' then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 if action='recipe.save' then
  for item in select value from jsonb_array_elements(coalesce(data->'document'->'lines','[]')) loop
   -- The browser cannot invent a price snapshot to bypass administrative pricing rights.
   if item ? 'transfer_prices' or item ? 'transfer_price_at' then
    if not exists(select 1 from private.recipe_cards r cross join lateral jsonb_array_elements(r.document->'lines') old where r.store_id=s and old.value->'transfer_prices'=item->'transfer_prices' and old.value->'transfer_price_at'=item->'transfer_price_at') then raise exception 'INVALID_TRANSFER_PRICE_SNAPSHOT' using errcode='22023';end if;
   end if;
  end loop;
 end if;
 if action='recipe.cost.confirm' then return private.recipe_confirm_cost(s,data,request);end if;
 return private.recipe_operation(s,action,data,request);
end $$;
revoke all on function private.recipe_safe_operation(uuid,text,jsonb,uuid) from public;
grant execute on function private.recipe_safe_operation(uuid,text,jsonb,uuid) to authenticated;


notify pgrst,'reload schema';
