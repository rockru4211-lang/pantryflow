-- Preserve the original creation timestamps and request keys for both workflows.
create or replace function private.field_operation_date(p_data jsonb)
returns date language plpgsql stable set search_path='' as $date$
declare
  v_text text := p_data->>'work_date';
  v_date date;
begin
  if not (p_data ? 'work_date') then return null; end if;
  if v_text is null or v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'INVALID_WORK_DATE' using errcode='22023';
  end if;
  begin
    v_date := v_text::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'INVALID_WORK_DATE' using errcode='22023';
  end;
  if v_date > (now() at time zone 'Asia/Taipei')::date then
    raise exception 'INVALID_WORK_DATE' using errcode='22023';
  end if;
  return v_date;
end;
$date$;
revoke all on function private.field_operation_date(jsonb) from public, anon, authenticated;

-- Apply narrowly to the active definitions, retaining their roles and idempotency logic.
do $migration$
declare
  patch record;
  source_sql text;
  active_signature text;
begin
  for patch in select * from (values
    ('private.expiry_waste_command(uuid,uuid,text,jsonb)',
      ' today date:=',
      ' v_work_date date;' || chr(10) || ' today date:='),
    ('private.expiry_waste_command(uuid,uuid,text,jsonb)',
      '   insert into private.waste_records(organization_id,store_id,store_name,name,quantity,unit,reason,note,delay_reason,source,expiry_id,lot_id,product_id,expires_on,zone_name,reference_price,price_receipt_line_id,erp_required,created_by,actor_name)',
      $waste$   v_work_date := private.field_operation_date(p_data);
   if v_work_date is not null and eid is not null then
    raise exception 'INVALID_WORK_DATE' using errcode='22023';
   end if;
   insert into private.waste_records(organization_id,store_id,store_name,name,quantity,unit,reason,note,delay_reason,source,expiry_id,lot_id,product_id,expires_on,zone_name,reference_price,price_receipt_line_id,erp_required,created_by,actor_name,work_date)$waste$),
    ('private.expiry_waste_command(uuid,uuid,text,jsonb)',
      'price.id,erp,auth.uid(),actor) returning id into wid;',
      'price.id,erp,auth.uid(),actor,coalesce(v_work_date,today)) returning id into wid;'),
    ('private.expiry_waste_command(uuid,uuid,text,jsonb)',
      $old$   result:=jsonb_build_object('id',wid,'type','WASTE');$old$,
      $new$   result:=jsonb_build_object('id',wid,'type','WASTE')
     || case when v_work_date is null then '{}'::jsonb else jsonb_build_object('work_date',v_work_date) end;$new$),
    ('private.create_store_transfer(uuid,jsonb)',
      ' v_move private.store_movements;v_result jsonb;',
      ' v_work_date date;' || chr(10) || ' v_move private.store_movements;v_result jsonb;'),
    ('private.create_store_transfer(uuid,jsonb)',
      $old$ if p_data ? 'items' then$old$,
      $new$ v_work_date := private.field_operation_date(p_data);
 if p_data ? 'items' then$new$),
    ('private.create_store_transfer(uuid,jsonb)',
      $old$array['items','from_store_id','to_store_id','note']$old$,
      $new$array['items','from_store_id','to_store_id','note','work_date']$new$),
    ('private.create_store_transfer(uuid,jsonb)',
      $old$'from_store_id',v_from,'to_store_id',v_to,'note',coalesce(p_data->>'note','')));$old$,
      $new$'from_store_id',v_from,'to_store_id',v_to,'note',coalesce(p_data->>'note',''))
      || case when v_work_date is null then '{}'::jsonb else jsonb_build_object('work_date',v_work_date) end);$new$),
    ('private.create_store_transfer(uuid,jsonb)',
      'note,review_status,available_snapshot,stock_warning',
      'note,review_status,available_snapshot,stock_warning,occurred_at'),
    ('private.create_store_transfer(uuid,jsonb)',
      'v_product is not null and v_available<v_qty' || chr(10) || ' ) returning',
      $new$v_product is not null and v_available<v_qty,
 case when v_work_date = (now() at time zone 'Asia/Taipei')::date then now()
      else v_work_date::timestamp at time zone 'Asia/Taipei' end
 ) returning$new$)
  ) as x(signature, before_sql, after_sql) order by signature
  loop
    if active_signature is distinct from patch.signature then
      if active_signature is not null then execute source_sql; end if;
      active_signature := patch.signature;
      select pg_get_functiondef(active_signature::regprocedure) into strict source_sql;
    end if;
    if length(source_sql) - length(replace(source_sql,patch.before_sql,'')) <> length(patch.before_sql) then
      raise exception 'Unexpected definition for % near %',patch.signature,patch.before_sql;
    end if;
    source_sql := replace(source_sql,patch.before_sql,patch.after_sql);
  end loop;
  execute source_sql;
end;
$migration$;
