import test from 'node:test';
import assert from 'node:assert/strict';
import {priceCandidate,priceSearch,isIngredientStopped,priceEdit,supplierOptions} from '../lib/ingredient-price-sheet.ts';
const source=(id,price,date,key='id:a')=>({id,price,effective_date:date,created_at:date,unit:'g',review_status:'confirmed',source_kind:'purchase',supplier_key:key,supplier_name:key==='id:a'?'甲廠商':'乙廠商'});
const row={id:'m',name:'奶油',unit:'g',cost_price:.28,selected_reference:'old',review_status:'confirmed',revision:1,aliases:[{id:'a',name:'無鹽牛油'}],supplier_key:'id:a',supplier_name:'甲廠商',sources:[source('old',.28,'2026-09-01'),source('new',.3,'2026-10-01')]};
test('latest comparable quote only: older differences do not appear after latest equals standard',()=>{assert.equal(priceCandidate(row,[]).id,'new');assert.equal(priceCandidate({...row,cost_price:.3},[]),null);assert.equal(priceCandidate({...row,dismissed_reference:'new',dismissed_value:.3},[]),null);assert.equal(priceCandidate({...row,dismissed_reference:'new',dismissed_value:.4},[]).id,'new');});
test('supplier-specific stop preserves ingredient and alternative supplier; whole stop hides price candidates',()=>{const stopped=[{ingredient_id:'m',supplier_key:'id:a',stopped:true}];assert.equal(isIngredientStopped(row,stopped),false);assert.equal(priceCandidate(row,stopped),null);assert.equal(priceCandidate({...row,sources:[...row.sources,source('b',.29,'2026-10-02','id:b')]},stopped).id,'b');assert.equal(isIngredientStopped(row,[{ingredient_id:'m',supplier_key:'*',stopped:true}]),true);});
test('different units, unrelated store references and unconfirmed sources are never automatically comparable',()=>{assert.equal(priceCandidate({...row,sources:[{...source('q',30,'2026-10-02'),unit:'包'}]},[]),null);assert.equal(priceCandidate({...row,sources:[{...source('q',.3,'2026-10-02'),can_apply:false}]},[]),null);assert.equal(priceCandidate({...row,sources:[{...source('q',.3,'2026-10-02'),review_status:'pending'}]},[]),null);});
test('supplier and every alias are searchable; edit uses package price and stable supplier identity',()=>{assert(priceSearch(row,'無鹽牛油'));assert(priceSearch(row,'甲廠商'));assert.equal(priceEdit(row).supplier_id,'a');assert.equal(supplierOptions(row).length,1);assert.equal(priceEdit({...row,purchase:{amount:280,quantity:1,unit:'公斤'}}).price,'280');});

test('price changes compare confirmed same-supplier same-package prices only',async()=>{
 const {priceChange}=await import('../lib/ingredient-price-sheet.ts');
 const h={snapshot:{...row,cost_price:.3},previous_snapshot:row,supplier_key:'id:a',previous_supplier_key:'id:a'};
 assert(Math.abs(priceChange(h).percent-7.142857)<.00001);
 assert.equal(priceChange({...h,previous_snapshot:null}).percent,null);
 assert.equal(priceChange({...h,previous_supplier_key:null}).percent,null);
 assert.equal(priceChange({...h,supplier_key:'id:b'}).note,'供應商變更');
 assert.equal(priceChange({...h,previous_snapshot:{...row,cost_price:0}}).percent,null);
 const old={...row,purchase:{amount:100,quantity:1,unit:'包',content_quantity:500,content_unit:'g'}},next={...row,purchase:{amount:150,quantity:1,unit:'包',content_quantity:750,content_unit:'g'}};
 assert.equal(priceChange({...h,previous_snapshot:old,snapshot:next}).note,'規格變更');
 assert.equal(priceChange({...h,snapshot:{...row,cost_price:.25}}).percent<0,true);
});

test('metadata-only price preservation uses the original draft across date rollover',async()=>{
 const {priceSavePreservesBaseline,priceEdit}=await import('../lib/ingredient-price-sheet.ts');
 const row={id:'preserve',name:'奶油',unit:'g',cost_price:.28,revision:1,review_status:'confirmed',aliases:[]};
 const initialDraft={...priceEdit(row),effective_date:'2026-11-11'};
 const edit={row,initialDraft,draft:{...initialDraft,name:'無鹽奶油'},requestId:'test'};
 assert.equal(priceSavePreservesBaseline(edit),true);
 for(const [field,value] of [['price','.5'],['unit','公斤'],['specification','1000公克'],['effective_date','2026-11-12']])assert.equal(priceSavePreservesBaseline({...edit,draft:{...edit.draft,[field]:value}}),false);
});

test('a supplier offer displays the latest receipt first and uses a confirmed request price only without a receipt',async()=>{
 const {baselineGroups,priceSheetSupplierIndex,supplierSheetPurchase}=await import('../lib/ingredient-price-sheet.ts');
 const request={...source('request',2.35,'2026-11-03'),source:'請購表：食材',purchase:{amount:800,quantity:1,unit:'罐',content_quantity:340,content_unit:'g'}};
 const stale={...request,id:'older',effective_date:'2026-07-01',purchase:{...request.purchase,amount:750}};
 const live={...request,id:'receipt',effective_date:'2026-10-02',source:'已核對進貨明細',receipt_price:900,receipt_unit:'罐',receipt_purchase:{...request.purchase,amount:900},receipt_supplier:'甲廠商'};
 const offer=sources=>{
  const groups=baselineGroups([{...row,supplier_key:'',supplier_name:'未確認舊名稱',sources}]);
  const {index}=priceSheetSupplierIndex(groups,[{id:'a',name:'甲廠商',active:true}],[],[]);
  return supplierSheetPurchase(index.get(groups[0].key)[0]);
 };
 const fromReceipt=offer([request,live,stale]);
 assert.equal(fromReceipt.purchase.amount,900);
 assert.equal(fromReceipt.receiptDate,'2026-10-02');
 const fallback=offer([stale,request]);
 assert.equal(fallback.purchase.amount,800);
 assert.equal(fallback.purchase.unit,'罐');
 assert.equal(fallback.source,'請購參考價');
 assert.equal(fallback.receiptDate,null);
 assert.equal(offer([{...request,review_status:'pending'}]).purchase,null);
});
