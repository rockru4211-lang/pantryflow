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

test('requisition baselines stay common and a new receipt updates the same identity',async()=>{
 const {backofficeReceiptName,baselineGroups,priceSheetSupplierIndex,supplierSheetPurchase}=await import('../lib/ingredient-price-sheet.ts');
 const sourceName='大蒜仁　（去皮）';
 const request={...source('request',80,'2026-11-03'),source:'請購表：食材',purchase:{amount:80,quantity:1,unit:'台斤'}};
 const receipt={...request,id:'receipt',name:sourceName,effective_date:'2026-10-02',source:'已核對進貨明細',
  receipt_price:86,receipt_unit:'台斤',receipt_purchase:{...request.purchase,amount:86},receipt_supplier:'甲廠商'};
 const ingredient={...row,source:request.source,sources:[request]};
 const [historical]=baselineGroups([ingredient]);
 assert.equal(historical.history,false);
 const [current]=baselineGroups([{...ingredient,sources:[request,receipt]}]);
 assert.equal(current.history,false);
 assert.equal(current.key,historical.key);
 assert.equal(current.rows[0].id,ingredient.id);
 const {index}=priceSheetSupplierIndex([current],[{id:'a',name:'甲廠商',active:true}],[],[]);
 const [offer]=index.get(current.key);
 assert.equal(backofficeReceiptName(current.rows[0],offer),sourceName);
 assert.equal(supplierSheetPurchase(offer).purchase.amount,86);
 assert.equal(baselineGroups([{...ingredient,manual:true}])[0].history,false);
 assert.equal(baselineGroups([{...ingredient,sources:[{...request,review_status:'pending'}]}])[0].history,false);
});

test('a reviewed supplier assignment retains its confirmed requisition as a labeled reference',async()=>{
 const {baselineGroups,priceSheetSupplierIndex,supplierSheetPurchase}=await import('../lib/ingredient-price-sheet.ts');
 const request={...source('request',35,'2026-10-12',''),supplier_name:'舊供應商名稱',source:'請購表：食材',
  name:'細糖1K 台糖sugar',purchase:{amount:35,quantity:1,unit:'包',content_quantity:1000,content_unit:'g'}};
 const [group]=baselineGroups([{...row,supplier_key:'',supplier_name:'',sources:[request]}]);
 const suppliers=[{id:'a',name:'甲廠商',active:true}];
 assert.equal(priceSheetSupplierIndex([group],suppliers,[],[]).pending.length,1);
 const {index,pending}=priceSheetSupplierIndex([group],suppliers,[],[],{'m:request':'a'});
 assert.equal(pending.length,0);
 const [offer]=index.get(group.key);
 const result=supplierSheetPurchase(offer);
 assert.equal(result.purchase.amount,35);
 assert.equal(result.source,'請購參考價');
 assert.equal(result.receiptDate,null);
});

test('a receipt-backed item excludes a supplier found only on a requisition',async()=>{
 const {baselineGroups,priceSheetSupplierIndex,supplierSheetHistory,supplierSheetPurchase}=await import('../lib/ingredient-price-sheet.ts');
 const request={...source('request',.8,'2026-09-01','id:b'),source:'請購表：食材',purchase:{amount:800,quantity:1,unit:'公斤'}};
 const receipt={...source('receipt',.90476,'2026-10-08'),source:'已核對進貨明細',
  receipt_price:904.76,receipt_unit:'公斤',receipt_supplier:'甲廠商',receipt_purchase:{amount:904.76,quantity:1,unit:'公斤'}};
 const [group]=baselineGroups([{...row,sources:[receipt,request]}]);
 const {index}=priceSheetSupplierIndex([group],[{id:'a',name:'甲廠商',active:true},{id:'b',name:'乙廠商',active:true}],[],[]);
 const offers=index.get(group.key);
 const live=offers.find(entry=>entry.supplier.key==='id:a');
 const historical=offers.find(entry=>entry.supplier.key==='id:b');
 assert.equal(group.history,false);
 assert.equal(supplierSheetHistory(live),false);
 assert.equal(supplierSheetPurchase(live).purchase.amount,904.76);
 assert.equal(historical,undefined);
 assert.deepEqual(group.rows[0].sources,[receipt,request]);
});

