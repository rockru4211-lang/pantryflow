begin;
do $$
declare store uuid; actor uuid; batch uuid; options jsonb; payload jsonb; first_id uuid; second_id uuid; result jsonb; key uuid; failed boolean;
begin
 select id into strict store from public.stores where store_code='QA0908RECEIPT';
 select user_id into strict actor from public.store_memberships where store_id=store and role='LOGISTICS' and is_active;
 select id into batch from public.receipt_upload_batches where store_id=store order by uploaded_at limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 options:=public.get_pilot_context_expiry(store,'RECEIPT',batch,null);
 payload:=jsonb_build_object('item_key',options->'items'->0->>'key','run_id',options->>'run_id','expires_on','2026-09-11','zone_id',null,'new_batch',true);
 key:=gen_random_uuid();result:=public.save_pilot_context_expiry(store,key,'RECEIPT',batch,payload,null);first_id:=(result->>'id')::uuid;
 if public.save_pilot_context_expiry(store,key,'RECEIPT',batch,payload,null)<>result then raise exception 'ASSERT request replay created a second package';end if;
 failed:=false;begin perform public.save_pilot_context_expiry(store,key,'RECEIPT',batch,payload||'{"expires_on":"2026-09-12"}',null);exception when others then failed:=sqlerrm like '%REQUEST_REUSED%';end;
 if not failed then raise exception 'ASSERT uncertain retry accepted altered data';end if;
 result:=public.save_pilot_context_expiry(store,gen_random_uuid(),'RECEIPT',batch,payload||'{"expires_on":"2026-09-12"}',null);second_id:=(result->>'id')::uuid;
 if first_id=second_id then raise exception 'ASSERT different packages within one receipt line merged';end if;
 payload:=payload||jsonb_build_object('expiry_id',first_id,'revision',0,'expires_on','2026-09-10');
 perform public.save_pilot_context_expiry(store,gen_random_uuid(),'RECEIPT',batch,payload,null);
 if (select expires_on from private.expiry_items where id=first_id)<>date '2026-09-11' or (select expires_on from private.expiry_current where id=first_id)<>date '2026-09-10' or (select expires_on from private.expiry_current where id=second_id)<>date '2026-09-12' then raise exception 'ASSERT correction changed original or another batch';end if;
 if (select zone_id from private.expiry_current where id=first_id) is not null or (select zone_name from private.expiry_current where id=first_id)<>'未分類' then raise exception 'ASSERT null location';end if;
end $$;
rollback;
select 'PASS: same-line distinct packages, request replay, altered retry denial, append-only corrections and unclassified location' as context_batches_tests;
