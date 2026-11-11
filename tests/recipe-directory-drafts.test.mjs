import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import React from 'react';import * as jsx from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';import ts from 'typescript';
import * as display from '../lib/recipe-display.ts';
import * as model from '../lib/recipe-model.ts';import * as organization from '../lib/recipe-organization.ts';import * as prices from '../lib/recipe-price-draft.ts';import * as cost from '../lib/recipe-cost.ts';
const code=ts.transpileModule(readFileSync(new URL('../app/pilot/recipe-directory.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const scope={exports:{},require(n){if(n==='react')return React;if(n==='react/jsx-runtime')return jsx;if(n==='lucide-react')return{ChevronDown:'i',Plus:'i',Search:'i'};if(n==='@/lib/data-access')return{canData:()=>true};if(n==='@/lib/supabase-browser')return{};if(n==='@/lib/app-workspace')return{appError:String};if(n==='@/lib/recipe-display')return display;if(n==='@/lib/recipe-cost')return cost;if(n==='@/lib/recipe-model')return model;if(n==='@/lib/recipe-organization')return organization;if(n==='@/lib/recipe-price-draft')return prices;if(n==='./recipe-editor')return{recipeMoney:()=>'$100'};if(n==='./recipe-modal')return{default:()=>null};if(n==='./recipe-row-menu')return{default:({children})=>children};if(n.endsWith('.css'))return{};throw Error(n);}};runInNewContext(code,scope);
const card={id:'saved',revision:2,document:{...cost.emptyRecipe(),name:'原食譜'},updated_at:'',cost:{total:100,subtotal:100,missing:0,lines:[]}};
const props={store:{id:'s',name:'BeApe',role:'OWNER'},recipes:[card],drafts:[{...card,document:{...card.document,name:'修改中的食譜'}},{...card,id:'new',revision:0,document:{...card.document,name:'新醬汁',kind:'prep'}}],loaded:true,actions:null,onNew(){},onOpen(){},onView(){},onDiscard(){},reload:async()=>{},beforeUpdate:()=>true};
test('draft tab uses the same directory with a single new action and no duplicate saved list',()=>{
 const html=renderToStaticMarkup(React.createElement(scope.exports.default,{...props,initialStatus:'draft'}));
 assert.match(html,/修改中的食譜/);assert.match(html,/新醬汁/);assert.match(html,/修改草稿 · 原食譜保留/);assert.match(html,/新食譜草稿 · 配件/);
 assert.equal((html.match(/>新增<\/button>/g)||[]).length,1);assert.equal((html.match(/>刪除草稿<\/button>/g)||[]).length,2);assert.doesNotMatch(html,/檢視食譜|返回食譜總表|新增主食譜/);
});
test('read-only directory never offers draft deletion',()=>{
 const html=renderToStaticMarkup(React.createElement(scope.exports.default,{...props,initialStatus:'draft',store:{...props.store,access_mode:'VIEW'}}));assert.doesNotMatch(html,/>刪除草稿</);assert.match(html,/繼續編輯/);
});

test('the centered saved directory shows the matching recipe with direct view and no duplicate preview',()=>{
 const other={...card,id:'other',recipe_code:'R000005',document:{...card.document,name:'藍帶豬排',component_order:['sauce']}};
 const html=renderToStaticMarkup(React.createElement(scope.exports.default,{...props,recipes:[card,other],initialSearch:'R000005'}));
 assert.match(html,/R000005[\s\S]*藍帶豬排[\s\S]*1 個配件[\s\S]*編輯食譜/);
 assert.doesNotMatch(html,/原食譜|食譜預覽|開啟完整食譜/);
});

test('overview previews component usage costs and keeps a unified recipe edit entry',()=>{
 const component={...card,id:'sauce',recipe_code:'P000001',document:{...card.document,name:'醬汁',kind:'prep'},cost:{total:500,subtotal:500,missing:0,lines:[]}};
 const parent={...card,recipe_code:'R000001',document:{...card.document,yield:'2',lines:[{id:'usage',recipe_id:'sauce',name:'醬汁',quantity:'20',unit:'g'}]},cost:{total:40,subtotal:40,missing:0,lines:[{id:'usage',amount:40}]}};
 const html=renderToStaticMarkup(React.createElement(scope.exports.default,{...props,recipes:[parent,component]}));
 assert.match(html,/rd-component-preview[\s\S]*醬汁[\s\S]*本次使用/);
 assert.match(html,/>總成本<\/th>/);
 assert.match(html,/>配件及本次使用成本<\/th>/);
 assert.match(html,/<td class="rd-components"><div class="rd-component-preview"/);
 assert.match(html,/>編輯食譜<\/button>/);
 assert.doesNotMatch(html,/>編輯配件<|每 份|rd-component-row|rd-components-toggle|>檢視<\/button>/);
 assert.equal((html.match(/>醬汁</g)||[]).length,1);
});
