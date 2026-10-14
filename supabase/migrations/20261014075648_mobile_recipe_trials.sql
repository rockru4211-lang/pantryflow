-- Mobile reading and exploratory drafts are separate from formal recipes and approvals.
create table private.mobile_recipe_trials (
 id uuid primary key, store_id uuid not null references public.stores(id),
 actor_id uuid not null references auth.users(id), document jsonb not null,
 revision integer not null default 1, updated_at timestamptz not null default now()
);
create index mobile_recipe_trials_store on private.mobile_recipe_trials(store_id,updated_at desc);
alter table private.mobile_recipe_trials enable row level security;
revoke all on private.mobile_recipe_trials from public,anon,authenticated;

create function public.mobile_recipe_workspace(p_store_id uuid,p_section text default 'recipes') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.has_data_access(p_store_id,'RECIPE') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_section='recipes' then
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',case when c.document->>'name' in ('出餐','成品','出餐菜色') then coalesce(nullif(c.document->>'source_name',''),c.document->>'name') else c.document->>'name' end,
   'kind',c.document->>'kind','yield',c.document->>'yield','unit',c.document->>'unit','notes',c.document->>'notes','steps',coalesce(f.steps,''),
   'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l->>'id','name',l->>'name','quantity',l->>'quantity','unit',l->>'unit','recipe_id',l->>'recipe_id','note',l->>'note') order by n) from jsonb_array_elements(coalesce(c.document->'lines','[]')) with ordinality as a(l,n)),'[]')) order by c.document->>'name'),'[]') into result
  from private.recipe_cards c left join private.recipe_field_flows f on f.recipe_id=c.id where c.store_id=p_store_id and coalesce(c.document->>'lifecycle','')<>'archived';
  return jsonb_build_object('recipes',result);
 elsif p_section='prices' then
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.unit,'price',case when m.review_status='confirmed' and m.unit not in ('','待確認') then m.cost_price else null end,'revision',m.revision,
   'aliases',coalesce((select string_agg(a.name,' ') from private.ingredient_aliases a where a.store_id=p_store_id and a.ingredient_id=m.id),'')) order by m.name),'[]') into result from private.ingredient_masters m where m.store_id=p_store_id and m.canonical_ingredient_id is null;
  return jsonb_build_object('prices',result);
 elsif p_section='trials' then
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'document',t.document,'revision',t.revision,'updated_at',t.updated_at,'own',t.actor_id=auth.uid()) order by t.updated_at desc),'[]') into result from private.mobile_recipe_trials t where t.store_id=p_store_id and (t.actor_id=auth.uid() or private.office_data_access(p_store_id));
  return jsonb_build_object('trials',result);
 end if;
 raise exception 'INVALID_SECTION';
end $$;

