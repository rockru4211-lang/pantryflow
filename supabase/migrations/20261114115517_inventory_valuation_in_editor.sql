-- Persist the selected source and edits in a single inventory transaction.
create function public.save_baihuayuan_inventory_valuation(
 p_store_id uuid,p_month date,p_session_id uuid,p_row_key text,p_expected jsonb,p_choice jsonb,p_edit jsonb
) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare
 state jsonb; r jsonb; selected jsonb; raw jsonb; q jsonb; evidence jsonb;
 qty numeric; price numeric; rate numeric; kg numeric; original numeric; cutoff date;
 supplier_key text; product uuid; count_unit text; purchase_unit text; current_values jsonb;
 editing boolean:=p_edit is not null; desired_name text; desired_note text; saved_signature text;
 v_request_id uuid; request_payload jsonb; cached private.app_requests; result jsonb;
begin
 perform private.assert_store_editable(p_store_id);
 if auth.uid() is null or coalesce(private.app_role(p_store_id),'') not in ('LOGISTICS','OWNER')
  or not private.has_active_store_role(p_store_id,null) or not private.can_import_inventory(p_store_id)
 then raise exception 'INVENTORY_ADMIN_REQUIRED' using errcode='42501';end if;
 if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_choice) is distinct from 'object'
  or octet_length(p_choice::text)>4096 then raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;

 if editing then
  if jsonb_typeof(p_edit) is distinct from 'object' or octet_length(p_edit::text)>12000
   or jsonb_typeof(p_edit->'quantity') is distinct from 'number' then
   raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;
  v_request_id:=(p_edit->>'request_id')::uuid;
  if v_request_id is null then raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;
  request_payload:=jsonb_build_object('month',p_month,'session',p_session_id,'row_key',p_row_key,
   'expected',p_expected,'choice',p_choice,'edit',p_edit);
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||v_request_id::text,819));
  select * into cached from private.app_requests a where a.store_id=p_store_id and a.request_id=v_request_id;
  if found then
   if cached.actor_id<>auth.uid() or cached.action<>'inventory.valuation.edit' or cached.payload is distinct from request_payload then
    raise exception 'INVENTORY_REVISION_CHANGED' using errcode='40001';end if;
   return cached.result||jsonb_build_object('replayed',true);
  end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_month::text,819));
 perform 1 from public.inventory_count_sessions where id=p_session_id and store_id=p_store_id for update;
 if not found then raise exception 'INVENTORY_SOURCE_REQUIRED' using errcode='22023';end if;
 state:=private.inventory_month_state(p_store_id,p_month,p_session_id);
 if (state->>'closed')::boolean then raise exception 'INVENTORY_MONTH_CLOSED' using errcode='22023';end if;
 select value into r from jsonb_array_elements(state->'rows') where value->>'row_key'=p_row_key;
 if r is null or r->>'source_quantity' is null then raise exception 'INVENTORY_ROW_NOT_FOUND' using errcode='P0002';end if;
 cutoff:=(state->>'count_date')::date;
 qty:=case when editing then (p_edit->>'quantity')::numeric else (r->>'current_quantity')::numeric end;
 count_unit:=case when editing then btrim(p_edit->>'unit') else r->>'unit' end;
 desired_name:=case when editing then btrim(p_edit->>'name') else r->>'name' end;
 desired_note:=case when editing then btrim(coalesce(p_edit->>'note','')) else r->>'review_note' end;
 product:=(r->>'product_id')::uuid;
 q:=r->'inventory_cost_quote';
 selected:=p_choice->'quote';
 raw:=selected->'purchase';
 purchase_unit:=btrim(raw->>'unit');
 if jsonb_typeof(raw) is distinct from 'object' or not coalesce(qty>=0 and qty<1000000000,false)
  or (not editing and qty=0) or not coalesce(length(count_unit) between 1 and 40,false)
  or not coalesce(length(desired_name) between 1 and 160,false)
  or (selected->>'date' is not null and (selected->>'date')::date>cutoff)
 then raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;
 original:=private.cost_purchase_price(raw,purchase_unit);
 if original is null or original<0 or original>=1000000000 then
  raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;

 if p_choice->>'count_per_unit' is not null then
  rate:=(p_choice->>'count_per_unit')::numeric;
  if rate<=0 or rate>=1000000000 or private.recipe_unit(purchase_unit)=private.recipe_unit(count_unit)
   or p_choice->>'weight_kg' is not null then raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;
  price:=original/rate;
 elsif p_choice->>'weight_kg' is not null then
  kg:=(p_choice->>'weight_kg')::numeric;
  if qty<=0 or kg<=0 or kg>=1000000000 or private.recipe_unit(purchase_unit)<>'g'
   or private.recipe_unit(count_unit) in ('g','ml') then raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;
  price:=private.cost_purchase_price(raw,'公斤')*kg/qty;
 else
  price:=private.cost_purchase_price(raw,count_unit);
 end if;
 if price is null or price<0 or price>=1000000000 then raise exception 'INVALID_INVENTORY_VALUATION' using errcode='22023';end if;
 price:=round(price,10);
 evidence:=jsonb_strip_nulls(jsonb_build_object('purchase',raw,'source',left(selected->>'source',200),'date',selected->>'date',
  'supplier_name',left(selected->>'supplier_name',200),'reference_id',selected->>'reference_id','batch_id',selected->>'batch_id','specification',left(selected->>'specification',300),'conversion_rate',rate,'weight_kg',kg));
 current_values:=jsonb_build_object('name',r->'name','unit',r->'unit','quantity',r->'current_quantity','price',r->'unit_price','note',r->'review_note');
 if r->>'source_signature' is distinct from p_expected->>'source_signature' then
  raise exception 'INVENTORY_REVISION_CHANGED' using errcode='40001';end if;
 if not editing and r->>'unit_price' is not null then
  if (current_values-'price')=((p_expected->'values')-'price') and (r->>'unit_price')::numeric=price and (
   exists(select 1 from private.inventory_month_reviews v where v.store_id=p_store_id and v.month=p_month and v.session_id=p_session_id
    and v.row_key=p_row_key and v.price_set and v.source_signature=r->>'source_signature' and v.purchase_evidence=evidence)
   or (rate is not null and q->>'batch_id' is not null and (q->>'conversion_rate')::numeric=rate
    and q-'price'-'conversion_rate'=selected-'price'-'reason'-'conversion_rate')
  ) then return jsonb_build_object('saved',true,'replayed',true);end if;
  raise exception 'INVENTORY_REVISION_CHANGED' using errcode='40001';
 end if;
 if current_values is distinct from p_expected->'values' then
  raise exception 'INVENTORY_REVISION_CHANGED' using errcode='40001';end if;
 if coalesce((p_choice->>'automatic')::boolean,false) then
  if q is distinct from selected or count_unit is distinct from r->>'unit' then raise exception 'COST_QUOTE_CHANGED' using errcode='40001';end if;
 elsif not private.inventory_manual_source_exists(p_store_id,selected) then
  raise exception 'COST_QUOTE_CHANGED' using errcode='40001';
 end if;

 perform public.save_baihuayuan_inventory_inline_v3(p_store_id,p_month,p_session_id,p_row_key,p_expected,
  desired_name,count_unit,qty,price,desired_note);
 if editing then
  -- A matching numeric price can be a no-op for the row editor but still
  -- needs to record the newly selected source and mark it as explicit.
  state:=private.inventory_month_state(p_store_id,p_month,p_session_id);
  select x->>'source_signature' into saved_signature from jsonb_array_elements(state->'rows') x where x->>'row_key'=p_row_key;
  insert into private.inventory_month_reviews(store_id,month,session_id,row_key,source_signature,
   price_set,unit_price,note,reviewed_by,report_unit)
  values(p_store_id,p_month,p_session_id,p_row_key,saved_signature,true,price,desired_note,auth.uid(),nullif(count_unit,r->>'source_unit'))
  on conflict(store_id,month,session_id,row_key)
  do update set source_signature=excluded.source_signature,price_set=true,unit_price=excluded.unit_price;
 end if;
 if rate is not null and q=selected and q->>'batch_id' is not null then
  select private.inventory_supplier_key(s.organization_id,q->>'supplier_name') into supplier_key
  from public.stores s where s.id=p_store_id;
  if supplier_key is not null and private.inventory_spec_key(q->>'specification')<>'' then
   insert into private.inventory_unit_conversions(store_id,product_id,supplier_key,specification_key,purchase_unit,count_unit,effective_date,count_per_purchase_unit)
   values(p_store_id,product,supplier_key,private.inventory_spec_key(q->>'specification'),
    private.inventory_rate_unit(purchase_unit),private.inventory_rate_unit(count_unit),cutoff,rate)
   on conflict on constraint inventory_unit_conversions_pkey do nothing;
   if not exists(select 1 from private.inventory_unit_conversions c
    where c.store_id=p_store_id and c.product_id=product
     and c.supplier_key=private.inventory_supplier_key((select organization_id from public.stores where id=p_store_id),q->>'supplier_name')
     and c.specification_key=private.inventory_spec_key(q->>'specification')
     and c.purchase_unit=private.inventory_rate_unit(raw->>'unit')
     and c.count_unit=private.inventory_rate_unit(r->>'unit') and c.effective_date=cutoff and c.count_per_purchase_unit=rate)
    then raise exception 'COST_QUOTE_CHANGED' using errcode='40001';end if;
   update private.inventory_month_reviews set price_set=false,unit_price=null,purchase_evidence=null
   where store_id=p_store_id and month=p_month and session_id=p_session_id and row_key=p_row_key;
  end if;
 end if;
 update private.inventory_month_reviews set purchase_evidence=evidence
 where store_id=p_store_id and month=p_month and session_id=p_session_id and row_key=p_row_key and price_set;
 result:=jsonb_build_object('saved',true);
 if editing then
  insert into private.app_requests(store_id,request_id,actor_id,action,payload,result)
  values(p_store_id,v_request_id,auth.uid(),'inventory.valuation.edit',request_payload,result);
 end if;
 return result;
end
$$;
revoke all on function public.save_baihuayuan_inventory_valuation(uuid,date,uuid,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_baihuayuan_inventory_valuation(uuid,date,uuid,text,jsonb,jsonb,jsonb) to authenticated;

-- Keep the existing read-view action and older clients on the same save path.
create or replace function public.save_baihuayuan_inventory_valuation(
 p_store_id uuid,p_month date,p_session_id uuid,p_row_key text,p_expected jsonb,p_choice jsonb
) returns jsonb language sql set search_path='' as $$
 select public.save_baihuayuan_inventory_valuation(p_store_id,p_month,p_session_id,p_row_key,p_expected,p_choice,null::jsonb)
$$;
notify pgrst,'reload schema';
