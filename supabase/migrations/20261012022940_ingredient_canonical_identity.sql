-- Canonical identity is a non-destructive link. Original IDs, codes, prices and
-- recipe/receipt references remain unchanged, including every cost approval.
lock table private.ingredient_masters in share row exclusive mode;
create temporary table ingredient_identity_preservation on commit drop as
select md5(string_agg(to_jsonb(m)::text,'' order by id)) hash from private.ingredient_masters m;
alter table private.ingredient_masters add column canonical_ingredient_id uuid;
alter table private.ingredient_masters add constraint ingredient_canonical_store_fk
 foreign key(canonical_ingredient_id,store_id) references private.ingredient_masters(id,store_id);
alter table private.ingredient_masters add constraint ingredient_canonical_not_self
 check(canonical_ingredient_id is null or canonical_ingredient_id<>id);
create index ingredient_canonical_idx on private.ingredient_masters(canonical_ingredient_id) where canonical_ingredient_id is not null;

create function private.ingredient_identity_name(n text) returns text
language sql immutable set search_path='' as $$
 select lower(regexp_replace(regexp_replace(normalize(n,NFKC),'\s*·\s*原表計價基準:.*$',''),'[[:space:]·]','','g'))
$$;
create function private.ingredient_identity_key(n text,u text,p jsonb,c text) returns text
language plpgsql immutable set search_path='' as $$
declare capacity numeric; base text;
begin
 if jsonb_typeof(p->'content_quantity')<>'number' or nullif(p->>'unit','') is null then return null;end if;
 capacity:=(p->>'content_quantity')::numeric*private.recipe_factor(p->>'content_unit');
 base:=private.recipe_unit(p->>'content_unit');
 if capacity is null or capacity<=0 or base not in ('g','ml') or private.recipe_unit(u) not in (base,private.recipe_unit(p->>'unit')) then return null;end if;
 return jsonb_build_array(private.ingredient_identity_name(n),private.recipe_unit(p->>'unit'),trim_scale(capacity),base,coalesce(c,''))::text;
end $$;
create function private.ingredient_identity_eligible(i uuid,n text) returns boolean
language sql stable set search_path='' as $$
 select not exists(select 1 from private.ingredient_aliases a where a.ingredient_id=i and
 (a.corrected or (btrim(a.specification)<>'' and a.specification not like '原表計價基準:%' and strpos(private.ingredient_identity_name(n),private.ingredient_identity_name(a.specification))=0)))

$$;
create index ingredient_identity_key_idx on private.ingredient_masters(store_id,private.ingredient_identity_key(name,unit,purchase,category));

with eligible as (
 select m.*,private.ingredient_identity_key(name,unit,purchase,category) identity_key
 from private.ingredient_masters m where private.ingredient_identity_eligible(id,name)
 and not exists(select 1 from private.ingredient_supply_state st where st.ingredient_id=m.id and st.stopped)
), ranked as (
 select id,first_value(id) over(partition by store_id,identity_key order by
 manual desc,(exists(select 1 from private.ingredient_aliases a where a.ingredient_id=eligible.id)) desc,(private.recipe_unit(unit)=private.recipe_unit(purchase->>'content_unit')) desc,ingredient_code,id) root
 from eligible where identity_key is not null
)
update private.ingredient_masters m set canonical_ingredient_id=r.root from ranked r where m.id=r.id and r.id<>r.root;

-- Only a complete, exact package identity can attach a subsequently imported row.
-- Shape changes dissolve affected links rather than mixing incompatible packages.
create function private.assign_ingredient_canonical() returns trigger
language plpgsql security invoker set search_path='' as $$
declare k text; target uuid;
begin
 k:=private.ingredient_identity_key(new.name,new.unit,new.purchase,new.category);
 if TG_OP='UPDATE' then
  if k is not distinct from private.ingredient_identity_key(old.name,old.unit,old.purchase,old.category) then return new;end if;
  update private.ingredient_masters set canonical_ingredient_id=null where canonical_ingredient_id=old.id;
 end if;
 new.canonical_ingredient_id:=null;
 if k is null or not private.ingredient_identity_eligible(new.id,new.name) or exists(select 1 from private.ingredient_supply_state st where st.ingredient_id=new.id and st.stopped) then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.store_id::text||k,0));
 select m.id into target from private.ingredient_masters m where m.store_id=new.store_id and m.id<>new.id
 and (m.manual or exists(select 1 from private.ingredient_aliases a where a.ingredient_id=m.id))
 and m.canonical_ingredient_id is null and private.ingredient_identity_key(m.name,m.unit,m.purchase,m.category)=k
 and private.ingredient_identity_eligible(m.id,m.name)
 order by m.manual desc,(private.recipe_unit(m.unit)=private.recipe_unit(m.purchase->>'content_unit')) desc,m.ingredient_code,m.id limit 1;
 new.canonical_ingredient_id:=target;
 return new;
