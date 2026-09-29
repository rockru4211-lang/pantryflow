import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const compile=code=>ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const workflow={};runInNewContext(compile(readFileSync(new URL('../lib/receipt-workflow.ts',import.meta.url),'utf8')),{exports:workflow});
const drafts={};runInNewContext(compile(readFileSync(new URL('../lib/receipt-review-draft.ts',import.meta.url),'utf8')),{exports:drafts,structuredClone,require:()=>workflow});
const edit={};runInNewContext(compile(readFileSync(new URL('../lib/receipt-ledger-edit.ts',import.meta.url),'utf8')),{exports:edit,require:()=>drafts});
const sheet={};runInNewContext(compile(readFileSync(new URL('../lib/receipt-sheet.ts',import.meta.url),'utf8')),{exports:sheet,require:n=>n.includes('workflow')?workflow:edit});
const fields=[['document','supplier_name','甲'],['document','receipt_date','2026-09-09'],...['1','2'].flatMap(k=>[['product','青蔥'],['specification','A'],['unit','公斤'],['quantity',2],['unit_price_ex_tax',40],['subtotal_ex_tax',80]].map(([n,v])=>[k,n,v]))].map(([row_key,field_name,value],i)=>({id:String(i),row_key,field_name,value}));
const detail={run:{id:'r'},fields,mappings:[]};
function draft(k='1'){const row={batch_id:'b',run_id:'r',row_key:k,review_revision:'opening',annotation_revision:0,category:'食材',note:''};const initial=sheet.sheetValues(row,detail);return {row,detail,initial,values:{...initial}};}
test('sheet includes only changed rows and preserves their opening baselines',()=>{const a=draft(),b=draft('2');a.values.quantity='3';const p=sheet.sheetPayload([a,b]);assert.equal(p.rows.length,1);assert.equal(p.rows[0].review_revision,'opening');assert.equal(p.rows[0].line.fields.find(f=>f.id==='7').value,120);});
test('multiple rows share one document correction without acknowledging hidden taxes',()=>{const a=draft(),b=draft('2');for(const d of [a,b])d.values.supplier='乙';const p=sheet.sheetPayload([a,b]);assert.equal(p.rows.length,2);assert.equal(p.rows.filter(r=>r.document).length,1);assert.equal(p.rows[0].document.acknowledge,false);assert.equal(p.rows[0].document.fields.find(f=>f.id==='0').value,'乙');});
test('invalid later input prevents submission of the entire draft set',()=>{const a=draft(),b=draft('2');a.values.quantity='3';b.values.quantity='-1';assert.throws(()=>sheet.sheetPayload([a,b]),/數量/);});
const src=readFileSync(new URL('../app/pilot/receipt-ledger-table.tsx',import.meta.url),'utf8');const ast=ts.createSourceFile('table.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ReceiptLedgerTable');
const fn=n=>component.body.statements.find(v=>ts.isFunctionDeclaration(v)&&v.name?.text===n).getText(ast);
function harness(success){const a=draft();a.values.quantity='3';const state={drafts:{'b:1':a},saved:false,error:''};const scope={setMode:()=>{},sheetPayload:sheet.sheetPayload,drafts:state.drafts,dirty:[a],loading:[],lock:{current:false},cache:{current:new Map()},operation:{busy:false,run:async()=>success?{saved:true,count:1}:undefined,setError(){}},setError:v=>state.error=v,setNotice:v=>state.notice=v,setDrafts:v=>state.drafts=v,props:{onSaved:async()=>state.saved=true}};runInNewContext(compile(fn('save')),scope);return {scope,state};}
test('failed sheet save keeps every draft and successful save clears only after confirmation',async()=>{for(const success of [false,true]){const h=harness(success);await h.scope.save();assert.equal(Object.keys(h.state.drafts).length,success?0:1);assert.equal(h.state.saved,success);assert.equal(h.scope.lock.current,false);}});
test('shared supplier edits propagate to other opened lines without replacing their quantities',()=>{const a=draft(),b=draft('2');b.values.quantity='4';let current={a,b};const scope={setDrafts:fn=>current=fn(current)};runInNewContext(compile(fn('change')),scope);scope.change('a','supplier','乙');assert.equal(current.a.values.supplier,'乙');assert.equal(current.b.values.supplier,'乙');assert.equal(current.b.values.quantity,'4');});

test('global edit opens eligible visible rows only with bounded concurrency',async()=>{
 const rows=Array.from({length:9},(_,i)=>({batch_id:'b'+i,row_key:'1',run_id:'r',review_allowed:true,status:'PENDING'}));rows.push({...rows[0],batch_id:'confirmed',status:'COMPLETE'},{...rows[0],batch_id:'viewer',review_allowed:false});
 let concurrent=0,maximum=0;const opened=[];const scope={operation:{busy:false},lock:{current:false},preparing:{current:false},generation:{current:0},drafts:{},props:{rows,recordView:'LIVE'},keyOf:r=>r.batch_id+':'+r.row_key,setMode:()=>{},setError:()=>{},setNotice:()=>{},open:async row=>{concurrent++;maximum=Math.max(maximum,concurrent);opened.push(row.batch_id);await Promise.resolve();concurrent--;}};
 runInNewContext(compile(fn('begin')),scope);await scope.begin();assert.equal(opened.length,9);assert.ok(maximum<=4);assert.equal(scope.preparing.current,false);assert.ok(!opened.includes('confirmed'));assert.ok(!opened.includes('viewer'));
});
