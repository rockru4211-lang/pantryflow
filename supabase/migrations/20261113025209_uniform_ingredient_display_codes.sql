-- Preserve import codes and all source IDs. Only official display codes change.
lock table private.ingredient_masters, private.ingredient_code_links in share row exclusive mode;

create table private.ingredient_display_codes (
 ingredient_id uuid primary key references private.ingredient_masters(id),
 code text not null check(code ~ '^F[0-9]{6,}$')
);
alter table private.ingredient_display_codes enable row level security;
revoke all on private.ingredient_display_codes from public,anon,authenticated;

with legacy as materialized (
 select m.id,s.organization_id,m.ingredient_code,
  (select min(a.source_key) from private.ingredient_aliases a where a.store_id=m.store_id
   and a.ingredient_id=m.id and a.source_key like 'p:%'
   having count(distinct a.source_key)=1) product_key
 from private.ingredient_masters m join public.stores s on s.id=m.store_id
 where s.name in ('BeApe','Gras') and m.ingredient_code !~ '^F[0-9]{6,}$'
), scopes as materialized (
 select organization_id,ingredient_code,count(distinct product_key)=1 and bool_and(product_key is not null) same_product
 from legacy group by organization_id,ingredient_code
), identities as materialized (
 select l.id,case when s.same_product then jsonb_build_array(l.organization_id,l.ingredient_code,l.product_key)::text
  else l.id::text end identity
 from legacy l join scopes s using(organization_id,ingredient_code)
), numbered as materialized (
 select identity,nextval('private.ingredient_code_sequence') n from (select distinct identity from identities) i order by identity
)
insert into private.ingredient_display_codes(ingredient_id,code)
select i.id,'F'||lpad(n.n::text,greatest(6,length(n.n::text)),'0') from identities i join numbered n using(identity);

create or replace function private.managed_ingredient_code(i uuid) returns text language sql stable set search_path='' as $$
 select coalesce(display.code,t.ingredient_code,r.ingredient_code,m.ingredient_code)
 from private.ingredient_masters m
 left join private.ingredient_masters r on r.id=m.canonical_ingredient_id
 left join private.ingredient_code_links l on l.ingredient_id=coalesce(r.id,m.id)
 left join private.ingredient_masters t on t.id=l.target_id
 left join private.ingredient_display_codes display on display.ingredient_id=coalesce(t.id,r.id,m.id)
 where m.id=i
$$;

-- Match the chosen root's visible code in the existing revision guard.
do $rpc$
declare source text; anchor text:='p_data->>''target_code'' is distinct from b.ingredient_code';
begin
 source:=pg_get_functiondef('public.baihuayuan_code_management(uuid,text,jsonb,uuid)'::regprocedure);
 if strpos(source,anchor)=0 then raise exception 'INGREDIENT_DISPLAY_CODE_GUARD_ANCHOR';end if;
 execute replace(source,anchor,'p_data->>''target_code'' is distinct from private.managed_ingredient_code(b.id)');
end
$rpc$;

-- Match the reviewed pepper pair only where the stored package and purchase
-- source still agree. The existing same-store merge preserves both price rows.
do $pepper$
declare pair record;
begin
 for pair in
  select old.store_id,old.id source_id,main.id target_id,main.revision
  from private.ingredient_masters old
  join private.ingredient_masters main on main.store_id=old.store_id
   and main.ingredient_code in ('F002262','F003848')
  join public.stores s on s.id=old.store_id and s.name in ('BeApe','Gras')
  join private.recipe_price_entries a on a.id=old.selected_reference and a.store_id=old.store_id
  join private.recipe_price_entries b on b.id=main.selected_reference and b.store_id=main.store_id
  where old.ingredient_code='SEQ-CF87ADF4A720C9B8'
   and private.managed_ingredient_code(main.id)='F002262'
   and old.name=main.name||' · 600g' and old.purchase=main.purchase
   and old.review_status='confirmed' and main.review_status='confirmed'
   and not old.manual and not main.manual and old.canonical_ingredient_id is null
   and a.source_kind='purchase' and b.source_kind='purchase' and a.effective_date=b.effective_date
   and nullif(a.source_ref->>'supplier_name','')=nullif(b.source_ref->>'supplier_name','')
   and not exists(select 1 from private.ingredient_supply_state st where st.ingredient_id in(old.id,main.id) and st.stopped)
 loop
  perform private.merge_ingredient_price_duplicate(pair.store_id,pair.source_id,pair.target_id,pair.revision);
 end loop;
end
$pepper$;

notify pgrst,'reload schema';
