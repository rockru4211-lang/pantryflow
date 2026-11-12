-- Preserve compatibility with the currently deployed mobile frontend while
-- publication awaits confirmation. Restore only the two prior public endpoints.
-- No draft, recipe, price or request rows are changed.
CREATE OR REPLACE FUNCTION public.save_mobile_recipe_trial(p_store_id uuid, p_id uuid, p_revision integer, p_document jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old private.mobile_recipe_trials; prior private.app_requests; m private.ingredient_masters; line jsonb; lines jsonb:='[]'; payload jsonb; doc jsonb; result jsonb; qty numeric; amount numeric; subtotal numeric:=0; missing integer:=0; portions numeric;
begin
 if not private.has_data_access(p_store_id,'RECIPE') or not private.can_edit_store(p_store_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_request_id is null or p_revision is null or p_revision<0 or jsonb_typeof(p_document) is distinct from 'object' or length(btrim(coalesce(p_document->>'name',''))) not between 1 and 160 or length(coalesce(p_document->>'notes',''))>4000 or jsonb_typeof(p_document->'lines') is distinct from 'array' then raise exception 'INVALID_TRIAL';end if;
 if jsonb_array_length(p_document->'lines') not between 1 and 100 or coalesce(p_document->>'portions','') !~ '^\d{1,6}(\.\d{1,3})?$' then raise exception 'INVALID_TRIAL';end if;
 portions:=(p_document->>'portions')::numeric;if portions<=0 then raise exception 'INVALID_TRIAL';end if;
 payload:=jsonb_build_object('id',p_id,'revision',p_revision,'document',p_document);
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_request_id::text,0));
 select * into prior from private.app_requests where store_id=p_store_id and request_id=p_request_id;
 if found then
  if prior.actor_id<>auth.uid() or prior.action<>'mobile.recipe-trial' or prior.payload<>payload then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;
  return prior.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
 select * into old from private.mobile_recipe_trials where id=p_id for update;
 if found and (old.store_id<>p_store_id or old.actor_id<>auth.uid()) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if coalesce(old.revision,0)<>p_revision then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 for line in select value from jsonb_array_elements(p_document->'lines') loop
  select * into m from private.ingredient_masters where id=(line->>'ingredient_id')::uuid and store_id=p_store_id and canonical_ingredient_id is null for share;
  if not found then raise exception 'INGREDIENT_UNAVAILABLE';end if;
  if (line->>'price_revision')::integer is distinct from m.revision then raise exception 'TRIAL_PRICE_CHANGED';end if;
  if coalesce(line->>'quantity','') !~ '^\d{1,9}(\.\d{1,6})?$' or length(coalesce(line->>'unit','')) not between 1 and 30 then raise exception 'INVALID_QUANTITY';end if;
  qty:=(line->>'quantity')::numeric; if qty<=0 then raise exception 'INVALID_QUANTITY';end if;
  amount:=null;
  if m.review_status='confirmed' and m.unit not in ('','待確認') and m.cost_price is not null and private.recipe_unit(line->>'unit')=private.recipe_unit(m.unit) then amount:=qty*private.recipe_factor(line->>'unit')/private.recipe_factor(m.unit)*m.cost_price;end if;
  if amount is null then missing:=missing+1;else subtotal:=subtotal+amount;end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('ingredient_id',m.id,'name',m.name,'quantity',line->>'quantity','unit',line->>'unit','price_revision',m.revision,'price',case when m.review_status='confirmed' and m.unit not in ('','待確認') then m.cost_price else null end,'price_unit',m.unit,'amount',amount));
 end loop;
 doc:=jsonb_build_object('name',btrim(p_document->>'name'),'notes',coalesce(p_document->>'notes',''),'portions',p_document->>'portions','lines',lines,'subtotal',subtotal,'missing',missing,'per_portion',case when missing=0 then subtotal/portions else null end);
 insert into private.mobile_recipe_trials(id,store_id,actor_id,document,revision) values(p_id,p_store_id,auth.uid(),doc,1) on conflict(id) do update set document=excluded.document,revision=private.mobile_recipe_trials.revision+1,updated_at=now() returning jsonb_build_object('id',id,'document',document,'revision',revision,'updated_at',updated_at,'own',true) into result;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store_id,p_request_id,auth.uid(),'mobile.recipe-trial',payload,result);
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.mobile_recipe_workspace(p_store_id uuid, p_section text DEFAULT 'recipes'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if not private.has_data_access(p_store_id,'RECIPE') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_section='recipes' then
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',case when c.document->>'name' in ('出餐','成品','出餐菜色') then coalesce(nullif(c.document->>'source_name',''),c.document->>'name') else c.document->>'name' end,
   'season',c.document->'season','lifecycle',c.document->'lifecycle','source_status',c.document->'source_status','source_sheet_hidden',c.document->'source_sheet_hidden','menu_ids',c.document->'menu_ids','kind',c.document->>'kind','yield',c.document->>'yield','unit',c.document->>'unit','notes',c.document->>'notes','steps',coalesce(f.steps,''),
   'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l->>'id','name',l->>'name','quantity',l->>'quantity','unit',l->>'unit','recipe_id',l->>'recipe_id','note',l->>'note') order by n) from jsonb_array_elements(coalesce(c.document->'lines','[]')) with ordinality as a(l,n)),'[]')) order by c.document->>'name'),'[]') into result
  from private.recipe_cards c left join private.recipe_field_flows f on f.recipe_id=c.id where c.store_id=p_store_id;
  return jsonb_build_object('recipes',result,'menus',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'state',m.state,'revision',m.revision)),'[]') from private.recipe_menus m where m.store_id=p_store_id));
 elsif p_section='prices' then
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.unit,'price',case when m.review_status='confirmed' and m.unit not in ('','待確認') then m.cost_price else null end,'revision',m.revision,
   'aliases',coalesce((select string_agg(a.name,' ') from private.ingredient_aliases a where a.store_id=p_store_id and a.ingredient_id=m.id),'')) order by m.name),'[]') into result from private.ingredient_masters m where m.store_id=p_store_id and m.canonical_ingredient_id is null;
  return jsonb_build_object('prices',result);
 elsif p_section='trials' then
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'document',t.document,'revision',t.revision,'updated_at',t.updated_at,'own',t.actor_id=auth.uid()) order by t.updated_at desc),'[]') into result from private.mobile_recipe_trials t where t.store_id=p_store_id and (t.actor_id=auth.uid() or private.office_data_access(p_store_id));
  return jsonb_build_object('trials',result);
 end if;
 raise exception 'INVALID_SECTION';
end $function$
;
notify pgrst,'reload schema';
