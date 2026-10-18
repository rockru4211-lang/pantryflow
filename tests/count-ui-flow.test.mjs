import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../app/pilot/count-workspace.tsx', import.meta.url), 'utf8');
test('entry search stays in the shell scroller without changing draft controls or modal search',()=>{
  const css=readFileSync(new URL('../app/pilot/count-inline.css',import.meta.url),'utf8');
  const shell=readFileSync(new URL('../app/pilot/v59-shell.css',import.meta.url),'utf8');
  assert.match(source,/className="count-entry-search-sticky"[\s\S]*?value=\{entryQuery\} onChange=\{event=>setEntryQuery\(event.target.value\)\}/);
  assert.equal((source.match(/count-entry-search-sticky/g)||[]).length,1);
  assert.match(css,/\.count-entry-search-sticky\{position:sticky;top:0;z-index:20/);
  assert.match(shell,/\.phone-app:not\(\.auth-phone\) \.shell-content\{[^}]*overflow-y:auto/);
});
const ast = ts.createSourceFile('count-workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const workspace = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CountWorkspace');
assert.ok(workspace?.body, 'The tests must exercise the actual CountWorkspace');
const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React };
const compile = code => ts.transpileModule(code, { compilerOptions, fileName: 'count-fragment.tsx' }).outputText;

