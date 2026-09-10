begin;
do $test$
declare s uuid;u uuid;staff uuid;a jsonb;b jsonb;denied boolean;
begin
 select id into s from public.stores where store_code='QAFULLINDEP';
 select sm.user_id into u from public.store_memberships sm join public.organization_members om on om.user_id=sm.user_id and om.organization_id=sm.organization_id where sm.store_id=s and om.is_owner;
 select sm.user_id into staff from public.store_memberships sm where sm.store_id=s and sm.role='STAFF' and sm.is_active limit 1;
 assert u is not null and staff is not null,'QA fixtures missing';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 a:=public.app_workspace(s,'reports','{"from":"2026-08-01T00:00:00+08:00","to":"2026-09-01T00:00:00+08:00"}');
 b:=public.app_workspace(s,'reports','{"from":"2026-09-01T00:00:00+08:00","to":"2026-10-01T00:00:00+08:00"}');
 assert exists(select 1 from jsonb_array_elements(a->'receipts') r where r->>'document_number'='20260827005'),'August receipt omitted';
 assert not exists(select 1 from jsonb_array_elements(b->'receipts') r where r->>'document_number'='20260827005'),'review date moved August receipt into September';
 assert (select count(*) from jsonb_array_elements(a->'lines') r where r->>'source_batch_id'='39916e08-adf5-4ef0-95e5-9128d557e624')=3,'receipt rows missing';
 assert exists(select 1 from jsonb_array_elements(a->'lines') r where r->>'name'='Broken lump 碎蟹腿' and r->>'product_id' is not null and r->>'inventory_status'='POSTED'),'resolved identity missing';
 assert (select count(*) from jsonb_array_elements(a->'lines') r where r->>'inventory_status'='MAPPING_PENDING')=2,'unmapped stock guessed';
 perform set_config('request.jwt.claim.sub',staff::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 denied:=false;begin perform public.app_workspace(s,'reports');exception when insufficient_privilege then denied:=true;end;assert denied,'staff read cost report';
end $test$;
rollback;
select 'PASS: actual receipt month, three saved lines, resolved identity, pending stock, role denial' result;
