-- Temporary fixtures only: no real store's inventory is changed.
begin;
do $$
declare org uuid; staff uuid; manager1 uuid; manager2 uuid; store uuid; foreign_store uuid; z uuid; z2 uuid; product uuid; count_id uuid;
 before_token text; next_token text; denied boolean;
begin
 select s.organization_id,m.user_id into strict org,staff from public.stores s join public.store_memberships m on m.store_id=s.id where s.store_code='QA0908RECEIPT' and m.role='STAFF';
 select m.user_id into strict manager1 from public.stores s join public.store_memberships m on m.store_id=s.id where s.store_code='QA0908RECEIPT' and m.role='LOGISTICS';
 select m.user_id into strict manager2 from public.stores s join public.store_memberships m on m.store_id=s.id where s.store_code='QAFULLCHAIN' and m.role='SUPERVISOR';
 insert into public.organization_members(organization_id,user_id,role) values(org,manager2,'SUPERVISOR') on conflict do nothing;
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,manager2,'QA sync supervisor',manager1) on conflict do nothing;
 insert into public.stores(organization_id,name,store_code,created_by) values(org,'BeApe','QA-SYNC-'||left(gen_random_uuid()::text,8),manager1) returning id into store;
 insert into public.stores(organization_id,name,store_code,created_by) values(org,'Gras','QA-SYNC-'||left(gen_random_uuid()::text,8),manager1) returning id into foreign_store;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,assigned_by)
 values(store,org,staff,'sync-staff','STAFF',manager1),(store,org,manager1,'sync-manager1','SUPERVISOR',manager1),(store,org,manager2,'sync-manager2','SUPERVISOR',manager1);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager1,'role','authenticated')::text,true);
 before_token:=public.get_count_store_revision(store);
 if before_token is distinct from public.get_count_store_revision(store) then raise exception 'ASSERT read changes token';end if;
 z:=public.create_pilot_zone(store,'冷藏');z2:=public.create_pilot_zone(store,'工作台');
 if before_token=public.get_count_store_revision(store) then raise exception 'ASSERT new zone not detected';end if;
 insert into public.products(organization_id,product_code,name,category,base_unit,count_unit,is_active)
 values(org,'QA-SYNC-'||gen_random_uuid()::text,'牛奶','其他','瓶','瓶',true) returning id into product;
 insert into public.zone_products(zone_id,product_id,count_unit) values(z,product,'瓶');
 insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot)
 values(org,store,manager1,'IN_PROGRESS',jsonb_build_object('zones',jsonb_build_array(jsonb_build_object('zone_id',z,'product_id',product,'unit','瓶')))) returning id into count_id;
 insert into public.count_zone_progress(organization_id,session_id,zone_id) values(org,count_id,z),(org,count_id,z2);
 before_token:=public.get_count_store_revision(store);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager2,'role','authenticated')::text,true);
 if before_token<>public.get_count_store_revision(store) then raise exception 'ASSERT supervisors have separate data';end if;
 update public.count_zones set name='冷藏庫',updated_at=clock_timestamp() where id=z;
 next_token:=public.get_count_store_revision(store);
 if before_token=next_token then raise exception 'ASSERT rename not detected';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 before_token:=public.get_count_store_revision(store);
 perform public.save_pilot_count_drafts_v2(count_id,gen_random_uuid(),jsonb_build_array(jsonb_build_object('zone_id',z,'product_id',product,'quantity',5,'note','same store','expected_updated_at',null)));
 if before_token=public.get_count_store_revision(store) then raise exception 'ASSERT draft change not detected';end if;
 before_token:=public.get_count_store_revision(store);
 update public.zone_products set zone_id=z2 where zone_id=z and product_id=product;
 if before_token=public.get_count_store_revision(store) then raise exception 'ASSERT moved item not detected';end if;
 before_token:=public.get_count_store_revision(store);
 delete from public.count_drafts d where d.session_id=count_id;
 if before_token=public.get_count_store_revision(store) then raise exception 'ASSERT deleted draft not detected';end if;
 before_token:=public.get_count_store_revision(store);
 update public.count_zone_progress set status='COMPLETED',completed_at=clock_timestamp(),completed_by=staff where session_id=count_id and zone_id=z;
 if before_token=public.get_count_store_revision(store) then raise exception 'ASSERT completion not detected';end if;
 before_token:=public.get_count_store_revision(store);
 insert into public.count_zones(organization_id,store_id,name) values(org,foreign_store,'外店冷藏');
 if before_token<>public.get_count_store_revision(store) then raise exception 'ASSERT unrelated store changed token';end if;
 execute 'set local role authenticated';
 if before_token<>public.get_count_store_revision(store) then raise exception 'ASSERT authenticated wrapper not usable';end if;
 execute 'reset role';
 denied:=false;begin perform public.get_count_store_revision(foreign_store);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'ASSERT foreign store accessible';end if;
 update public.store_memberships set is_active=false where store_id=store and user_id=staff;
 denied:=false;begin perform public.get_count_store_revision(store);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'ASSERT inactive staff accessible';end if;
 if has_function_privilege('anon','public.get_count_store_revision(uuid)','EXECUTE') then raise exception 'ASSERT anonymous access';end if;
end $$;
rollback;
select 'PASS: shared supervisor/store revision; insert/update/move/delete detected; read-only stable; foreign/inactive/anonymous denied' as result;
