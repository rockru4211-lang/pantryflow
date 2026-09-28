-- Preserve existing grants/store guards while fixing the ambiguous local name.
do $migration$
declare src text;
begin
 select pg_get_functiondef('public.save_pilot_receipt_review(uuid,text,uuid)'::regprocedure) into src;
 if strpos(src,'select organization_id,store_name into org,store_name')=0 then raise exception 'RECEIPT_SAVE_ANCHOR_MISSING';end if;
 src:=replace(src,'select organization_id,store_name into org,store_name','select b.organization_id,b.store_name into org,store_name');
 src:=replace(src,'from public.receipt_upload_batches where id=p_batch_id','from public.receipt_upload_batches b where b.id=p_batch_id');
 execute src;
 select pg_get_functiondef('public.correct_pilot_receipt_field(uuid,jsonb)'::regprocedure) into src;
 if strpos(src,'select b.store_id from public.receipt_ocr_fields f join public.receipt_upload_batches b on b.id=f.batch_id where f.id=p_field_id')=0 then raise exception 'RECEIPT_FIELD_GUARD_ANCHOR_MISSING';end if;
 src:=replace(src,'select b.store_id from public.receipt_ocr_fields f join public.receipt_upload_batches b on b.id=f.batch_id where f.id=p_field_id','select scope_batch.store_id from public.receipt_ocr_fields scope_field join public.receipt_upload_batches scope_batch on scope_batch.id=scope_field.batch_id where scope_field.id=p_field_id');
 execute src;
 -- Explicit row acknowledgement uses the existing atomic CAS and operation retry key.
 select pg_get_functiondef('private.receipt_edit_card(uuid,jsonb)'::regprocedure) into src;
 if strpos(src,$anchor$if change->'old' is distinct from change->'value' then$anchor$)=0 then raise exception 'RECEIPT_EDIT_ANCHOR_MISSING';end if;
 src:=replace(src,$anchor$if change->'old' is distinct from change->'value' then$anchor$, $replace$if change->'old' is distinct from change->'value' or coalesce((d->>'acknowledge')::boolean,false) and exists(select 1 from private.receipt_effective_fields(current_run) ef where ef.id=(change->>'id')::uuid and not ef.corrected and ef.review_status<>'TRUSTED') then$replace$);
 execute src;
 -- Resolve new products before selecting them, so the next SQL statement sees
 -- the inserted row (including when the product table was initially empty).
 select pg_get_functiondef('private.publish_receipt(uuid,uuid,boolean)'::regprocedure) into src;
 if strpos(src,'product public.products;')=0 then raise exception 'RECEIPT_PRODUCT_ANCHOR_MISSING';end if;
 src:=replace(src,'product public.products;','product public.products; resolved_product uuid;');
 src:=regexp_replace(src,'select \* into product\s+from public.products\s+where id=private.baihuayuan_resolve_receipt_product\(([^;]+)\);',E'resolved_product:=private.baihuayuan_resolve_receipt_product(\\1);\n select p.* into product from public.products p where p.id=resolved_product;','g');
 execute src;
end $migration$;

