import test from 'node:test';
import {createRequire} from 'node:module';
import * as XLSX from 'xlsx';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import ts from 'typescript';
import * as model from '../lib/ingredient-price-sheet.ts';
import * as catalog from '../lib/ingredient-catalog.ts';
const source=readFileSync(new URL('../app/pilot/ingredient-price-sheet.tsx',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default function','function');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const row={id:'m',name:'奶油',source:'請購表：2026/09食材',effective_date:'2026-09-10',unit:'g',cost_price:.28,review_status:'confirmed',revision:1,aliases:[{id:'a',name:'奶油塊'},{id:'b',name:'無鹽牛油'}],supplier_key:'id:s',supplier_id:'s',supplier_name:'甲商',sources:[]};
function harness(extra={}){const hooks=[],calls=[],storage=new Map();let i=0;const scope={require:createRequire(import.meta.url),React,Fragment:React.Fragment,...model,...catalog,crypto,setTimeout:()=>0,clearTimeout,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},window:{confirm:()=>true,addEventListener(){},removeEventListener(){}},useState:v=>{const n=i++;if(!(n in hooks))hooks[n]=typeof v==='function'?v():v;return [hooks[n],v=>hooks[n]=typeof v==='function'?v(hooks[n]):v];},useRef:v=>{const n=i++;return hooks[n]||(hooks[n]={current:v});},useEffect:()=>{}};runInNewContext(code,scope);const props={data:{...model.emptyPriceSheet,ingredients:[row],suppliers:[{id:'s',name:'甲商'}],can_price:true,...extra},loaded:true,failed:false,canExport:true,draftKey:'test',save:async(...args)=>{calls.push(args);}};const render=()=>{i=0;return scope.IngredientPriceSheet(props);};return {render,calls,props};}
function all(node,predicate){if(!node)return [];if(Array.isArray(node))return node.flatMap(v=>all(v,predicate));if(typeof node!=='object')return [];return [...(predicate(node)?[node]:[]),...all(node.props?.children,predicate)];}
const text=n=>Array.isArray(n)?n.map(text).join(''):typeof n==='object'&&n?text(n.props?.children):String(n??'');
async function flush(){for(let i=0;i<100;i++)await Promise.resolve();}
const button=(tree,label)=>all(tree,n=>n.type==='button'&&text(n)===label)[0];
test('inline edit saves without a side card and preserves blank price',async()=>{const h=harness();button(h.render(),'更多 ⌄').props.onClick();button(h.render(),'編輯資料').props.onClick();let tree=h.render();assert.equal(all(tree,n=>n.props?.role==='dialog').length,0);all(tree,n=>n.props?.['aria-label']==='確認價格')[0].props.onChange({target:{value:''}});await button(h.render(),'儲存修改').props.onClick();await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'save');assert.equal(h.calls[0][1].cost_price,null);assert.equal(h.calls[0][1].supplier_id,'s');});
test('supplier stop sends scope and reason and does not write until confirmed',async()=>{const h=harness();button(h.render(),'更多 ⌄').props.onClick();button(h.render(),'停用此品項').props.onClick();await flush();assert.equal(h.calls.length,0);let tree=h.render();const select=all(tree,n=>n.type==='select'&&n.props.value==='*')[0];select.props.onChange({target:{value:'id:s'}});await button(h.render(),'確認停用並留紀錄').props.onClick();await flush();assert.equal(h.calls[0][0],'stop');assert.equal(h.calls[0][1].supplier_key,'id:s');assert.equal(h.calls[0][1].reason,'價格偏高');});
test('removed tab shows reason and requires restore explanation',async()=>{const h=harness({supply_states:[{ingredient_id:'m',supplier_key:'id:s',supplier_name:'甲商',stopped:true,reason:'品質不佳',disposition:'不建議再採購',note:'退貨兩次',revision:1,updated_at:'2026-10-08'}]});const tab=all(h.render(),n=>n.type==='button'&&text(n)==='已停用紀錄')[0];tab.props.onClick();await flush();assert(text(h.render()).includes('品質不佳'));button(h.render(),'恢復').props.onClick();await button(h.render(),'確認恢復並留紀錄').props.onClick();await flush();assert.equal(h.calls.length,0);assert(text(h.render()).includes('請簡短記錄恢復採購的原因'));});