test('recipe supplements and manual prices remain common independently of missing prices',async()=>{
 const {baselineGroups,priceSheetSupplierIndex,supplierSheetHistory}=await import('../lib/ingredient-price-sheet.ts');
 const supplier={id:'a',name:'甲廠商',active:true};
 const reference={...row,source:'歷史食譜：食材',source_kind:'history',sources:[],purchase:{amount:280,quantity:1,unit:'公斤'}};
 const history=ingredient=>{
  const groups=baselineGroups([ingredient]);
  const {index}=priceSheetSupplierIndex(groups,[supplier],[],[]);
  return supplierSheetHistory(index.get(groups[0].key)[0]);
 };
 assert.equal(history(reference),false);
 assert.equal(history({...reference,manual:true}),false);
 assert.equal(history({...reference,review_status:'pending',purchase:null,cost_price:null}),undefined);
});


test('clove uses its recipe unit price until its own receipt arrives',async()=>{
 const {currentIngredientPurchase,ingredientReceiptPrices,baselineGroups}=await import('../lib/ingredient-price-sheet.ts');
 const clove={...row,name:'丁香',source:'歷史食譜：豬肉凍派',source_kind:'history',
  supplier_name:'',supplier_key:'',cost_price:.9,purchase:{amount:180,quantity:200,unit:'g'},sources:[],
  current_quote:{price:null,reason:'缺少已確認進價或單位換算'}};
 assert.equal(baselineGroups([clove])[0].history,false);
 const before=currentIngredientPurchase(clove,[]);
 assert.deepEqual(before.purchase,{amount:.9,quantity:1,unit:'g'});
 assert.equal(before.source,'食譜參考價');
 const updated={...clove,sources:[{id:'clove-receipt',name:'丁香粒 200g',receipt_price:210,receipt_unit:'罐',
  receipt_purchase:{amount:210,quantity:1,unit:'罐',content_quantity:200,content_unit:'g'},
  receipt_supplier:'甲廠商',supplier_name:'甲廠商',supplier_key:'id:a',effective_date:'2026-11-17'}]};
 const after=currentIngredientPurchase(updated,ingredientReceiptPrices([updated]));
 assert.equal(after.purchase.amount,210);
 assert.equal(after.purchase.unit,'罐');
 assert.equal(after.supplier,'甲廠商');
 assert.equal(after.source,'已確認建檔進貨');
 assert.equal(updated.id,clove.id);
});

test('requisition fallback outranks recipe-only prices and preserves zero amounts',async()=>{
 const {ingredientReferencePrice}=await import('../lib/ingredient-price-sheet.ts');
 const ingredient={...row,current_quote:{price:null},sources:[
  {...source('recipe',.9,'2026-11-17'),source:'歷史食譜：菜單',source_kind:'history'},
  {...source('request',0,'2026-06-01'),source:'請購表：2026/06食材',purchase:{amount:0,quantity:1,unit:'包'}},
 ]};
 assert.equal(ingredientReferencePrice(ingredient).purchase.amount,0);
 assert.equal(ingredientReferencePrice(ingredient).purchase.unit,'包');
 assert.equal(ingredientReferencePrice(ingredient).source,'請購參考價');
 assert.equal(ingredientReferencePrice({...ingredient,sources:ingredient.sources.map(s=>({...s,review_status:'pending'})),source:undefined}),null);
});

test('newer confirmed receipt quote wins while unresolved quote does not hide a reference conflict',async()=>{
 const {currentIngredientPurchase}=await import('../lib/ingredient-price-sheet.ts');
 const receipt={purchase:{amount:180,quantity:1,unit:'罐'},supplier:'甲廠商',date:'2026-10-01'};
 const quoted={...row,current_quote:{basis:'receipt',price:210,unit:'罐',purchase:{amount:210,quantity:1,unit:'罐'},supplier_name:'甲廠商',date:'2026-11-17',source:'已確認建檔進貨'}};
 assert.equal(currentIngredientPurchase(quoted,[receipt]).purchase.amount,210);
 assert.equal(currentIngredientPurchase({...quoted,current_quote:{...quoted.current_quote,date:'2026-09-01'}},[receipt]).purchase.amount,180);
 const conflicted={...row,purchase:null,source:'歷史食譜：丁香',source_kind:'history',cost_price:.9,
  current_quote:{price:null,reason:'同日進價衝突'}};
 assert.equal(currentIngredientPurchase(conflicted,[]).purchase,null);
 assert.equal(currentIngredientPurchase(conflicted,[]).reason,'同日進價衝突');
});
