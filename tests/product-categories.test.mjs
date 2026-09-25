import test from 'node:test';import assert from 'node:assert/strict';
import {inventoryCategorySummary,filterInventory} from '../lib/inventory-monthly.ts';
import {supplierPriceItems} from '../lib/supplier-prices.ts';
import {productCategory} from '../lib/product-categories.ts';
const row={product_id:'p',category:'食材',name:'核桃',supplier:'大永',zones:[{zone_id:'dry'},{zone_id:'cold'}],current_quantity:3,previous_quantity:2,amount:60,previous_amount:40,missing_price:false,needs_review:false};
test('category, zone, search and pending filters intersect without splitting quantities',()=>{
 const rows=[row,{...row,product_id:'s',name:'保鮮膜',category:'耗材',needs_review:true}];
 assert.deepEqual(filterInventory(rows,{category:'食材',zone:'cold',search:'大永',pending:false}),[row]);
 assert.equal(filterInventory(rows,{category:'耗材',zone:'dry',search:'保鮮膜',pending:true}).length,1);
 assert.equal(filterInventory(rows,{category:'酒水',zone:'dry',search:'',pending:false}).length,0);
});
test('category cards include missing previous-only rows and preserve unknown/zero amounts',()=>{
 const summary=inventoryCategorySummary([row,{...row,product_id:'missing',current_quantity:null,amount:null,previous_amount:20,needs_review:true},{...row,product_id:'no-price',amount:null,missing_price:true,previous_quantity:null,previous_amount:null,needs_review:true}],true);
 assert.deepEqual(summary,{items:2,subtotal:60,missing_prices:1,pending:2,previous_subtotal:60,previous_missing_prices:0,amount_difference:0});
 assert.equal(inventoryCategorySummary([{...row,amount:0}],false).subtotal,0);
 assert.equal(inventoryCategorySummary([],false).subtotal,null);
 assert.equal(inventoryCategorySummary([row],false).amount_difference,null);
});
test('supplier history and fresh catalogue items use one canonical category; unmapped stays pending',()=>{
 const supplier={id:'s',name:'大永',aliases:[]};
 const products=[{id:'p',name:'核桃',base_unit:'包',specification:'1kg',current_supplier_id:'s',is_active:true,primary_category:'食材',category_revision:4},{id:'o',name:'橄欖油',base_unit:'瓶',current_supplier_id:'s',is_active:true,primary_category:'調料'}];
 const base={supplier_name:'大永',product_id:'p',product_name:'舊品名',unit:'包',specification:'1kg',receipt_date:'2026/09/01',uploaded_at:'2026-09-01',batch_id:'a',row_key:'1',status:'COMPLETE',unit_price:10};
 const items=supplierPriceItems(supplier,products,[base,{...base,product_id:null,product_name:'未對應',row_key:'2'}],[supplier]);
 assert.equal(items.find(i=>i.productId==='p').category,'食材');assert.equal(items.find(i=>i.productId==='p').categoryRevision,4);
 assert.equal(items.find(i=>i.productId==='o').category,'調料');assert.equal(items.find(i=>!i.productId).category,'待分類');
 assert.equal(productCategory('自訂舊分類'),'待分類');
});
