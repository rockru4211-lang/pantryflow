-- Return the value after the existing updated_at trigger runs, including on updates.
create or replace function public.save_pilot_count_draft(p_session_id uuid,p_zone_id uuid,p_product_id uuid,p_quantity numeric,p_expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare s public.inventory_count_sessions%rowtype; d public.count_drafts%rowtype; v_unit text; v_stamp timestamptz;
begin
 select * into s from public.inventory_count_sessions where id=p_session_id for update;
 if not found or not private.has_active_store_role(s.store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[]) then raise exception using errcode='42501',message='STORE_COUNTER_REQUIRED'; end if;
 if s.status<>'IN_PROGRESS' or not exists(select 1 from public.count_zone_progress where session_id=s.id and zone_id=p_zone_id and status<>'COMPLETED') then raise exception 'COUNT_ZONE_NOT_AVAILABLE'; end if;
 select item->>'unit' into v_unit from jsonb_array_elements(s.snapshot->'zones') item where item->>'zone_id'=p_zone_id::text and item->>'product_id'=p_product_id::text;
 if v_unit is null then raise exception using errcode='42501',message='PRODUCT_NOT_IN_COUNT'; end if;
 if p_quantity<0 or p_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_QUANTITY'; end if;
 select * into d from public.count_drafts where session_id=s.id and zone_id=p_zone_id and product_id=p_product_id;
 if d.updated_at is distinct from p_expected_updated_at then
   -- A committed request whose response was lost is safe to acknowledge again.
   if d.id is not null and d.quantity is not distinct from p_quantity then return d.updated_at; end if;
   raise exception using errcode='40001',message='COUNT_DRAFT_CHANGED';
 end if;
 v_stamp:=clock_timestamp();
 insert into public.count_drafts(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,updated_at,observation_state)
 values(s.organization_id,s.id,p_zone_id,p_product_id,p_quantity,v_unit,(select auth.uid()),v_stamp,case when p_quantity is null then 'BLANK' else 'COUNTED' end)
 on conflict(session_id,zone_id,product_id) do update set quantity=excluded.quantity,entered_by=excluded.entered_by,unit=excluded.unit,updated_at=excluded.updated_at,observation_state=excluded.observation_state
 returning updated_at into v_stamp;
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
 values(s.organization_id,'count_draft',s.id,'COUNT_DRAFT_SAVED',jsonb_build_object('quantity',d.quantity,'entered_by',d.entered_by),jsonb_build_object('zone_id',p_zone_id,'product_id',p_product_id,'quantity',p_quantity),(select auth.uid()));
 return v_stamp;
end; $$;
revoke all on function public.save_pilot_count_draft(uuid,uuid,uuid,numeric,timestamptz) from public,anon;
grant execute on function public.save_pilot_count_draft(uuid,uuid,uuid,numeric,timestamptz) to authenticated;
