-- Compute the header before INSERT; preserve the original-record immutability trigger.
do $$
declare src text;
begin
 select pg_get_functiondef('public.create_baihuayuan_direct_receipt(uuid,text,date,text,jsonb)'::regprocedure) into src;
 if position('  update public.goods_receipts' in src)=0 then raise exception 'DIRECT_RECEIPT_CONTRACT_CHANGED';end if;
 src:=replace(src,'  insert into public.goods_receipts(',
 $body$  select coalesce(sum((value->>'quantity')::numeric * nullif(value->>'unit_price','')::numeric),0), bool_and(nullif(value->>'unit_price','') is not null) into v_subtotal,v_all_priced from jsonb_array_elements(p_lines);
  insert into public.goods_receipts($body$);
 src:=replace(src,'null,null,null,auth.uid(),now(),v_batch','case when v_all_priced then v_subtotal else null end,null,case when v_all_priced then v_subtotal else null end,auth.uid(),now(),v_batch');
 src:=replace(src,'  update public.goods_receipts
  set subtotal_ex_tax=case when v_all_priced then v_subtotal else null end,
      total_inc_tax=case when v_all_priced then v_subtotal else null end
  where id=v_receipt;','');
 execute src;
end $$;
