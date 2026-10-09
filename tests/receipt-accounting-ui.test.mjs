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
 const props={toolsTarget:{},storeId:'store',userId:'user',tab:'accounts',onTabChange(){},filters:{from:'2026-09-01',to:'2026-09-30',supplier:'ALL',supplierNames:[],query:'',category:'ALL',scope:'ALL'},lines:[],children:React.createElement('div',null,'既有品項明細'),disabled:false,editing:false,onEditing(){},onSource:id=>opened.push(id)};
 const scope={React,createPortal:x=>x,...helpers,nextReviewId,ReceiptReviewWorkbench:()=>null,ReceiptBulkReview:()=>React.createElement('div',null,'整批編輯明細'),AbortController,document:{visibilityState:'visible'},crypto:{randomUUID:()=>`request-${++id}`},receiptReadError:()=> '讀取失敗',exportRows:async(...args)=>calls.push({export:args}),useState:initial=>{const i=si++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},useRef:initial=>{const i=ri++;return refs[i]||(refs[i]={current:initial});},useCallback:fn=>fn,useEffect(fn){effects.push(fn);},readScopedReceiptAccounts:async(_store,_signal,_from,_to,_supplier,batch)=>records.filter(r=>!batch||r.batch_id===batch),saveReceiptAccount:async(store,batch,data,request)=>{calls.push({store,batch,data,request});if(fail)throw Error('NETWORK');records=records.map(r=>r.batch_id===batch?{...r,...(data.amount_override||{}),amount_override:data.amount_override,note:data.note,status:data.checked?'CHECKED':'UNCHECKED',checked_at:data.checked?'2026-09-11':null,revision:r.revision+1}:r);return {saved:true};}};
 runInNewContext(compiled,scope);const render=()=>{si=0;ri=0;effects.length=0;return scope.ReceiptAccountingBody(props);};render();state[0]=rows;state[1]=false;state[5]=JSON.stringify(['store','user','2026-09-01','2026-09-30','ALL']);
 return {state,refs,props,calls,opened,effects,render,html:()=>renderToStaticMarkup(render()),fail:v=>{fail=v;},find:predicate=>nodes(render()).find(predicate),button:label=>nodes(render()).find(n=>n.type==='button'&&text(n)===label)};
}
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('actual component renders one checkbox per receipt, grouped suppliers, missing tax and original access',()=>{const h=harness([row('a'),row('b',{tax:null,total:null,status:'MISSING'}),row('c',{supplier_name:'乙供應商',pending:true,status:'PENDING',tax:null,total:null})]);const html=h.html();assert.equal((html.match(/type="checkbox"/g)||[]).length,3);assert.equal((html.match(/<h3>甲供應商<\/h3>/g)||[]).length,1);assert.match(html,/金額未完整 2 張/);const incomplete=nodes(h.render()).find(n=>n.type==='tr'&&text(n).includes('DOC-b'));const cells=nodes(incomplete).filter(n=>n.type==='td');assert.equal(text(cells[4]),'');assert.equal(text(cells[5]),'');assert.match(html,/待建檔/);nodes(h.find(n=>n.type==='tr'&&text(n).includes('DOC-a'))).find(n=>n.type==='button'&&text(n)==='查看').props.onClick();assert.deepEqual(h.opened,['a']);});
test('checkbox roundtrip calls the persistent API and reloads checked then unchecked state',async()=>{const h=harness();h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({currentTarget:{checked:true,dataset:{accountId:'a'}}});await settle();assert.equal(h.calls[0].data.checked,true);assert.equal(h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.checked,true);h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({currentTarget:{checked:false,dataset:{accountId:'a'}}});await settle();assert.equal(h.calls[1].data.revision,1);assert.equal(h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.checked,false);});
test('row correction opens the unified workbench even for a completed receipt',()=>{const h=harness([row('a',{status:'CHECKED'})]);h.button('核對／更正').props.onClick();assert.equal(h.state[7],'a');});
test('reading failure labels same-scope receipts stale and blocks exporting or checking',()=>{const h=harness();h.state[2]='讀取失敗';assert.match(h.html(),/DOC-a/);assert.match(h.html(),/尚未更新/);assert.equal(h.button('匯出對帳清單').props.disabled,true);assert.equal(h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.disabled,true);h.props.filters.supplier='另一廠商';assert.doesNotMatch(h.html(),/DOC-a/);});
test('read-only and pending entries cannot be checked; items tab uses inline bulk editor',()=>{const h=harness([row('a',{can_edit:false}),row('b',{pending:true,status:'PENDING'})]);const boxes=nodes(h.render()).filter(n=>n.type==='input'&&n.props.type==='checkbox');assert.ok(boxes.every(n=>n.props.disabled));h.props.tab='items';assert.match(h.html(),/整批編輯明細/);assert.doesNotMatch(h.html(),/DOC-a/);});

