-- Avoid treating packaging as its printed food name, or wine as grapes.
do $$
declare src text;
begin
 select pg_get_functiondef('private.classify_product(text,text)'::regprocedure) into src;
 if strpos(src,'|盒蓋|')=0 or strpos(src,$rule$ when p_name ~* '(核桃|$rule$)=0 then raise exception 'CATEGORY_RULE_ANCHOR_MISSING';end if;
 src:=replace(src,'|盒蓋|','|盒蓋|腿蓋|杯套|手提袋|包裝袋|貼紙|LDPE|HDPE|');
 src:=replace(src,'|紅酒醋|','|紅酒醋|葡萄酒醋|紅酒醬|');
 src:=replace(src,$rule$ when p_name ~* '(醬油|$rule$, $rule$ when p_name ~* '(蛋糕|餅乾|冰淇淋|奶酪)' then '食材'$rule$||chr(10)||$rule$ when p_name ~* '(醬油|$rule$);
 src:=replace(src,$rule$ when p_name ~* '(核桃|$rule$, $rule$ when p_name ~* '(紅酒|白酒|葡萄酒|清酒)' then '待分類'$rule$||chr(10)||$rule$ when p_name ~* '(核桃|$rule$);
 execute src;
end $$;
