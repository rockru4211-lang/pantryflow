import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeCategory,recipeLifecycle,recipeDirectoryMatches} from '../lib/recipe-organization.ts';
const menus=[{id:'a',name:'秋冬',state:'closed',revision:1},{id:'b',name:'商午',state:'active',revision:1}];
test('source categories remain store-specific, hidden sheets never imply archived',()=>{
 assert.equal(recipeCategory({source_category:'前菜'}),'前菜');
 assert.equal(recipeCategory({category:'沙拉',source_category:'前菜'}),'沙拉');
 assert.equal(recipeCategory({}),'待分類');
 assert.equal(recipeLifecycle({source_sheet_hidden:true,source_status:['舊菜']},menus),'unset');
});
test('ending one menu preserves service in another active menu',()=>{
 assert.equal(recipeLifecycle({lifecycle:'menu',menu_ids:['a','b']},menus),'serving');
 assert.equal(recipeLifecycle({lifecycle:'menu',menu_ids:['a']},menus),'archived');
 assert.equal(recipeLifecycle({lifecycle:'menu',menu_ids:['b']},[{...menus[1],state:'draft'}]),'research');
 assert.equal(recipeLifecycle({lifecycle:'research',menu_ids:[]},menus),'research');
 assert.equal(recipeLifecycle({lifecycle:'serving'},menus),'serving');
});
test('search reaches ingredients and nested components and terminates cycles',()=>{
 const card=(id,name,lines,components=[])=>({id,document:{name,kind:'dish',lines,component_order:components}});
 const root=card('root','藍帶豬排',[{name:'內餡',recipe_id:'prep'}]);
 const prep=card('prep','內餡',[{name:'起司'},{name:'parent',recipe_id:'root'}]);
 assert.equal(recipeDirectoryMatches(root,[root,prep],'起司'),true);
 assert.equal(recipeDirectoryMatches(root,[root,prep],'不存在'),false);
});
