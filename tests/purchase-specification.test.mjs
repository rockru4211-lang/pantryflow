import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePurchaseSpecification,formatPurchaseSpecification,validatePurchaseSpecification} from '../lib/purchase-specification.ts';
import {ingredientSaveData} from '../lib/ingredient-catalog.ts';
import {changeSheetValues} from '../lib/operations-sheet.ts';
import {costBasisNote,restoreCostBasis} from '../lib/cost-price.ts';
test('single-field specifications parse supported weight and volume without guessing',()=>{
 assert.deepEqual(parsePurchaseSpecification('２ 公斤'),{quantity:'2',unit:'公斤'});
 for(const s of ['500克','750毫升','2kg','1L'])assert.ok(parsePurchaseSpecification(s));
 for(const s of ['2','0公斤','約2公斤','2公斤×3包'])assert.equal(parsePurchaseSpecification(s),null);
 assert.doesNotThrow(()=>validatePurchaseSpecification(''));
 assert.throws(()=>validatePurchaseSpecification('2'),/規格/);
 assert.equal(formatPurchaseSpecification(750,'ml'),'750毫升');
});
test('905 per kg and 1900 per 2kg package produce distinct correct standard prices',()=>{
 const base={name:'菲力',reference:''};
 assert.equal(ingredientSaveData({...base,price:'905',unit:'公斤',specification:''}).cost_price,.905);
 const p=ingredientSaveData({...base,price:'1900',unit:'包',specification:'2公斤'});
 assert.equal(p.cost_price,.95);assert.equal(p.purchase.content_quantity,2);assert.equal(p.purchase.content_unit,'公斤');
 assert.equal(ingredientSaveData({...base,price:'1900',unit:'包',specification:''}).cost_price,1900);
});
test('new specification recalculates operations and survives storage; clearing makes cross-unit cost unknown',()=>{
 const initial={name:'菲力',unit:'公斤',quantity:'.5',purchase_price:'1900',price_unit:'包',price:'',note:''};
 const row=changeSheetValues(initial,'purchase_specification','2公斤');
 assert.equal(row.price,'950');assert.equal(row.amount,'475');
 const restored=restoreCostBasis({...row,note:costBasisNote(row)});
 assert.equal(restored.purchase_specification,'2公斤');
 assert.equal(changeSheetValues(row,'purchase_specification','').price,'');
 assert.equal(changeSheetValues(row,'price_unit','公斤').content_quantity,'');
});
