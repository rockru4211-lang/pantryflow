import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as XLSX from 'xlsx';
import * as spot from '../lib/spot-checks.ts';
const {validSpotQuantity,spotDifference,spotExportRows,makeSpotWorkbook,spotWorkEntries}=spot;
const caps={plan:true,operate:true,review:true,close:false,export:true};
const item={entry_id:'entry',product_id:'product',zone_id:'zone',name:'橄欖油',zone:'乾貨區',unit:'瓶',specification:'1L',original_entered_at:'2026-09-27T04:00:00Z',baseline_note:'',original_quantity:10,quantity:8,review_status:'PENDING',recheck_quantity:null,reason:null,note:'',reviewed_name:null,reviewed_at:null,confirmed_name:null,confirmed_at:null,final_quantity:null,return_note:''};
const check={id:'check',store_id:'one',source_id:'source',source_month:'2026-09-01',source_completed_at:'2026-09-27T04:00:00Z',status:'REVIEWING',assignee_id:'manager',assignee_name:'主管',created_name:'行政',created_at:'2026-09-28T01:00:00Z',submitted_at:'2026-09-28T06:30:00Z',submitted_name:'主管',closed_at:null,revision:3,total:1,pending_review:1,pending_close:0,caps,items:[item],events:[]};
test('spot-check input keeps zero and decimals valid without converting blanks into zero',()=>{
 for(const v of ['0','8','0.125','100.000'])assert.equal(validSpotQuantity(v),true);
 for(const v of ['',' ','-1','NaN','Infinity','1e4','8.1234','100000000000'])assert.equal(validSpotQuantity(v),false);
 assert.equal(spotDifference({original_quantity:0.3,quantity:0.1}),-0.2);
 assert.equal(spotDifference({original_quantity:10,quantity:null}),null);
});
test('work feed includes spot checks across pending stages but not unpublished plans',()=>{
 const rows=spotWorkEntries([check,{...check,id:'draft',status:'DRAFT'},{...check,id:'done',status:'CLOSED'}]);
 assert.equal(rows.length,2);assert.equal(rows[0].target,'spot-check');assert.equal(rows[0].pending,true);assert.equal(rows[1].pending,false);
});
test('export excludes drafts and preserves pending status, null final values and numeric zero',()=>{
 const output=spotExportRows([check,{...check,id:'draft',submitted_at:null},{...check,id:'zero',items:[{...item,original_quantity:0,quantity:0,review_status:'SAME',final_quantity:0}]}],'BeApe');
 assert.equal(output.details.length,2);assert.equal(output.reviews.length,1);
 assert.equal(output.details[0]['最後確認數'],null);assert.equal(output.details[1]['最後確認數'],0);
 assert.equal(output.details[0]['差異數'],-2);assert.equal(output.reviews[0]['目前處理狀態'],'待主管複核');
 assert.equal(typeof output.details[0]['抽查送出時間'],'number');
 assert.throws(()=>spotExportRows([{...check,items:[{...item,original_quantity:undefined}]}],'BeApe'),/不完整/);
});
test('Excel round-trip produces both financial sheets with numeric sortable cells, dates and literal user text',async()=>{
 const after={...item,review_status:'CLOSED',recheck_quantity:8,final_quantity:8,reason:'USED',note:'=1+1',reviewed_name:'主管',reviewed_at:'2026-09-28T08:20:00Z',confirmed_name:'行政',confirmed_at:'2026-09-28T09:00:00Z'};
 const full={...check,status:'CLOSED',items:[{...after,name:'=HYPERLINK("https://example.invalid")'}],events:[{id:'event',entry_id:'entry',action:'close',actor_name:'行政',at:after.confirmed_at,payload:{before:item,after}}]};
 const book=await makeSpotWorkbook([full],'BeApe');
 const saved=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellNF:true});
 assert.deepEqual(saved.SheetNames,['抽盤明細','差異處理紀錄']);
 const sheet=saved.Sheets['抽盤明細'];const rows=XLSX.utils.sheet_to_json(sheet);
 assert.equal(rows[0]['原盤點數'],10);assert.equal(rows[0]['抽查數'],8);assert.equal(rows[0]['最後確認數'],8);
 const refs=Object.keys(sheet).filter(key=>!key.startsWith('!'));
 assert.equal(refs.some(key=>sheet[key].f),false);assert.equal(sheet['G2'].t,'s');
 assert.ok(refs.some(key=>sheet[key].t==='n'&&sheet[key].z==='yyyy/mm/dd hh:mm'));
 assert.ok(sheet['!autofilter']);
 const audit=XLSX.utils.sheet_to_json(saved.Sheets['差異處理紀錄']);assert.equal(audit[0]['補充說明'],'=1+1');assert.equal(audit[0]['結案確認人'],'行政');
});

