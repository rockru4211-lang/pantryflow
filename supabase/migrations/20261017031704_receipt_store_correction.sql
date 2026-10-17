-- Exceptional receipt correction; ordinary upload/store defaults are unchanged.
create function private.receipt_store_choices(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_active_store_role(p_store,array['LOGISTICS','OWNER']::public.app_role[]) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 perform private.assert_store_editable(p_store);
 return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name)
 from public.stores s join public.stores origin on origin.id=p_store and origin.organization_id=s.organization_id
 where s.is_active and s.name in ('BeApe','Gras') and origin.name in ('BeApe','Gras')
 and private.has_active_store_role(s.id,array['LOGISTICS','OWNER']::public.app_role[])
 and not exists(select 1 from public.store_memberships m where m.store_id=s.id and m.user_id=auth.uid() and m.is_active and m.access_mode='VIEW')),'[]'::jsonb);
end $$;
revoke all on function private.receipt_store_choices(uuid) from public,anon,authenticated;
grant execute on function private.receipt_store_choices(uuid) to authenticated;
create function public.get_receipt_store_choices(p_store_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select private.receipt_store_choices(p_store_id)$$;
revoke all on function public.get_receipt_store_choices(uuid) from public,anon;
grant execute on function public.get_receipt_store_choices(uuid) to authenticated;

create function private.correct_receipt_store(p_store uuid,p_batch uuid,p_target uuid,p_data jsonb,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; target public.stores; cached private.app_requests; payload jsonb; result jsonb; products uuid[]; prices uuid[];
begin
 if auth.uid() is null then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 if p_request is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'INVALID_REQUEST';end if;
 if not exists(select 1 from jsonb_array_elements(private.receipt_store_choices(p_store)) x where x->>'id'=p_target::text) then raise exception 'RECEIPT_TARGET_FORBIDDEN' using errcode='42501';end if;
 perform private.assert_store_editable(p_target);
 payload:=jsonb_build_object('batch_id',p_batch,'target_store_id',p_target,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_request::text,0));
 select * into cached from private.app_requests where store_id=p_store and request_id=p_request;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'receipt.store.correct' or cached.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
  return cached.result;
 end if;
 select * into b from public.receipt_upload_batches where id=p_batch for update;
 if not found or b.store_id<>p_store then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 select * into strict target from public.stores where id=p_target;
 -- Do not move a physical stock/custody event by relabelling its receipt.
 if exists(select 1 from private.receipt_custody_links where batch_id=p_batch)
 or exists(select 1 from private.custody_reminder_receipts where batch_id=p_batch)
 or exists(select 1 from public.inventory_lots l join public.receipt_lines r on r.id=l.source_id join public.goods_receipts g on g.id=r.receipt_id where g.source_batch_id=p_batch)
 or exists(select 1 from private.stock_postings s join public.receipt_lines r on r.id=s.source_id join public.goods_receipts g on g.id=r.receipt_id where g.source_batch_id=p_batch)
 then raise exception 'RECEIPT_STORE_LINKED_STOCK';end if;
 if exists(select 1 from public.receipt_upload_batches other where other.id<>p_batch and other.store_id=p_target and other.upload_fingerprint=b.upload_fingerprint)
 then raise exception 'RECEIPT_TARGET_DUPLICATE';end if;
 -- Reuse the normal revision and source checks, saving the draft in this transaction.
 if p_data ? 'removed_row_keys' then
  result:=public.save_baihuayuan_receipt_entry(p_store,p_batch,p_data,gen_random_uuid());
 else
  result:=public.save_baihuayuan_receipt_review(p_store,p_batch,p_data,gen_random_uuid());
 end if;
 -- Saving custody details may create links, so check again before changing ownership.
 if exists(select 1 from private.receipt_custody_links where batch_id=p_batch) or exists(select 1 from private.custody_reminder_receipts where batch_id=p_batch) then raise exception 'RECEIPT_STORE_LINKED_STOCK';end if;
 select array_agg(id),array_agg(distinct product_id) into prices,products from private.recipe_price_entries where store_id=p_store and source_ref->>'batch_id'=p_batch::text;
 update public.receipt_upload_batches set store_id=p_target,store_name=target.name,updated_at=now() where id=p_batch;
 update public.goods_receipts set store_id=p_target where source_batch_id=p_batch;
 update private.receipt_account_edits set store_id=p_target,revision=revision+1,updated_by=auth.uid(),updated_at=now(),
 line_values=coalesce((select jsonb_object_agg(key,value-'ingredient_id'-'ingredient_match_revision') from jsonb_each(line_values)),'{}') where batch_id=p_batch;
 update private.receipt_reconciliations set store_id=p_target,revision=revision+1,updated_by=auth.uid(),updated_at=now() where batch_id=p_batch;
 update private.baihuayuan_record_flags set store_id=p_target where entity_type='RECEIPT_BATCH' and entity_id=p_batch;
 update private.recipe_price_entries set store_id=p_target where id=any(prices);
 -- Keep locked recipe/standard snapshots intact. Remove moved evidence from source aliases.
 update private.ingredient_aliases set reference_ids=array(select x from unnest(reference_ids) x where not(x=any(prices))) where store_id=p_store and reference_ids&&prices;
 perform private.sync_ingredient_prices(p_target,p_batch);
 perform private.refresh_ingredient_price_cache(p_store,coalesce(products,'{}'));
 perform private.refresh_ingredient_price_cache(p_target,coalesce(products,'{}'));
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id,attempt_id,store_id)
 values(b.organization_id,'receipt_batch',p_batch::text,'receipt.store.correct',jsonb_build_object('store_id',p_store,'store_name',b.store_name),jsonb_build_object('store_id',p_target,'store_name',target.name),auth.uid(),p_request,p_target);
 result:=jsonb_build_object('saved',true,'account',(private.receipt_account_rows(p_target,null,null,null,p_batch)->0)||jsonb_build_object('moved_to_store_id',p_target));
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store,p_request,auth.uid(),'receipt.store.correct',payload,result);
 return result;
end $$;
revoke all on function private.correct_receipt_store(uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.correct_receipt_store(uuid,uuid,uuid,jsonb,uuid) to authenticated;
create function public.correct_receipt_store(p_store_id uuid,p_batch_id uuid,p_target_store_id uuid,p_data jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select private.correct_receipt_store(p_store_id,p_batch_id,p_target_store_id,p_data,p_request_id)$$;
revoke all on function public.correct_receipt_store(uuid,uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.correct_receipt_store(uuid,uuid,uuid,jsonb,uuid) to authenticated;
