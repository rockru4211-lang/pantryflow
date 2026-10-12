-- Display codes extend existing ingredient identities; no financial or source IDs change.
lock table private.ingredient_masters in share row exclusive mode;
create sequence private.ingredient_code_sequence;
revoke all on sequence private.ingredient_code_sequence from public,anon,authenticated;
alter table private.ingredient_masters add column ingredient_code text;

-- Reuse an inventory code only for a proven one-to-one source link in this store.
with links as (
 select distinct a.store_id,a.ingredient_id,p.id product_id,p.product_code
 from private.ingredient_aliases a
 join private.recipe_price_entries r on r.id=any(a.reference_ids)
 join public.products p on p.id=r.product_id
 join public.stores s on s.id=a.store_id and s.organization_id=p.organization_id
 where nullif(btrim(p.product_code),'') is not null
), candidates as (
 select store_id,ingredient_id,min(product_code) code from links
 group by store_id,ingredient_id having count(distinct product_id)=1
), safe as (
 select c.* from candidates c where not exists (
 select 1 from links x where x.store_id=c.store_id and x.product_code=c.code and x.ingredient_id<>c.ingredient_id)
)
update private.ingredient_masters m set ingredient_code=s.code from safe s where m.id=s.ingredient_id;

-- The reserved prefix starts above every existing F-number; nextval is concurrency-safe.
select setval('private.ingredient_code_sequence',greatest(1,coalesce((select max(substring(product_code from 2)::bigint)+1 from public.products where product_code ~ '^F[0-9]{1,12}$'),1)),false);
with missing as materialized (
 select id,nextval('private.ingredient_code_sequence') n from private.ingredient_masters where ingredient_code is null order by store_id,name,unit,id
)
update private.ingredient_masters m set ingredient_code='F'||lpad(x.n::text,greatest(6,length(x.n::text)),'0') from missing x where m.id=x.id;
alter table private.ingredient_masters alter column ingredient_code set not null;
create unique index ingredient_fixed_code_unique on private.ingredient_masters(store_id,ingredient_code);

create function private.assign_ingredient_code() returns trigger
language plpgsql security invoker set search_path='' as $$
declare n bigint;
begin
 if TG_OP='UPDATE' then
  if new.ingredient_code is distinct from old.ingredient_code then raise exception 'INGREDIENT_CODE_IMMUTABLE' using errcode='22023';end if;
 else
  n:=nextval('private.ingredient_code_sequence');
  new.ingredient_code:='F'||lpad(n::text,greatest(6,length(n::text)),'0');
 end if;
 return new;
end $$;
revoke all on function private.assign_ingredient_code() from public,anon,authenticated;
create trigger ingredient_fixed_code before insert or update of ingredient_code on private.ingredient_masters
for each row execute function private.assign_ingredient_code();

-- Catalog reads already use to_jsonb(m), so prices and recipe catalogs include the code.
-- Keep the receipt endpoint's existing authentication, store scope and exclusions intact.
do $patch$
declare src text; anchor text:='''id'',m.id,''name'',m.name';
begin
 src:=pg_get_functiondef('public.get_baihuayuan_ingredient_matching(uuid)'::regprocedure);
 if strpos(src,anchor)=0 then raise exception 'receipt ingredient code anchor missing';end if;
 execute replace(src,anchor,'''id'',m.id,''ingredient_code'',m.ingredient_code,''name'',m.name');
end $patch$;
