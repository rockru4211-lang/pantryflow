import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {runInNewContext} from 'node:vm';import React from 'react';import ts from 'typescript';
import * as h from '../lib/receipt-review.ts';import * as history from '../lib/receipt-supplier-items.ts';import {accountMoney} from '../lib/receipt-accounting.ts';
const source=fs.readFileSync(new URL('../app/pilot/receipt-review-workbench.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('x.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ReceiptReviewWorkbench');
const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const row={batch_id:'a',supplier_name:'甲',receipt_date:'2026-09-01',document_number:'A',net:100,tax:5,total:105,adjustment:0,adjustment_note:'',note:'',revision:4,source_fingerprint:'version',can_edit:true,record_state:'LIVE',pending:false,status:'CHECKED',lines:[{row_key:'line-1',product_name:'麵粉',specification:'',quantity:2,unit:'包',unit_price:50,subtotal:100,category:'食材',note:''}],documents:[]};
function nodes(t){return Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];}function text(n){return typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):'';}
function harness(props={}){const states=[],refs=[],calls=[],saved=[],added=[];let si=0,ri=0,id=0,fail=false;const scope={UnitSelect:()=>null,costingUnits:['公斤','台斤','瓶','包'],useCustodyReminders:()=>({rows:[],tags:[],error:''}),ReceiptReminderBadge:()=>null,exports:{},React,beginReceiptManualReview:async()=>'manual-run',addReceiptDraftRow:async(s,b,r,id)=>{added.push({s,b,r,id});if(fail)throw Error('NETWORK');return id;},...h,...history,accountMoney,ReceiptHandlingFields:()=>null,ReceiptSourceViewer:()=>null,AbortController,crypto:{randomUUID:()=>String(++id)},window:{confirm:()=>false},useState:x=>{const i=si++;if(!(i in states))states[i]=typeof x==='function'?x():x;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:x=>{const i=ri++;return refs[i]||(refs[i]={current:x});},useEffect(){},saveReceiptReview:async(s,b,d,r)=>{calls.push({s,b,d,r});if(fail)throw Error('NETWORK');return {...row,status:d.checked?'CHECKED':'UNCHECKED'};}};runInNewContext(code,scope);const render=()=>{si=0;ri=0;return scope.ReceiptReviewWorkbench({storeId:'store',batchId:'a',nextId:'b',...props,onClose:()=>saved.push('close'),onSaved:(r,n)=>saved.push({r,n})});};render();states[0]=row;states[1]=h.reviewDraft(row);states[2]=JSON.stringify(states[1]);return {states,calls,saved,added,render,fail:v=>fail=v,find:f=>nodes(render()).find(f),button:l=>nodes(render()).find(n=>n.type==='button'&&text(n)===l)};}
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('actual completed-receipt editor exposes quantity, tax, metadata and notes together',()=>{const x=harness();assert.ok(x.find(n=>n.props?.['aria-label']==='第 1 筆 數量'));assert.ok(x.find(n=>n.props?.['aria-label']==='貨單稅額'));assert.equal(x.find(n=>n.type==='fieldset').props.disabled,false);assert.ok(x.button('完成對帳'));});
test('failed correction preserves inputs and reuses request token; success alone advances',async()=>{const x=harness();x.find(n=>n.props?.['aria-label']==='貨單對帳備註').props.onChange({target:{value:'保留我的輸入'}});x.fail(true);x.button('儲存').props.onClick();await settle();assert.equal(x.states[1].note,'保留我的輸入');assert.equal(x.saved.length,0);assert.match(x.states[4],/輸入仍保留/);x.fail(false);x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].r,x.calls[1].r);assert.equal(x.saved[0].n,false);});
test('unknown tax can be saved but cannot advance as completed; cancelled close keeps dirty draft',async()=>{const x=harness();x.find(n=>n.props?.['aria-label']==='貨單稅額').props.onChange({target:{value:''}});x.button('完成對帳').props.onClick();await settle();assert.equal(x.calls.length,0);x.button('關閉').props.onClick();assert.equal(x.saved.length,0);x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].d.tax,null);});

