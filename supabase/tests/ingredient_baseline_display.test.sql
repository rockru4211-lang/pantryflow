do $test$
declare s uuid; actor uuid; item uuid; rev integer; req uuid:=gen_random_uuid(); result jsonb; payload jsonb;
begin
 select id,created_by into s,actor from public.stores where name='食譜測試' order by created_at desc limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into private.recipe_price_entries(store_id,name,unit,price,source,source_kind,effective_date,actor_id,review_status)
 values(s,'來源排序測試','g',0.4,'請購表：2026/08','purchase','2026-08-01',actor,'confirmed'),(s,'來源排序測試','g',0.9,'過去食譜','history','2026-10-01',actor,'confirmed');
 perform private.seed_ingredient_masters(s);
 select id,revision into item,rev from private.ingredient_masters where store_id=s and name='來源排序測試';
 assert public.app_workspace(s,'ingredient.sources',jsonb_build_object('id',item))#>>'{0,source}'='請購表：2026/08','purchasing displayed before newer history';
 assert exists(select 1 from jsonb_array_elements(public.app_workspace(s,'ingredients')->'ingredients') x where x->>'id'=item::text and x->>'source'='請購表：2026/08'),'catalog source provenance';
 payload:=jsonb_build_object('id',item,'revision',rev,'name','來源排序測試','unit','g','cost_price',null);
 result:=public.app_operation(s,'ingredient.save',payload,req);
 assert public.app_operation(s,'ingredient.save',payload,req)=result,'blank price save retry idempotent';
 assert exists(select 1 from jsonb_array_elements(public.app_workspace(s,'ingredients')->'ingredients') x where x->>'id'=item::text and x->>'cost_price' is null),'blank price saves and reads back';
end $test$;

