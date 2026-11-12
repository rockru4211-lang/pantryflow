-- Expose source quotations independently from the inventory valuation.
create function private.inventory_purchase_label(p jsonb)
returns text language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p->'amount')='number' and jsonb_typeof(p->'quantity')='number'
  and nullif(btrim(p->>'unit'),'') is not null then
  case when (p->>'amount')::numeric>=0 and (p->>'quantity')::numeric>0 then
   concat('原進價 NT$ ',trim_scale((p->>'amount')::numeric),'／',
    case when (p->>'quantity')::numeric<>1 then trim_scale((p->>'quantity')::numeric)::text||' ' end,
    btrim(p->>'unit'))
  end
 end
$$;
revoke all on function private.inventory_purchase_label(jsonb) from public,anon,authenticated;

do $patch$
declare source text; anchor text;
begin
 source:=pg_get_functiondef('private.inventory_known_standard(uuid,uuid,text,date)'::regprocedure);
 anchor:=$old$'date',nullif(effective_date,date '0001-01-01'),'reference_id',snapshot->>'selected_reference')$old$;
 if strpos(source,anchor)=0 then raise exception 'INVENTORY_ORIGINAL_STANDARD_ANCHOR';end if;
 execute replace(source,anchor,$new$'date',nullif(effective_date,date '0001-01-01'),'reference_id',snapshot->>'selected_reference','purchase',snapshot->'purchase')$new$);

 source:=pg_get_functiondef('private.inventory_saved_purchase_quote(uuid,uuid,text,date)'::regprocedure);
 anchor:=$old$'reason','盤點單位待確認 · 原進價 NT$ '||trim_scale(raw_price)||'／'||(purchase->>'unit')) from raw)$old$;
 if strpos(source,anchor)=0 then raise exception 'INVENTORY_ORIGINAL_PURCHASE_ANCHOR';end if;
 execute replace(source,anchor,$new$'purchase',purchase,'reason',concat_ws(' · ','盤點單位待確認',private.inventory_purchase_label(purchase))) from raw)$new$);

 source:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
 anchor:=$old$'price_source',case when v.price_set then '本月已儲存價格' when v.cost_quote->>'price' is not null then concat_ws(' · ',v.cost_quote->>'source',v.cost_quote->>'date')$old$;
 if strpos(source,anchor)=0 then raise exception 'INVENTORY_ORIGINAL_REPORT_ANCHOR';end if;
 execute replace(source,anchor,$new$'price_purchase',case when not coalesce(v.price_set,false) then v.cost_quote->'purchase' end,
   'price_source',case when v.price_set then '本月已儲存價格' when v.cost_quote->>'price' is not null then concat_ws(' · ',v.cost_quote->>'source',v.cost_quote->>'date',private.inventory_purchase_label(v.cost_quote->'purchase'))$new$);
end
$patch$;
notify pgrst,'reload schema';
