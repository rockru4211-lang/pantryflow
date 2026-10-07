import test from 'node:test';
import assert from 'node:assert/strict';
import {purchaseUnitPrice,applyCostQuotes} from '../lib/cost-price.ts';
test('purchase units and known package contents convert without guessing',()=>{
 assert.equal(purchaseUnitPrice({amount:35,quantity:1,unit:'包',content_quantity:1000,content_unit:'g'},'公斤'),35);
 assert.equal(purchaseUnitPrice({amount:35,quantity:1,unit:'包',content_quantity:1000,content_unit:'g'},'g'),.035);
 assert.equal(purchaseUnitPrice({amount:35,quantity:1,unit:'斤'},'公斤'),35/600*1000);
 assert.equal(purchaseUnitPrice({amount:450,quantity:1,unit:'瓶',content_quantity:750,content_unit:'ml'},'ml'),.6);
 assert.equal(purchaseUnitPrice({amount:450,quantity:1,unit:'瓶'},'g'),null);
 assert.equal(purchaseUnitPrice({amount:420,quantity:1,unit:'公斤'},'支'),null);
});
test('quote preview preserves unresolved inputs and original retry identity',()=>{
 const rows=[{id:'a',requestId:'retry',values:{price:'10',quantity:'2',name:'甲'},meta:{revision:4}},{id:'b',values:{price:'',quantity:'3'}}];
 const out=applyCostQuotes(rows,[{price:null,reason:'缺容量'},{price:12,source:'請購表',date:'2026-09-01'}]);
 assert.equal(out[0].values.price,'10');assert.equal(out[0].requestId,'retry');assert.equal(out[0].meta.revision,4);
 assert.equal(out[1].values.amount,'36');assert.equal(rows[1].values.price,'');
 assert.match(out[1].values.price_source,/請購表/);assert.throws(()=>applyCostQuotes(rows,[]));
});