// Execute the real handlers with mocked I/O; do not duplicate their routing logic.
function handler(name, scope) {
  const node = workspace.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `Missing handler: ${name}`);
  const context = { ...scope };
  runInNewContext(compile(node.getText(ast)), context, { timeout: 1000 });
  return context[name];
}
test('count addition uses the shared atomic form with a draft-save guard and exact session scope',()=>{
 assert.match(source,/FieldProductForm storeId=\{storeId\} initialName=\{entryQuery\} zoneId=\{selectedZoneId\} sessionId=\{countSession\?\.id\} beforeSave=\{leaveEntry\}/);
 assert.match(source,/setCountRefreshRequired\(true\);throw Error\('COUNT_REFRESH_REQUIRED'\)/);
});
function reopenHarness(options={}) {
 const events=[],notices=[];const stamp='2026-09-30T11:39:33Z';
 const scope={countSession:{id:'session',status:options.status||'IN_PROGRESS'},selectedZoneId:'wine',progress:[{zone_id:'wine',status:'COMPLETED',completed_at:stamp}],mutationLock:{current:false},
  window:{confirm:()=>options.confirm!==false},setBusy:v=>events.push(['busy',v]),setNotice:v=>notices.push(v),
  persistZone:async()=>({error:options.saveError}),withCountSaveTimeout:f=>f({}),
  supabase:{rpc:(name,args)=>{events.push(['rpc',name,args]);return {abortSignal:async()=>({error:options.rpcError})};}},
  loadCountData:async()=>options.refreshFailed?undefined:{status:'IN_PROGRESS',progress:[{zone_id:'wine',status:options.recompleted?'COMPLETED':'IN_PROGRESS'}]},
  setEntryQuery:v=>events.push(['query',v]),goTo:v=>events.push(['page',v])};
 return {events,notices,scope,run:handler('reopenZone',scope)};
}
test('return to editing sends the observed completion generation and opens restored inputs only after refresh',async()=>{
 const h=reopenHarness();await h.run();const rpc=h.events.find(e=>e[0]==='rpc');
 assert.equal(rpc[1],'reopen_pilot_count_zone');assert.equal(rpc[2].p_zone_id,'wine');assert.equal(rpc[2].p_completed_at,'2026-09-30T11:39:33Z');
 assert.ok(h.events.some(e=>e[0]==='page'&&e[1]==='entry'));assert.match(h.notices.at(-1),/原數量與備註已帶回/);assert.equal(h.scope.mutationLock.current,false);
});
test('submitted counts, declined confirmation and unsaved input cannot reopen a zone',async()=>{
 for(const options of [{status:'REVIEWING'},{status:'CLOSED'},{confirm:false},{saveError:Error('unsaved')}]){
  const h=reopenHarness(options);await h.run();assert.ok(!h.events.some(e=>e[0]==='rpc'));assert.equal(h.scope.mutationLock.current,false);
 }
});
test('reopen failures, unknown refresh and newer completion never navigate to editable stale data',async()=>{
 for(const options of [{rpcError:{message:'COUNT_ZONE_CHANGED'}},{rpcError:{message:'STORE_READ_ONLY'}},{refreshFailed:true},{recompleted:true}]){
  const h=reopenHarness(options);await h.run();assert.ok(!h.events.some(e=>e[0]==='page'));assert.equal(h.scope.mutationLock.current,false);assert.ok(h.notices.at(-1));
 }
});
function initializer(name) {
  for (const statement of workspace.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(node => node.name.getText(ast) === name);
    if (declaration?.initializer) return declaration.initializer.getText(ast);
  }
  throw new Error(`Missing initializer: ${name}`);
}
const completionExpressions = [];
const detailsExpressions = [];
function visit(node) {
  if (ts.isJsxExpression(node) && node.expression?.getText(ast).startsWith('page === "complete"')) completionExpressions.push(node.expression.getText(ast));
  if (ts.isJsxExpression(node) && node.expression?.getText(ast).startsWith('page === "details"')) detailsExpressions.push(node.expression.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(completionExpressions.length, 1, 'Keep one final-completion block');

function finishHarness(options={}) {
 const events=[],notices=[];const preview={revision:'rev',missing:options.missing??[{name:'奶油'}]};
 const scope={countSession:{id:'session-a'},mutationLock:{current:false},finishPreview:preview,
  setBusy:v=>events.push(['busy',v]),setNotice:v=>notices.push(v),setFinishPreview:v=>events.push(['preview',v]),
  persistZone:async()=>{events.push('save');return {error:options.saveError};},
  withCountSaveTimeout:fn=>fn({}),supabase:{rpc:(name,args)=>{events.push([name,args]);return {abortSignal:async()=>{if(options.networkError)throw Error('offline');return {data:preview,error:options.rpcError};}};}},
  loadCountData:async()=>{events.push('load');return options.refreshFailed?null:{status:'REVIEWING'};},goTo:p=>events.push(['page',p])};
 return {events,notices,scope,prepare:()=>handler('prepareFinish',scope)(),finish:()=>handler('finishCount',scope)()};
}
test('whole-count preview flushes drafts first and never submits merely by opening the dialog',async()=>{
 const h=finishHarness();await h.prepare();
 assert.equal(h.events[1],'save');assert.equal(h.events[2][0],'get_count_finish_preview');
 assert.ok(h.events.some(e=>Array.isArray(e)&&e[0]==='preview'));
 assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==='finish_pilot_count'));
});
test('failed autosave prevents completion preview',async()=>{
 const h=finishHarness({saveError:Error('UNSAVED')});await h.prepare();
 assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==='get_count_finish_preview'));
});
test('explicit finish sends exact revision and skip choice without manufacturing zero',async()=>{
 for(const missing of [[],[{name:'奶油'}]]){const h=finishHarness({missing});await h.finish();
 const call=h.events.find(e=>Array.isArray(e)&&e[0]==='finish_pilot_count');
 assert.deepEqual(JSON.parse(JSON.stringify(call[1])),{p_session_id:'session-a',p_revision:'rev',p_allow_unobserved:missing.length>0});
 assert.ok(h.events.some(e=>Array.isArray(e)&&e[0]==='page'&&e[1]==='complete'));assert.equal(h.scope.mutationLock.current,false);}
});
test('stale revision and network failure retain data and release the submission lock',async()=>{
 for(const options of [{rpcError:{message:'COUNT_CHANGED'}},{networkError:true}]){const h=finishHarness(options);await h.finish();
 assert.ok(!h.events.includes('load'));assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==='page'));
 assert.equal(h.scope.mutationLock.current,false);assert.ok(h.notices.length);}
});
test('successful submit with failed refresh does not show a false completion screen',async()=>{
 const h=finishHarness({refreshFailed:true});await h.finish();assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==='page'));
});

test('returning from a completed-zone list goes straight to area progress', async () => {
  const events = [];
  const scope = { page: 'zone-details', initialPage: 'overview', initialSessionId: undefined, historySessionId: undefined,
    setHistorySessionId: () => {}, leaveEntry: async () => true, onBack: () => events.push('home'), goTo: value => events.push(value), loadCountData: async () => {} };
  await handler('back', scope)();
  assert.deepEqual(events, ['overview']);
  assert.equal(runInNewContext(`(${initializer('backLabel')})`, { ...scope, returnLabel: '返回首頁' }), '返回區域進度');
});
test('back navigation retains save guards and the existing paper return paths', async () => {
  for (const [page, expected] of [['paper', 'complete'], ['paper-complete', 'paper']]) {
    const events = [];
    const scope = { page, initialPage: 'overview', initialSessionId: undefined, historySessionId: undefined,
      setHistorySessionId: () => {}, leaveEntry: async () => true, onBack: () => events.push('home'), goTo: value => events.push(value), loadCountData: async () => {} };
    await handler('back', scope)(); assert.deepEqual(events, [expected]);
    events.length = 0;
    await handler('back', { ...scope, leaveEntry: async () => false })(); assert.deepEqual(events, []);
  }
});

