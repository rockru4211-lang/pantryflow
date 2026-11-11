import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeCategory,recipeLifecycle,recipeDirectoryMatches,recipeLegacyStatus,recipeStatusTabs,lifecycleLabels} from '../lib/recipe-organization.ts';
const menus=[{id:'a',name:'秋冬',state:'closed',revision:1},{id:'b',name:'商午',state:'active',revision:1}];
test('source categories remain store-specific; old dishes take priority over hidden sheets',()=>{
 assert.equal(recipeCategory({source_category:'前菜'}),'前菜');
 assert.equal(recipeCategory({category:'沙拉',source_category:'前菜'}),'沙拉');
 assert.equal(recipeCategory({}),'待分類');
 assert.equal(recipeLifecycle({source_sheet_hidden:true,source_status:['舊菜']},menus),'archived');
});
test('menus no longer infer a recipe usage state',()=>{
 assert.equal(recipeLifecycle({lifecycle:'menu',menu_ids:['a','b']},menus),'unset');
 assert.equal(recipeLifecycle({lifecycle:'menu',menu_ids:['a']},menus),'unset');
 assert.equal(recipeLifecycle({lifecycle:'menu',menu_ids:['b']},[{...menus[1],state:'draft'}]),'unset');
 assert.equal(recipeLifecycle({lifecycle:'research',menu_ids:[]},menus),'unset');
 assert.equal(recipeLifecycle({lifecycle:'serving'},menus),'serving');
});
test('search reaches ingredients and nested components and terminates cycles',()=>{
 const card=(id,name,lines,components=[])=>({id,document:{name,kind:'dish',lines,component_order:components}});
 const root=card('root','藍帶豬排',[{name:'內餡',recipe_id:'prep'}]);
 const prep=card('prep','內餡',[{name:'起司'},{name:'parent',recipe_id:'root'}]);
 assert.equal(recipeDirectoryMatches(root,[root,prep],'起司'),true);
 assert.equal(recipeDirectoryMatches(root,[root,prep],'不存在'),false);
});

test('reserve classification preserves explicit choices and unknown service status',()=>{
 assert.equal(recipeLifecycle({source_sheet_hidden:true},[]),'unset');
 assert.equal(recipeLifecycle({source_status:['原表隱藏']},[]),'unset');
 assert.equal(recipeLifecycle({source_status:[]},[]),'unset');
 assert.equal(recipeLifecycle({lifecycle:'serving',source_sheet_hidden:true},[]),'serving');
 assert.equal(recipeLifecycle({lifecycle:'research',source_status:['舊菜']},[]),'unset');
 assert.equal(recipeLifecycle({lifecycle:'unset',source_sheet_hidden:true},[]),'unset');
 assert.equal(recipeLifecycle({lifecycle:'reserve'},[]),'unset');
});

test('approved recipes have an independent ready state and season/code search preserves documents',()=>{
 const doc={name:'濃湯',kind:'dish',season:'秋季',lifecycle:'ready',lines:[]};
 const card={id:'soup',recipe_code:'R-101',document:doc};const before=JSON.stringify(card);
 assert.equal(recipeLifecycle(doc,[]),'ready');
 assert.equal(recipeDirectoryMatches(card,[card],'R-101'),true);
 assert.equal(recipeDirectoryMatches(card,[card],'秋季'),true);
 assert.equal(JSON.stringify(card),before);
});

test('four explicit states and uncertain legacy metadata are lossless',()=>{
 assert.deepEqual(recipeStatusTabs,['serving','unused','archived','ready']);
 assert.deepEqual(recipeStatusTabs.map(s=>lifecycleLabels[s]),['使用中','未使用','舊食譜','待上市']);
 for(const lifecycle of ['unset','research','reserve','menu']){
  const doc={lifecycle,source_sheet_hidden:true,menu_ids:['b']}; const before=JSON.stringify(doc);
  assert.equal(recipeLifecycle(doc,menus),'unset'); assert.ok(recipeLegacyStatus(doc));
  assert.equal(JSON.stringify(doc),before);
 }
 for(const lifecycle of recipeStatusTabs)assert.equal(recipeLifecycle({lifecycle},menus),lifecycle);
});
