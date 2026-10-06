import test from 'node:test';
import assert from 'node:assert/strict';
import {ingredientMatches,ingredientDraft,ingredientSaveData} from '../lib/ingredient-catalog.ts';
import {recipeIngredientOptions,recipeCost} from '../lib/recipe-cost.ts';
const row={id:'master-1',name:'無鹽奶油',unit:'g',cost_price:.48,selected_reference:null,review_status:'confirmed',revision:2,aliases:[{id:'alias-1',name:'無鹽牛油',unit:'g',specification:'',corrected:false}]};
test('aliases are searchable and zero is different from a missing price',()=>{assert(ingredientMatches(row,'無鹽牛油'));assert(!ingredientMatches(row,'有鹽'));assert.equal(ingredientSaveData({...ingredientDraft(row),price:''},row).cost_price,null);assert.equal(ingredientSaveData({...ingredientDraft(row),price:'0'},row).cost_price,0);assert.throws(()=>ingredientSaveData({...ingredientDraft(row),price:'-2'},row));});
test('master identity survives renaming and chooses only its scoped price',()=>{const ws={ingredients:[row],recipes:[],products:[],prices:[{key:'i:master-1',name:'無鹽奶油',unit:'g',price:.48}],can_price:true};assert.equal(recipeIngredientOptions(ws).length,1);assert.equal(recipeIngredientOptions(ws)[0].ingredient_id,row.id);assert.deepEqual(recipeIngredientOptions(ws)[0].aliases,['無鹽牛油']);assert.equal(recipeCost({name:'測試',lines:[{id:'1',name:'舊名',ingredient_id:'master-1',unit:'g',quantity:'100'}],notes:''},ws).total,48);assert.equal(recipeCost({name:'測試',lines:[{id:'1',name:'無鹽奶油',ingredient_id:'another-store',unit:'g',quantity:'100'}],notes:''},ws).total,null);});

test('source labels distinguish baseline origin and explicit manual values',async()=>{
 const {ingredientSourceLabel,ingredientSourcePriority}=await import('../lib/ingredient-catalog.ts');
 assert.equal(ingredientSourceLabel({...row,source:'請購表：2026/09食材',source_kind:'purchase'}),'請購表');
 assert.equal(ingredientSourceLabel({...row,source:'白醬成本',source_kind:'history'}),'過去食譜成本表');
 assert.equal(ingredientSourceLabel({...row,manual:true}),'人工設定');
 assert(ingredientSourcePriority('已核對進貨','purchase')<ingredientSourcePriority('請購表','purchase'));
 assert(ingredientSourcePriority('請購表','purchase')<ingredientSourcePriority('食譜','history'));
});

test('purchase amount and optional conversion survive draft/save/reload without relabeling weight',()=>{
 const packaged={...row,purchase:{amount:600,quantity:2,unit:'瓶',content_quantity:600,content_unit:'ml'},unit:'ml',cost_price:.5};
 const draft=ingredientDraft(packaged);assert.equal(draft.price,'300');assert.equal(draft.unit,'瓶');assert.equal(draft.content,'600');
 const saved=ingredientSaveData(draft,packaged);assert.equal(saved.cost_price,.5);assert.equal(saved.unit,'ml');assert.equal(saved.purchase.amount,300);
 const pending=ingredientSaveData({...draft,content:''},packaged);assert.equal(pending.cost_price,300);assert.equal(pending.unit,'瓶');assert.equal(pending.purchase.content_quantity,undefined);
 assert.equal(ingredientDraft({...packaged,...pending}).price,'300');
 assert.equal(ingredientSaveData({...draft,price:''},packaged).cost_price,null);
});