// Render the actual completion JSX with inert child components, not a separate mock UI.
function completionHtml(status, options = {}) {
  const context = {
    React, page: 'complete', importRevision: 0, simpleField:false,
    countSession: status === null ? null : { id: 'session-a', status, paper_required: false, completed_at: '2026-09-15', ...options.session },
    submittedTotals: { zones: 2, products: 3 }, completedBy: '測試人員',
    displayTime: value => value ?? '', Check: () => null,
    CountDetails: ({ outputOnly }) => React.createElement('span', { 'data-output-only': String(Boolean(outputOnly)) }, '明細輸出'),
    canViewFullDetails: false, canManage: false, initialSessionId: undefined, historySessionId: undefined,
    discrepancies: [], businessType: 'SINGLE_RESTAURANT', busy: false,
    goTo: () => {}, startCount: () => {}, onBack: () => {}, returnLabel: '返回首頁', ...options.scope,
  };
  const expression=context.page==='details'?detailsExpressions[0]:completionExpressions[0];
  const code = ['submitted','awaitingConfirmation','completionHeading','confirmationAction'].map(name=>`globalThis.${name} = (${initializer(name)});`).join('\n')+`globalThis.result = (${expression});`;
  runInNewContext(compile(code), context, { timeout: 1000 });
  return renderToStaticMarkup(context.result);
}
test('an unfinished count cannot render a single-zone or final success page', () => {
  for (const status of [null, 'DRAFT', 'IN_PROGRESS', 'UNKNOWN']) assert.equal(completionHtml(status), '');
  assert.doesNotMatch(source, /\ballComplete\b|繼續下一區/);
});
test('final completion keeps totals, results and export without intermediate actions', () => {
  for (const status of ['REVIEWING', 'CLOSED']) {
    const html = completionHtml(status);
    assert.match(html, status==='CLOSED'?/本次盤點完成/:/盤點已送出，待主管確認/); assert.match(html, /2 個區域・3 項已保存/);
    assert.match(html, /查看結果/); assert.match(html, /data-output-only="true"/);
    assert.doesNotMatch(html, /本區共|查看已盤清單|返回區域進度|繼續下一區|開始下一次盤點/);
  }
});
test('only a manager with resolved differences can confirm a REVIEWING count; CLOSED history is unchanged',()=>{
 const manager=completionHtml('REVIEWING',{scope:{canManage:true,canViewFullDetails:true}});
 assert.match(manager,/盤點已送出，請確認/);assert.match(manager,/確認本次盤點/);assert.match(manager,/開始下次盤點/);
 assert.doesNotMatch(manager,/本次盤點完成/);
 const pending=completionHtml('REVIEWING',{scope:{canManage:true,canViewFullDetails:true,discrepancies:[{status:'PENDING'}]}});
 assert.match(pending,/查看盤點差異/);assert.doesNotMatch(pending,/確認本次盤點/);
 const staff=completionHtml('REVIEWING');assert.match(staff,/待主管確認/);assert.doesNotMatch(staff,/確認本次盤點/);
 const closed=completionHtml('CLOSED',{scope:{canManage:true}});assert.match(closed,/本次盤點完成/);assert.doesNotMatch(closed,/確認本次盤點/);
 const busy=completionHtml('REVIEWING',{scope:{canManage:true,busy:true}});assert.match(busy,/disabled=""[^>]*>確認中…/);
});

