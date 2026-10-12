import test from 'node:test';
import assert from 'node:assert/strict';
import {baselineGroups,isIngredientStopped,priceSearch} from '../lib/ingredient-price-sheet.ts';
import {recipeIngredientOptions,recipeCost} from '../lib/recipe-cost.ts';
import {recipeIngredientCode,resolveIngredientImport} from '../lib/ingredient-code.ts';
import {receiptIngredientOptions,matchReceiptIngredient,autoMatchReceiptDraft} from '../lib/receipt-ingredient-matching.ts';
const root={id:'base',ingredient_code:'F001430',canonical_code:'F001430',name:'紅酒醋(小)PONIT · 500ml',unit:'ml',cost_price:.15,review_status:'confirmed',revision:1,aliases:[{name:'紅酒醋',unit:'ml',specification:'500ml'}],purchase:{amount:75,quantity:1,unit:'罐',content_quantity:500,content_unit:'ml'}};
const legacy={...root,id:'package',ingredient_code:'F001432',canonical_ingredient_id:'base',name:'紅酒醋(小)PONIT 500ml',unit:'罐',cost_price:75,aliases:[{name:'紅酒醋',unit:'罐'}]};
const rows=[legacy,root];
const catalog={ingredients:rows.map(r=>({...r,aliases:r.aliases.map(a=>a.name)})),bindings:[]};
test('canonical grouping preserves primary identity across package units and old-code search',()=>{
 const before=JSON.stringify(rows),groups=baselineGroups(rows);assert.equal(groups.length,1);assert.equal(groups[0].rows[0].id,'base');assert(groups[0].rows.some(r=>priceSearch(r,'F001432')));assert.equal(JSON.stringify(rows),before);
 const other={...root,id:'litre',name:'紅酒醋 1L',purchase:{...root.purchase,content_quantity:1000}};assert.equal(baselineGroups([...rows,other]).length,2);
});
test('new recipe and receipt options use one root and remain searchable by legacy code',()=>{
 const options=recipeIngredientOptions({ingredients:rows,prices:[]});assert.equal(options.length,1);assert.equal(options[0].ingredient_id,'base');assert(options[0].aliases.includes('F001432'));
 const picks=receiptIngredientOptions(catalog);assert.equal(picks.length,1);assert.equal(picks[0].id,'base');assert(picks[0].aliases.includes('F001432'));
 assert.equal(matchReceiptIngredient(catalog,'供應商',{product_name:'紅酒醋',unit:'罐'}).id,'base');
 const draft={supplier:'供應商',lines:[{product_name:legacy.name,ingredient_id:'package',unit:'罐',quantity:2,subtotal:150}]};assert.deepEqual(autoMatchReceiptDraft(draft,catalog),draft);
});
test('old code imports route to main record after verifying original ID/code pair',()=>{
 assert.equal(resolveIngredientImport(rows,{'食材編碼':'F001432','識別碼':'package'}),root);
 assert.throws(()=>resolveIngredientImport(rows,{'食材編碼':'F001432','識別碼':'base'}),/不一致/);
 assert.equal(recipeIngredientCode({ingredient_id:'package'},{ingredients:rows}),'F001430');
});
test('root stop applies to old IDs and saved recipe costs are not recomputed',()=>{
 assert(isIngredientStopped(legacy,[{ingredient_id:'base',supplier_key:'*',stopped:true}]));
 const line={id:'l',ingredient_id:'package',name:legacy.name,unit:'罐',quantity:2};const doc={lines:[line]};const saved={lines:[{id:'l',amount:140,reason:null,price:null}],total:140};
 const result=recipeCost(doc,{ingredients:rows,prices:[{key:'i:package',unit:'罐',price:999}],recipes:[{id:'recipe',approved_cost:{document:doc,cost:saved}}]},['recipe']);assert.equal(result.total,140);
});
