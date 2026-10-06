-- A stale user draft is an HTTP conflict, not a transient serialization failure.
-- PostgREST 14 retries SQLSTATE 40001 inside a single request indefinitely.
-- Preserve each installed function's authorization, audit and idempotency body.
do $$
declare target regprocedure; definition text; changed text;
begin
 foreach target in array array[
  'public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure,
  'public.save_baihuayuan_receipt_reconciliation(uuid,uuid,jsonb,uuid)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(target);
  changed:=replace(definition, 'errcode=''40001''', 'errcode=''PT409''');
  if changed=definition and position('PT409' in definition)=0 then
   raise exception 'Receipt conflict guard missing: %',target;
  end if;
  execute changed;
 end loop;
end $$;
notify pgrst, 'reload schema';
