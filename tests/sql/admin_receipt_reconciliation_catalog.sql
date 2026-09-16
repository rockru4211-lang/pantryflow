-- CATALOG / ANONYMOUS-DENIAL CHECK ONLY. Not a full authenticated workflow test.
-- Run on a local/disposable test database AFTER applying the full migration chain.
-- Do not run against the live merchant project just to test this candidate.
begin;
do $test$
declare target text; signature text; oid_value oid; source text;
begin
  foreach target in array array['admin_receipt_rows','admin_receipt_preferences','admin_receipt_changes'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relname=target and c.relrowsecurity) then
      raise exception 'RLS_NOT_ENABLED: %',target;
    end if;
    if has_table_privilege('authenticated','private.'||target,'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('anon','private.'||target,'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'PRIVATE_TABLE_EXPOSED: %',target;
    end if;
  end loop;
  foreach signature in array array[
    'public.get_admin_receipt_register(uuid)','public.get_admin_receipt_document(uuid)',
    'public.set_admin_receipt_codes(uuid,boolean)',
    'public.save_admin_receipt_row(uuid,uuid,text,integer,text,jsonb,boolean,uuid)',
    'public.save_admin_receipt_arrival(uuid,integer,date,uuid)',
    'public.get_admin_receipt_history(uuid,bigint)'
  ] loop
    oid_value:=to_regprocedure(signature);
    if oid_value is null then raise exception 'RPC_MISSING: %',signature; end if;
    if has_function_privilege('anon',oid_value,'EXECUTE') or not has_function_privilege('authenticated',oid_value,'EXECUTE') then
      raise exception 'RPC_GRANT_ERROR: %',signature;
    end if;
    select pg_get_functiondef(oid_value) into source;
    if position('admin_receipt_guard' in source)=0 then raise exception 'ROLE_GUARD_MISSING: %',signature; end if;
  end loop;
  foreach signature in array array['private.admin_receipt_guard(uuid)','private.admin_receipt_base(uuid,text)','private.admin_receipt_token(uuid,text)'] loop
    oid_value:=to_regprocedure(signature);
    if oid_value is null or has_function_privilege('authenticated',oid_value,'EXECUTE') or has_function_privilege('anon',oid_value,'EXECUTE') then
      raise exception 'PRIVATE_HELPER_EXPOSED: %',signature;
    end if;
  end loop;
  -- An empty JWT identity must be denied even when the test runner owns the functions.
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.get_admin_receipt_register(gen_random_uuid());
    raise exception 'ANONYMOUS_READ_UNEXPECTEDLY_SUCCEEDED';
  exception when insufficient_privilege then null;
  end;
end $test$;
rollback;
