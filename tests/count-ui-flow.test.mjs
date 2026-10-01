import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validCountQuantity } from '../lib/count-flow.ts';

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
function addItemHarness(options={}) {
  const events=[],notices=[],busy=[];
  const form={fields:{product_name:'南法羅特列克酒莊 小不點紅酒',unit:'瓶'},reset:()=>events.push('reset')};
  const event={currentTarget:form,preventDefault(){}};
  const scope={countSession:{id:'session'},selectedZoneId:'wine',storeId:'store',addItemPending:{current:false},mutationLock:{current:false},
    FormData:class {constructor(element){assert.equal(element,form);this.fields={...element.fields};}get(key){return this.fields[key];}},
    leaveEntry:async()=>{events.push('save');await options.wait;return !options.saveFailed;},
    setNotice:v=>notices.push(v),setBusy:v=>busy.push(v),setAddingCountItem:v=>events.push(['form',v]),setCountRefreshRequired:v=>events.push(['refresh',v]),
    withCountSaveTimeout:f=>f({}),supabase:{rpc:(name,args)=>{events.push(['rpc',name,args]);return {abortSignal:async()=>{if(options.networkError)throw Error('offline');return {error:options.rpcError};}};}},
    loadCountData:async()=>{events.push('load');return options.refreshFailed?undefined:{id:'session'};},
    setSelectedZoneId:id=>events.push(['zone',id]),goTo:p=>events.push(['page',p])};
  const add=handler('addCountItem',scope);
  return {events,notices,busy,scope,form,run(){const job=add(event);event.currentTarget=null;return job;},double(){return add({currentTarget:form,preventDefault(){}});}};
}
test('adding an onsite item captures form values before React clears currentTarget during draft save',async()=>{
  const h=addItemHarness();await h.run();
  const rpc=h.events.find(e=>Array.isArray(e)&&e[0]==='rpc');
  assert.equal(rpc[1],'add_pilot_count_item');assert.equal(rpc[2].p_name,'南法羅特列克酒莊 小不點紅酒');assert.equal(rpc[2].p_unit,'瓶');
  assert.ok(h.events.indexOf('save')<h.events.indexOf(rpc));assert.ok(h.events.includes('reset'));assert.ok(h.events.includes('load'));
  assert.match(h.notices.at(-1),/已加入本次盤點/);assert.equal(h.busy.at(-1),false);assert.equal(h.scope.mutationLock.current,false);
});
test('unsaved counts stop addition and double taps cannot insert twice while saving',async()=>{
  const failed=addItemHarness({saveFailed:true});await failed.run();assert.deepEqual(failed.events,['save']);assert.equal(failed.busy.at(-1),false);
  let resume;const h=addItemHarness({wait:new Promise(r=>{resume=r;})});const first=h.run();await h.double();resume();await first;
  assert.equal(h.events.filter(e=>Array.isArray(e)&&e[0]==='rpc').length,1);
});
test('add failures preserve form values and always release locks; uncertain writes require reconciliation',async()=>{
  for(const options of [{rpcError:{code:'42501'}},{networkError:true}]){
    const h=addItemHarness(options);await h.run();assert.ok(!h.events.includes('reset'));assert.equal(h.form.fields.unit,'瓶');assert.equal(h.busy.at(-1),false);assert.equal(h.scope.mutationLock.current,false);
    assert.match(h.notices.at(-1),options.networkError?/避免重複新增/:/輸入已保留/);
    assert.equal(h.events.some(e=>Array.isArray(e)&&e[0]==='refresh'),!!options.networkError);
  }
});
test('successful insert followed by failed reload is not reported as a failed insert',async()=>{
  const h=addItemHarness({refreshFailed:true});await h.run();assert.match(h.notices.at(-1),/品項已新增.*不需再次新增/);assert.ok(h.events.some(e=>Array.isArray(e)&&e[0]==='refresh'));
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

function countHarness(options = {}) {
  const zones = [{ id: 'a', zone_products: [{ product_id: 'p1' }] }, { id: 'b', zone_products: [{ product_id: 'p2' }] }];
  const quantities = { 'a:p1': options.quantity ?? '2' };
  const events = [], notices = [], busy = [];
  const scope = {
    countSession: { id: 'session-a' }, quantities, liveZones: zones,
    validQuantity: (zone, row) => validCountQuantity(quantities[`${zone.id}:${row.product_id}`]),
    entryInputs: { current: {} }, workspaceElement: { current: null },
    setNotice: text => notices.push(text), setBusy: value => busy.push(value),
    setSelectedZoneId: id => events.push(`zone:${id}`), goTo: page => events.push(`page:${page}`),
    persistZone: async () => { events.push('save'); return { error: options.saveError ?? null }; },
    withCountSaveTimeout: request => request(new AbortController().signal),
    supabase: { rpc: (name, args) => {
      assert.equal(name, 'complete_pilot_count_zone');
      assert.equal(args.p_session_id, 'session-a'); assert.equal(args.p_zone_id, 'a');
      events.push('complete');
      return { abortSignal: async () => {
        if (options.networkError) throw new Error('network');
        return { error: options.rpcError ?? null };
      } };
    } },
    loadCountData: async () => {
      events.push('load');
      return Object.hasOwn(options, 'refreshed') ? options.refreshed : { status: 'IN_PROGRESS', progress: [{ zone_id: 'a', status: 'COMPLETED' }] };
    },
  };
  return { events, notices, busy, quantities, run: () => handler('completeZone', scope)(zones[0]) };
}
const completed = [{ zone_id: 'a', status: 'COMPLETED' }, { zone_id: 'b', status: 'COMPLETED' }];

test('saving and completing a zone advances directly to the next unfinished zone', async () => {
  for (const status of ['DRAFT', 'IN_PROGRESS']) {
    const h = countHarness({ quantity: '0', refreshed: { status, progress: completed.slice(0, 1) } });
    await h.run();
    assert.deepEqual(h.events, ['save', 'complete', 'load', 'zone:b', 'page:entry']);
    assert.equal(h.quantities['a:p1'], '0');
    assert.equal(h.busy.at(-1), false);
  }
});
test('an active count without a next zone returns to progress, not a completion screen', async () => {
  for (const status of ['DRAFT', 'IN_PROGRESS']) {
    const h = countHarness({ refreshed: { status, progress: completed } }); await h.run();
    assert.deepEqual(h.events, ['save', 'complete', 'load', 'page:overview']);
  }
});
test('only a server-confirmed submitted count opens final completion', async () => {
  for (const status of ['REVIEWING', 'CLOSED']) {
    const h = countHarness({ refreshed: { status, progress: completed } }); await h.run();
    assert.deepEqual(h.events, ['save', 'complete', 'load', 'page:complete']);
  }
});
test('missing or unexpected session status never becomes a false completion', async () => {
  for (const status of [undefined, null, 'CANCELLED', 'UNKNOWN']) {
    const h = countHarness({ refreshed: { status, progress: completed } }); await h.run();
    assert.deepEqual(h.events, ['save', 'complete', 'load', 'page:overview']);
  }
});
test('a failed refresh does not navigate away', async () => {
  const h = countHarness({ refreshed: undefined }); await h.run();
  assert.deepEqual(h.events, ['save', 'complete', 'load']);
});
test('unsaved drafts, RPC errors and network errors cannot advance or clear the input', async () => {
  for (const options of [{ saveError: new Error('UNSAVED') }, { rpcError: { code: '40001' } }, { networkError: true }]) {
    const h = countHarness(options); await h.run();
    assert.ok(!h.events.some(event => event.startsWith('page:') || event.startsWith('zone:')));
    assert.ok(!h.events.includes('load'));
    assert.equal(h.quantities['a:p1'], '2'); assert.equal(h.busy.at(-1), false);
    if (!options.saveError) assert.ok(h.notices.length > 0);
  }
});
test('missing quantity cannot submit a zone', async () => {
  const h = countHarness({ quantity: '' }); await h.run();
  assert.deepEqual(h.events, []); assert.match(h.notices[0], /未完成/);
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
    React, page: 'complete', importRevision: 0,
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
    assert.match(html, status==='CLOSED'?/本次盤點完成/:/各區已完成，待主管確認/); assert.match(html, /2 個區域・3 項已保存/);
    assert.match(html, /查看結果/); assert.match(html, /data-output-only="true"/);
    assert.doesNotMatch(html, /本區共|查看已盤清單|返回區域進度|繼續下一區|開始下一次盤點/);
  }
});
test('only a manager with resolved differences can confirm a REVIEWING count; CLOSED history is unchanged',()=>{
 const manager=completionHtml('REVIEWING',{scope:{canManage:true,canViewFullDetails:true}});
 assert.match(manager,/各區已完成，請確認盤點/);assert.match(manager,/確認本次盤點/);assert.match(manager,/開始下次盤點/);
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
 assert.match(pending,/確認本次盤點/);assert.match(pending,/各區已完成，請確認盤點/);
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
