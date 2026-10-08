import test from 'node:test';
import assert from 'node:assert/strict';
import {baselineGroups,baselineSources} from '../lib/ingredient-price-sheet.ts';
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
