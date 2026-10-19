import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import React from 'react';import * as jsx from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';import ts from 'typescript';
import * as model from '../lib/recipe-model.ts';import * as organization from '../lib/recipe-organization.ts';import * as prices from '../lib/recipe-price-draft.ts';import * as cost from '../lib/recipe-cost.ts';
const code=ts.transpileModule(readFileSync(new URL('../app/pilot/recipe-directory.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const scope={exports:{},require(n){if(n==='react')return React;if(n==='react/jsx-runtime')return jsx;if(n==='lucide-react')return{ChevronDown:'i',Plus:'i',Search:'i'};if(n==='@/lib/data-access')return{canData:()=>true};if(n==='@/lib/supabase-browser')return{};if(n==='@/lib/app-workspace')return{appError:String};if(n==='@/lib/recipe-cost')return cost;if(n==='@/lib/recipe-model')return model;if(n==='@/lib/recipe-organization')return organization;if(n==='@/lib/recipe-price-draft')return prices;if(n==='./recipe-editor')return{recipeMoney:()=>'$100'};if(n==='./recipe-modal')return{default:()=>null};if(n.endsWith('.css'))return{};throw Error(n);}};runInNewContext(code,scope);
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
