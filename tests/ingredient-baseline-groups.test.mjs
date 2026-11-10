import test from 'node:test';
import assert from 'node:assert/strict';
import {baselineGroups,baselineSources,ingredientReviewGroups} from '../lib/ingredient-price-sheet.ts';
const row=(id,name,extra={})=>({id,name,unit:'g',cost_price:1,revision:1,aliases:[],source:'歷史食譜：菜單',source_kind:'history',...extra});
test('history price annotations group without changing identities, prices or caller data',()=>{
 const input=[row('a','巴西里 · 原表計價基準：480 元／600 g'),row('b','巴西里 · 原表計價基準：800 元／1000 g',{cost_price:2}),row('c','巴西里',{manual:true,cost_price:3})];
 const before=JSON.stringify(input),groups=baselineGroups(input);assert.equal(groups.length,1);assert.equal(groups[0].name,'巴西里');assert.equal(groups[0].rows[0].id,'c');assert.deepEqual(groups[0].rows.map(r=>r.cost_price),[3,1,2]);assert.equal(JSON.stringify(input),before);
});
test('units, brands, capacities and corrected aliases never silently combine',()=>{
 const input=[row('a','橄欖油'),row('b','橄欖油',{unit:'ml'}),row('c','初榨橄欖油'),row('d','橄欖油 · 5L'),row('e','橄欖油',{aliases:[{specification:'3L'}]}),row('f','橄欖油',{aliases:[{corrected:true}]})];assert.equal(baselineGroups(input).length,6);
});
test('purchasing outranks recipes and dates use source dates, never import dates',()=>{
 const input=[row('old','歷史',{effective_date:'2026-10-08'}),row('missing','未記日期',{source:'請購表'}),row('aug','八月',{source:'請購表',effective_date:'2026-08-01'}),row('sep','九月',{sources:[{id:'q',source:'請購表',effective_date:'2026-09-01',created_at:'2026-10-01'}]})];
 assert.deepEqual(baselineGroups(input).map(g=>g.rows[0].id),['sep','aug','missing','old']);assert.equal(baselineGroups(input).at(-1).history,true);
});
test('sources put requisitions before recent recipes and receipts, preserving prices',()=>{
 const r=row('x','品項',{sources:[{id:'h',source:'歷史食譜',source_kind:'history',effective_date:'2026-10-01',price:3},{id:'r',source:'已核對進貨',source_kind:'purchase',price:2},{id:'p',source:'請購表',effective_date:'2026-08-01',price:1}]});assert.deepEqual(baselineSources(r).map(s=>s.id),['p','r','h']);assert.equal(r.sources[0].price,3);
});

test('receipt prices retain the original untaxed amount and isolate incomplete package matches',async()=>{
 const {ingredientReceiptPrices,ingredientPerBaseUnit}=await import('../lib/ingredient-price-sheet.ts');
 const source={id:'receipt',price:1.4,receipt_price:350,receipt_unit:'包',effective_date:'2026-10-26',receipt_supplier:'大永',
  receipt_purchase:{amount:350,quantity:1,unit:'包',content_quantity:500,content_unit:'g'}};
 const active=row('root','核桃 · 500g',{unit:'包',purchase:source.receipt_purchase,sources:[source]});
 const old=row('old','核桃',{unit:'包',sources:[{id:'ref',price:350,effective_date:'2026-10-01'}]});
 const groups=baselineGroups([active,old]);
 assert.equal(groups.length,2);
 const review=ingredientReviewGroups(groups);
 assert.equal(review.length,1);
 assert.deepEqual(review[0].rows.map(r=>r.id),['root','old']);
 const receipts=ingredientReceiptPrices([active,old,active]);
 assert.equal(receipts.length,1);
 assert.equal(receipts[0].purchase.amount,350);
 assert.deepEqual(ingredientPerBaseUnit(receipts[0].purchase),{price:700,label:'公斤'});
 assert.equal(ingredientReceiptPrices([active],'其他供應商').length,0);
});

test('an imported name with a repeated package appears for review without combining records',()=>{
 const item='全殼熟淡菜,500g/包,15包/箱';
 const purchase={amount:350,quantity:1,unit:'包',content_quantity:500,content_unit:'g'};
 const input=[row('a',item,{unit:'包',purchase}),row('b',item+' · 500 g／包',{unit:'包',purchase}),
  row('c',item+' · 750g/包',{unit:'包',purchase:{...purchase,content_quantity:750}}),
  row('d','全殼熟淡菜,1500g/包,15包/箱 · 500g/包',{unit:'包',purchase})];
 const before=JSON.stringify(input),groups=baselineGroups(input),review=ingredientReviewGroups(groups);
 assert.equal(groups.length,4);
 assert.deepEqual(review.map(group=>group.rows.map(item=>item.id)),[['a','b']]);
 assert.equal(JSON.stringify(input),before);
});