end $$;
create trigger ingredient_canonical_assignment before insert or update of name,unit,purchase,category on private.ingredient_masters
for each row execute function private.assign_ingredient_canonical();

create function private.check_ingredient_canonical() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.canonical_ingredient_id is not null and not exists(select 1 from private.ingredient_masters r where r.id=new.canonical_ingredient_id and r.store_id=new.store_id and r.canonical_ingredient_id is null) then
 raise exception 'INGREDIENT_CANONICAL_ROOT_REQUIRED' using errcode='22023';end if;
 return new;
end $$;
create trigger ingredient_canonical_validation before insert or update of canonical_ingredient_id on private.ingredient_masters
for each row execute function private.check_ingredient_canonical();

-- A deliberate alias correction is evidence against automatic identity grouping.
create function private.detach_corrected_ingredient() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.corrected or exists(select 1 from private.ingredient_masters m where m.id=new.ingredient_id and not private.ingredient_identity_eligible(m.id,m.name)) then
 update private.ingredient_masters set canonical_ingredient_id=null where id=new.ingredient_id or canonical_ingredient_id=new.ingredient_id;
 if TG_OP='UPDATE' then
 update private.ingredient_masters set canonical_ingredient_id=null where id=old.ingredient_id or canonical_ingredient_id=old.ingredient_id;
 end if;
 end if;
 return new;
end $$;
create trigger ingredient_canonical_alias_correction after insert or update of corrected,ingredient_id,specification on private.ingredient_aliases
for each row execute function private.detach_corrected_ingredient();

revoke all on function private.ingredient_identity_name(text),private.ingredient_identity_key(text,text,jsonb,text),private.ingredient_identity_eligible(uuid,text),private.assign_ingredient_canonical(),private.check_ingredient_canonical(),private.detach_corrected_ingredient() from public,anon,authenticated;

-- Preserve existing endpoint authorization and all original pricing rows.
do $patch$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.ingredient_catalog(uuid)'::regprocedure);
 anchor:='to_jsonb(m)||jsonb_build_object(''aliases''';
 if strpos(src,anchor)=0 then raise exception 'catalog canonical anchor missing';end if;
 execute replace(src,anchor,'to_jsonb(m)||jsonb_build_object(''canonical_code'',coalesce((select c.ingredient_code from private.ingredient_masters c where c.id=m.canonical_ingredient_id),m.ingredient_code),''aliases''');
 src:=pg_get_functiondef('public.get_baihuayuan_ingredient_matching(uuid)'::regprocedure);
 anchor:='''ingredient_code'',m.ingredient_code';
 if strpos(src,anchor)=0 then raise exception 'matching canonical anchor missing';end if;
 src:=replace(src,anchor,anchor||',''canonical_ingredient_id'',m.canonical_ingredient_id,''canonical_code'',coalesce((select c.ingredient_code from private.ingredient_masters c where c.id=m.canonical_ingredient_id),m.ingredient_code)');
 anchor:='st.ingredient_id=m.id and st.supplier_key=''*''';
 if strpos(src,anchor)=0 then raise exception 'matching stop anchor missing';end if;
 execute replace(src,anchor,'st.ingredient_id in (m.id,m.canonical_ingredient_id) and st.supplier_key=''*''');
end $patch$;

do $preserve$
begin
 assert (select hash from ingredient_identity_preservation)=(select md5(string_agg((to_jsonb(m)-'canonical_ingredient_id')::text,'' order by id)) from private.ingredient_masters m),'Canonical mapping must preserve every original ingredient field';
end $preserve$;