test('saved or filed receipts enter finance without a reviewed prerequisite; unfiled OCR stays out',()=>{const h=harness([row('new',{reviewed:false,pending:true}),row('filed',{reviewed:false}),row('draft',{reviewed:false,pending:true,edit_revision:1}),row('old',{reviewed:false,status:'CHECKED'})]);assert.doesNotMatch(h.html(),/DOC-new/);for(const id of ['filed','draft','old'])assert.match(h.html(),new RegExp('DOC-'+id));});

test('supplier options come from loaded accounts even if the legacy ledger is empty',()=>{
 const h=harness([row('a'),row('b',{supplier_name:'乙供應商'}),row('dup'),row('test',{supplier_name:'測試廠商',record_state:'TEST'})]);
 const options=[];h.props.onSuppliersLoaded=names=>options.push(Array.from(names));h.props.tab='items';h.render();h.effects.at(-1)();
 assert.deepEqual(options,[['甲供應商','乙供應商']]);assert.equal(h.props.lines.length,0);
 h.props.storeId='other-store';h.render();h.effects.at(-1)();assert.equal(options.length,1);
});

test('items export uses scoped saved lines when the legacy ledger is empty',async()=>{const h=harness([row('a',{lines:[{product_name:'麵粉',quantity:2,unit:'包',unit_price:null,subtotal:null,category:'食材',specification:'1kg',note:'已儲存'}]})]);h.props.tab='items';h.button('匯出').props.onClick();await settle();const rows=h.calls[0].export[0];assert.equal(rows[0]['品名'],'麵粉');assert.equal(rows[0]['未稅單價'],'');assert.equal(rows[0]['備註'],'已儲存');});
test('items retain the same-scope receipts during a failed refresh',()=>{const h=harness();h.props.tab='items';h.state[2]='讀取逾時';const editor=nodes(h.render()).find(n=>n.props?.rows);assert.equal(editor.props.rows.length,1);assert.match(h.html(),/尚未更新/);h.props.filters.from='2026-10-01';assert.match(h.html(),/資料尚未載入/);assert.equal(nodes(h.render()).find(n=>n.props?.rows).props.rows.length,0);});

test('restored pending drafts pause background refresh without cancelling the initial read',()=>{
 const h=harness();const initialRead=new AbortController();h.refs[0].current=initialRead;
 h.props.editing=true;h.render();h.effects[0]();
 assert.equal(initialRead.signal.aborted,false);assert.equal(h.refs[0].current,initialRead);
});


test('receiving tabs have separate destinations and lock during editing',()=>{
 const h=harness();const destinations=[];
 h.props.desktopMode=true;h.props.onInbox=()=>destinations.push('inbox');h.props.onTabChange=tab=>destinations.push(tab);
 const tabs=nodes(h.render()).filter(n=>n.props.role==='tab');
 assert.deepEqual(tabs.map(text),['進貨明細','貨單管理','對帳單']);
 for(const tab of tabs)tab.props.onClick();
 assert.deepEqual(destinations,['items','inbox','accounts']);
 h.props.editing=true;assert.ok(nodes(h.render()).filter(n=>n.props.role==='tab').every(n=>n.props.disabled));
 h.props.externalTabs=true;assert.equal(h.find(n=>n.props.role==='tablist').props.hidden,true);
});


test('table summary is singular and missing filter also scopes exports and disables full supplier comparison',async()=>{
 const h=harness([row('a'),row('b',{tax:null,total:null,status:'MISSING'}),row('c',{supplier_name:'乙供應商',net:0,tax:0,total:0})]);
 assert.equal(nodes(h.render()).filter(n=>n.props.className==='receipt-report-row').length,1);
 const zero=nodes(h.render()).find(n=>n.type==='tr'&&text(n).includes('DOC-c'));
 assert.deepEqual(nodes(zero).filter(n=>n.type==='td').slice(3,6).map(text),['0','0','0']);
 h.button('金額未完整 1 張 ›').props.onClick();assert.doesNotMatch(h.html(),/DOC-a/);assert.match(h.html(),/DOC-b/);assert.doesNotMatch(h.html(),/廠商對帳單金額/);
 h.button('匯出對帳清單').props.onClick();await settle();assert.equal(h.calls[0].export[0].length,1);
 h.button('返回全部明細').props.onClick();assert.match(h.html(),/DOC-a/);
});
