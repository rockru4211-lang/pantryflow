-- Additive receipt attribution. Raw OCR, posted receipts and existing stock history remain immutable.
create table private.receipt_custody_links (
 batch_id uuid not null references public.receipt_upload_batches(id), row_key text not null,
 store_id uuid not null references public.stores(id), run_id uuid,
 event_id uuid not null unique references private.custody_events(id),
 lot_id uuid not null references private.custody_lots(id), quantity numeric not null,
 unit text not null, receipt_date date not null,
 primary key(batch_id,row_key)
);
alter table private.receipt_custody_links enable row level security;
revoke all on private.receipt_custody_links from public,anon,authenticated;

create function private.receipt_handling_line(s uuid,b uuid,r uuid,l jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
 select l||case when k.event_id is null then '{}'::jsonb else jsonb_build_object(
 'custody_posted',true,'custody_event_id',k.event_id,'custody_lot_id',k.lot_id,
 'custody_reference',coalesce(nullif(c.reference,''),c.label)) end
 from (select 1) one left join private.receipt_custody_links k on k.store_id=s and k.batch_id=b and k.row_key=l->>'row_key'
 left join private.custody_lots c on c.id=k.lot_id
$$;
revoke all on function private.receipt_handling_line(uuid,uuid,uuid,jsonb) from public,anon,authenticated;

-- A saved release is not a new price; freight is not a stockable ingredient.
create function private.receipt_is_purchase_line(b uuid,r text) returns boolean
language sql stable security invoker set search_path='' as $$
 select not exists(select 1 from private.receipt_account_edits e
 where e.batch_id=b and e.run_id is not distinct from (select id from public.receipt_ocr_runs where batch_id=b order by version desc limit 1)
 and coalesce(e.line_values->r->>'handling','NORMAL') in ('FREIGHT','CUSTODY_RELEASE'))
$$;
revoke all on function private.receipt_is_purchase_line(uuid,text) from public,anon,authenticated;

-- Called inside the existing authorized, locked, atomic receipt save only.
create function private.receipt_link_custody(s uuid,b uuid,r uuid,h jsonb,lines jsonb,post boolean) returns void
language plpgsql security invoker set search_path='' as $$
declare l jsonb;k private.receipt_custody_links;a private.custody_accounts;lot private.custody_lots;
 ev private.custody_events;eid uuid;q numeric;ld date;existing uuid;
begin
 for l in select value from jsonb_array_elements(lines) loop
  select * into k from private.receipt_custody_links where batch_id=b and row_key=l->>'row_key';
  q:=private.receipt_account_number(l->>'quantity');ld:=private.receipt_account_date(h->>'receipt_date');
  if k.event_id is not null then
   if k.store_id<>s or coalesce(l->>'handling','NORMAL')<>'CUSTODY_RELEASE' or k.lot_id::text is distinct from l->>'custody_lot_id'
    or k.quantity is distinct from q or k.unit is distinct from l->>'unit' or k.receipt_date is distinct from ld
    or k.run_id is distinct from r then raise exception 'RECEIPT_CUSTODY_LOCKED' using errcode='22023';end if;
   continue;
  end if;
  if coalesce(l->>'handling','NORMAL')<>'CUSTODY_RELEASE' then continue;end if;
  if nullif(l->>'custody_lot_id','') is null then
   if post then raise exception 'CUSTODY_LOT_REQUIRED' using errcode='22023';end if;
   continue;
  end if;
  select * into lot from private.custody_lots where id=(l->>'custody_lot_id')::uuid;
  select * into a from private.custody_accounts where id=lot.account_id and store_id=s and kind='supplier';
  if a.id is null or a.unit is distinct from l->>'unit' or (nullif(l->>'product_id','') is not null and a.product_id::text<>l->>'product_id') then raise exception 'CUSTODY_INVALID' using errcode='22023';end if;
  if not post then continue;end if;
  if q is null or q<=0 or ld is null then raise exception 'CUSTODY_INVALID' using errcode='22023';end if;
  -- If this receipt already posted this item, do not post a second receipt via custody.
  if exists(select 1 from private.stock_postings p join public.receipt_lines rl on rl.id=p.source_id
   join public.goods_receipts g on g.id=rl.receipt_id where g.source_batch_id=b and p.store_id=s and rl.source_row_key=l->>'row_key')
   then raise exception 'CUSTODY_RECEIPT_ALREADY_POSTED' using errcode='22023';end if;
  existing:=nullif(l->>'custody_event_id','')::uuid;
  if existing is not null then
   select * into ev from private.custody_events where id=existing and store_id=s and lot_id=lot.id and action='collect';
   if ev.id is null or ev.quantity is distinct from q or ev.occurred_on is distinct from ld then raise exception 'CUSTODY_INVALID' using errcode='22023';end if;
   eid:=ev.id;
  else
   eid:=gen_random_uuid();
   perform private.baihuayuan_custody(s,'supplier','collect',jsonb_build_object('request_id',eid,'account_id',a.id,'revision',a.revision,
    'lot_id',lot.id,'quantity',q,'occurred_on',ld,'note','貨單寄庫領回：'||b||'／'||(l->>'row_key')));
  end if;
  insert into private.receipt_custody_links(batch_id,row_key,store_id,run_id,event_id,lot_id,quantity,unit,receipt_date)
   values(b,l->>'row_key',s,r,eid,lot.id,q,a.unit,ld);
 end loop;
end $$;
revoke all on function private.receipt_link_custody(uuid,uuid,uuid,jsonb,jsonb,boolean) from public,anon,authenticated;

do $migration$
declare src text;anchor text;
begin
 src:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
 anchor:='jsonb_agg(l.line||coalesce(b.line_values->l.row_key,''{}'') order by l.row_key)';
 if strpos(src,anchor)=0 then raise exception 'HANDLING_READ_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'jsonb_agg(private.receipt_handling_line(p_store,b.id,b.run_id,l.line||coalesce(b.line_values->l.row_key,''{}'')) order by l.row_key)');execute src;
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='q:=private.receipt_account_number(l->>''quantity'');';
 if strpos(src,anchor)=0 then raise exception 'HANDLING_SAVE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$code$
  -- Older clients must preserve attribution; absence does not mean NORMAL.
  if not (l ? 'handling') then
   l:=l||coalesce((select jsonb_build_object('handling',coalesce(x->>'handling','NORMAL'),
    'custody_lot_id',coalesce(x->>'custody_lot_id',''),'custody_event_id',coalesce(x->>'custody_event_id',''))
    from jsonb_array_elements(current_row->'lines') x where x->>'row_key'=l->>'row_key'),'{}');
  end if;
  if coalesce(l->>'handling','') not in ('NORMAL','FREIGHT','CUSTODY_RELEASE') then raise exception 'INVALID_RECEIPT_LINE' using errcode='22023';end if;
  if l->>'handling'='CUSTODY_RELEASE' then l:=l||jsonb_build_object('unit_price',null,'subtotal',0);end if;
  q:=private.receipt_account_number(l->>'quantity');$code$);
 src:=replace(src,'incomplete:=incomplete or q is null or price is null or subtotal is null',
  'incomplete:=incomplete or q is null or (l->>''handling''<>''CUSTODY_RELEASE'' and price is null) or subtotal is null');
 src:=replace(src,'''subtotal'',''category'',''note'') and value', '''subtotal'',''category'',''note'',''handling'',''custody_lot_id'',''custody_event_id'') and value');
 anchor:='fresh:=private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0;';
 if strpos(src,anchor)=0 then raise exception 'HANDLING_POST_ANCHOR_MISSING';end if;
 -- Effective persisted values, never client posting flags. Runs in this transaction.
 src:=replace(src,anchor,$code$
 perform private.receipt_link_custody(p_store_id,p_batch_id,nullif(current_row->>'run_id','')::uuid,header,
  (select jsonb_agg(x||coalesce(edits->(x->>'row_key'),'{}')) from jsonb_array_elements(current_row->'raw_lines') x),
  checked or coalesce((p_data->>'reviewed')::boolean,false));
 fresh:=private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0;$code$);
 execute src;
 -- Price candidates keep their previous acquisition cost, excluding non-purchase rows.
 src:=pg_get_functiondef('private.recipe_prices(uuid)'::regprocedure);
 -- The ingredient-master release wraps the acquisition-price function.
 -- Patch its preserved source instead of replacing the newer wrapper.
 if strpos(src,'private.recipe_prices_before_master(s)')>0 and to_regprocedure('private.recipe_prices_before_master(uuid)') is not null then
  src:=pg_get_functiondef('private.recipe_prices_before_master(uuid)'::regprocedure);
 end if;
 anchor:='where g.store_id=s and b.status::text=''COMPLETED''';
 if strpos(src,anchor)=0 then raise exception 'HANDLING_PRICE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,anchor||' and private.receipt_is_purchase_line(b.id,coalesce(l.source_row_key,''admin-direct-''||l.id))');execute src;
 -- Legacy confirmation must not create stock/products for attributed fee/release lines.
 src:=pg_get_functiondef('private.publish_receipt(uuid,uuid,boolean)'::regprocedure);
 anchor:='select * into strict b from public.receipt_upload_batches where id=p_batch;';
 if strpos(src,anchor)=0 then raise exception 'HANDLING_PUBLISH_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,anchor||$code$
 if exists(select 1 from private.receipt_account_edits e cross join lateral jsonb_each(e.line_values) x
  where e.batch_id=p_batch and e.run_id is not distinct from (select id from public.receipt_ocr_runs where batch_id=p_batch order by version desc limit 1)
  and x.value->>'handling' in ('FREIGHT','CUSTODY_RELEASE')) then
  raise exception 'RECEIPT_HANDLING_USE_REVIEW' using errcode='22023';end if;
 $code$);execute src;
end $migration$;
notify pgrst,'reload schema';
