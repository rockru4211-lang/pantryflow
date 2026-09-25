import test from 'node:test';import assert from 'node:assert/strict';
import {supplierPriceItems,supplierForLine,safeSupplierLink,supplierReceiptDate} from '../lib/supplier-prices.ts';
const s={id:'s',name:'大永',is_active:true,updated_at:'now',aliases:['大永企業']};
const row=(id,price,date='2026/09/25',extra={})=>({batch_id:id,row_key:'1',product_id:'p',product_name:'油',supplier_name:'大永',specification:'18L',unit:'桶',unit_price:price,quantity:1,receipt_date:date,uploaded_at:date,status:'COMPLETE',review_allowed:true,...extra});
const items=(rows,products=[])=>supplierPriceItems(s,products,rows,[s]);
test('compares separate confirmed receipts in receipt-date order, not upload order',()=>{
 const result=items([row('b',950,'115/09/25',{uploaded_at:'2026-09-25'}),row('a',900,'2026/09/01',{uploaded_at:'2026-09-26'}),row('pending',5000,'2026/09/26',{status:'PENDING'})])[0];
 assert.equal(result.latest,950);assert.equal(result.previous,900);assert.equal(result.change,50);assert.equal(result.percent,5.6);assert.equal(result.pending,1);
});
test('unlike specs, units and product identities cannot form a price comparison',()=>{
 const result=items([row('a',900),row('b',950,'2026/09/26',{unit:'箱'}),row('c',100,'2026/09/26',{specification:'2L'}),row('d',300,'2026/09/26',{product_id:'other'})]);
 assert.equal(result.length,4);assert(result.every(r=>r.previous===null&&r.change===null));
});
test('two rows on one invoice are not two observations and mixed prices require inspection',()=>{
 let result=items([row('b',950),row('b',950,'2026/09/25',{row_key:'2'}),row('a',900,'2026/09/01')])[0];assert.equal(result.previous,900);
 result=items([row('b',950),row('b',940,'2026/09/25',{row_key:'2'}),row('a',900,'2026/09/01')])[0];assert.equal(result.ambiguous,true);assert.equal(result.latest,null);assert.equal(result.change,null);
});
test('zero is valid while unknown prices, unmapped items, impossible dates cannot create a delta',()=>{
 const r=items([row('a',0,'2026/09/01'),row('b',10)])[0];assert.equal(r.change,10);assert.equal(r.percent,null);
 for(const extra of [{unit_price:null},{product_id:null},{receipt_date:'2026/02/30'},{unit:'未提供'},{status:'PENDING'}])assert(items([row('x',100,'2026/09/25',extra)]).every(i=>i.latest===null));
 assert.equal(supplierReceiptDate('民國115年9月2日'),'2026-09-02');
});
test('supplier aliases preserve links while ambiguous names are never silently merged',()=>{
 const line=row('x',100,'2026/09/25',{supplier_name:' 大永 企業 '});assert.equal(supplierForLine([s],line)?.id,'s');assert.equal(supplierForLine([s,{...s,id:'other'}],line),undefined);
});
test('new supplier products remain reachable without inventing prices, unsafe links are blocked',()=>{
 const result=items([],[{id:'new',name:'新食材',specification:'1kg',base_unit:'包',current_supplier_id:'s',is_active:true}]);assert.equal(result.length,1);assert.equal(result[0].latest,null);
 assert.equal(safeSupplierLink('javascript:alert(1)'),null);assert.equal(safeSupplierLink('data:text/html,x'),null);assert.equal(safeSupplierLink('https://example.com/order'),'https://example.com/order');
});
