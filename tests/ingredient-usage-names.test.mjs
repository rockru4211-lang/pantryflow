import test from 'node:test';
import assert from 'node:assert/strict';
import {countNameMatches,usageNamesError} from '../lib/ingredient-usage-names.ts';
import {matchReceiptIngredient,chooseReceiptIngredient} from '../lib/receipt-ingredient-matching.ts';
import {reviewPayload} from '../lib/receipt-review.ts';
import {recipeIngredientOptions} from '../lib/recipe-cost.ts';
const ingredient={id:'i',ingredient_code:'F000001',canonical_code:'F000002',name:'鐵塔鮮奶油 1L',unit:'瓶',category:'食材',aliases:[],cost_price:200,review_status:'confirmed',revision:1};
const line={row_key:'r',product_name:'奶油A',unit:'瓶',specification:'1L',quantity:'6',unit_price:'200',subtotal:'1200',category:'食材',note:''};
test('count search finds original, display, supplier aliases and both fixed and shared codes',()=>{
 const product={name:'原盤點名稱',product_code:'OLD',identity:{count_name:'鐵塔鮮奶油',code:'F000002',names:['奶油A','鐵塔鮮奶油 1L']}};
 for(const q of ['原盤點','鐵塔','奶油A','ｆ０００００２','old'])assert(countNameMatches(product,q),q);
 assert(!countNameMatches(product,'別家鮮奶油'));
});
test('stopped supplier aliases cannot auto-assign a new delivery, existing historical line still resolves',()=>{
 const catalog={ingredients:[ingredient],bindings:[{supplier:'A',name:'奶油A',unit:'瓶',specification:'1L',ingredient_id:'i',revision:1,stopped:true}]};
 assert.equal(matchReceiptIngredient(catalog,'A',line),null);
 assert.equal(matchReceiptIngredient(catalog,'A',{...line,ingredient_id:'i'}).id,'i');
});
test('supplier switch requires a matching confirmed alias, not a different vendor with the same wording',()=>{
 const catalog={ingredients:[ingredient],bindings:[{supplier:'A',name:'奶油A',unit:'瓶',specification:'1L',ingredient_id:'i',revision:1}]};
 assert.equal(matchReceiptIngredient(catalog,'B',line),null);
 assert.equal(matchReceiptIngredient(catalog,'A',line).id,'i');
});
test('remember opt-out reaches receipt save without changing quantities or monetary evidence',()=>{
 const chosen=chooseReceiptIngredient(line,ingredient,{ingredients:[ingredient],bindings:[]},'B');
 const draft={supplier:'B',date:'2026-10-19',number:'',tax:'0',total:'1200',note:'',adjustment:'0',adjustmentNote:'',lines:[{...chosen,remember_ingredient_alias:false}]};
 const payload=reviewPayload({lines:[line],revision:1},draft,false);
 assert.equal(payload.lines[0].remember_ingredient_alias,false);assert.equal(payload.lines[0].supplier_item_name,'奶油A');
 assert.equal(payload.lines[0].quantity,6);assert.equal(payload.lines[0].subtotal,1200);assert.equal(payload.lines[0].ingredient_id,'i');
});
test('recipe aliases are searchable on both candidates without selecting one or replacing saved costs',()=>{
 const workspace={ingredients:[{...ingredient,recipe_aliases:['鮮奶油']},{...ingredient,id:'other',name:'另一牌鮮奶油',recipe_aliases:['鮮奶油']}],recipes:[],prices:[],products:[]};
 const options=recipeIngredientOptions(workspace).filter(i=>i.aliases.includes('鮮奶油'));
 assert.equal(options.length,2);assert.deepEqual(options.map(o=>o.ingredient_id).sort(),['i','other']);
 assert.match(usageNamesError({message:'ALIAS_ALREADY_ASSIGNED'}),/已對應其他食材/);
});
