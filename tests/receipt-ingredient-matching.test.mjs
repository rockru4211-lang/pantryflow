import test from 'node:test';
import assert from 'node:assert/strict';
import {autoMatchReceiptDraft,chooseReceiptIngredient,clearReceiptIngredient,matchReceiptIngredient,restoreReceiptSupplierAliases,searchReceiptIngredients} from '../lib/receipt-ingredient-matching.ts';
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
test('cosmetic supplier spelling changes resolve uniquely and keep the original receipt values',()=>{
 const c={...catalog,bindings:[{supplier:'大永',name:'牛 油 Ａ',unit:'包',specification:'0.454kg',ingredient_id:'i',revision:3}]};
 const line={...draft().lines[0],product_name:'牛油 a',specification:'454克'};
 assert.equal(matchReceiptIngredient(c,'大永',line).id,'i');
 assert.equal(matchReceiptIngredient(c,'另一家',line),null);
 assert.equal(matchReceiptIngredient(c,'大永',{...line,specification:'500克'}),null);
 const ambiguous={ingredients:[ingredient,{...ingredient,id:'other'}],bindings:[...c.bindings,{...c.bindings[0],name:'牛油A',ingredient_id:'other'}]};
 assert.equal(matchReceiptIngredient(ambiguous,'大永',line),null);
 const flagged={...c,bindings:c.bindings.map(binding=>({...binding,stopped:true}))};
 assert.equal(matchReceiptIngredient(flagged,'大永',line),null);
 const saved=restoreReceiptSupplierAliases({...draft(),lines:[line]},c);
 assert.equal(saved.lines[0].ingredient_id,'i');
 assert.equal(saved.lines[0].supplier_item_name,'牛油 a');
 assert.equal(saved.lines[0].product_name,'牛油 a');
 assert.equal(saved.lines[0].specification,'454克');
 assert.equal(saved.lines[0].unit_price,'160');
 const declined={...draft(),lines:[{...line,ingredient_match_pending:true}]};
 assert.equal(restoreReceiptSupplierAliases(declined,c),declined);
 const cleared={...draft(),lines:[clearReceiptIngredient(line)]};
 assert.equal(restoreReceiptSupplierAliases(cleared,c),cleared);
});
test('close vendor spelling goes through a picker for one-time confirmation',()=>{
 const sugar={id:'sugar',ingredient_code:'F001465',name:'細糖1K 台糖sugar',unit:'g',category:'食材',aliases:[],purchase:{unit:'包',content_quantity:1000,content_unit:'g'}};
 const line={...draft().lines[0],product_name:'細糖1K 台糖sugar · 1K',specification:'1公斤'};
 const binding={supplier:'大永',name:sugar.name,unit:'包',specification:'1000克',ingredient_id:sugar.id,revision:1};
 const c={ingredients:[sugar],bindings:[binding]};
 assert.equal(matchReceiptIngredient(c,'大永',line),null);
 assert.deepEqual(searchReceiptIngredients(c,'大永',line,line.product_name).map(result=>[result.ingredient.ingredient_code,result.similar]),[['F001465',true]]);
 assert.deepEqual(searchReceiptIngredients(c,'別家',line,line.product_name),[]);
 assert.deepEqual(searchReceiptIngredients(c,'大永',{...line,specification:'500克'},line.product_name),[]);
 const chosen=chooseReceiptIngredient(line,sugar,c,'大永');
 assert.equal(chosen.remember_ingredient_alias,true);
 assert.equal(chosen.supplier_item_name,line.product_name);
 const remembered={...c,bindings:[binding,{...binding,name:line.product_name}]};
 assert.equal(matchReceiptIngredient(remembered,'大永',line).id,'sugar');
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

test('automatic matching preserves manual categories while still binding the known ingredient',()=>{
 for(const category of ['耗材','待分類','']){
  const manual=changeReviewLine(draft(),0,'category',category),matched=autoMatchReceiptDraft(manual,catalog);
  assert.equal(matched.lines[0].ingredient_id,'i');assert.equal(matched.lines[0].category,category);
  assert.equal(matched.lines[0].categorySource,'manual');assert.equal(matched.lines[0].supplier_item_name,'無鹽牛油');
  const payload=reviewPayload(row,matched,false);assert.equal(payload.lines[0].category,category);assert.equal('categorySource' in payload.lines[0],false);
 }
});

test('choosing an existing ingredient preserves a manual category and retains the original default behavior otherwise',()=>{
 const manual=changeReviewLine(draft(),0,'category','待分類');
 assert.equal(chooseReceiptIngredient(manual.lines[0],ingredient,catalog,manual.supplier).category,'待分類');
 assert.equal(chooseReceiptIngredient(draft().lines[0],ingredient,catalog,row.supplier_name).category,'食材');
});
