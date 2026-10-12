import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveIngredientImport,recipeIngredientCode} from '../lib/ingredient-code.ts';
import {priceSearch} from '../lib/ingredient-price-sheet.ts';
import {ingredientMatches} from '../lib/ingredient-catalog.ts';
import {recipeIngredientOptions} from '../lib/recipe-cost.ts';
const row={id:'i1',ingredient_code:'F000123',name:'無鹽奶油',unit:'g',aliases:[{name:'奶油塊'}],cost_price:1,revision:1,review_status:'confirmed'};
test('code search and recipe selection preserve the existing identity',()=>{
 assert.equal(priceSearch(row,'f000123'),true);assert.equal(ingredientMatches(row,'F000123'),true);
 const option=recipeIngredientOptions({ingredients:[row],prices:[]})[0];assert.equal(option.ingredient_id,'i1');assert.equal(option.ingredient_code,'F000123');assert.equal(option.name,'無鹽奶油');
});
test('import by code updates existing item even after rename; conflicting and foreign codes reject',()=>{
 assert.equal(resolveIngredientImport([row],{'食材編碼':'F000123','食材':'新名稱'}),row);
 assert.throws(()=>resolveIngredientImport([row],{'識別碼':'i1','食材編碼':'F000999'}),/不一致/);
 assert.throws(()=>resolveIngredientImport([row],{'食材編碼':'F000999'}),/不存在/);
});
test('export uses linked identity only, never guesses by name or alters locked cost',()=>{
 const workspace={ingredients:[row]},line={ingredient_id:'i1',name:'舊名稱'};
 assert.equal(recipeIngredientCode(line,workspace),'F000123');assert.equal(recipeIngredientCode({name:row.name},workspace),'');assert.equal(recipeIngredientCode({ingredient_id:'other',name:row.name},workspace),'');
});
