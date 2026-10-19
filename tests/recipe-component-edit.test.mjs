import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeComponentEditPath} from '../lib/recipe-component-edit.ts';
import {emptyRecipe} from '../lib/recipe-cost.ts';
const card=(id,children=[])=>({id,document:{...emptyRecipe(),name:id,lines:children.map(child=>({id:`${id}-${child}`,name:child,recipe_id:child,quantity:'40',unit:'g'}))}});
test('editing a shared component invalidates only the open root dependency path',()=>{
 const workspace={recipes:[card('main',['sauce','side']),card('sauce',['base']),card('side'),card('base'),card('other-main',['base'])]};const before=JSON.stringify(workspace);
 const result=recipeComponentEditPath('main','base',workspace,'edit-1');assert.deepEqual([...result.keys()],['sauce','main']);
 assert.equal(result.get('sauce').lines[0].cost_revision,'edit-1');assert.equal(result.get('main').lines[0].cost_revision,'edit-1');assert.equal(result.get('main').lines[1].cost_revision,undefined);
 assert.equal(result.get('main').lines[0].quantity,'40');assert.equal(JSON.stringify(workspace),before);assert.equal(result.has('other-main'),false);
});
test('multiple paths are updated and cyclic or missing references terminate safely',()=>{
 const workspace={recipes:[card('main',['sauce','other','missing']),card('sauce',['base','main']),card('other',['base']),card('base')]};
 const result=recipeComponentEditPath('main','base',workspace,'edit');assert.deepEqual(new Set(result.keys()),new Set(['main','sauce','other']));assert.equal(result.get('main').lines[2].cost_revision,undefined);
 assert.equal(recipeComponentEditPath('main','absent',workspace,'edit').size,0);
});