test('partial save retry does not resend successful rows and retains request identity',async()=>{const h=harness({ingredients:[row,{...row,id:'n',name:'麵粉'}]});const requests=[];let fail=true;h.props.save=async(a,d,id)=>{requests.push({a,d,id});if(d.id==='n'&&fail)throw Error('network');};button(h.render(),'編輯全部').props.onClick();for(let i=0;i<2;i++)all(h.render(),n=>n.props?.['aria-label']==='確認價格')[i].props.onChange({target:{value:'0.5'}});await button(h.render(),'儲存修改').props.onClick();await flush();assert.equal(requests.length,2);fail=false;await button(h.render(),'儲存修改').props.onClick();await flush();assert.equal(requests.length,3);assert.equal(requests[2].d.id,'n');assert.equal(requests[2].id,requests[1].id);});
function file(rows){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows),'價格');const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});return {arrayBuffer:async()=>bytes};}
test('multi-file first import stages rows, duplicate files do not create duplicate drafts, explicit save writes',async()=>{const h=harness({ingredients:[]});let tree=h.render();const upload=all(tree,n=>n.type==='input'&&n.props.type==='file')[0];const f=file([{食材:'測試麵粉',單位:'公斤',價格:32}]);await upload.props.onChange({target:{files:[f,f]}});await flush();assert.equal(h.calls.length,0);await button(h.render(),'儲存修改').props.onClick();await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].name,'測試麵粉');});
test('removed-file reimport cannot resurrect a removed item',async()=>{const h=harness({supply_states:[{ingredient_id:'m',supplier_key:'*',stopped:true}]});const upload=all(h.render(),n=>n.type==='input'&&n.props.type==='file')[0];await upload.props.onChange({target:{files:[file([{識別碼:'m',食材:'奶油',單位:'g',價格:.28}])]}});await flush();assert.equal(h.calls.length,0);assert(text(h.render()).includes('匯入不會自動恢復'));});

test('single specification input saves a package and replaces the two content controls',async()=>{
 const h=harness();button(h.render(),'更多 ⌄').props.onClick();button(h.render(),'編輯資料').props.onClick();
 const input=label=>all(h.render(),n=>n.props?.['aria-label']===label)[0];
 assert.equal(input('規格').props.disabled,true);
 input('進貨單位').props.onChange({target:{value:'包'}});
 input('規格').props.onChange({target:{value:'2公斤'}});
 input('確認價格').props.onChange({target:{value:'1900'}});
 assert.equal(input('每包內容量'),undefined);assert.equal(input('內容單位'),undefined);
 await button(h.render(),'儲存修改').props.onClick();await flush();
 assert.equal(h.calls[0][1].cost_price,.95);assert.equal(h.calls[0][1].purchase.content_quantity,2);
});


 test('seven-column baseline expands details in-row, including grouped history, without writes',()=>{
 const h=harness({ingredients:[row,{...row,id:'older',name:'奶油 · 原表計價基準：300 元／1000 g',source:'歷史食譜：舊菜單',source_kind:'history',effective_date:null}]});
 assert.deepEqual(all(h.render(),n=>n.type==='th').map(text),['','食材名稱','分類','供應商','參考進價','價格日期','操作']);assert(!text(h.render()).includes('請購表：2026/09食材'));
 assert.equal(all(h.render(),n=>n.type==='button'&&text(n)==='更多 ⌄').length,1);
 button(h.render(),'更多 ⌄').props.onClick();
 assert(text(h.render()).includes('價格來源'));assert(text(h.render()).includes('同名原始紀錄（2）'));
 assert.equal(all(h.render(),n=>n.props?.role==='dialog').length,0);assert.equal(h.calls.length,0);
 button(h.render(),'收起 ⌃').props.onClick();assert(!text(h.render()).includes('價格來源'));
 });
 test('history tabs and alias search preserve the selected scope',()=>{
 const h=harness({ingredients:[row,{...row,id:'old',name:'舊食材',source:'歷史食譜：舊菜單',source_kind:'history',sources:[],effective_date:null,aliases:[{id:'old-alias',name:'舊別名'}]}]});
 assert(!text(h.render()).includes('舊食材'));assert.equal(all(h.render(),n=>n.type==='nav').length,1);
 button(h.render(),'歷史食材').props.onClick();assert(text(h.render()).includes('舊食材'));
 button(h.render(),'全部').props.onClick();
 all(h.render(),n=>n.props?.['aria-label']==='搜尋食材、別名、供應商')[0].props.onChange({target:{value:'舊別名'}});
 assert(text(h.render()).includes('舊食材'));assert.equal(h.calls.length,0);
 });

 test('opening edit all and saving unchanged rows does not rewrite saved prices',async()=>{
 const h=harness();button(h.render(),'編輯全部').props.onClick();await button(h.render(),'儲存修改').props.onClick();await flush();assert.equal(h.calls.length,0);
 });

