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
import * as codes from '../lib/ingredient-code.ts';
const source=readFileSync(new URL('../app/pilot/ingredient-price-sheet.tsx',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default function','function');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const supplySource=readFileSync(new URL('../app/pilot/ingredient-hub-records.tsx',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export function','function');
const supplyCode=ts.transpileModule(supplySource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const row={id:'m',name:'奶油',source:'請購表：2026/09食材',effective_date:'2026-09-10',unit:'g',cost_price:.28,review_status:'confirmed',revision:1,aliases:[{id:'a',name:'奶油塊'},{id:'b',name:'無鹽牛油'}],supplier_key:'id:s',supplier_id:'s',supplier_name:'甲商',sources:[]};
function harness(extra={},supply=false){const hooks=[],calls=[],storage=new Map();let i=0;const scope={WorkspaceEditDialog:"WorkspaceEditDialog",require:createRequire(import.meta.url),React,Error,Fragment:React.Fragment,...model,...catalog,...codes,RecipeRowMenu:({children})=>children,RecipeModal:({children})=>children,crypto,setTimeout:()=>0,clearTimeout,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},window:{confirm:()=>true,addEventListener(){},removeEventListener(){}},useState:v=>{const n=i++;if(!(n in hooks))hooks[n]=typeof v==='function'?v():v;return [hooks[n],v=>hooks[n]=typeof v==='function'?v(hooks[n]):v];},useRef:v=>{const n=i++;return hooks[n]||(hooks[n]={current:v});},useEffect:()=>{}};runInNewContext(supply?supplyCode:code,scope);const props={data:{...model.emptyPriceSheet,ingredients:[row],suppliers:[{id:'s',name:'甲商'}],can_price:true,...extra},loaded:true,failed:false,canExport:true,draftKey:'test',save:async(...args)=>{calls.push(args);}};const render=()=>{i=0;return supply?scope.SupplyRecords(props):scope.IngredientPriceSheet(props);};return {render,calls,props};}
function all(node,predicate){if(!node)return [];if(Array.isArray(node))return node.flatMap(v=>all(v,predicate));if(typeof node!=='object')return [];return [...(predicate(node)?[node]:[]),...all(node.props?.children,predicate)];}
const text=n=>Array.isArray(n)?n.map(text).join(''):typeof n==='object'&&n?text(n.props?.children):String(n??'');
async function flush(){for(let i=0;i<100;i++)await Promise.resolve();}
const button=(tree,label)=>all(tree,n=>n.type==='button'&&text(n)===label)[0];
test('price edit opens the table dialog and preserves blank price',async()=>{const h=harness();button(h.render(),'編輯食材').props.onClick();let tree=h.render();assert.equal(all(tree,n=>n.type==='WorkspaceEditDialog').length,1);all(tree,n=>n.props?.['aria-label']==='確認價格')[0].props.onChange({target:{value:''}});await button(h.render(),'儲存修改').props.onClick();await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'save');assert.equal(h.calls[0][1].cost_price,null);assert.equal(h.calls[0][1].supplier_id,'s');});
test('supplier stop sends scope and replacement only after confirmation',async()=>{const h=harness({},true);button(h.render(),'停用').props.onClick();await flush();assert.equal(h.calls.length,0);const input=all(h.render(),n=>n.type==='input'&&n.props.maxLength===1000)[0];input.props.onChange({target:{value:'替代奶油／乙商'}});await button(h.render(),'儲存紀錄').props.onClick();await flush();assert.equal(h.calls[0][0],'stop');assert.equal(h.calls[0][1].supplier_key,'id:s');assert.equal(h.calls[0][1].reason,'停止供貨');assert.equal(h.calls[0][1].replacement,'替代奶油／乙商');});
test('supply tab shows original reason and requires restore explanation',async()=>{const h=harness({supply_states:[{ingredient_id:'m',supplier_key:'id:s',supplier_name:'甲商',stopped:true,reason:'品質不佳',disposition:'不建議再採購',note:'退貨兩次',replacement:'候選品',revision:1,updated_at:'2026-10-08'}]},true);assert(text(h.render()).includes('品質不佳'));button(h.render(),'恢復').props.onClick();assert.equal(button(h.render(),'儲存紀錄').props.disabled,true);assert.equal(h.calls.length,0);all(h.render(),n=>n.type==='textarea')[0].props.onChange({target:{value:'重新試用合格'}});await button(h.render(),'儲存紀錄').props.onClick();await flush();assert.equal(h.calls[0][0],'restore');assert.equal(h.calls[0][1].note,'重新試用合格');assert.equal(h.calls[0][1].replacement,'候選品');});

