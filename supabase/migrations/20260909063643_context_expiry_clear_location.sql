-- A correction to unclassified must clear the old zone ID as well as its label.
create or replace view private.expiry_current with(security_invoker=true) as
select e.id,e.organization_id,e.store_id,e.name,coalesce(r.expires_on,e.expires_on) expires_on,
 case when r.id is not null then r.zone_id else e.zone_id end zone_id,coalesce(r.zone_name,e.zone_name) zone_name,
 coalesce(r.attention_reason,e.attention_reason) attention_reason,e.source,e.lot_id,e.product_id,e.unit,e.created_by,e.created_at,
 e.context_type,e.context_id,e.context_key,e.context_run_id,e.expires_on original_expires_on,coalesce(r.revision,0) revision
from private.expiry_items e left join lateral(select * from private.expiry_item_revisions where expiry_id=e.id order by revision desc limit 1) r on true;
revoke all on private.expiry_current from public,anon,authenticated;

