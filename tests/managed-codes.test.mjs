import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeLineCode} from '../lib/recipe-cost.ts';
import {viewAccess} from '../lib/data-access.ts';
test('linked ingredients display common code without altering original identity or cost',()=>{
 const item={id:'i',name:'麵粉',ingredient_code:'F000002',canonical_code:'F000001',cost_price:32,unit:'kg'};
 const workspace={ingredients:[item],recipes:[]};const before=JSON.stringify(workspace);
 assert.equal(recipeLineCode({ingredient_id:'i'},workspace),'F000001');
 assert.equal(JSON.stringify(workspace),before);
});
test('component codes come from saved recipe IDs and unresolved links stay unassigned',()=>{
 const workspace={recipes:[{id:'p',recipe_code:'P000012'}]};
 assert.equal(recipeLineCode({recipe_id:'p',name:'改名配件'},workspace),'P000012');
 assert.equal(recipeLineCode({recipe_id:'unknown'},workspace),'—');
});
test('code management and margin placeholder use office recipe permissions',()=>{
 for(const view of ['code-management','margin-review']){
 assert.equal(viewAccess({role:'STAFF',work_functions:['FIELD'],data_access:{RECIPE:{view:true}}},view),false);
 assert.equal(viewAccess({role:'LOGISTICS',work_functions:['OFFICE'],data_access:{RECIPE:{view:false}}},view),false);
 assert.equal(viewAccess({role:'OWNER'},view),true);
 }
});

import {groupManagedCodes,duplicateCodeKeys} from '../lib/managed-codes.ts';
const row=(id,store,code,name='麵粉',extra={})=>({id,store_id:store,store_name:store,kind:'ingredient',code,original_code:code,name,unit:'g',inactive:false,...extra});
test('shared codes collapse stores without losing old identities or search data',()=>{
 const rows=[row('b','二店','F1','麵粉',{original_code:'F2',target_id:'a',aliases:'粉'}),row('a','一店','F1')];
 const before=JSON.stringify(rows),groups=groupManagedCodes(rows);
 assert.equal(groups.length,1);assert.equal(groups[0].primary.id,'a');assert.equal(groups[0].members.length,2);
 assert.equal(groups[0].members[0].original_code,'F2');assert.equal(JSON.stringify(rows),before);
});
test('same name alone never merges codes, and missing codes remain separate',()=>{
 assert.equal(groupManagedCodes([row('a','一店','F1'),row('b','二店','F2')]).length,2);
 assert.equal(groupManagedCodes([row('a','一店',''),row('b','二店','')]).length,2);
});
test('duplicate hints require active cross-store names and compatible units',()=>{
 const normalize=u=>u==='kg'?'g':u;
 assert.deepEqual([...duplicateCodeKeys([row('a','一店','F1'),row('b','二店','F2','麵粉',{unit:'kg'})],normalize)],['ingredient:F1','ingredient:F2']);
 for(const other of [row('b','一店','F2'),row('b','二店','F1'),row('b','二店','F2','麵粉',{unit:'ml'}),row('b','二店','F2','麵粉',{inactive:true})])assert.equal(duplicateCodeKeys([row('a','一店','F1'),other],normalize).size,0);
});

import {backofficeReceiptName} from '../lib/ingredient-price-sheet.ts';
import {autoMatchReceiptDraft} from '../lib/receipt-ingredient-matching.ts';
test('confirmed common name wins over old receipt labels without mutating source',()=>{
 const ingredient={id:'local',name:'AL洗潔精',shared_name:'AL洗潔精',sheet_receipt_label:{name:'Ａ.L洗潔精4桶',supplier_key:'x'}};
 const offer={supplier:{key:'x'},receipt:{name:'洗潔精（桶）'}};
 assert.equal(backofficeReceiptName(ingredient,offer),'AL洗潔精');
 assert.equal(ingredient.sheet_receipt_label.name,'Ａ.L洗潔精4桶');
 assert.equal(backofficeReceiptName({...ingredient,shared_name:null},offer),'Ａ.L洗潔精4桶');
});
test('shared supplier binding picks local ID/common name and keeps original receipt name and amounts',()=>{
 const catalog={ingredients:[{id:'local',name:'AL洗潔精',unit:'桶',category:'耗材',canonical_code:'F000090',aliases:[]}],bindings:[{supplier:'供應商',name:'AL清潔劑',unit:'桶',specification:'',ingredient_id:'local',revision:0,shared:true}]};
 const original={supplier:'供應商',lines:[{product_name:'AL清潔劑',unit:'桶',specification:'',quantity:'4',unit_price:'50',subtotal:'200'}]};
 const result=autoMatchReceiptDraft(original,catalog).lines[0];
 assert.equal(result.product_name,'AL洗潔精');assert.equal(result.ingredient_id,'local');assert.equal(result.ingredient_code,'F000090');assert.equal(result.supplier_item_name,'AL清潔劑');assert.equal(result.subtotal,'200');
 assert.equal(autoMatchReceiptDraft({...original,lines:[{...original.lines[0],unit:'箱'}]},catalog).lines[0].ingredient_id,undefined);
});
