create table private.count_item_changes(
 id bigint generated always as identity primary key,
 store_id uuid not null references public.stores(id), product_id uuid not null references public.products(id),
 product_name text not null, action text not null, actor_id uuid, actor_name text not null,
 happened_at timestamptz not null default clock_timestamp(), before_data jsonb, after_data jsonb
);
alter table private.count_item_changes enable row level security;
revoke all on private.count_item_changes from public,anon,authenticated;
create index count_item_changes_store_cursor on private.count_item_changes(store_id,id desc);
create function private.capture_count_item_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; pid uuid; stores uuid[]; s uuid; org uuid; label text; who text; action_name text; zid uuid; cs uuid; entry_kind text;
begin
 b:=case when tg_op<>'INSERT' then to_jsonb(old) end;
 a:=case when tg_op<>'DELETE' then to_jsonb(new) end;
 entry_kind:=a->>'entry_type';
 if tg_table_name='count_zones' then
  if old.name is not distinct from new.name then return null;end if;
  select display_name into who from public.staff_identities where user_id=auth.uid() and organization_id=new.organization_id;
  insert into private.count_item_changes(store_id,product_id,product_name,action,actor_id,actor_name,before_data,after_data)
  select new.store_id,p.id,p.name,'儲物區更名',auth.uid(),coalesce(who,'門市人員'),jsonb_build_object('zone',old.name),jsonb_build_object('zone',new.name)
  from public.zone_products zp join public.products p on p.id=zp.product_id where zp.zone_id=new.id;
  return null;
 end if;
 if tg_table_name in ('count_drafts','count_entries') then
  pid:=(coalesce(a,b)->>'product_id')::uuid;cs:=(coalesce(a,b)->>'session_id')::uuid;
  select array[store_id] into stores from public.inventory_count_sessions where id=cs;
  select jsonb_build_object('quantity',b->'quantity','unit',b->'unit','note',b->'note','zone',z.name),jsonb_build_object('quantity',a->'quantity','unit',a->'unit','note',a->'note','zone',z.name) into b,a from public.count_zones z where z.id=(coalesce(a,b)->>'zone_id')::uuid;
  action_name:=case when tg_table_name='count_entries' then case entry_kind when 'INITIAL_COUNT' then '完成盤點' when 'CORRECTION' then '更正盤點' else '重新盤點' end else '盤點資料' end;
  if tg_table_name='count_entries' then b:=null;end if;
 elsif tg_table_name='products' then
  pid:=new.id;
  select array_agg(distinct z.store_id) into stores from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where zp.product_id=pid and z.is_active;
  b:=jsonb_build_object('name',old.name,'unit',old.count_unit,'specification',old.specification);
  a:=jsonb_build_object('name',new.name,'unit',new.count_unit,'specification',new.specification);action_name:='品項資料';
 elsif tg_table_name='zone_products' then
  pid:=(coalesce(a,b)->>'product_id')::uuid;zid:=(coalesce(a,b)->>'zone_id')::uuid;
  select array[store_id],name into stores,label from public.count_zones where id=zid;
  b:=case when b is not null then jsonb_build_object('zone',label,'unit',b->'count_unit') end;
  a:=case when a is not null then jsonb_build_object('zone',label,'unit',a->'count_unit') end;
  action_name:=case tg_op when 'INSERT' then '加入儲物區' when 'DELETE' then '移出儲物區' else '儲物區資料' end;
 elsif tg_table_name='count_field_removed' then
  pid:=(coalesce(a,b)->>'product_id')::uuid;stores:=array[(coalesce(a,b)->>'store_id')::uuid];
  b:=jsonb_build_object('status',case when tg_op='INSERT' then '使用中' else '已移出' end);
  a:=jsonb_build_object('status',case when tg_op='INSERT' then '已移出' else '使用中' end);
  action_name:=case when tg_op='INSERT' then '移出盤點' else '恢復使用' end;
 end if;
 if b is not distinct from a or stores is null then return null;end if;
 select name,organization_id into label,org from public.products where id=pid;
 select display_name into who from public.staff_identities where user_id=auth.uid() and organization_id=org;
 foreach s in array stores loop
  insert into private.count_item_changes(store_id,product_id,product_name,action,actor_id,actor_name,before_data,after_data)
  values(s,pid,label,action_name,auth.uid(),coalesce(who,case when auth.uid() is null then '系統' else '門市人員' end),b,a);
 end loop;
 return null;
end $$;
revoke all on function private.capture_count_item_change() from public,anon,authenticated;
create trigger count_draft_change_history after insert or update on public.count_drafts for each row execute function private.capture_count_item_change();
create trigger count_entry_change_history after insert on public.count_entries for each row execute function private.capture_count_item_change();
create trigger count_zone_name_history after update of name on public.count_zones for each row execute function private.capture_count_item_change();
create trigger count_product_change_history after update of name,count_unit,specification on public.products for each row execute function private.capture_count_item_change();
create trigger count_zone_product_change_history after insert or update or delete on public.zone_products for each row execute function private.capture_count_item_change();
create trigger count_field_change_history after insert or delete on private.count_field_removed for each row execute function private.capture_count_item_change();
-- Recover earlier store-scoped evidence where the product identity was recorded.
insert into private.count_item_changes(store_id,product_id,product_name,action,actor_id,actor_name,happened_at,before_data,after_data)
select l.store_id,p.id,p.name,case l.action when 'COUNT_FIELD_REMOVED' then '移出盤點' when 'COUNT_FIELD_RESTORED' then '恢復使用' else '盤點資料' end,
 l.user_id,coalesce(si.display_name,'門市人員'),l.created_at,
 case when l.action='COUNT_FIELD_REMOVED' then '{"status":"使用中"}'::jsonb when l.action='COUNT_FIELD_RESTORED' then '{"status":"已移出"}'::jsonb else jsonb_build_object('quantity',l.old_value->'quantity','note',l.old_value->'note') end,
 case when l.action='COUNT_FIELD_REMOVED' then '{"status":"已移出"}'::jsonb when l.action='COUNT_FIELD_RESTORED' then '{"status":"使用中"}'::jsonb else jsonb_build_object('quantity',l.new_value->'quantity','note',l.new_value->'note') end
from public.audit_logs l join public.products p on p.id::text=l.new_value->>'product_id' and p.organization_id=l.organization_id
join public.stores s on s.id=l.store_id and s.organization_id=l.organization_id
left join public.staff_identities si on si.organization_id=l.organization_id and si.user_id=l.user_id
where l.action in ('COUNT_DRAFT_SAVED','COUNT_FIELD_REMOVED','COUNT_FIELD_RESTORED') order by l.created_at,l.id;

create function private.get_count_item_changes(s uuid,before_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(private.app_role(s),'') not in ('LOGISTICS','OWNER') then raise exception 'INVENTORY_ADMIN_REQUIRED' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(q) order by q.id desc) from (select id,product_id,product_name,action,actor_name,happened_at,before_data,after_data from private.count_item_changes where store_id=s and (before_id is null or id<before_id) order by id desc limit 100)q),'[]');
end $$;
revoke all on function private.get_count_item_changes(uuid,bigint) from public,anon;
grant execute on function private.get_count_item_changes(uuid,bigint) to authenticated;
create function public.get_count_item_changes(p_store_id uuid,p_before_id bigint default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.get_count_item_changes(p_store_id,p_before_id) $$;
revoke all on function public.get_count_item_changes(uuid,bigint) from public,anon;
grant execute on function public.get_count_item_changes(uuid,bigint) to authenticated;
notify pgrst,'reload schema';
