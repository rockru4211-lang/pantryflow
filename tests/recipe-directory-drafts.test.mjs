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
 assert.match(html,/R000005[\s\S]*藍帶豬排[\s\S]*編輯食譜/);
 assert.doesNotMatch(html,/原食譜|食譜預覽|開啟完整食譜/);
 assert.doesNotMatch(html,/\d+ 個配件|class="rd-state rd-/);
 assert.match(html,/aria-label="勾選藍帶豬排"/);
 assert.match(html,/class="rd-component-code">—<\/span>/);
 assert.match(html,/未使用<small>/);
 assert.match(html,/配件成本/);
});

test('overview previews component usage costs and keeps a unified recipe edit entry',()=>{
 const component={...card,id:'sauce',recipe_code:'P000001',document:{...card.document,name:'醬汁',kind:'prep'},cost:{total:500,subtotal:500,missing:0,lines:[]}};
 const parent={...card,recipe_code:'R000001',document:{...card.document,yield:'2',lines:[{id:'usage',recipe_id:'sauce',name:'醬汁',quantity:'20',unit:'g'}]},cost:{total:40,subtotal:40,missing:0,lines:[{id:'usage',amount:40}]}};
 const html=renderToStaticMarkup(React.createElement(scope.exports.default,{...props,recipes:[parent,component]}));
 assert.match(html,/rd-component-preview[\s\S]*P000001[\s\S]*醬汁[\s\S]*\$100/);
 assert.match(html,/class="rd-component-code">P000001<\/span>/);
 assert.match(html,/>總成本<\/th>/);
 assert.match(html,/>配件成本<\/th>/);
 assert.match(html,/<td class="rd-components"><div class="rd-component-preview"/);
 assert.match(html,/>編輯食譜<\/button>/);
 assert.doesNotMatch(html,/>編輯配件<|每 份|rd-component-row|rd-components-toggle|>檢視<\/button>/);
 assert.equal((html.match(/>醬汁</g)||[]).length,1);
});

test('usage selector has four choices, preserves uncertain legacy labels and read-only access',()=>{
 const legacy={...card,document:{...card.document,lifecycle:'reserve'}};
 const html=renderToStaticMarkup(React.createElement(scope.exports.default,{...props,recipes:[legacy]}));
 assert.match(html,/>使用狀態<\/th>/);
 assert.match(html,/aria-label="原食譜使用狀態"/);
 assert.match(html,/option value="unset" disabled="" selected="">待設定/);
 for(const [value,label] of [['serving','使用中'],['unused','未使用'],['archived','舊食譜'],['ready','待上市']])assert.match(html,new RegExp(`option value="${value}">${label}`));
 assert.match(html,/原狀態：季節備用/);
 assert.doesNotMatch(html,/送主管確認|確認並立即上線|退回修改/);
 const readonly=renderToStaticMarkup(React.createElement(scope.exports.default,{...props,recipes:[legacy],store:{...props.store,access_mode:'VIEW'}}));
 assert.doesNotMatch(readonly,/aria-label="原食譜使用狀態"/);
 assert.match(readonly,/原狀態：季節備用/);
 assert.equal(legacy.document.lifecycle,'reserve');
});

test('dish category remains distinct from usage status and preserves source fallback and uncategorized rows',()=>{
 const rows=[{...card,id:'main',document:{...card.document,name:'長菜名主餐',category:'主餐',source_category:'來源分類',lifecycle:'serving'}},{...card,id:'starter',document:{...card.document,name:'前菜食譜',source_category:'前菜'}},{...card,id:'unset',document:{...card.document,name:'尚未分類食譜'}}];
 const before=JSON.stringify(rows);
 const html=renderToStaticMarkup(React.createElement(scope.exports.default,{...props,recipes:rows}));
 assert.match(html,/>菜色分類<\/th>/);assert.match(html,/>使用狀態<\/th>/);
 assert.match(html,/rd-category-label">主餐/);assert.match(html,/rd-category-label">前菜/);assert.match(html,/rd-category-unset">待分類/);
 assert.match(html,/aria-label="篩選分類"/);assert.match(html,/aria-label="食譜使用狀態"/);
 assert.equal(JSON.stringify(rows),before);
});

test('component layout preserves full names with wrapping and confines narrow screens to the table scroller',()=>{
 const css=readFileSync(new URL('../app/pilot/cost-directory-theme.css',import.meta.url),'utf8');
 assert.match(css,/white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere/);
 assert.match(css,/grid-template-columns:58px minmax\(0,1fr\) 96px/);
 assert.match(css,/\.rd-table\{min-width:1120px\}/);
 const directoryCss=readFileSync(new URL('../app/pilot/recipe-directory.css',import.meta.url),'utf8');
 assert.match(directoryCss,/\.rd-table-scroll\{overflow:auto/);
});

test('full-width recipe directory preserves single-line codes and keeps enlarged component costs together',()=>{
 const css=readFileSync(new URL('../app/pilot/cost-directory-theme.css',import.meta.url),'utf8');
 assert.match(css,/\.recipe-directory\.recipe-directory\{width:100%;max-width:none;margin-inline:0;container-type:inline-size\}/);
 assert.match(css,/th\.rd-identity\{width:104px\}/);
 assert.match(css,/\.rd-identity\{white-space:nowrap;overflow-wrap:normal;font-variant-numeric:tabular-nums\}/);
 assert.match(css,/\.rd-component-preview\{display:grid;width:max-content;max-width:100%;grid-template-columns:62px minmax\(0,max-content\) max-content;column-gap:12px;row-gap:5px;margin-inline:0\}/);
 assert.match(css,/\.rd-component-preview>span\{display:contents\}/);
 assert.match(css,/@container\(min-width:1450px\)/);
 assert.match(css,/th\.rd-components\{width:320px\}/);
 assert.match(css,/th\.rd-category\{width:148px\}/);
 assert.match(css,/th\.rd-usage-status\{width:176px\}/);
 assert.match(css,/\.rd-name\{font-size:20px\}/);
 assert.match(css,/\.rd-component-code\{font-size:14px\}/);
 assert.match(css,/\.rd-component-preview>span>span:nth-child\(2\)\{font-size:16px\}/);
 const html=renderToStaticMarkup(React.createElement(scope.exports.default,{...props,recipes:[{...card,recipe_code:'R000088'}]}));
 assert.match(html,/<td class="rd-identity">R000088<\/td>/);
});
