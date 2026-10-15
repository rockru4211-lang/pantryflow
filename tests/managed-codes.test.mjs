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
