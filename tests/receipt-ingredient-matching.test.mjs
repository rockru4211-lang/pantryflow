import test from 'node:test';
import assert from 'node:assert/strict';
import {autoMatchReceiptDraft,chooseReceiptIngredient,clearReceiptIngredient,matchReceiptIngredient} from '../lib/receipt-ingredient-matching.ts';
import {reviewDraft,reviewPayload,changeReviewLine} from '../lib/receipt-review.ts';
const ingredient={id:'i',name:'無鹽奶油',unit:'g',category:'食材',aliases:['無鹽牛油','奶油塊'],purchase:{unit:'包',content_quantity:454,content_unit:'g'}};
const catalog={ingredients:[ingredient],bindings:[]};
const row={lines:[{row_key:'r',product_name:'無鹽牛油',unit:'包',specification:'',category:'待分類',quantity:2,unit_price:160,subtotal:320,note:''}],supplier_name:'大永',receipt_date:'2026-10-09',note:'',adjustment:0};
const draft=()=>reviewDraft(row);
test('unique alias resolves; ambiguous same-name products and non-stock costs do not',()=>{
 assert.equal(matchReceiptIngredient(catalog,'大永',draft().lines[0]).id,'i');
 assert.equal(matchReceiptIngredient({...catalog,ingredients:[ingredient,{...ingredient,id:'other'}]},'大永',draft().lines[0]),null);
 assert.equal(matchReceiptIngredient(catalog,'大永',{...draft().lines[0],handling:'FREIGHT'}),null);
});
test('supplier memory requires supplier, original name, unit and package match',()=>{
 const c={...catalog,bindings:[{supplier:'大永',name:'牛油A',unit:'包',specification:'454g',ingredient_id:'i',revision:3}]};
 const line={...draft().lines[0],product_name:'牛油A',specification:'454g'};
 assert.equal(matchReceiptIngredient(c,'大永',line).id,'i');
 assert.equal(matchReceiptIngredient(c,'別家',line),null);assert.equal(matchReceiptIngredient(c,'大永',{...line,unit:'箱'}),null);assert.equal(matchReceiptIngredient(c,'大永',{...line,specification:'500g'}),null);
});
test('selection retains original vendor wording and quantities/prices; payload persists stable identity',()=>{
 const d=draft();d.lines[0]=chooseReceiptIngredient(d.lines[0],ingredient,catalog,d.supplier);
 assert.equal(d.lines[0].product_name,'無鹽奶油');assert.equal(d.lines[0].supplier_item_name,'無鹽牛油');assert.equal(d.lines[0].specification,'454g');
 const p=reviewPayload(row,d,false);assert.equal(p.lines[0].ingredient_id,'i');assert.equal(p.lines[0].unit_price,160);assert.equal(p.lines[0].subtotal,320);assert.equal(p.lines[0].quantity,2);
});
test('explicit clearing and edited unit remove stale association and do not silently rematch',()=>{
 const d=autoMatchReceiptDraft(draft(),catalog);const changed=changeReviewLine(d,0,'unit','箱');
 assert.equal(changed.lines[0].ingredient_id,null);assert.equal(autoMatchReceiptDraft(changed,catalog).lines[0].ingredient_id,null);
 d.lines[0]=clearReceiptIngredient(d.lines[0]);assert.equal(reviewPayload(row,d,false).lines[0].ingredient_id,null);
});
test('new ingredient is staged until receipt save and unknown items can be saved without mapping',()=>{
 const d=draft();d.lines[0]=chooseReceiptIngredient({...d.lines[0],product_name:'新品'},null,catalog,d.supplier);
 assert.equal(reviewPayload(row,d,false).lines[0].create_ingredient,true);
 const p=reviewPayload(row,draft(),false);assert.equal(p.lines[0].ingredient_id,undefined);
});