test('partial save retry does not resend successful rows and retains request identity',async()=>{const h=harness({ingredients:[row,{...row,id:'n',name:'麵粉'}]});const requests=[];let fail=true;h.props.save=async(a,d,id)=>{requests.push({a,d,id});if(d.id==='n'&&fail)throw Error('network');};button(h.render(),'編輯全部').props.onClick();for(let i=0;i<2;i++)all(h.render(),n=>n.props?.['aria-label']==='確認價格')[i].props.onChange({target:{value:'0.5'}});await button(h.render(),'儲存修改').props.onClick();await flush();assert.equal(requests.length,2);fail=false;await button(h.render(),'儲存修改').props.onClick();await flush();assert.equal(requests.length,3);assert.equal(requests[2].d.id,'n');assert.equal(requests[2].id,requests[1].id);});
function file(rows){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows),'價格');const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});return {arrayBuffer:async()=>bytes};}
test('multi-file first import stages rows, duplicate files do not create duplicate drafts, explicit save writes',async()=>{const h=harness({ingredients:[]});let tree=h.render();const upload=all(tree,n=>n.type==='input'&&n.props.type==='file')[0];const f=file([{食材:'測試麵粉',單位:'公斤',價格:32}]);await upload.props.onChange({target:{files:[f,f]}});await flush();assert.equal(h.calls.length,0);await button(h.render(),'儲存修改').props.onClick();await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].name,'測試麵粉');});
test('removed-file reimport cannot resurrect a removed item',async()=>{const h=harness({supply_states:[{ingredient_id:'m',supplier_key:'*',stopped:true}]});const upload=all(h.render(),n=>n.type==='input'&&n.props.type==='file')[0];await upload.props.onChange({target:{files:[file([{識別碼:'m',食材:'奶油',單位:'g',價格:.28}])]}});await flush();assert.equal(h.calls.length,0);assert(text(h.render()).includes('匯入不會自動恢復'));});

test('single specification input saves a package and replaces the two content controls',async()=>{
 const h=harness();button(h.render(),'編輯食材').props.onClick();
 const input=label=>all(h.render(),n=>n.props?.['aria-label']===label)[0];
 assert.equal(input('規格').props.disabled,true);
 input('進貨單位').props.onChange({target:{value:'包'}});
 input('規格').props.onChange({target:{value:'2公斤'}});
 input('確認價格').props.onChange({target:{value:'1900'}});
 assert.equal(input('每包內容量'),undefined);assert.equal(input('內容單位'),undefined);
 await button(h.render(),'儲存修改').props.onClick();await flush();
 assert.equal(h.calls[0][1].cost_price,.95);assert.equal(h.calls[0][1].purchase.content_quantity,2);
});


 test('compact price table opens one modal with grouped history without writes',()=>{
 const h=harness({ingredients:[row,{...row,id:'older',name:'奶油 · 原表計價基準：300 元／1000 g',source:'歷史食譜：舊菜單',source_kind:'history',effective_date:null}]});
 assert.deepEqual(all(h.render(),n=>n.type==='th').map(text),['','編碼','供應商食材名稱','規格','最新有效進價','供應商／日期','操作']);assert(!text(h.render()).includes('請購表：2026/09食材'));
 assert.equal(all(h.render(),n=>n.type==='button'&&text(n)==='明細').length,1);
 button(h.render(),'明細').props.onClick({currentTarget:{closest:()=>null}});
 assert(text(h.render()).includes('標準價'));assert(text(h.render()).includes('同名原始紀錄（2）'));
 assert.equal(all(h.render(),n=>n.props?.className==='ingredient-inline-details').length,0);assert.equal(all(h.render(),n=>n.props?.title==='食材明細').length,1);
 assert.equal(all(h.render(),n=>n.props?.role==='dialog').length,0);assert.equal(h.calls.length,0);
 button(h.render(),'關閉').props.onClick();assert(!text(h.render()).includes('同名原始紀錄'));
 });
 test('history tabs and alias search preserve the selected scope',()=>{
 const h=harness({ingredients:[row,{...row,id:'old',name:'舊食材',source:'歷史食譜：舊菜單',source_kind:'history',sources:[],effective_date:null,aliases:[{id:'old-alias',name:'舊別名'}]}]});
 assert(!text(h.render()).includes('舊食材'));assert.equal(all(h.render(),n=>n.type==='nav').length,1);
 button(h.render(),'歷史食材').props.onClick();assert(text(h.render()).includes('舊食材'));
 button(h.render(),'全部').props.onClick();
 all(h.render(),n=>n.props?.['aria-label']==='搜尋編碼、食材、別名、供應商')[0].props.onChange({target:{value:'舊別名'}});
 assert(text(h.render()).includes('舊食材'));assert.equal(h.calls.length,0);
 });

 test('opening edit all and saving unchanged rows does not rewrite saved prices',async()=>{
 const h=harness();button(h.render(),'編輯全部').props.onClick();await button(h.render(),'儲存修改').props.onClick();await flush();assert.equal(h.calls.length,0);
 });

