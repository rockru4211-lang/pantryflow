import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as helpers from '../lib/receipt-review.ts';
import {accountMoney} from '../lib/receipt-accounting.ts';
const source=readFileSync(new URL('../app/pilot/receipt-bulk-review.tsx',import.meta.url),'utf8');
const body=source.slice(source.indexOf('export default function')).replace('export default ','');
const compiled=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const make=(id,date='2026-09-22')=>({batch_id:id,supplier_name:'大永行銷有限公司',receipt_date:date,document_number:'A',net:100,tax:5,total:105,adjustment:0,adjustment_note:'',note:'',revision:4,source_fingerprint:'v1',can_edit:true,record_state:'LIVE',pending:false,status:'UNCHECKED',lines:[{row_key:'1',product_name:'海鹽（粗）義大利',specification:'1Kg*12',quantity:1,unit:'盒',unit_price:50,subtotal:50,category:'調料',note:''},{row_key:'2',product_name:'貝殼麵AA(65)',specification:'500g*24包',quantity:1,unit:'包',unit_price:50,subtotal:50,category:'食材',note:''}]});
function nodes(n){return Array.isArray(n)?n.flatMap(nodes):!n||typeof n!=='object'?[]:[n,...nodes(n.props?.children)];}
function text(n){return typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):'';}
function harness(){const states=[],refs=[],calls=[];let si=0,ri=0,fail='',submitted=false;const props={storeId:'store',userId:'user',rows:[make('b','2026-09-23'),make('a')],disabled:false,onSource(){},onEditing(){},onSaved(row){props.rows=props.rows.map(r=>r.batch_id===row.batch_id?row:r);},onSubmitted(){submitted=true;}};
 const useState=initial=>{const i=si++;if(!(i in states))states[i]=initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];};
 const scope={React,Fragment:React.Fragment,ReceiptHandlingFields:()=>null,...helpers,accountMoney,crypto:{randomUUID:()=>String(Math.random())},window:{confirm:()=>true},useState,useOperationDraft:(_u,_s,_k,v)=>useState(v),useEffect(){},useRef:v=>refs[ri++]||(refs[ri-1]={current:v}),saveReceiptReview:async(_s,id,data,request)=>{calls.push({id,data,request});if(id===fail)throw Error('NETWORK');return {...props.rows.find(r=>r.batch_id===id),reviewed:data.reviewed,status:'UNCHECKED',revision:5,source_fingerprint:'v2',lines:data.lines};}};
 runInNewContext(compiled,scope);function render(){si=0;ri=0;return scope.ReceiptBulkReview(props);}return {props,calls,states,render,html:()=>renderToStaticMarkup(render()),nodes:()=>nodes(render()),button:label=>nodes(render()).find(n=>n.type==='button'&&text(n)===label),fail:id=>fail=id,submitted:()=>submitted};}
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('flat table keeps date order, original links and no extra store control',()=>{const h=harness(),s=h.html();assert(s.indexOf('2026-09-22')<s.indexOf('2026-09-23'));assert.equal((s.match(/查看原貨單/g)||[]).length,4);assert.doesNotMatch(s,/門市|核對／更正/);});
test('single button edits complete receipts and saves once per invoice with original version',async()=>{const h=harness();h.button('編輯所有明細').props.onClick();h.nodes().find(n=>n.type==='input'&&n.props['aria-label']==='海鹽（粗）義大利 數量').props.onChange({target:{value:'2'}});await h.button('儲存修改').props.onClick();await settle();assert.equal(h.calls.length,1);assert.equal(h.calls[0].data.lines.length,2);assert.equal(h.calls[0].data.lines[0].subtotal,100);assert.equal(h.calls[0].data.checked,false);assert.equal(h.calls[0].data.reviewed,false);assert.equal(h.calls[0].data.source_fingerprint,'v1');});
test('selecting any line selects entire invoice and submits without checking supplier account',async()=>{const h=harness();h.nodes().find(n=>n.type==='input'&&n.props['aria-label']?.startsWith('勾選整張')).props.onChange({target:{checked:true}});assert.equal(h.nodes().filter(n=>n.type==='input'&&n.props['aria-label']?.startsWith('勾選整張')&&n.props.checked).length,2);h.button('確認無誤，送入對帳').props.onClick();await settle();assert.equal(h.calls.length,1);assert.equal(h.calls[0].data.reviewed,true);assert.equal(h.calls[0].data.checked,false);assert.equal(h.submitted(),true);});
test('partial failure retains remaining receipt and reuses request ID without resubmitting success',async()=>{const h=harness();h.fail('b');h.nodes().find(n=>n.props?.['aria-label']==='勾選全部貨單').props.onChange({target:{checked:true}});h.button('確認無誤，送入對帳').props.onClick();await settle();assert.equal(h.calls.length,2);assert.equal(h.submitted(),false);const retry=h.calls[1].request;h.fail('');h.button('確認無誤，送入對帳').props.onClick();await settle();assert.equal(h.calls.length,3);assert.equal(h.calls[2].id,'b');assert.equal(h.calls[2].request,retry);});
test('missing tax retains only that invoice while valid selected invoices are submitted',async()=>{const h=harness();h.props.rows[0].tax=null;h.nodes().find(n=>n.props?.['aria-label']==='勾選全部貨單').props.onChange({target:{checked:true}});h.button('確認無誤，送入對帳').props.onClick();await settle();assert.equal(h.calls.length,1);assert.equal(h.calls[0].id,'a');assert.equal(h.submitted(),false);assert.match(h.html(),/2026-09-23・大永行銷有限公司・A：缺稅額/);assert(h.states[0].b);h.props.rows[0].status='CHECKED';});
test('filter changes hide other receipts but retain edits and original revision for saving',async()=>{
 const h=harness(),original=h.props.rows;h.button('編輯所有明細').props.onClick();
 h.nodes().find(n=>n.props?.['aria-label']==='海鹽（粗）義大利 數量').props.onChange({target:{value:'2'}});
 h.props.rows=[];assert.equal(h.nodes().filter(n=>n.props?.['aria-label']==='海鹽（粗）義大利 數量').length,0);
 const c=make('c','2026-10-01');c.supplier_name='另一家供應商';h.props.rows=[c];
 const field=h.nodes().find(n=>n.props?.['aria-label']==='海鹽（粗）義大利 數量');assert(field);field.props.onChange({target:{value:'3'}});
 h.props.rows=[{...original[1],revision:99}];
 assert.equal(h.nodes().find(n=>n.props?.['aria-label']==='海鹽（粗）義大利 數量').props.value,'2');
 h.button('儲存修改').props.onClick();await settle();
 assert.deepEqual(h.calls.map(c=>c.id).sort(),['a','c']);
 assert.equal(h.calls.find(c=>c.id==='a').data.source_fingerprint,'v1');
 assert.equal(h.calls.find(c=>c.id==='a').data.revision,4);
 assert(h.calls.every(c=>c.data.lines.length===2));
});
if(process.env.BULK_PREVIEW){const h=harness();const css=readFileSync(new URL('../app/pilot/receipt-ledger-table.css',import.meta.url),'utf8');writeFileSync('/tmp/beape-bulk-preview.html',`<meta charset="utf-8"><style>body{font-family:Arial,sans-serif;padding:24px;max-width:1200px;margin:auto}button{cursor:pointer} ${css}</style><h2>進貨明細</h2>${h.html()}`);}

test('submit saves selected corrected invoice while unrelated invalid draft remains untouched',async()=>{
 const h=harness();h.button('編輯所有明細').props.onClick();
 const quantity=()=>h.nodes().filter(n=>n.props?.['aria-label']==='海鹽（粗）義大利 數量');
 quantity()[0].props.onChange({target:{value:'2'}});
 quantity()[1].props.onChange({target:{value:'bad'}});
 h.nodes().find(n=>n.props?.['aria-label']==='大永行銷有限公司 2026-09-22 含稅金額').props.onChange({target:{value:'155'}});
 h.nodes().find(n=>n.props?.['aria-label']?.startsWith('勾選整張貨單')).props.onChange({target:{checked:true}});
 assert.equal(h.button('確認無誤，送入對帳').props.disabled,false);
 h.button('確認無誤，送入對帳').props.onClick();await settle();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].id,'a');assert.equal(h.calls[0].data.reviewed,true);assert.equal(h.calls[0].data.lines[0].quantity,2);
 assert.equal(h.states[0].b.value.lines[0].quantity,'bad');assert.equal(h.submitted(),false);
 assert.match(h.html(),/其餘 1 張資料與修改已保留/);
});
