import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptSavedUnits,supplierItems,applySupplierItem,unambiguousReceiptProducts,matchSharedReceiptProducts,applySharedReceiptProduct,keepReceiptProductName} from '../lib/receipt-supplier-items.ts';
const line={product_name:'牛邊條',unit:'公斤',specification:'',unit_price:380};
const account=(id,date,overrides={})=>({batch_id:id,receipt_date:date,supplier_name:'肉商',record_state:'LIVE',edit_revision:1,status:'UNCHECKED',lines:[line],...overrides});
test('supplier history is exact, recent-first, distinct by specification/unit and excludes unreviewed or removed data',()=>{
 const rows=[account('old','2026-09-01'),account('new','2026-10-01',{lines:[{...line,unit_price:400}]}),account('current','2026-10-09'),account('other','2026-10-09',{supplier_name:'另一肉商'}),account('removed','2026-10-09',{record_state:'REMOVED'}),account('raw','2026-10-09',{edit_revision:0})];
 const items=supplierItems(rows,'肉商','current');assert.equal(items.length,1);assert.equal(items[0].price,400);assert.equal(items[0].date,'2026-10-01');
});
test('choosing a common item leaves entered quantity and current price untouched',()=>{
 const draft={lines:[{product_name:'',unit:'',specification:'',quantity:'3',unit_price:'420',subtotal:'1260'}]};
 const result=applySupplierItem(draft,0,{name:'牛邊條',unit:'公斤',specification:'',price:380,date:'2026-10-01'});
 assert.equal(result.lines[0].product_name,'牛邊條');assert.equal(result.lines[0].unit,'公斤');assert.equal(result.lines[0].quantity,'3');assert.equal(result.lines[0].unit_price,'420');assert.equal(result.lines[0].subtotal,'1260');
});
test('selection fills a blank price, computes amount, and never supplies quantity',()=>{
 const item={name:'火腿',unit:'包',specification:'',price:850,date:'2026-10-12'};
 const draft={lines:[{product_name:'火',unit:'',specification:'',quantity:'2',unit_price:'',subtotal:''}]};
 const result=applySupplierItem(draft,0,item);assert.equal(result.lines[0].unit_price,'850');assert.equal(result.lines[0].subtotal,'1700');
 draft.lines[0].quantity='';const blank=applySupplierItem(draft,0,item);assert.equal(blank.lines[0].quantity,'');assert.equal(blank.lines[0].subtotal,'');
});
test('all supplier history keeps source identities and excludes raw OCR and current batch',()=>{
 const rows=[account('a','2026-09-01'),account('b','2026-10-01',{supplier_name:'另一肉商'}),account('current','2026-10-10'),account('raw','2026-10-12',{edit_revision:0})];
 const items=supplierItems(rows,'','current');assert.equal(items.length,2);assert.equal(items[0].supplier,'另一肉商');
});
test('keyword search is normalized and does not lose matches beyond the first hundred items',async()=>{
 const {matchSupplierItems}=await import('../lib/receipt-supplier-items.ts');
 const rows=[account('many','2026-09-01',{lines:Array.from({length:150},(_,i)=>({...line,product_name:`品項${i}`}))})];
 assert.equal(matchSupplierItems(supplierItems(rows,'肉商','current'),'品項149').length,1);
 assert.equal(matchSupplierItems([{name:'ABC 火腿',unit:'包',specification:'切片',supplier:'歐陸',price:2,date:''}],'ａｂｃ 切片').length,1);
});
test('supplier fragments and aliases offer a choice, and partial supplier names still find history',async()=>{
 const {matchReceiptSuppliers,itemsForSupplier,receiptItemQuery}=await import('../lib/receipt-supplier-items.ts');
 const rows=[{id:'1',name:'凱摩企業有限公司',aliases:['乳品商']},{id:'2',name:'凱元',is_active:false}];
 assert.equal(matchReceiptSuppliers(rows,'凱')[0].id,'1');assert.equal(matchReceiptSuppliers(rows,'乳品')[0].id,'1');assert.equal(matchReceiptSuppliers(rows,'凱').length,1);
 const items=[{supplier:'凱摩企業有限公司',name:'奶油'},{supplier:'其他',name:'奶油'}];assert.equal(itemsForSupplier(items,'凱').length,1);assert.equal(receiptItemQuery('未命名品項'),'');assert.equal(receiptItemQuery('奶油'),'奶油');
});

test('exact supplier detection includes aliases and inactive records without offering them as active choices',async()=>{
 const {exactReceiptSupplier,matchReceiptSuppliers}=await import('../lib/receipt-supplier-items.ts');
 const rows=[{id:'a',name:'青田',aliases:['青田 蔬果'],is_active:true},{id:'b',name:'舊廠商',is_active:false},{id:'c',name:'移除廠商',is_removed:true}];
 assert.equal(exactReceiptSupplier(rows,' 青田蔬果 ').id,'a');assert.equal(exactReceiptSupplier(rows,'舊廠商').id,'b');assert.equal(exactReceiptSupplier(rows,'移除廠商').id,'c');assert.equal(matchReceiptSuppliers(rows,'廠商').length,0);
});

