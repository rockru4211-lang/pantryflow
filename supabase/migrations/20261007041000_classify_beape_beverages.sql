-- Classify obvious BeApe beverage/alcohol items as 酒水.
-- Food/seasoning items that happen to use bottle/can units are intentionally excluded.

do $classify$
declare
  v_store uuid;
  v_org uuid;
  v_actor uuid;
begin
  select id,organization_id into v_store,v_org
  from public.stores
  where name='BeApe' and is_active
  order by (private.inventory_month_state(id,'2026-09-01'::date,null)#>>'{summary,items}')::int desc nulls last
  limit 1;

  if v_store is null then return; end if;

  select sm.user_id into v_actor
  from public.store_memberships sm
  where sm.store_id=v_store and sm.is_active and sm.role::text in ('OWNER','LOGISTICS','ADMIN')
  order by case sm.role::text when 'OWNER' then 0 when 'LOGISTICS' then 1 else 2 end,sm.created_at
  limit 1;

  insert into private.product_categories(product_id,category,updated_by)
  select p.id,'酒水',v_actor
  from public.products p
  where p.organization_id=v_org
    and p.name in (
      'AMARETTO DISARONNO 杏仁酒','Carac''Terre 2012','cointreau 君度澄酒',
      'Giffard (代替哈密瓜酒)','Intuition','Jim beam金賓(白)波本威士忌',
      'Prosecco氣泡酒 ( 調酒用 )','Renaissance','乾雪莉酒750ml','亞當博士苦精',
      '刺山酒窖6P貴腐甜白酒','勃根地夏樂酒莊 伯恩村一級園「荊棘園」紅酒',
      '勃根地夏樂酒莊 阿里哥蝶「小蝴蝶」白酒','南法羅特列克酒莊 「小不點」紅酒',
      '南法羅特列克酒莊 「小可愛」自然粉紅氣泡酒','南法羅特列克酒莊 卡拉多克紅酒',
      '南法羅特列克酒莊 月亮橘酒','南法萊昂內酒莊 白蘇維儂白酒',
      '夏布利摩克瑞酒莊「核心之岳」一級園白酒','多林 紅香艾酒','多林純香艾酒',
      '小瓢蟲酒莊 卡斯特勞紅酒','布列塔尼蘋果氣泡酒','德國德傑霍夫酒莊 「騎馬打仗」白酒',
      '思美洛夫伏特加','戀夏365日 SAISON','格倫瓦天然蜂蜜酒','格蘭8年雪莉風味桶 蘇格蘭威士忌',
      '檸檬無酒精蒸餾飲','歐恩丹 金龍舌蘭','氣泡水','沃斯柏林泡泡松氣泡飲',
      '法國侏羅「一起去郊遊」熊熊橘酒','法國獅心騎士白詩楠Blonde無酒精啤酒',
      '法國貓頭鷹蘋果氣泡酒','波思可森林酒莊 蒙提布希雅諾紅酒','波爾多 蒙佩哈堡紅酒',
      '無酒精 伊威酒莊 卡本內蘇維農紅酒','瑪黛茶氣泡飲','礦泉水','美粒果',
      '義大利布奇酒莊 維蒂奇歐白酒','義大利費希娜酒莊 典藏奇揚地紅酒',
      '聖-雷米VSOP法國白蘭地','胡格諾塔辛酒莊 黑中白老藤2010年份香檳','自由工藝',
      '艾普羅香甜酒','蓬蓬萊仙島HazyIPA','蔻特・杜柏依香檳・「查爾斯勒內」白中白香檳',
      '薑汁汽水','蘋果白蘭地','覆盆莓利口酒','諾布斯基琴酒','貝里斯奶酒','通寧水',
      '金巴利 香甜酒','開木斯酒莊 納帕卡本內紅酒50週年紀念版','雙喜Double IPA','馬爹拉酒750ml'
    )
  on conflict(product_id) do update set
    category='酒水',
    revision=private.product_categories.revision+1,
    updated_by=excluded.updated_by,
    updated_at=clock_timestamp();
end
$classify$;