const source=readFileSync(new URL('../app/pilot/spot-check-workspace.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('spot.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='SpotCheckWorkspace');
const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
function handler(name,scope){const node=component.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node);const context={...scope};runInNewContext(compile(node.getText(ast)),context);return context[name];}
function mutationHarness(rpc){
 const events=[],errors=[],busy=[],accepts=[];const state={alive:{current:true},working:{current:false},pending:{current:null},sequence:{current:0},reviewRef:{current:null},planDirty:{current:true},crypto:{randomUUID:()=> 'request-1'},rpc,
 setBusy:v=>busy.push(v),setError:v=>errors.push(v),accept:v=>accepts.push(v),setUncertain:v=>events.push(['uncertain',v]),setReview:()=>{},setNotice:()=>{},setTab:v=>events.push(['tab',v]),setDraftId:()=>{},setSourceId:()=>{},setSelected:()=>{},setAssignee:()=>{},spotError:spot.spotError};
 return {state,events,errors,busy,accepts,run:handler('mutate',state)};
}
test('ambiguous create save retains exact request ID and blocks a different action until retry succeeds',async()=>{
 const calls=[];let attempt=0;
 const h=mutationHarness(async(action,data)=>{calls.push({action,data});if(++attempt===1)throw Error('network lost');return check;});
 assert.equal(await h.run('create',{id:'check',entries:['entry']}),null);
 assert.ok(h.state.pending.current);assert.equal(h.accepts.length,0);
 assert.equal(await h.run('submit',{id:'check'}),null);assert.equal(calls.length,1);
 await h.run('',{},true);assert.deepEqual(calls[0],calls[1]);assert.equal(h.state.pending.current,null);assert.equal(h.accepts.length,1);
 assert.ok(h.events.some(([k,v])=>k==='tab'&&v==='pending'));
});
test('a revision conflict leaves existing input intact and permits an explicit refresh',async()=>{
 const h=mutationHarness(async()=>{throw {code:'40001',message:'SPOT_CHANGED'};});
 await h.run('save_entries',{id:'check',revision:2});assert.equal(h.accepts.length,0);assert.equal(h.state.pending.current,null);assert.match(h.errors.at(-1),/輸入仍保留/);
});
test('submit flushes quantities first and uses the acknowledged revision; failed save cannot submit',async()=>{
 for(const saved of [true,false]){const calls=[];const ref={current:{...check,revision:3}};
 const submit=handler('submit',{saveQuantities:async()=>{calls.push('save');ref.current={...check,revision:4};return saved;},detailRef:ref,mutate:async(action,data)=>calls.push([action,data.revision]),read:()=>{}});
 await submit();assert.deepEqual(calls,saved?['save',['submit',4]]:['save']);}
});
test('one running write excludes double clicks and publishes only a matching acknowledged check',async()=>{
 let finish;const h=mutationHarness(()=>new Promise(resolve=>{finish=resolve;}));const first=h.run('submit',{id:'check'});
 assert.equal(await h.run('submit',{id:'check'}),null);finish({...check,id:'other'});assert.equal(await first,null);assert.equal(h.accepts.length,0);assert.ok(h.state.pending.current);
});
function render(detail,{readonly=false,userId='manager'}={}){
 let index=0;const state=['2026-09','pending',{caps:readonly?{...caps,plan:false,operate:false,review:false,close:false}:caps,checks:[]},null,detail,'','',[],'','','',detail?Object.fromEntries(detail.items.map(i=>[i.entry_id,i.quantity==null?'':String(i.quantity)])):{},null,'','',false,false,false,false];
 const context={React,...spot,number:v=>v==null?'—':String(v),useState:init=>{const n=index++;return [n<state.length?state[n]:typeof init==='function'?init():init,()=>{}];},useRef:value=>({current:value}),useEffect:()=>{},useCallback:f=>f,localMonth:()=> '2026-09',displayTime:v=>v||'',Download:()=>null,RefreshCw:()=>null,ClipboardCheck:()=>null,supabase:{},exports:{},AbortController,crypto};
 runInNewContext(compile(component.getText(ast)),context);
 const store={id:'one',name:'BeApe',role:'SUPERVISOR',access_mode:readonly?'VIEW':'EDIT'};
 return renderToStaticMarkup(context.exports.default({store,userId}));
}
test('open mobile check shows only selected inputs and hides original comparison; readonly results expose no mutation buttons',()=>{
 const open={...check,status:'OPEN',submitted_at:null,items:[{...item,original_quantity:undefined,quantity:8}]};
 const html=render(open);assert.match(html,/實際數量/);assert.ok(!html.includes('原盤點</small>'));assert.ok(!html.includes('填寫複核數量與原因'));
 const read=render({...check,caps:{plan:false,operate:false,review:false,close:false,export:true}},{readonly:true});
 assert.match(read,/匯出 Excel/);assert.match(read,/原盤點/);assert.ok(!read.includes('填寫複核數量與原因'));assert.ok(!read.includes('確認結案'));
});


