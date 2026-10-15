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
