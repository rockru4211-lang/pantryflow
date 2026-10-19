import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptItemCategoryDefault} from '../lib/receipt-categories.ts';
import {applyReviewCategoryDefaults,changeReviewLine,reviewDraft,reviewPayload} from '../lib/receipt-review.ts';
import {applySupplierItem,supplierItems,supplierReceiptCategory} from '../lib/receipt-supplier-items.ts';

const blank={row_key:'new',product_name:'',specification:'',unit:'',quantity:null,unit_price:null,subtotal:null,category:'待分類',note:''};
const account={batch_id:'current',supplier_name:'綜合供應商',receipt_date:'2026-10-19',document_number:'',note:'',tax:null,total:null,adjustment:0,adjustment_note:'',source_fingerprint:'source',revision:1,edit_revision:0,run_id:'run',record_state:'LIVE',status:'UNCHECKED',receipt_categories:[],lines:[blank]};
const wine={id:'wine',name:'紅酒',unit:'瓶',category:'酒水',aliases:['House Red']};
const catalog={ingredients:[wine],bindings:[]};

test('item category precedes a single invoice category and the exact supplier default',()=>{
 assert.deepEqual(receiptItemCategoryDefault('耗材',['酒水'],'食材'),{category:'耗材',categorySource:'item'});
 assert.deepEqual(receiptItemCategoryDefault('待分類',[' 酒水 ','酒水'],'食材'),{category:'酒水',categorySource:'receipt'});
 assert.deepEqual(receiptItemCategoryDefault('',[],'食材'),{category:'食材',categorySource:'supplier'});
 assert.deepEqual(receiptItemCategoryDefault(undefined,undefined,undefined),{category:'待分類'});
});

test('mixed or custom invoice labels never become an arbitrary item category',()=>{
 for(const categories of [['食材','酒水'],['酒水','食材'],['食材','清潔用品'],['清潔用品']]){
  assert.deepEqual(receiptItemCategoryDefault('',categories,'耗材'),{category:'待分類'});
 }
 assert.deepEqual(receiptItemCategoryDefault('調料',['食材','酒水'],'耗材'),{category:'調料',categorySource:'item'});
});

test('new inherited categories follow invoice changes without changing amounts or the source account',()=>{
 const before=JSON.stringify(account),draft=reviewDraft(account);
 const supplier=applyReviewCategoryDefaults(draft,{supplierCategory:'食材',original:account});
 assert.equal(supplier.lines[0].category,'食材');assert.equal(supplier.lines[0].categorySource,'supplier');
 const invoice=applyReviewCategoryDefaults({...supplier,receiptCategories:['酒水']},{supplierCategory:'食材',original:account});
 assert.equal(invoice.lines[0].category,'酒水');assert.equal(invoice.lines[0].categorySource,'receipt');
 const mixed=applyReviewCategoryDefaults({...invoice,receiptCategories:['食材','酒水']},{supplierCategory:'食材',original:account});
 assert.equal(mixed.lines[0].category,'待分類');assert.equal(mixed.lines[0].unit_price,'');assert.equal(mixed.lines[0].subtotal,'');
 assert.equal(JSON.stringify(account),before);assert.equal(draft.lines[0].category,'待分類');
});

test('manual classifications, including an explicit unclassified choice, survive all fallback changes',()=>{
 const inherited=applyReviewCategoryDefaults(reviewDraft(account),{supplierCategory:'食材'});
 for(const category of ['耗材','待分類','']){
  const manual=changeReviewLine(inherited,0,'category',category);
  const result=applyReviewCategoryDefaults({...manual,receiptCategories:['酒水']},{supplierCategory:'酒水',catalog});
  assert.equal(result.lines[0].category,category);assert.equal(result.lines[0].categorySource,'manual');
 }
});

test('existing saved rows retain classified and unclassified values while appended rows receive defaults',()=>{
 const saved={...account,edit_revision:3,lines:[{...blank,row_key:'saved',category:'調料'},{...blank,row_key:'saved-pending'}]};
 const draft=reviewDraft(saved),before=JSON.stringify(saved);
 draft.lines.push({...draft.lines[0],row_key:'local-new',category:'待分類'});
 const result=applyReviewCategoryDefaults({...draft,receiptCategories:['酒水']},{supplierCategory:'食材',original:saved,catalog});
 assert.equal(result.lines[0].category,'調料');assert.equal(result.lines[1].category,'待分類');assert.equal(result.lines[2].category,'酒水');
 assert.equal(JSON.stringify(saved),before);
});