test('an unsuccessful initial read does not report zero ingredients',()=>{
 const h=harness({ingredients:[]});h.props.loaded=false;h.props.failed=true;
 assert(!text(h.render()).includes('待確認 0'));assert(!text(h.render()).includes('0 項 · 每頁'));
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
 const price=all(blank,n=>n.type==='td'&&n.props.className?.includes('ingredient-latest-price'))[0];
 assert.equal(text(price.props.children[0]),'—');assert(!text(price).includes('2026/09/10'));
 assert(text(zero).includes('NT$ 0／g'));assert(text(zero).includes('2026/09/20'));assert(!text(blank).includes('未計價'));
});
test('category edit persists and survives switching to historical scope',async()=>{
 const h=harness();button(h.render(),'編輯全部').props.onClick();
 all(h.render(),n=>n.props?.['aria-label']==='食材分類')[0].props.onChange({target:{value:'調料'}});
 button(h.render(),'歷史食材').props.onClick();await button(h.render(),'儲存修改').props.onClick();await flush();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].category,'調料');assert.equal(h.calls[0][1].cost_price,.28);
});

test('item classification shortcut saves only category and keeps the price snapshot intact',async()=>{
 const h=harness();
 button(h.render(),'明細').props.onClick({currentTarget:{closest:()=>null}});
 const control=()=>all(h.render(),n=>n.props?.['aria-label']==='奶油的品項分類')[0];
 assert(control());assert.equal(control().props.value,'待分類');
 assert.equal(all(h.render(),n=>n.props?.['aria-label']==='確認價格').length,0);
 control().props.onChange({target:{value:'酒水'}});await flush();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'category');
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][1])),{id:'m',revision:1,category:'酒水'});
 assert.equal(h.props.data.ingredients[0].cost_price,.28);
 assert(text(h.render()).includes('已儲存品項分類'));
});

test('failed classification save retains selection and retries the same request',async()=>{
 const h=harness();let fail=true;
 h.props.save=async(...args)=>{h.calls.push(args);if(fail)throw Error('暫時離線');};
 button(h.render(),'明細').props.onClick({currentTarget:{closest:()=>null}});
 all(h.render(),n=>n.props?.['aria-label']==='奶油的品項分類')[0].props.onChange({target:{value:'耗材'}});await flush();
 assert.equal(all(h.render(),n=>n.props?.['aria-label']==='奶油的品項分類')[0].props.value,'耗材');
 assert(text(h.render()).includes('暫時離線'));fail=false;
 await button(h.render(),'重試儲存分類').props.onClick();await flush();
 assert.equal(h.calls.length,2);assert.equal(h.calls[1][2],h.calls[0][2]);
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1][1])),{id:'m',revision:1,category:'耗材'});
});

test('classification shortcut is unavailable to read-only users and disabled during table edits',()=>{
 const readonly=harness({can_price:false});button(readonly.render(),'明細').props.onClick({currentTarget:{closest:()=>null}});
 assert.equal(all(readonly.render(),n=>n.props?.['aria-label']==='奶油的品項分類').length,0);
 const h=harness({ingredients:[row,{...row,id:'n',name:'麵粉'}]});
 button(h.render(),'明細').props.onClick({currentTarget:{closest:()=>null}});button(h.render(),'新增食材').props.onClick();
 assert.equal(all(h.render(),n=>n.props?.className==='ingredient-compact-modal').length,0);
 assert.equal(h.calls.length,0);
});
test('import stages valid categories and rejects invalid classifications without writing',async()=>{
 const h=harness({ingredients:[]});
 const upload=()=>all(h.render(),n=>n.type==='input'&&n.props.type==='file')[0];
 await upload().props.onChange({target:{files:[file([{食材:'測試酒',單位:'瓶',價格:100,分類:'錯誤'}])]}});await flush();assert.equal(h.calls.length,0);assert(text(h.render()).includes('分類請使用'));
 await upload().props.onChange({target:{files:[file([{食材:'測試酒',單位:'瓶',價格:100,分類:'酒水'}])]}});await flush();
 await button(h.render(),'儲存修改').props.onClick();await flush();assert.equal(h.calls[0][1].category,'酒水');
});

