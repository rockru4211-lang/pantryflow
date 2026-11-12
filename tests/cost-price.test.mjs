import test from 'node:test';
import assert from 'node:assert/strict';
import {purchaseUnitPrice,applyCostQuotes,loadTransferAmounts} from '../lib/cost-price.ts';
test('purchase units and known package contents convert without guessing',()=>{
 assert.equal(purchaseUnitPrice({amount:35,quantity:1,unit:'包',content_quantity:1000,content_unit:'g'},'公斤'),35);
 assert.equal(purchaseUnitPrice({amount:35,quantity:1,unit:'包',content_quantity:1000,content_unit:'g'},'g'),.035);
 assert.equal(purchaseUnitPrice({amount:35,quantity:1,unit:'斤'},'公斤'),35/600*1000);
 assert.equal(purchaseUnitPrice({amount:450,quantity:1,unit:'瓶',content_quantity:750,content_unit:'ml'},'ml'),.6);
 assert.equal(purchaseUnitPrice({amount:450,quantity:1,unit:'瓶'},'g'),null);
 assert.equal(purchaseUnitPrice({amount:420,quantity:1,unit:'公斤'},'支'),null);
});
test('quote preview clears stale prices on unresolved quotes and preserves retry identity',()=>{
 const rows=[{id:'a',requestId:'retry',values:{price:'10',quantity:'2',name:'甲'},meta:{revision:4}},{id:'b',values:{price:'',quantity:'3'}}];
 const out=applyCostQuotes(rows,[{price:null,reason:'缺容量'},{price:12,source:'請購表',date:'2026-09-01'}]);
 assert.equal(out[0].values.price,'');assert.equal(out[0].values.amount,'');assert.equal(out[0].values.purchase_price,'');assert.equal(out[0].requestId,'retry');assert.equal(out[0].meta.revision,4);
 assert.equal(out[1].values.amount,'36');assert.equal(rows[1].values.price,'');
 assert.match(out[1].values.price_source,/請購表/);assert.throws(()=>applyCostQuotes(rows,[]));
});

test('saved missing transfer costs are not hydrated from current prices',async()=>{
 const rows=[{id:'old',values:{name:'鱸魚',unit:'kg',quantity:'3',price:'',amount:''}},{id:'saved',values:{quantity:'2',price:'90',amount:'180'}}];
 const result=await loadTransferAmounts(rows,async()=>{throw Error('Historical lookup forbidden');});
 assert.deepEqual(result,rows);
});
test('new transfer previews retain missing and genuine zero costs distinctly',async()=>{
 const rows=[{id:'new',fresh:true,values:{quantity:'2',price:'',amount:''}},{id:'missing',fresh:true,values:{quantity:'2',price:'',amount:''}}];
 const result=await loadTransferAmounts(rows,async()=>[{price:0,source:'已確認建檔進貨'},{price:null,reason:'規格衝突'}]);
 assert.equal(result[0].values.amount,'0');assert.equal(result[1].values.amount,'');assert.equal(result[1].values.price,'');
});
test('automatic save guard preserves full expected quote including unresolved and zero prices',async()=>{
 const {automaticCostGuard,transferReviewPricing}=await import('../lib/cost-price.ts');
 const quote={price:12,reference_id:'receipt:1',date:'2026-11-01',basis:'receipt',purchase:{amount:120,quantity:1,unit:'公斤'}};
 const row={id:'a',values:{price:'12'},meta:{costQuote:quote}};
 assert.deepEqual(automaticCostGuard(row),{price_mode:'automatic',expected_cost_quote:quote});
 assert.deepEqual(automaticCostGuard({...row,values:{price:'13'}}),{});
 assert.deepEqual(automaticCostGuard({...row,meta:{}}),{});
 assert.equal(automaticCostGuard({values:{price:''},meta:{costQuote:{price:null,reason:'conflict'}}}).expected_cost_quote.price,null);
 assert.equal(automaticCostGuard({values:{price:'0'},meta:{costQuote:{price:0}}}).price_mode,'automatic');
 assert.equal(transferReviewPricing({review_status:'PENDING',reference_price:10,cost_quote:quote}).expected_cost_quote,quote);
 assert.deepEqual(transferReviewPricing({review_status:'PENDING',reference_price:10}),{price_mode:'automatic',expected_cost_quote:{price:10}});
 assert.deepEqual(transferReviewPricing({review_status:'CONFIRMED',reference_price:10}),{price_mode:'manual'});
});
test('different same-label receipt package keeps normalized operation cost on quantity edits',async()=>{
 const {recalculateSheet}=await import('../lib/operations-sheet.ts');
 const quote={price:150,purchase:{amount:300,quantity:1,unit:'包',content_quantity:1000,content_unit:'g'}};
 const [row]=applyCostQuotes([{id:'a',values:{name:'糖',unit:'包',quantity:'2',price:''}}],[quote]);
 assert.equal(row.values.purchase_price,'150');assert.equal(row.values.content_quantity,'');
 assert.equal(recalculateSheet({...row.values,quantity:'3'}).amount,'450');
 assert.equal(row.meta.costQuote,quote);assert.equal(row.meta.costQuote.purchase.content_quantity,1000);
});