test('exact existing item and aliases supply category without changing identity, quantity or price',()=>{
 const before=JSON.stringify(catalog);
 const draft=reviewDraft({...account,lines:[{...blank,product_name:'House Red',unit:'瓶',quantity:2,unit_price:100,subtotal:200,ingredient_id:null}]});
 const result=applyReviewCategoryDefaults({...draft,receiptCategories:['食材']},{catalog,supplierCategory:'耗材',original:account});
 assert.equal(result.lines[0].category,'酒水');assert.equal(result.lines[0].categorySource,'item');
 assert.equal(result.lines[0].ingredient_id,null);assert.equal(result.lines[0].create_ingredient,undefined);
 assert.equal(result.lines[0].quantity,'2');assert.equal(result.lines[0].unit_price,'100');assert.equal(result.lines[0].subtotal,'200');
 const renamed=applyReviewCategoryDefaults(changeReviewLine(result,0,'product_name','新品橄欖油'),{catalog,supplierCategory:'耗材'});
 assert.equal(renamed.lines[0].category,'食材');assert.equal(renamed.lines[0].categorySource,'receipt');
 assert.equal(JSON.stringify(catalog),before);
});

test('ambiguous item names never select a category from the first matching master',()=>{
 const ambiguous={ingredients:[wine,{...wine,id:'another-wine',category:'耗材'}],bindings:[]};
 const draft=reviewDraft({...account,receipt_categories:['食材','酒水'],lines:[{...blank,product_name:'紅酒',unit:'瓶'}]});
 assert.equal(applyReviewCategoryDefaults(draft,{catalog:ambiguous,supplierCategory:'食材'}).lines[0].category,'待分類');
});

test('history keeps each item category and master category wins over an inherited category',()=>{
 const saved={...account,batch_id:'older',edit_revision:2,lines:[{...blank,product_name:'紅酒',unit:'瓶',unit_price:380,category:'食材'}]};
 const before=JSON.stringify(saved),item=supplierItems([saved],account.supplier_name,account.batch_id)[0];
 assert.equal(item.category,'食材');
 const draft=applyReviewCategoryDefaults(reviewDraft({...account,lines:[{...blank,quantity:3,unit_price:420,subtotal:1260}]}),{supplierCategory:'耗材'});
 const chosen=applySupplierItem(draft,0,item,{catalog,supplierCategory:'耗材'});
 assert.equal(chosen.lines[0].category,'酒水');assert.equal(chosen.lines[0].categorySource,'item');
 assert.equal(chosen.lines[0].unit_price,'420');assert.equal(chosen.lines[0].subtotal,'1260');assert.equal(JSON.stringify(saved),before);
});

test('history selection preserves manual categories and does not reclassify any other row',()=>{
 const draft=reviewDraft({...account,lines:[{...blank,row_key:'other',category:'食材'},{...blank,row_key:'selected',quantity:2}]});
 const manual=changeReviewLine(draft,1,'category','待分類');
 const result=applySupplierItem(manual,1,{name:'紅酒',unit:'瓶',specification:'',category:'酒水',price:380,date:'2026-10-18'},{catalog,supplierCategory:'耗材'});
 assert.equal(result.lines[1].category,'待分類');assert.equal(result.lines[1].categorySource,'manual');
 assert.equal(result.lines[1].subtotal,'760');assert.deepEqual(result.lines[0],draft.lines[0]);
 assert.equal(applySupplierItem(draft,20,{name:'紅酒'}),draft);
});

test('category inheritance remains optional and draft-only provenance never enters save payloads',()=>{
 for(const categories of [['酒水'],['食材','耗材'],['清潔用品'],[]]){
  const draft=applyReviewCategoryDefaults({...reviewDraft(account),receiptCategories:categories},{supplierCategory:'食材'});
  const payload=reviewPayload(account,draft,false);
  assert.deepEqual(payload.receipt_categories,categories);assert.equal(payload.checked,false);
  assert.equal('categorySource' in payload.lines[0],false);assert.equal(payload.lines[0].quantity,null);
 }
});

test('supplier defaults require a complete active name or alias, never a partial supplier query',()=>{
 const suppliers=[{id:'a',name:'食材供應商',aliases:['Kitchen Source'],supplier_category:'食材'},{id:'b',name:'酒水供應商',supplier_category:'酒水',is_active:false},{id:'c',name:'舊供應商',supplier_category:'耗材',is_removed:true}];
 assert.equal(supplierReceiptCategory(suppliers,'食材供應商'),'食材');assert.equal(supplierReceiptCategory(suppliers,'kitchen source'),'食材');
 assert.equal(supplierReceiptCategory(suppliers,'供應商'),'');assert.equal(supplierReceiptCategory(suppliers,'酒水供應商'),'');assert.equal(supplierReceiptCategory(suppliers,'舊供應商'),'');
});
