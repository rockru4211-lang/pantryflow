import * as categories from '../lib/receipt-categories.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as helpers from '../lib/receipt-accounting.ts';
import {nextReviewId} from '../lib/receipt-review.ts';
const source=readFileSync(new URL('../app/pilot/receipt-accounting.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('receipt-accounting.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const body=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ReceiptAccountingBody');
const compiled=ts.transpileModule(body.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const row=(id,extra={})=>({batch_id:id,batch_number:'RC-'+id,receipt_date:'2026-09-10',work_date:'2026-09-10',supplier_name:'甲供應商',document_number:'DOC-'+id,products:'麵粉',line_count:2,line_net:100,pages:2,net:100,tax:5,total:105,source_net:100,source_tax:5,source_total:105,amount_override:null,note:'',revision:0,source_fingerprint:'hash',checked_at:null,pending:false,amount_conflict:false,reviewed:true,status:'UNCHECKED',record_state:'LIVE',can_edit:true,...extra});
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];return [tree,...nodes(tree.props?.children)];}
const text=node=>typeof node==='string'?node:typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
function harness(rows=[row('a')]){
 const state=[],refs=[],calls=[],opened=[],effects=[];let si=0,ri=0,id=0,fail=false,records=rows;
 const props={toolsTarget:{},storeId:'store',userId:'user',filters:{from:'2026-09-01',to:'2026-09-30',supplier:'ALL',supplierNames:[],query:'',category:'ALL',scope:'ALL'},lines:[],children:React.createElement('div',null,'既有品項明細'),disabled:false,editing:false,onEditing(){},onSource:id=>opened.push(id)};
 const scope={...categories,React,readIngredientMatching:async()=>({ingredients:[]}),createPortal:x=>x,...helpers,nextReviewId,ReceiptReviewWorkbench:()=>null,ReceiptBulkReview:()=>React.createElement('div',null,'整批編輯明細'),AbortController,document:{visibilityState:'visible'},crypto:{randomUUID:()=>`request-${++id}`},receiptReadError:()=> '讀取失敗',exportRows:async(...args)=>calls.push({export:args}),useState:initial=>{const i=si++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},useRef:initial=>{const i=ri++;return refs[i]||(refs[i]={current:initial});},useCallback:fn=>fn,useEffect(fn){effects.push(fn);},readScopedReceiptAccounts:async(_store,_signal,_from,_to,_supplier,batch)=>records.filter(r=>!batch||r.batch_id===batch),saveReceiptAccount:async(store,batch,data,request)=>{calls.push({store,batch,data,request});if(fail)throw Error('NETWORK');records=records.map(r=>r.batch_id===batch?{...r,...(data.amount_override||{}),amount_override:data.amount_override,note:data.note,status:data.checked?'CHECKED':'UNCHECKED',checked_at:data.checked?'2026-09-11':null,revision:r.revision+1}:r);return {saved:true};}};
 runInNewContext(compiled,scope);const render=()=>{si=0;ri=0;effects.length=0;return scope.ReceiptAccountingBody(props);};render();state[0]=rows;state[1]=false;state[4]=JSON.stringify(['store','user','2026-09-01','2026-09-30','ALL']);
 return {state,refs,props,calls,opened,effects,render,html:()=>renderToStaticMarkup(render()),fail:v=>{fail=v;},find:predicate=>nodes(render()).find(predicate),button:label=>nodes(render()).find(n=>n.type==='button'&&text(n)===label)};
}
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('receipt details are the only list, with stale reads blocking edits and exports',()=>{
 const h=harness([row('a'),row('b',{status:'MISSING',tax:null,total:null})]);
 assert.match(h.html(),/整批編輯明細/);
 assert.doesNotMatch(h.html(),/匯出對帳清單|對帳單/);
 h.state[2]='讀取失敗';
 assert.match(h.html(),/尚未更新/);
 assert.equal(h.button('匯出').props.disabled,true);
 assert.equal(h.find(n=>n.props?.onEditReceipt).props.disabled,true);
});

test('supplier options come from loaded accounts even if the legacy ledger is empty',()=>{
 const h=harness([row('a'),row('b',{supplier_name:'乙供應商'}),row('dup'),row('test',{supplier_name:'測試廠商',record_state:'TEST'})]);
 const options=[];h.props.onSuppliersLoaded=names=>options.push(Array.from(names));h.render();h.effects.at(-1)();
 assert.deepEqual(options,[['甲供應商','乙供應商']]);assert.equal(h.props.lines.length,0);
 h.props.storeId='other-store';h.render();h.effects.at(-1)();assert.equal(options.length,1);
});

test('items export uses scoped saved lines when the legacy ledger is empty',async()=>{const h=harness([row('a',{lines:[{product_name:'麵粉',quantity:2,unit:'包',unit_price:null,subtotal:null,category:'食材',specification:'1kg',note:'已儲存'}]})]);h.button('匯出').props.onClick();await settle();const rows=h.calls[0].export[0];assert.equal(rows[0]['品名'],'麵粉');assert.equal(rows[0]['未稅單價'],'');assert.equal(rows[0]['備註'],'已儲存');});
test('items retain the same-scope receipts during a failed refresh',()=>{const h=harness();h.state[2]='讀取逾時';const editor=nodes(h.render()).find(n=>n.props?.rows);assert.equal(editor.props.rows.length,1);assert.match(h.html(),/尚未更新/);h.props.filters.from='2026-10-01';assert.match(h.html(),/資料尚未載入/);assert.equal(nodes(h.render()).find(n=>n.props?.rows).props.rows.length,0);});

test('restored pending drafts pause background refresh without cancelling the initial read',()=>{
 const h=harness();const initialRead=new AbortController();h.refs[0].current=initialRead;
 h.props.editing=true;h.render();h.effects[0]();
 assert.equal(initialRead.signal.aborted,false);assert.equal(h.refs[0].current,initialRead);
});


test('receiving tabs have separate destinations and lock during editing',()=>{
 const h=harness();const destinations=[];
 h.props.desktopMode=true;h.props.onInbox=()=>destinations.push('inbox');
 const tabs=nodes(h.render()).filter(n=>n.props.role==='tab');
 assert.deepEqual(tabs.map(text),['進貨明細','貨單管理']);
 tabs[1].props.onClick();
 assert.deepEqual(destinations,['inbox']);
 h.props.editing=true;assert.ok(nodes(h.render()).filter(n=>n.props.role==='tab').every(n=>n.props.disabled));
 h.props.externalTabs=true;assert.equal(h.find(n=>n.props.role==='tablist').props.hidden,true);
});


test('missing amounts scope the visible items, including the zero-tax distinction',()=>{
 const h=harness([row('a'),row('b',{tax:null,total:null,status:'MISSING'}),row('c',{net:100,tax:0,total:100})]);
 const listed=()=>h.find(n=>n.props?.onEditReceipt).props.rows.map(r=>r.batch_id).join(',');
 assert.equal(listed(),'a,b,c');
 h.button('金額未完整 1 張 ›').props.onClick();
 assert.equal(listed(),'b');
 h.button('返回全部明細').props.onClick();
 assert.equal(listed(),'a,b,c');
});

test('viewing an item opens the shared workbench and keeps the supplier navigation queue',()=>{
 const h=harness([row('a'),row('b',{receipt_date:'2026-09-09'}),row('c',{supplier_name:'乙供應商'})]);
 h.find(n=>n.props?.onEditReceipt).props.onEditReceipt('a');
 const editor=h.find(n=>n.props?.batchId==='a'&&typeof n.props?.onSaved==='function');
 assert.equal(editor.props.nextId,'b');
 assert.equal(editor.props.positionLabel,'1 / 2');
 editor.props.onSaved(row('a',{revision:1}),false);
 assert.equal(h.find(n=>n.props?.batchId==='a').props.batchId,'a');
});

test('classification uses receipt metadata',()=>{
 const h=harness([row('a',{receipt_categories:['酒水','耗材']}),row('b',{receipt_categories:[]})]);
 const filtered=()=>h.find(n=>n.props?.onEditReceipt).props.rows.map(r=>r.batch_id).join(',');
 h.find(n=>n.props?.['aria-label']==='篩選貨單分類').props.onChange({target:{value:'酒水'}});
 assert.equal(filtered(),'a');
 h.find(n=>n.props?.['aria-label']==='篩選貨單分類').props.onChange({target:{value:'__uncategorized'}});
 assert.equal(filtered(),'b');
});