test('saved custom units include freight, deduplicate and exclude other record states or raw OCR',()=>{
 const rows=[account('a','2026-10-01',{lines:[{...line,unit:' 趟 ',handling:'FREIGHT'},{...line,unit:'趟'}]}),account('b','2026-10-01',{record_state:'REMOVED',lines:[{...line,unit:'錯'}]}),account('c','2026-10-01',{edit_revision:0,lines:[{...line,unit:'OCR錯'}]}),account('d','2026-10-01',{record_state:'TEST',lines:[{...line,unit:'測試'}]})];
 assert.deepEqual(receiptSavedUnits(rows),['趟']);
});


test('shared search supports a code and keeps different packaging distinct',()=>{
 const items=[
  {id:'a',name:'黃檸檬',product_code:'BH-01',base_unit:'台斤',specification:''},
  {id:'b',name:'黃檸檬',product_code:'BH-02',base_unit:'箱',specification:'10入'},
  {id:'c',name:'重 複',product_code:'BH-03',base_unit:'公斤',specification:''},
  {id:'d',name:'重複',product_code:'BH-04',base_unit:'克',specification:''},
 ];
 const choices=unambiguousReceiptProducts(items);
 assert.deepEqual(choices.map(item=>item.id),['a','b']);
 assert.deepEqual(matchSharedReceiptProducts(choices,'ｂｈ－０１',{unit:'',specification:''}).map(item=>item.id),['a']);
 assert.deepEqual(matchSharedReceiptProducts(choices,'黃檸檬',{unit:'箱',specification:'10入'}).map(item=>item.id),['b']);
 assert.deepEqual(matchSharedReceiptProducts(choices,'黃檸檬',{unit:'箱',specification:'5入'}),[]);
});

test('shared selection keeps the entered unit, quantity, price and total and remembers a verified vendor name',()=>{
 const item={id:'a',name:'黃檸檬',product_code:'BH-01',base_unit:'台斤',specification:''};
 const original=account('a','2026-10-01',{lines:[{row_key:'r1',source_product:'進口黃檸',unit:'公斤',specification:''}]});
 const draft={supplier:'甲',lines:[{row_key:'r1',product_name:'黃檸',unit:'公斤',specification:'',quantity:'3',unit_price:'420',subtotal:'1260'}]};
 const context={original,catalog:{ingredients:[{id:'lemon',name:'黃檸檬',unit:'公斤',category:'食材',aliases:[]}],bindings:[]}};
 const result=applySharedReceiptProduct(draft,0,item,context).lines[0];
 assert.equal(result.product_name,'黃檸檬');
 assert.equal(result.supplier_item_name,'進口黃檸');
 assert.equal(result.ingredient_id,'lemon');
 for(const key of ['unit','quantity','unit_price','subtotal'])assert.equal(result[key],draft.lines[0][key]);
 const unpriced={...draft,lines:[{...draft.lines[0],unit:'',unit_price:'',subtotal:''}]};
 const blank=applySharedReceiptProduct(unpriced,0,item).lines[0];
 assert.equal(blank.unit,'台斤');
 assert.equal(blank.unit_price,'');
 assert.equal(blank.subtotal,'');
});

test('supplier confirmation ranks matching packages first and saved recipe aliases find the common item',()=>{
 const products=[
  {id:'still',name:'蘿莉塔娜礦泉水',product_code:'W1',base_unit:'瓶',specification:'750ml'},
  {id:'sparkling',name:'蘿莉塔娜氣泡水',product_code:'W2',base_unit:'瓶',specification:'750ml'},
  {id:'herb',name:'俄力岡葉',product_code:'H1',base_unit:'包',specification:'200g'},
 ];
 const history=supplierItems([
  account('a','2026-10-11',{supplier_name:'酒水商',lines:[{...line,product_name:products[0].name,unit:'瓶',specification:'750ml'}]}),
  account('b','2026-10-10',{supplier_name:'酒水商',review_completed:true,lines:[{...line,product_name:products[1].name,unit:'瓶',specification:'0.75L'}]}),
 ],'','');
 const catalog={ingredients:[{id:'herb-master',name:'俄力岡葉',unit:'g',category:'食材',aliases:[],recipe_aliases:['乾奧勒岡葉'],purchase:{unit:'包',content_quantity:200,content_unit:'g'}}],bindings:[]};
 const find=(query,supplier='酒水商',specification='')=>matchSharedReceiptProducts(products,query,{unit:'',specification},8,{catalog,supplier,history});
 assert.deepEqual(find('蘿莉塔娜').map(({id,supplierConfirmed})=>[id,supplierConfirmed]),[['sparkling',true],['still',false]]);
 assert.deepEqual(find('蘿莉塔娜','另一家').map(({id,supplierConfirmed})=>[id,supplierConfirmed]),[['still',false],['sparkling',false]]);
 assert.deepEqual(find('乾奧勒岡葉').map(({id})=>id),['herb']);
 assert.deepEqual(find('乾奧勒岡葉','酒水商','250g'),[]);
});

test('keeping the original line clears the proposed link without changing transaction values',()=>{
 const original={product_name:'蘿莉塔娜氣泡水',ingredient_id:'sparkling',create_ingredient:true,quantity:'6',unit_price:'78',subtotal:'468'};
 const kept=keepReceiptProductName({lines:[original]},0,'蘿莉塔娜 水').lines[0];
 assert.equal(kept.product_name,'蘿莉塔娜 水');
 assert.equal(kept.ingredient_id,null);
 assert.equal(kept.create_ingredient,false);
 assert.equal(kept.subtotal,'468');
 assert.equal(original.ingredient_id,'sparkling');
});