test('row actions add an alias in a single input and search by the saved alias',async()=>{
 const packaged={...row,ingredient_code:'F000123',purchase:{amount:308,quantity:1,unit:'罐',content_quantity:110,content_unit:'g'}};
 const h=harness({ingredients:[packaged]});
 h.props.saveRecipeAlias=async(id,value,previous,request)=>{
  h.calls.push({id,value,previous,request});
  h.props.data={...h.props.data,ingredients:[{...packaged,recipe_aliases:[value]}]};
 };
 button(h.render(),'加入食譜別名').props.onClick({currentTarget:{closest:()=>null}});
 const form=all(h.render(),n=>n.type==='form')[0];
 const alias=all(form,n=>n.type==='input')[0];
 assert.equal(all(form,n=>n.type==='input').length,1);
 assert.match(text(form),/奶油110克／罐 · F000123/);
 assert.equal(alias.props.value,'');
 alias.props.onChange({target:{value:'法式無鹽奶油'}});
 all(h.render(),n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
 await flush();
 assert.equal(h.calls[0].id,row.id);
 assert.equal(h.calls[0].value,'法式無鹽奶油');
 assert.equal(all(h.render(),n=>n.type==='form').length,0);
 const search=all(h.render(),n=>n.props?.['aria-label']==='搜尋編碼、食材、別名、供應商')[0];
 search.props.onChange({target:{value:'法式無鹽奶油'}});
 assert(text(h.render()).includes('NT$ 308'));
 assert(button(h.render(),'編輯別名 · 法式無鹽奶油'));
 button(h.render(),'明細').props.onClick({currentTarget:{closest:()=>null}});
 assert(text(h.render()).includes('食譜名稱：法式無鹽奶油'));
 assert(!text(h.render()).includes('食譜別名：法式無鹽奶油'));
});

test('purchasing name remains primary with compact recipe name editing and no price mutation',async()=>{
 const ingredient={...row,name:'供應商無鹽奶油 450g',recipe_aliases:['奶油','無鹽奶油']};
 const h=harness({ingredients:[ingredient]});
 h.props.saveRecipeAlias=async(...args)=>h.calls.push(args);
 let tree=h.render();
 assert.equal(text(all(tree,n=>n.props?.className==='ingredient-primary-name')[0]),ingredient.name);
 assert.match(text(tree),/食譜名稱：奶油、無鹽奶油/);
 const opener=all(tree,n=>n.props?.['aria-label']===`編輯 ${ingredient.name} 的食譜名稱`)[0];
 opener.props.onClick({currentTarget:{focus(){}}});
 let form=all(h.render(),n=>n.type==='form')[0];
 assert.equal(all(form,n=>n.type==='input')[0].props.value,'奶油');
 all(form,n=>n.type==='input')[0].props.onChange({target:{value:'廚房奶油'}});
 all(h.render(),n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
 await flush();
 assert.deepEqual(h.calls[0].slice(0,3),[row.id,'廚房奶油','奶油']);
 assert.equal(h.calls.length,1);
 assert.equal(ingredient.cost_price,row.cost_price);
 assert.deepEqual(ingredient.recipe_aliases,['奶油','無鹽奶油']);
});
test('compact recipe name edit is not shown to read-only users',()=>{
 const h=harness({can_price:false});h.props.saveRecipeAlias=async()=>{};
 assert.equal(all(h.render(),n=>String(n.props?.['aria-label']||'').startsWith('編輯 奶油 的食譜名稱')).length,0);
});

test('expanded ingredient details show extra history, not duplicate basic or empty fields',()=>{
 const h=harness();button(h.render(),'明細').props.onClick({currentTarget:{closest:()=>null}});
 const detail=all(h.render(),n=>n.props?.className==='ingredient-compact-modal')[0];
 assert(!/食材編碼：|正式品名：|包裝規格：|舊碼：無|其他名稱：—|編輯資料/.test(text(detail)));
 assert(text(detail).includes('標準價'));
 assert.equal(all(h.render(),n=>n.type==='button'&&text(n)==='編輯食材').length,2);
 assert.equal(h.calls.length,0);
});

test('different latest and standard package sizes stay explicit without changing saved prices',()=>{
 const standard={amount:100,quantity:1,unit:'包',content_quantity:450,content_unit:'g'};
 const latest={amount:180,quantity:1,unit:'包',content_quantity:1000,content_unit:'g'};
 const h=harness({ingredients:[{...row,purchase:standard,sources:[{id:'receipt',receipt_price:180,receipt_unit:'包',receipt_purchase:latest,effective_date:'2026-11-11',receipt_supplier:'甲商'}]}]});
 button(h.render(),'明細').props.onClick({currentTarget:{closest:()=>null}});
 const detail=all(h.render(),n=>n.props?.className==='ingredient-compact-modal')[0];
 const standardLine=all(detail,n=>n.type==='p'&&text(n).startsWith('標準價'))[0];
 assert.match(text(standardLine),/NT\$ 100／包/);assert.match(text(standardLine),/450克／包/);
 assert.match(text(detail),/NT\$ 180／包/);assert.equal(h.calls.length,0);
});

test('reference price rows expose their direct expansion control without writes',()=>{
 const h=harness();
 const expand=all(h.render(),n=>n.props?.['aria-label']==='查看 奶油 的價格紀錄')[0];
 assert(expand);expand.props.onClick({currentTarget:{closest:()=>null}});
 assert(text(h.render()).includes('進貨紀錄'));assert(text(h.render()).includes('供應商'));
 assert.equal(h.calls.length,0);
 button(h.render(),'關閉').props.onClick();
 assert(!text(h.render()).includes('尚無已核對進貨紀錄'));assert.equal(h.calls.length,0);
});

test('authoritative automatic quote displays receipt price without replacing the baseline editor',()=>{
 const h=harness({ingredients:[{...row,current_quote:{price:.4,unit:'g',source:'已確認建檔進貨',date:'2026-10-01'}}]});
 assert(text(h.render()).includes('NT$ 0.4／g'));assert(text(h.render()).includes('已確認建檔進貨'));
 button(h.render(),'編輯食材').props.onClick();
 assert.equal(all(h.render(),n=>n.props?.['aria-label']==='確認價格')[0].props.value,'0.28');
});
test('unresolved current quote never falls back to baseline or shows zero',()=>{
 const h=harness({ingredients:[{...row,current_quote:{price:null,unit:'g',reason:'同日進價衝突'}}]});
 assert(text(h.render()).includes('同日進價衝突'));assert(!text(h.render()).includes('NT$ 0.28'));assert(!text(h.render()).includes('NT$ 0／'));
});

test('compact modal uses current quote, preserves baseline, and closes before editor',()=>{
 const h=harness({ingredients:[{...row,current_quote:{price:.4,unit:'g',source:'已確認建檔進貨',date:'2026-11-12',purchase:{amount:400,quantity:1,unit:'包',content_quantity:1000,content_unit:'g'}}}]});
 button(h.render(),'明細').props.onClick({currentTarget:{closest:()=>null}});
 let detail=all(h.render(),n=>n.props?.className==='ingredient-compact-modal')[0];
 assert.match(text(detail),/NT\$ 400／包/);assert.match(text(detail),/1000克／包/);assert.match(text(detail),/標準價.*NT\$ 0.28/);
 button(detail,'編輯食材').props.onClick();assert.equal(all(h.render(),n=>n.props?.className==='ingredient-compact-modal').length,0);assert.equal(all(h.render(),n=>n.props?.['aria-label']==='確認價格')[0].props.value,'0.28');assert.equal(h.calls.length,0);
});
test('compact modal retains missing quote and read-only permissions',()=>{
 const h=harness({can_price:false,ingredients:[{...row,current_quote:{price:null,unit:'g',reason:'同日進價衝突'}}]});
 button(h.render(),'明細').props.onClick({currentTarget:{closest:()=>null}});const detail=all(h.render(),n=>n.props?.className==='ingredient-compact-modal')[0];
 const price=all(detail,n=>n.props?.className==='ingredient-compact-price')[0];assert.match(text(price),/待補價格.*同日進價衝突/);assert(!text(price).includes('NT$'));assert.equal(button(detail,'編輯食材'),undefined);assert.equal(all(detail,n=>n.type==='select').length,0);assert.equal(h.calls.length,0);
});
