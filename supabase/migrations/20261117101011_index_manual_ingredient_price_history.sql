-- The price sheet reads manual changes separately from imported versions.
set local lock_timeout = '3s';

create index if not exists ingredient_standard_versions_manual_by_store
 on private.ingredient_standard_versions (store_id, created_at desc)
 where actor_id is not null;