test('late detail responses cannot replace a newer selection or reopen a departed tab',async()=>{
 const pending=[],accepted=[];const scope={canLeave:async()=>true,detailSequence:{current:0},sequence:{current:0},opening:{current:false},alive:{current:true},setLoading:()=>{},setError:()=>{},setNotice:()=>{},spotError:spot.spotError,accept:v=>accepted.push(v.id),rpc:()=>new Promise(resolve=>pending.push(resolve))};
 const open=handler('open',scope);const first=open('first');await new Promise(resolve=>setImmediate(resolve));const second=open('second');await new Promise(resolve=>setImmediate(resolve));
 pending[1]({...check,id:'second'});await second;pending[0]({...check,id:'first'});await first;assert.deepEqual(accepted,['second']);
 const third=open('third');await new Promise(resolve=>setImmediate(resolve));scope.detailSequence.current++;pending[2]({...check,id:'third'});await third;assert.deepEqual(accepted,['second']);
});

test('unfinished-sheet export preserves missing baseline and difference as blank, not zero',()=>{
 const result=spotExportRows([{...check,source_completed_at:null,items:[{...item,original_quantity:null}]}],'Gras');
 assert.equal(result.details[0]['原盤點數'],null);
 assert.equal(result.details[0]['差異數'],null);
 assert.equal(result.details[0]['原盤點完成時間'],null);
 assert.equal(result.details[0]['抽查數'],8);
});
test('plan saves the automatically selected current sheet and refuses a stale removed selection',async()=>{
 const calls=[],errors=[];
 const scope={sourceId:'',catalog:{source_id:'current',items:[{entry_id:'entry'}]},selected:['entry'],assignee:'admin',draftId:'',detailRef:{current:null},crypto:{randomUUID:()=> 'new'},setError:e=>errors.push(e),mutate:async(action,data)=>{calls.push([action,data]);return null;}};
 await handler('savePlan',scope)(true);
 assert.equal(calls.length,1);assert.equal(calls[0][1].source_id,'current');assert.equal(calls[0][1].publish,true);
 scope.catalog.items=[];
 await handler('savePlan',scope)(true);
 assert.equal(calls.length,1);assert.match(errors.at(-1),/品項已更新/);
});

test('open checks expose add-items control only to planners before submission',()=>{
 const open={...check,status:'OPEN',submitted_at:null,items:[{...item,original_quantity:undefined}]};
 assert.match(render(open),/新增抽盤品項/);
 assert.ok(!render(check).includes('新增抽盤品項'));
 assert.ok(!render({...open,caps:{...caps,plan:false}},{readonly:true}).includes('新增抽盤品項'));
});
test('adding selected items routes to append with acknowledged revision instead of replacing plan',async()=>{
 const calls=[];
 await handler('savePlan',{sourceId:'source',catalog:{items:[{entry_id:'new-item'}]},selected:['new-item'],assignee:'admin',draftId:'check',detailRef:{current:{id:'check',status:'OPEN',revision:7}},setError:e=>{throw Error(e);},mutate:async(action,data)=>{calls.push([action,data]);return null;}})(true);
 assert.equal(calls[0][0],'add_items');assert.equal(calls[0][1].revision,7);
 assert.deepEqual(Array.from(calls[0][1].entries),['new-item']);
});