create function public.save_mobile_recipe_trial(p_store_id uuid,p_id uuid,p_revision integer,p_document jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function public.mobile_recipe_workspace(uuid,text),public.save_mobile_recipe_trial(uuid,uuid,integer,jsonb,uuid) from public,anon;
grant execute on function public.mobile_recipe_workspace(uuid,text),public.save_mobile_recipe_trial(uuid,uuid,integer,jsonb,uuid) to authenticated;

-- Isolated fixtures; the subtransaction always rolls back, preserving real records.
do $test$
declare owner_id uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();chef uuid:=gen_random_uuid();org uuid:=gen_random_uuid();s uuid:=gen_random_uuid();other_s uuid:=gen_random_uuid();recipe uuid:=gen_random_uuid();ingredient uuid:=gen_random_uuid();missing_id uuid:=gen_random_uuid();trial uuid:=gen_random_uuid();req uuid:=gen_random_uuid();out jsonb;doc jsonb;baseline text;after_hash text;
begin
 select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by c.id),'')) into baseline from private.recipe_cards c;
 begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select u,u||'@data-access-test.invalid',now(),now(),now() from unnest(array[owner_id,staff,chef]) u;
 insert into public.profiles(id,display_name) select u,'權限回滾測試' from unnest(array[owner_id,staff,chef]) u on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type) values(org,'權限回滾測試','SINGLE_RESTAURANT');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(s,org,'BeApe','DA'||substr(s::text,1,8),owner_id),(other_s,org,'Gras','DA'||substr(other_s::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,owner_id,'OWNER',true,true),(org,staff,'STAFF',false,false),(org,chef,'SUPERVISOR',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,u,'權限回滾測試',owner_id from unnest(array[owner_id,staff,chef]) u;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(s,org,owner_id,'da-owner','OWNER','OWNER',owner_id,true),(s,org,staff,'da-staff','STAFF','STAFF',owner_id,false),(s,org,chef,'da-chef','SUPERVISOR','SUPERVISOR',owner_id,false);

 insert into private.recipe_cards(id,store_id,document,updated_by) values(recipe,s,'{"name":"手機閱讀測試","kind":"dish","notes":"製作備註","lines":[{"name":"米","quantity":"100","unit":"g"}]}',owner_id);
 insert into private.ingredient_masters(id,store_id,name,unit,cost_price,review_status) values(ingredient,s,'測試米','g',0.1,'confirmed'),(missing_id,s,'待補食材','g',null,'pending');
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.save_person_data_access(s,staff,'{"RECIPE":{"view":true,"edit":false}}',0,gen_random_uuid());
 perform set_config('request.jwt.claim.sub',chef::text,true);
 begin perform public.mobile_recipe_workspace(s);raise exception 'ungranted read';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub',staff::text,true);
 out:=public.mobile_recipe_workspace(s);
 assert out::text like '%製作備註%' and out::text like '%quantity%','materials available';
 assert out::text not like '%cost_price%' and out::text not like '%approved_cost%','no formal costs';
 begin perform public.app_workspace(s,'recipes.saved');raise exception 'formal read widened';exception when sqlstate '42501' then null;end;
 begin perform public.app_operation(s,'recipe.save','{}',gen_random_uuid());raise exception 'formal write widened';exception when sqlstate '42501' then null;end;
 begin perform public.mobile_recipe_workspace(other_s);raise exception 'cross store read';exception when sqlstate '42501' then null;end;
 doc:=jsonb_build_object('name','試算測試','portions','2','notes','','lines',jsonb_build_array(jsonb_build_object('ingredient_id',ingredient,'price_revision',1,'quantity','0.5','unit','公斤','price',999)));
 out:=public.save_mobile_recipe_trial(s,trial,0,doc,req);
 assert (out#>>'{document,subtotal}')::numeric=50 and (out#>>'{document,per_portion}')::numeric=25,'server authoritative conversion';
 assert public.save_mobile_recipe_trial(s,trial,0,doc,req)=out,'idempotent retries';
 assert (select count(*) from private.mobile_recipe_trials where id=trial)=1;
 begin perform public.save_mobile_recipe_trial(s,trial,0,doc||'{"name":"changed"}',req);raise exception 'request reuse';exception when sqlstate '23505' then null;end;
 begin perform public.save_mobile_recipe_trial(s,trial,0,doc,gen_random_uuid());raise exception 'stale write';exception when sqlstate '40001' then null;end;
 update private.ingredient_masters set revision=2 where id=ingredient;
 begin perform public.save_mobile_recipe_trial(s,trial,1,doc,gen_random_uuid());raise exception 'stale quote accepted';exception when others then if sqlerrm<>'TRIAL_PRICE_CHANGED' then raise;end if;end;
 doc:=jsonb_set(doc,'{lines,0,price_revision}','2');
 doc:=jsonb_set(doc,'{lines}',(doc->'lines')||jsonb_build_array(jsonb_build_object('ingredient_id',missing_id,'price_revision',1,'quantity','10','unit','g')));
 out:=public.save_mobile_recipe_trial(s,trial,1,doc,gen_random_uuid());
 assert (out#>>'{document,missing}')::int=1 and out#>'{document,per_portion}'='null'::jsonb,'missing price not zero';
 begin perform public.save_mobile_recipe_trial(s,gen_random_uuid(),0,jsonb_set(doc,'{lines,0,ingredient_id}',to_jsonb(gen_random_uuid())),gen_random_uuid());raise exception 'foreign ingredient';exception when others then if sqlerrm<>'INGREDIENT_UNAVAILABLE' then raise;end if;end;
 update public.store_memberships set access_mode='VIEW' where store_id=s and user_id=staff;
 begin perform public.save_mobile_recipe_trial(s,trial,2,doc,gen_random_uuid());raise exception 'readonly write';exception when sqlstate '42501' then null;end;
 update public.store_memberships set access_mode='EDIT' where store_id=s and user_id=staff;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 assert jsonb_array_length(public.mobile_recipe_workspace(s,'trials')->'trials')=1,'office reviews';
 begin perform public.save_mobile_recipe_trial(s,trial,2,doc,gen_random_uuid());raise exception 'other actor edit';exception when sqlstate '42501' then null;end;
 perform public.save_person_data_access(s,chef,'{"RECIPE":{"view":true,"edit":false}}',0,gen_random_uuid());
 perform set_config('request.jwt.claim.sub',chef::text,true);
 assert jsonb_array_length(public.mobile_recipe_workspace(s,'trials')->'trials')=0,'field drafts private';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.save_person_data_access(s,staff,'{}',1,gen_random_uuid());
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.save_mobile_recipe_trial(s,trial,0,doc,req);raise exception 'revoked replay';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.mobile_recipe_workspace(s);raise exception 'anonymous read';exception when sqlstate '42501' then null;end;
 assert not has_table_privilege('authenticated','private.mobile_recipe_trials','SELECT');
 assert not has_function_privilege('anon','public.mobile_recipe_workspace(uuid,text)','EXECUTE');
 raise exception using errcode='ZX001',message='rollback mobile trial fixtures';
 exception when sqlstate 'ZX001' then null;end;
 select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by c.id),'')) into after_hash from private.recipe_cards c;
 assert baseline=after_hash,'formal recipes unchanged';
 assert not exists(select 1 from private.mobile_recipe_trials where id=trial),'fixtures rolled back';
end $test$;
