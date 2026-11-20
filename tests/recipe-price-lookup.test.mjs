import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeLookupOptions,recipeLookupOffers,recipeLookupDraft,recipeLookupPreview} from '../lib/recipe-price-lookup.ts';
import {emptyRecipe} from '../lib/recipe-cost.ts';
import {recipeCommitPrices} from '../lib/recipe-price-draft.ts';
const ws={recipes:[],products:[],prices:[],can_price:true};
const line={id:'row',name:'餐用油',quantity:'15',unit:'g'};
const offer=(id,basis='receipt',unit='g')=>({name:'餐用油',code:'F-TEST',stopped:false,quote:{reference_id:id,basis,source:basis==='receipt'?'已確認建檔進貨':'請購表',supplier_name:'供應商 A',date:'2026-11-19',purchase:{amount:300,quantity:1,unit:'桶',content_quantity:3000,content_unit:unit}}});
test('lookup preserves original package, source and supplier while staging only a recipe quote',()=>{
 const option=recipeLookupOffers([offer('receipt-line')])[0],before=JSON.stringify(ws),draft=recipeLookupDraft(line,option,ws);
 assert.equal(draft.amount,'300');assert.equal(draft.unit,'桶');assert.equal(draft.content,'3000');assert.equal(draft.referenceId,undefined);assert.match(draft.source,/供應商：供應商 A/);
 const preview=recipeLookupPreview(line,draft,ws,'');assert.equal(preview.amount,1.5);
 const prices=recipeCommitPrices({...emptyRecipe(),lines:[line]},ws,{row:draft});assert.equal(prices[0].price,.1);assert.equal(prices[0].purchase.amount,300);assert.match(prices[0].source,/供應商 A/);assert.equal(JSON.stringify(ws),before);
 const reopened={...option.price,key:'n:餐用油',name:'餐用油',source:prices[0].source,source_kind:'manual',supplier_name:undefined,source_ref:undefined};assert.equal(recipeLookupOptions({...ws,prices:[reopened]},'餐用油')[0].supplier,'供應商 A');
});
test('volume and count quotes require explicit conversion and do not invent zero costs',()=>{
 const option=recipeLookupOffers([offer('volume','receipt','ml')])[0],draft=recipeLookupDraft(line,option,ws);
 assert.equal(recipeLookupPreview(line,draft,ws,'').unitCost,null);
 assert.ok(Math.abs(recipeLookupPreview(line,{...draft,content:'2500',contentUnit:'g'},ws,'').amount-1.8)<1e-10);
 const beforeUsage=recipeLookupPreview({...line,quantity:''},{...draft,content:'2500',contentUnit:'g'},ws,'');assert.equal(beforeUsage.unitCost,.12);assert.equal(beforeUsage.amount,null);
 const zero=recipeLookupDraft(line,{...option,price:{...option.price,price:0,purchase:{amount:0,quantity:1,unit:'g'}}},ws);assert.equal(recipeLookupPreview(line,zero,ws,'').amount,0);
});
test('lookup orders live receipts before requests and history, searches suppliers, and isolates current query results',()=>{
 const quote={key:'n:餐用油',name:'餐用油',product_id:null,unit:'g',price:.2,source:'原食譜',source_kind:'history',effective_date:null};
 const request=recipeLookupOffers([offer('request','purchase')]),live=recipeLookupOffers([offer('receipt')]);
 const workspace={...ws,prices:[quote]},before=JSON.stringify(workspace);
 const options=recipeLookupOptions(workspace,'餐用油',[...request,...live]);assert.deepEqual(options.map(o=>o.source),['receipt','request','history']);
 assert.equal(recipeLookupOptions(workspace,'供應商 A',live).length,1);assert.equal(recipeLookupOptions(workspace,'其他食材',live).length,0);assert.equal(JSON.stringify(workspace),before);
 const wrongRef=recipeLookupDraft({...line,name:'另一品名'},options[2],ws);assert.equal(wrongRef.referenceId,undefined);assert.match(wrongRef.source,/原價日期未記載/);
});