test('an unsuccessful initial read does not report zero ingredients',()=>{
 const h=harness({ingredients:[]});h.props.loaded=false;h.props.failed=true;
 assert(text(h.render()).includes('讀取失敗'));assert(!text(h.render()).includes('0 項 · 每頁'));
});

test('category and supplier filters combine with search and selection limits editing',()=>{
 const h=harness({ingredients:[{...row,category:'調料'},{...row,id:'n',name:'高麗菜',category:'食材',supplier_name:'乙商'}]});
 const control=label=>all(h.render(),n=>n.props?.['aria-label']===label)[0];
 control('篩選分類').props.onChange({target:{value:'食材'}});
 assert(text(h.render()).includes('高麗菜'));assert(!text(h.render()).includes('奶油'));
 control('篩選供應商').props.onChange({target:{value:'甲商'}});assert(text(h.render()).includes('沒有符合的食材'));
 control('篩選分類').props.onChange({target:{value:''}});control('篩選供應商').props.onChange({target:{value:''}});
 control('選取 奶油').props.onChange({target:{checked:true}});button(h.render(),'編輯所選').props.onClick();
 assert.equal(all(h.render(),n=>n.props?.['aria-label']==='食材名稱').length,1);
});
test('missing price and legacy manual date stay blank while a genuine zero remains visible',()=>{
 const h=harness({ingredients:[{...row,id:'blank',name:'缺價品',cost_price:null,manual:true},{...row,id:'zero',name:'零價品',cost_price:0,price_date:'2026-09-20'}]});
 const rows=all(h.render(),n=>n.type==='tr');
 const blank=rows.find(n=>text(n).includes('缺價品')),zero=rows.find(n=>text(n).includes('零價品'));
 assert.equal(all(blank,n=>n.type==='td')[4].props.children[0],'');assert.equal(text(all(blank,n=>n.type==='td')[5]),'');
 assert(text(zero).includes('NT$ 0／g'));assert(text(zero).includes('2026/09/20'));assert(!text(blank).includes('未計價'));
});
test('category edit persists and survives switching to historical scope',async()=>{
 const h=harness();button(h.render(),'編輯全部').props.onClick();
 all(h.render(),n=>n.props?.['aria-label']==='食材分類')[0].props.onChange({target:{value:'調料'}});
 button(h.render(),'歷史食材').props.onClick();await button(h.render(),'儲存修改').props.onClick();await flush();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].category,'調料');assert.equal(h.calls[0][1].cost_price,.28);
});
test('import stages valid categories and rejects invalid classifications without writing',async()=>{
 const h=harness({ingredients:[]});
 const upload=()=>all(h.render(),n=>n.type==='input'&&n.props.type==='file')[0];
 await upload().props.onChange({target:{files:[file([{食材:'測試酒',單位:'瓶',價格:100,分類:'錯誤'}])]}});await flush();assert.equal(h.calls.length,0);assert(text(h.render()).includes('分類請使用'));
 await upload().props.onChange({target:{files:[file([{食材:'測試酒',單位:'瓶',價格:100,分類:'酒水'}])]}});await flush();
 await button(h.render(),'儲存修改').props.onClick();await flush();assert.equal(h.calls[0][1].category,'酒水');
});
