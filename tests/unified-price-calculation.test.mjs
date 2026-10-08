import test from 'node:test';
import assert from 'node:assert/strict';
import {recalculateSheet,changeSheetValues,moneyAmount,transferDirectionValues,sheetImports} from '../lib/operations-sheet.ts';
import {costBasisNote,restoreCostBasis,applyCostQuotes} from '../lib/cost-price.ts';
const row=(quantity,unit,price,priceUnit,content='',contentUnit='')=>({quantity,unit,purchase_price:price,price_unit:priceUnit,content_quantity:content,content_unit:contentUnit,price:'',amount:'',note:''});
test('all operation units use the same purchase basis, without displaying the converted unit price',()=>{
 assert.equal(recalculateSheet(row('300','克','900','公斤')).amount,'270');
 assert.equal(recalculateSheet(row('300','克','120','台斤')).amount,'60');
 assert.equal(recalculateSheet(row('150','ml','90','瓶','750','ml')).amount,'18');
 assert.equal(recalculateSheet(row('0.5','包','200','包','1000','克')).amount,'100');
 const changed=changeSheetValues(recalculateSheet(row('1','公斤','900','公斤')),'unit','克');
 assert.equal(changed.purchase_price,'900');assert.equal(changed.price_unit,'公斤');assert.equal(changed.price,'0.9');assert.equal(changed.amount,'0.9');
});
test('unknown package quantities and weight/volume mismatch remain missing, explicit zero remains zero',()=>{
 assert.equal(recalculateSheet(row('300','克','90','瓶','750','ml')).amount,'');
 assert.equal(recalculateSheet(row('300','克','90','包')).price,'');
 assert.equal(recalculateSheet(row('300','克','','公斤')).amount,'');
 assert.equal(recalculateSheet(row('300','克','0','公斤')).amount,'0');
 assert.equal(changeSheetValues({...row('3','包','90','包'),name:'A'},'name','B').price,'');
 assert.equal(moneyAmount('3','0.335'),'1.01');
});
test('saved operations retain the purchase basis rather than consulting changed standards on reload',()=>{
 const v=recalculateSheet(row('300','克','900','公斤'));const note=costBasisNote(v);
 const restored=restoreCostBasis({quantity:'300',unit:'克',price:'0.9',amount:'270',note});
 assert.equal(restored.purchase_price,'900');assert.equal(restored.price_unit,'公斤');assert.equal(restored.note,'');
 const fallback=restoreCostBasis({quantity:'300',unit:'克',price:'1.2',amount:'360',note});
 assert.equal(fallback.purchase_price,'1.2');assert.equal(fallback.price_unit,'克');
});
test('shared quotes carry source package details and precise normalized price',()=>{
 const [v]=applyCostQuotes([{id:'a',values:{quantity:'150',unit:'ml',price:''}}],[{price:.12,purchase:{amount:90,quantity:1,unit:'瓶',content_quantity:750,content_unit:'ml'}}]);
 assert.equal(v.values.purchase_price,'90');assert.equal(v.values.price_unit,'瓶');assert.equal(v.values.content_quantity,'750');assert.equal(v.values.amount,'18');
});

test('transfer direction changes both stores and clears the old source price',()=>{
 const original={...recalculateSheet(row('300','克','900','公斤')),direction:'一店→二店',from:'BeApe',to:'Gras'};
 const changed=changeSheetValues(original,'direction','二店→一店');
 assert.equal(changed.from,'Gras');assert.equal(changed.to,'BeApe');assert.equal(changed.price,'');assert.equal(changed.amount,'');
 assert.equal(transferDirectionValues({...changed,direction:'一店→二店'}).from,'BeApe');
 const imported=sheetImports([{'品名':'菲力','調撥方向':'二店→一店','數量':'2'}],[{key:'name',label:'品名'},{key:'direction',label:'調撥方向',editable:r=>!!r.fresh},{key:'quantity',label:'數量',type:'number'}],[],{from:'BeApe',to:'Gras',direction:'一店→二店'},()=>crypto.randomUUID());
 assert.equal(imported.rows[0].values.from,'Gras');assert.equal(imported.rows[0].values.to,'BeApe');
 const saved={id:'saved',values:original};
 const protectedRow=sheetImports([{'資料編號':'saved','調撥方向':'二店→一店','數量':'301'}],[{key:'direction',label:'調撥方向',editable:r=>!!r.fresh},{key:'quantity',label:'數量',type:'number'}],[saved],{},()=>crypto.randomUUID()).rows[0];
 assert.equal(protectedRow.values.from,'BeApe');assert.equal(protectedRow.values.to,'Gras');
});
