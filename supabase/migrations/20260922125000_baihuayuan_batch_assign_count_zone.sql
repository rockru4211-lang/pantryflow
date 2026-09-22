
do $patch$
declare
  src text;
  original text;
begin
  select pg_get_functiondef('private.count_inline_operation(uuid,text,jsonb)'::regprocedure) into src;
  original:=src;
  src:=replace(
    src,
    $old$elsif p_action not in ('count.assign-zone','count.move-zone') then raise exception 'INVALID_APP_ACTION' using errcode='22023';
 end if;$old$,
    $new$elsif p_action='count.assign-zone-batch' then
   if jsonb_typeof(p_data->'items')<>'array' or jsonb_array_length(p_data->'items')=0 or jsonb_array_length(p_data->'items')>300 then
     raise exception 'INVALID_BATCH_ASSIGNMENT' using errcode='22023';
   end if;
   result:='[]'::jsonb;
   for snapshot_item in select value from jsonb_array_elements(p_data->'items') loop
     if nullif(snapshot_item->>'product_id','') is null then
       raise exception 'INVALID_BATCH_ASSIGNMENT' using errcode='22023';
     end if;
     result:=result||jsonb_build_array(
       private.count_inline_operation(
         p_store,
         'count.assign-zone',
         jsonb_build_object(
           'session_id',p_data->>'session_id',
           'source_zone_id',p_data->>'source_zone_id',
           'target_zone_id',p_data->>'target_zone_id',
           'product_id',snapshot_item->>'product_id',
           'expected_updated_at',snapshot_item->>'expected_updated_at'
         )
       )
     );
   end loop;
   return jsonb_build_object('items',result,'count',jsonb_array_length(result));
 elsif p_action not in ('count.assign-zone','count.move-zone') then raise exception 'INVALID_APP_ACTION' using errcode='22023';
 end if;$new$
  );
  if src=original then raise exception 'COUNT_BATCH_ASSIGN_PATCH_MISSING'; end if;
  execute src;

  select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src;
  original:=src;
  src:=replace(
    src,
    '(''count.assign-zone'',''count.move-zone'',''count.ensure-zones''',
    '(''count.assign-zone'',''count.assign-zone-batch'',''count.move-zone'',''count.ensure-zones'''
  );
  if src=original then raise exception 'COUNT_BATCH_DISPATCH_PATCH_MISSING'; end if;
  execute src;
end
$patch$;