create function private.baihuayuan_receipt_review_state(p_batch uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare b public.receipt_upload_batches; r uuid; fs jsonb; ms jsonb; ls jsonb; maps jsonb; row_data record; f jsonb; vals jsonb; issues jsonb; flags jsonb:='{}'; published boolean; q numeric; price numeric; subtotal numeric; tax numeric; total numeric;
begin
 select * into strict b from public.receipt_upload_batches where id=p_batch;
 select id into r from public.receipt_ocr_runs where batch_id=p_batch order by version desc limit 1;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') into fs from private.receipt_effective_fields(r) e;
 select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') into ms from private.receipt_manual_rows m where m.batch_id=p_batch and m.run_id=r and m.deleted_at is null;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.row_key),'[]') into ls from private.receipt_line_decisions d where d.batch_id=p_batch and d.run_id=r;
 select coalesce(jsonb_agg(to_jsonb(m) order by m.row_key),'[]') into maps from public.receipt_product_mappings m where m.batch_id=p_batch;
 published:=b.status='COMPLETED' or exists(select 1 from public.goods_receipts where source_batch_id=p_batch);
 if not published then
  for row_data in select a->>'row_key' as row_key,jsonb_agg(a) as fields from jsonb_array_elements(fs) a group by a->>'row_key' loop
   if row_data.row_key<>'document' and not private.baihuayuan_receipt_line_included(p_batch,r,row_data.row_key) then continue;end if;
   select jsonb_object_agg(a->>'field_name',a->'value') into vals from jsonb_array_elements(row_data.fields) a;
   issues:='[]';
   for f in select value from jsonb_array_elements(row_data.fields) loop
    if not coalesce((f->>'corrected')::boolean,false) and f->>'review_status'<>'TRUSTED' and f->'value' is not null and f->'value' not in ('null'::jsonb,'""'::jsonb) then
     issues:=issues||jsonb_build_array(case f->>'field_name' when 'product' then '品名需核對' when 'quantity' then '數量需核對' when 'unit' then '單位需核對' when 'unit_price_ex_tax' then '單價需核對' when 'supplier_name' then '供應商需核對' when 'receipt_date' then '日期需核對' when 'specification' then '規格需核對' else '原單欄位需核對' end);
    end if;
   end loop;
   if row_data.row_key='document' then
    if nullif(btrim(vals->>'supplier_name'),'') is null then issues:=issues||'"供應商未辨識"'::jsonb;
    elsif private.supplier_identity(b.organization_id,vals->>'supplier_name') is null then issues:=issues||'"供應商名稱未確認"'::jsonb;end if;
    begin if nullif(vals->>'receipt_date','') is null then raise invalid_datetime_format;end if;perform (vals->>'receipt_date')::date;exception when others then issues:=issues||'"日期需修正"'::jsonb;end;
   else
    if nullif(btrim(vals->>'product'),'') is null then issues:=issues||'"品名未辨識"'::jsonb;end if;
    if nullif(btrim(vals->>'unit'),'') is null then issues:=issues||'"單位未辨識"'::jsonb;end if;
    q:=null;price:=null;subtotal:=null;
    if coalesce(vals->>'quantity','') ~ '^[0-9]+([.][0-9]+)?$' then q:=(vals->>'quantity')::numeric;end if;
    if q is null or q<=0 then issues:=issues||'"數量需補正"'::jsonb;end if;
    if coalesce(vals->>'unit_price_ex_tax','') ~ '^[0-9]+([.][0-9]+)?$' then price:=(vals->>'unit_price_ex_tax')::numeric;
    elsif vals->>'unit_price_ex_tax' is not null then issues:=issues||'"單價需補正"'::jsonb;end if;
    if coalesce(vals->>'subtotal_ex_tax','') ~ '^[0-9]+([.][0-9]+)?$' then subtotal:=(vals->>'subtotal_ex_tax')::numeric;end if;
    if q is not null and price is not null and subtotal is not null and abs(q*price-subtotal)>greatest(1,abs(subtotal)*0.01) then issues:=issues||'"數量與小計不符"'::jsonb;end if;
   end if;
   flags:=flags||jsonb_build_object(row_data.row_key,(select coalesce(jsonb_agg(distinct a),'[]') from jsonb_array_elements(issues) a));
  end loop;
  select jsonb_object_agg(a->>'field_name',a->'value') into vals from jsonb_array_elements(fs) a where a->>'row_key'='document';
  begin
   subtotal:=(vals->>'subtotal_ex_tax')::numeric;tax:=(vals->>'tax')::numeric;total:=(vals->>'total_inc_tax')::numeric;
   if subtotal is not null and tax is not null and total is not null and abs(subtotal+tax-total)>1 then flags:=jsonb_set(flags,'{document}',coalesce(flags->'document','[]')||'"未稅、稅額與含稅合計不符"'::jsonb);end if;
  exception when invalid_text_representation then flags:=jsonb_set(flags,'{document}',coalesce(flags->'document','[]')||'"原單金額需補正"'::jsonb);end;
 end if;
 return jsonb_build_object('run_id',r,'published',published,'issues',flags,'manual_lines',ms,'revision',md5(jsonb_build_object('run',r,'fields',fs,'manual',ms,'decisions',ls,'mappings',maps)::text));
end $$;
revoke all on function private.baihuayuan_receipt_review_state(uuid) from public,anon,authenticated;

create function private.baihuayuan_receipt_detail_ledger(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb; output jsonb:='[]'; states jsonb:='{}'; s jsonb; row_data jsonb; b record; manual jsonb;
begin
 -- Existing reader enforces the same role, membership, session and store scope.
 base:=public.get_pilot_receipt_ledger(p_store);
 for b in select rb.id,rb.uploaded_at from public.receipt_upload_batches rb where rb.store_id=p_store and rb.group_mode<>'ADMIN_DIRECT' and private.can_read_receipt(rb.id) and not exists(select 1 from private.receipt_duplicate_links d where d.batch_id=rb.id) loop
  s:=private.baihuayuan_receipt_review_state(b.id);states:=states||jsonb_build_object(b.id::text,s);
  for manual in select value from jsonb_array_elements(s->'manual_lines') loop
   base:=base||jsonb_build_array(jsonb_build_object('batch_id',b.id,'run_id',s->>'run_id','row_key','manual-'||(manual->>'id'),'uploaded_at',b.uploaded_at,
    'receipt_date',(select value#>>'{}' from private.receipt_effective_fields((s->>'run_id')::uuid) where row_key='document' and field_name='receipt_date'),
    'supplier_name',manual->>'supplier_name','product_name',manual->>'product_name','specification',manual->>'specification','unit',manual->>'unit','quantity',manual->'quantity','unit_price',manual->'unit_price_ex_tax','subtotal',manual->'line_subtotal_ex_tax','status','PENDING','review_allowed',private.can_review_receipt(b.id),'source_kind','OCR'));
  end loop;
 end loop;
 for row_data in select value from jsonb_array_elements(base) loop
  s:=states->(row_data->>'batch_id');
  output:=output||jsonb_build_array(row_data||jsonb_build_object('status',case when s is null then row_data->>'status' when (s->>'published')::boolean then 'COMPLETE' else 'PENDING' end,
   'issues',coalesce(s->'issues'->(row_data->>'row_key'),'[]'),'document_issues',coalesce(s->'issues'->'document','[]'),'review_revision',s->>'revision'));
 end loop;
 return coalesce((select jsonb_agg(a order by a->>'receipt_date' desc,a->>'uploaded_at' desc,a->>'row_key') from jsonb_array_elements(output) a),'[]');
end $$;
revoke all on function private.baihuayuan_receipt_detail_ledger(uuid) from public,anon;
grant execute on function private.baihuayuan_receipt_detail_ledger(uuid) to authenticated;
create function public.get_baihuayuan_receipt_detail_ledger(p_store_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.baihuayuan_receipt_detail_ledger(p_store_id)$$;
revoke all on function public.get_baihuayuan_receipt_detail_ledger(uuid) from public,anon;
grant execute on function public.get_baihuayuan_receipt_detail_ledger(uuid) to authenticated;

create function private.confirm_baihuayuan_receipt_details(p_store uuid,p_batch uuid,p_run uuid,p_revision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb; row_data record;
begin
 perform private.assert_store_editable(p_store);
 if auth.uid() is null or not private.can_review_receipt(p_batch) or not exists(select 1 from public.receipt_upload_batches where id=p_batch and store_id=p_store and store_name in ('BeApe','Gras')) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_batch::text,0));
 s:=private.baihuayuan_receipt_review_state(p_batch);
 if (s->>'published')::boolean then return jsonb_build_object('complete',true);end if;
 if (s->>'run_id')::uuid is distinct from p_run then raise exception 'OCR_VERSION_CHANGED' using errcode='40001';end if;
 if s->>'revision' is distinct from p_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 if exists(select 1 from jsonb_each(s->'issues') a where jsonb_array_length(a.value)>0) then raise exception 'RECEIPT_REVIEW_REQUIRED' using errcode='22023';end if;
 for row_data in select distinct f.row_key from public.receipt_ocr_fields f where f.ocr_run_id=p_run and f.row_key<>'document' and private.baihuayuan_receipt_line_included(p_batch,p_run,f.row_key) loop
  perform public.save_pilot_receipt_review(p_batch,row_data.row_key,p_run);
 end loop;
 return public.complete_baihuayuan_receipt(p_store,p_batch,p_run);
end $$;
revoke all on function private.confirm_baihuayuan_receipt_details(uuid,uuid,uuid,text) from public,anon;
grant execute on function private.confirm_baihuayuan_receipt_details(uuid,uuid,uuid,text) to authenticated;
create function public.confirm_baihuayuan_receipt_details(p_store_id uuid,p_batch_id uuid,p_run_id uuid,p_revision text) returns jsonb language sql security invoker set search_path='' as $$select private.confirm_baihuayuan_receipt_details(p_store_id,p_batch_id,p_run_id,p_revision)$$;
revoke all on function public.confirm_baihuayuan_receipt_details(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.confirm_baihuayuan_receipt_details(uuid,uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
