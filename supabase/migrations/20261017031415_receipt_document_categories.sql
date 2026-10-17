-- Invoice-level classification. Do not derive from or overwrite item categories.
alter table private.receipt_account_edits add column receipt_categories text[] not null default '{}';
do $patch$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
 anchor:='''received_at'',(select received_at';
 if strpos(src,anchor)=0 then raise exception 'RECEIPT_CATEGORY_READ_ANCHOR';end if;
 src:=replace(src,anchor,$code$'receipt_categories',coalesce((select to_jsonb(classification.receipt_categories) from private.receipt_account_edits classification where classification.batch_id=a.id),'[]'::jsonb),
 'received_at',(select received_at$code$);execute src;
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='header:=p_data->''header'';lines:=p_data->''lines'';checked:=(p_data->>''checked'')::boolean;';
 if strpos(src,anchor)=0 then raise exception 'RECEIPT_CATEGORY_VALIDATE_ANCHOR';end if;
 src:=replace(src,anchor,anchor||$code$
 if p_data ? 'receipt_categories' then
  if jsonb_typeof(p_data->'receipt_categories') is distinct from 'array' then raise exception 'INVALID_RECEIPT_CATEGORY' using errcode='22023';end if;
  if jsonb_array_length(p_data->'receipt_categories')>20 or exists(select 1 from jsonb_array_elements(p_data->'receipt_categories') c where jsonb_typeof(c)<>'string' or length(btrim(c#>>'{}'))>40 or btrim(c#>>'{}')='') then raise exception 'INVALID_RECEIPT_CATEGORY' using errcode='22023';end if;
 end if;
 $code$);
 anchor:='review_completed_source=case when';
 if strpos(src,anchor)=0 then raise exception 'RECEIPT_CATEGORY_SAVE_ANCHOR';end if;
 src:=replace(src,anchor,$code$receipt_categories=case when p_data ? 'receipt_categories' then array(select distinct btrim(c) from jsonb_array_elements_text(p_data->'receipt_categories') c order by btrim(c)) else receipt_categories end,
 review_completed_source=case when$code$);execute src;
end $patch$;
notify pgrst,'reload schema';