test('adding and removing an accidental row does not write until save',()=>{
 const x=harness({manualEntry:true});x.button('＋ 輸入下一項').props.onClick();assert.equal(x.states[1].lines.length,2);assert.equal(x.calls.length,0);assert.equal(x.added.length,0);
 x.find(n=>n.props?.['aria-label']==='刪除第 2 筆').props.onClick();assert.equal(x.states[1].lines.length,1);assert.equal(x.calls.length,0);
 x.button('復原上一項').props.onClick();assert.equal(x.states[1].lines.length,2);assert.ok(x.states[1].lines[1].row_key.startsWith('local-'));
});
test('remove existing line and undo preserves values and order; failed structural save keeps draft and token',async()=>{
 const x=harness({manualEntry:true});x.find(n=>n.props?.['aria-label']==='刪除第 1 筆').props.onClick();assert.equal(x.states[1].lines.length,0);
 x.button('復原上一項').props.onClick();assert.equal(x.states[1].lines[0].product_name,'麵粉');assert.equal(x.states[1].lines[0].quantity,'2');
 x.find(n=>n.props?.['aria-label']==='刪除第 1 筆').props.onClick();x.button('＋ 輸入下一項').props.onClick();x.fail(true);x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].d.removed_row_keys[0],'line-1');assert.ok(x.calls[0].d.lines[0].row_key.startsWith('local-'));assert.equal(x.saved.length,0);
 x.fail(false);x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].r,x.calls[1].r);assert.equal(x.saved.length,1);
});
test('partial entry save remains separate from financial reconciliation',async()=>{
 const x=harness({manualEntry:true});x.find(n=>n.props?.['aria-label']==='貨單稅額').props.onChange({target:{value:''}});x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].d.tax,null);assert.equal(x.calls[0].d.entry_completed,true);assert.equal(x.calls[0].d.checked,false);assert.equal(x.saved[0].n,false);
});
test('posted and custody linked lines cannot be deleted',()=>{
 const x=harness({manualEntry:true});x.states[0]={...x.states[0],receipt_status:'COMPLETED'};assert.equal(x.find(n=>n.props?.['aria-label']==='刪除第 1 筆').props.disabled,true);assert.equal(x.button('＋ 輸入下一項'),undefined);
 x.states[0]={...x.states[0],receipt_status:'READY_FOR_REVIEW'};x.states[1].lines[0].custody_reminder_id='linked';assert.equal(x.find(n=>n.props?.['aria-label']==='刪除第 1 筆').props.disabled,true);
});

for(const manualEntry of [true,false])test(`entry and accounting share layout and save-next behavior (${manualEntry})`,async()=>{
 const x=harness({manualEntry});assert.equal(x.find(n=>n.type==='dialog').props['aria-label'],'貨單建檔');assert.match(x.find(n=>n.type==='dialog').props.className,/receipt-unified-workbench/);
 assert.equal(x.find(n=>n.props?.['aria-label']==='調整貨單與明細寬度').props['aria-valuenow'],40);
 assert.ok(x.button('＋ 新增一列'));assert.ok(x.button('儲存'));
 x.find(n=>n.props?.['aria-label']==='貨單稅額').props.onChange({target:{value:''}});
 x.fail(true);x.button('儲存並下一張 →').props.onClick();await settle();assert.equal(x.saved.length,0);assert.equal(x.states[1].tax,'');
 x.fail(false);x.button('儲存並下一張 →').props.onClick();await settle();assert.equal(x.calls[0].r,x.calls[1].r);assert.equal(x.saved[0].n,true);assert.equal(x.calls[1].d.checked,false);assert.equal(x.calls[1].d.entry_completed,true);
});
test('last receipt disables next and cancelled navigation retains unsaved values',()=>{
 const navigated=[];const x=harness({manualEntry:true,nextId:null,previousId:'older',onNavigate:id=>navigated.push(id)});
 assert.equal(x.button('儲存並下一張 →').props.disabled,true);
 x.find(n=>n.props?.['aria-label']==='貨單到貨日期').props.onChange({target:{value:'2026-09-02'}});
 x.button('上一張').props.onClick();assert.deepEqual(navigated,[]);assert.equal(x.states[1].date,'2026-09-02');
});
