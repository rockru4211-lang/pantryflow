alter table private.administrative_documents
 add column contract_nonrenewed_at timestamptz,
 add column contract_nonrenewal_reason text not null default '' check(length(contract_nonrenewal_reason)<=2000),
 add constraint administrative_nonrenewal_closed check(
  (contract_nonrenewed_at is null and contract_nonrenewal_reason='')
  or (contract_nonrenewed_at is not null and archived)
 );

-- Reuse the authorized lifecycle path, revision check, audit, and request idempotency.
do $migration$
declare
 definition text:=pg_get_functiondef('private.directory_lifecycle(uuid,jsonb,uuid)'::regprocedure);
 anchor text;
begin
 anchor:=$old$act not in ('deactivate','activate','remove','restore','delete')$old$;
 if strpos(definition,anchor)=0 then raise exception 'Contract nonrenewal lifecycle allowlist missing';end if;
 definition:=replace(definition,anchor,$new$act not in ('deactivate','activate','remove','restore','delete','nonrenew')
 or (act='nonrenew' and kind<>'contract')$new$);

 anchor:=$old$(act in ('deactivate','activate','remove') and removed)$old$;
 if strpos(definition,anchor)=0 then raise exception 'Contract nonrenewal removed-state check missing';end if;
 definition:=replace(definition,anchor,$new$(act in ('deactivate','activate','remove','nonrenew') and removed)$new$);

 anchor:=$old$(act='deactivate' and inactive)$old$;
 if strpos(definition,anchor)=0 then raise exception 'Contract nonrenewal active-state check missing';end if;
 definition:=replace(definition,anchor,$new$(act in ('deactivate','nonrenew') and inactive)$new$);

 anchor:=$old$update private.administrative_documents set is_removed=(act='remove'),archived=(act<>'activate'),revision=revision+1$old$;
 if strpos(definition,anchor)=0 then raise exception 'Contract nonrenewal document update missing';end if;
 definition:=replace(definition,anchor,$new$update private.administrative_documents
    set is_removed=(act='remove'),archived=(act<>'activate'),revision=revision+1,
    contract_nonrenewed_at=case act when 'nonrenew' then clock_timestamp() when 'activate' then null else d.contract_nonrenewed_at end,
    contract_nonrenewal_reason=case act when 'nonrenew' then btrim(coalesce(p_data->>'reason','')) when 'activate' then '' else d.contract_nonrenewal_reason end$new$);

 anchor:=$old$insert into private.app_requests(store_id,request_id,actor_id,action,payload,result)$old$;
 if strpos(definition,anchor)=0 then raise exception 'Contract nonrenewal idempotency result missing';end if;
 definition:=replace(definition,anchor,$new$if act='nonrenew' then
  result:=result||jsonb_build_object('contract_nonrenewed_at',after_value->'contract_nonrenewed_at',
   'contract_nonrenewal_reason',after_value->'contract_nonrenewal_reason');
 end if;
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result)$new$);
 execute definition;
end;
$migration$;

notify pgrst,'reload schema';