function confirmationHarness(options={}){
 const events=[],notices=[],busy=[];
 const scope={countSession:{id:options.sessionId||'session-a',status:options.status||'REVIEWING'},canManage:options.canManage!==false,
  mutationLock:{current:false},discrepancies:options.discrepancies||[],setBusy:value=>busy.push(value),setNotice:value=>notices.push(value),
  persistZone:async()=>{events.push('save');return {error:options.saveError};},
  withCountSaveTimeout:request=>request(new AbortController().signal),
  supabase:{rpc:(name,args)=>{
   assert.equal(name,'confirm_pilot_count_session');assert.equal(args.p_session_id,options.sessionId||'session-a');events.push('confirm');
   return {abortSignal:async()=>{if(options.networkError)throw Error('offline');return {error:options.rpcError,data:options.response??{id:'session-a',status:'CLOSED',confirmed:true}};}};
  }},
  loadCountData:async()=>{events.push('load');return Object.hasOwn(options,'refreshed')?options.refreshed:{status:'CLOSED'};},
  goTo:page=>events.push(`page:${page}`),
 };
 return {scope,events,notices,busy,run:()=>handler('confirmCount',scope)()};
}
test('confirmation waits for unsaved input and cannot be invoked by a non-manager or with pending differences',async()=>{
 for(const options of [{saveError:Error('UNSAVED')},{canManage:false},{status:'CLOSED'},{discrepancies:[{status:'PENDING'}]}]){
  const h=confirmationHarness(options);await h.run();assert.ok(!h.events.includes('confirm'));assert.ok(!h.events.includes('load'));
  assert.equal(h.scope.mutationLock.current,false);
 }
});
test('historical REVIEWING details retain confirmation and difference routes without changing CLOSED history',async()=>{
 const scope={page:'details',historySessionId:'historical-session',canManage:true,canViewFullDetails:true};
 const pending=completionHtml('REVIEWING',{scope});
 assert.match(pending,/確認本次盤點/);assert.match(pending,/盤點已送出，請確認/);
 assert.doesNotMatch(pending,/開始下次盤點/);
 const differences=completionHtml('REVIEWING',{scope:{...scope,discrepancies:[{status:'PENDING'}]}});
 assert.match(differences,/查看盤點差異/);assert.doesNotMatch(differences,/確認本次盤點/);
 const closed=completionHtml('CLOSED',{scope});assert.doesNotMatch(closed,/確認本次盤點|查看盤點差異/);
 const h=confirmationHarness({sessionId:'historical-session'});await h.run();
 assert.deepEqual(h.events,['save','confirm','load','page:complete']);
});
test('opening a historical count changes the selected session only after its own data loads',async()=>{
 for(const refreshed of [undefined,{status:'REVIEWING'}]){
  const events=[];
  const scope={storeId:'current-store',loadCountData:async(store,id)=>{events.push(`read:${store}:${id}`);return refreshed;},
   setHistorySessionId:id=>events.push(`history:${id}`),goTo:page=>events.push(`page:${page}`)};
  await handler('openHistory',scope)('historical-session');
  assert.deepEqual(events,refreshed?['read:current-store:historical-session','history:historical-session','page:details']:['read:current-store:historical-session']);
 }
});
test('confirmed closure refreshes canonical progress before rendering success',async()=>{
 const h=confirmationHarness();await h.run();
 assert.deepEqual(h.events,['save','confirm','load','page:complete']);assert.match(h.notices.at(-1),/本次盤點完成/);
 assert.equal(h.busy.at(-1),false);assert.equal(h.scope.mutationLock.current,false);
});
test('confirmation failures and uncertain refreshes retain the current screen for a safe retry',async()=>{
 for(const options of [{rpcError:{message:'COUNT_DISCREPANCIES_PENDING'}},{rpcError:{message:'STORE_READ_ONLY'}},{networkError:true},{response:{status:'REVIEWING'}},{refreshed:undefined},{refreshed:{status:'REVIEWING'}}]){
  const h=confirmationHarness(options);await h.run();
  assert.ok(!h.events.some(event=>event.startsWith('page:')));assert.doesNotMatch(h.notices.at(-1),/本次盤點完成/);
  assert.equal(h.busy.at(-1),false);assert.equal(h.scope.mutationLock.current,false);
 }
});
test('paper requirements and manager completion actions use the V2.1 labels', () => {
  const paper = completionHtml('CLOSED', { session: { paper_required: true, paper_completed_at: null }, scope: { businessType: 'CHAIN_RESTAURANT' } });
  assert.match(paper, /實際盤點已完成/); assert.match(paper, /開啟紙本謄寫表/);
  assert.doesNotMatch(paper, /data-output-only|開始盤點/);
  const manager = completionHtml('CLOSED', { scope: { canViewFullDetails: true, canManage: true, discrepancies: [{ id: 'd1' }] } });
  assert.match(manager, /查看盤點差異/); assert.match(manager, /開始盤點/);
});


test('field completion keeps the result and exit without administrative output cards',()=>{
 const html=completionHtml('CLOSED',{scope:{simpleField:true,canViewFullDetails:true,canManage:true}});
 assert.match(html,/查看結果/);assert.match(html,/返回首頁/);
 assert.doesNotMatch(html,/明細輸出|查看盤點差異/);
});
