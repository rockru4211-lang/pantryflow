import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validCountQuantity } from '../lib/count-flow.ts';
import { sameCountCardDraft, unclassifiedCountZone } from '../lib/count-card-drafts.ts';

const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, fileName: 'actual.tsx' }).outputText;
const source = readFileSync(new URL('../app/pilot/count-workspace.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const workspace = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CountWorkspace');
function actualHandler(name, scope) {
  const fn = workspace.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn);
  const context = { ...scope };
  runInNewContext(compile(fn.getText(ast)), context);
  return context[name];
}
const cardModule = { exports: {} };
const reactJsx = await import('react/jsx-runtime');
runInNewContext(compile(readFileSync(new URL('../app/pilot/count-entry-card.tsx', import.meta.url), 'utf8')), {
  exports: cardModule.exports, module: cardModule,
  require: name => name === 'react' ? React : name === 'react/jsx-runtime' ? reactJsx : new Proxy({}, { get: () => () => null }),
});
const CountEntryCard = cardModule.exports.default;
function renderCard(props = {}) {
  return renderToStaticMarkup(React.createElement(CountEntryCard, {
    name: '伊比利火腿', unit: '包', quantity: '0', note: '本期用完，下期可移除。',
    unclassified: false, saveState: 'saved', onQuantity() {}, onNote() {}, onAssign() {}, ...props,
  }));
}

test('classified cards retain zero/note but contain no repeated area tag or assignment control', () => {
  const html = renderCard();
  assert.match(html, /value="0"/); assert.match(html, /本期用完，下期可移除/); assert.match(html, /已儲存/);
  assert.doesNotMatch(html, /儲物區|冷藏區|冷凍區|<select|type="range"/);
});
test('unclassified cards alone offer area assignment; empty quantity stays blank', () => {
  const html = renderCard({ unclassified: true, quantity: '', note: '', saveState: 'empty' });
  assert.match(html, /儲物區/); assert.match(html, /value=""/); assert.doesNotMatch(html, /已儲存|<textarea/);
  assert.equal(unclassifiedCountZone(' 未 分類 '), true); assert.equal(unclassifiedCountZone('冷藏區'), false);
});
test('a note-only card never invents a count, and invalid quantity gets a repair instruction', () => {
  const noteOnly = renderCard({ quantity: '' });
  assert.match(noteOnly, /value=""/); assert.doesNotMatch(noteOnly, /value="0"/);
  const invalid = renderCard({ quantity: '-1', saveState: 'invalid' });
  assert.match(invalid, /aria-invalid="true"/); assert.match(invalid, /請填 0 或正數/); assert.doesNotMatch(invalid, /儲存中/);
});
test('product source details remain available and only the permitted editor is rendered', () => {
  const html = renderCard({ supplier: '供應商 A', specification: '500g', editor: React.createElement('button', null, '修改') });
  assert.match(html, /<details/); assert.match(html, /供應商 A｜500g/); assert.match(html, />修改<\/button>/);
  assert.doesNotMatch(renderCard(), />修改<\/button>/);
});

function saveHarness(drafts, responder) {
  const scope = {
    saveTimer: { current: null }, pendingSaves: { current: null }, countSession: { id: 'session' },
    dirtyDrafts: { current: drafts }, savedDrafts: { current: {} }, draftVersions: { current: {} },
    failedKeys: { current: new Set() }, saveFailure: { current: false }, setNotice() {}, publishDraftStatus() {},
    clearTimeout, validCountQuantity, sameCountCardDraft,
    withCountSaveTimeout: request => request({}),
    supabase: { rpc: (name, args) => ({ abortSignal: () => responder(name, args, scope) }) },
  };
  return { scope, flush: actualHandler('flushDrafts', scope) };
}
test('combined autosave preserves a newer note entered while the quantity request is in flight', async () => {
  const requests = [];
  const h = saveHarness({ 'zone:item': { quantity: '0', note: 'first' } }, async (_name, args, scope) => {
    requests.push(args.p_entries[0]);
    if (requests.length === 1) scope.dirtyDrafts.current['zone:item'] = { quantity: '0', note: 'later' };
    return { data: [{ zone_id: 'zone', product_id: 'item', updated_at: `version-${requests.length}` }] };
  });
  await h.flush();
  assert.equal(requests.length, 2); assert.equal(requests[0].quantity, 0); assert.equal(requests[1].note, 'later');
  assert.equal(requests[1].expected_updated_at, 'version-1');
  assert.equal(h.scope.savedDrafts.current['zone:item'].note, 'later');
  assert.equal(Object.keys(h.scope.dirtyDrafts.current).length, 0);
});
test('note-only save sends null quantity; a failed save retains both input fields for retry', async () => {
  let first = true;
  const h = saveHarness({ 'zone:item': { quantity: '', note: '請行政確認' } }, async (_name, args) => {
    assert.equal(args.p_entries[0].quantity, null); assert.equal(args.p_entries[0].note, '請行政確認');
    if (first) { first = false; return { error: new Error('COUNT_DRAFT_CHANGED') }; }
    return { data: [{ zone_id: 'zone', product_id: 'item', updated_at: 'v1' }] };
  });
  await h.flush(); assert.equal(h.scope.saveFailure.current, true); assert.equal(h.scope.dirtyDrafts.current['zone:item'].note, '請行政確認');
  await h.flush(); assert.equal(h.scope.saveFailure.current, false); assert.equal(Object.keys(h.scope.dirtyDrafts.current).length, 0);
});
test('a pure invalid draft is retained without being sent or marked saved', async () => {
  const h = saveHarness({ 'zone:item': { quantity: '-1', note: '備註' } }, async () => { assert.fail('invalid count must not be submitted'); });
  await h.flush(); assert.equal(h.scope.dirtyDrafts.current['zone:item'].quantity, '-1');
  assert.equal(Object.keys(h.scope.savedDrafts.current).length, 0);
});

function assignmentHarness({ saveError = false, refresh = true, rpcError, action='count.assign-zone' } = {}) {
  const events = [], notices = [], refreshGate=[], pickerGate=[],requests=[];
  const scope = {
    zoneReloadRequired:false,setCountRefreshRequired:value=>refreshGate.push(value),setZoneReloadRequired:value=>pickerGate.push(value),setNotice:value=>notices.push(value),
    mutationLock: { current: false }, setBusy: value => events.push(`busy:${value}`), setZoneNotice: value => notices.push(value),
    draftVersions: { current: { 'source:item': 'old' } },
    persistZone: async () => { events.push('flush'); scope.draftVersions.current['source:item'] = 'saved'; return { error: saveError }; },
    runZoneOperation: async (action, data) => { requests.push({action,data});events.push(`assign:${data.expected_updated_at}`); if (rpcError) throw new Error(rpcError); },
    loadCountData: async () => { events.push('refresh'); return refresh ? {} : undefined; },
    setZonePicker: value => events.push(value === null ? 'close' : 'open'),
    setSelectedZoneId:value=>events.push(`zone:${value}`),setEntryQuery:value=>events.push(`query:${value}`),
  };
  return { scope, events, notices, refreshGate,pickerGate, requests,run: () => actualHandler('mutateZone', scope)(action, { source_zone_id: 'source', product_id: 'item', target_zone_id: 'target' }) };
}
test('assignment first flushes the combined draft and uses the resulting concurrency version', async () => {
  const h = assignmentHarness(); assert.equal(await h.run(), true);
  assert.deepEqual(h.events, ['busy:true', 'flush', 'assign:saved', 'refresh', 'close', 'busy:false']);
  assert.equal(h.scope.mutationLock.current, false);
});
test('failed draft save prevents assignment and failed refresh cannot become false success', async () => {
  const unsaved = assignmentHarness({ saveError: true }); assert.equal(await unsaved.run(), false);
  assert.ok(!unsaved.events.some(event => event.startsWith('assign:')));
  const stale = assignmentHarness({ refresh: false }); assert.equal(await stale.run(), false);
  assert.ok(!stale.events.includes('close')); assert.match(stale.notices.at(-1), /變更已儲存.*重新讀取共同進度/);
});
test('target conflicts explain how to recover rather than inviting an identical retry', async () => {
  const h = assignmentHarness({ rpcError: 'COUNT_TARGET_ALREADY_HAS_PRODUCT' }); await h.run();
  assert.match(h.notices.at(-1), /已有相同品項.*選擇其他區域/);
  assert.ok(!h.events.includes('close'));
});
test('editing a catalog unit blocks new count entry until the actual current snapshot is loaded', async () => {
  for (const refresh of [true, false]) {
    const events = [], notices = [];
    const scope = {
      updateProduct: () => events.push('catalog'),
      setCountRefreshRequired: value => events.push(`block:${value}`),
      loadCountData: async () => { events.push('snapshot'); return refresh ? {} : undefined; },
      setNotice: value => notices.push(value),
    };
    await actualHandler('updateCountProduct', scope)({ id: 'item', count_unit: '箱' });
    assert.deepEqual(events, ['catalog', 'block:true', 'snapshot']);
    if (!refresh) assert.match(notices[0], /重新讀取共同進度/);
  }
});
test('editing a name cannot clear a price that was not loaded', async () => {
  const editorSource = readFileSync(new URL('../app/pilot/product-basic-editor.tsx', import.meta.url), 'utf8');
  const editorAst = ts.createSourceFile('editor.tsx', editorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const editor = editorAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ProductBasicEditor');
  const form = editor.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(editorAst) === 'form');
  assert.ok(form?.initializer);
  for (const price of [undefined, null, 123.5]) for (const uncertain of [false,true]) {
    let payload, attempted=false, confirmed=false;
    const scope = {
      exports: {}, require: () => reactJsx, product: { id: 'item' },
      draft: { name: '火腿', count_unit: '包', specification: null, updated_at: 'v1', unit_price: price },
      includePrice: true, canEditBasic:true,operation: { busy: false, error: '', run: async (_action, data) => { assert.equal(attempted,true); payload = data; return uncertain?undefined:data; } },
      onSaved: async () => {confirmed=true;}, onSaveAttempt: () => {attempted=true;}, close() {}, setNotice() {}, setDraft() {},
    };
    runInNewContext(compile(`globalThis.form = (${form.initializer.getText(editorAst)});`), scope);
    await scope.form.props.onSubmit({ preventDefault() {} });
    assert.equal(Object.hasOwn(payload, 'unit_price'), price !== undefined);
    if (price !== undefined) assert.equal(payload.unit_price, price);
    assert.equal(attempted,true);assert.equal(confirmed,!uncertain);
  }
});
test('an uncertain product edit keeps counting blocked after its dialog is cancelled', async () => {
  const notices=[], gate=[];
  actualHandler('prepareProductSave',{setCountRefreshRequired:value=>gate.push(value),setNotice:value=>notices.push(value)})();
  assert.deepEqual(gate,[true]);
  const canLeave=await actualHandler('leaveEntry',{
    mutationLock:{current:false},editingProductId:'',countRefreshRequired:gate[0],setNotice:value=>notices.push(value),
    flushDrafts:async()=>assert.fail('must confirm snapshot before further count operations'),
  })();
  assert.equal(canLeave,false);assert.match(notices.at(-1),/重新讀取共同進度/);
});

function actualEditorExpression(name, scope) {
  const text = readFileSync(new URL('../app/pilot/product-basic-editor.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('editor.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ProductBasicEditor');
  const declaration = component.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(parsed) === name);
  assert.ok(declaration?.initializer);
  const context = { exports: {}, require: () => reactJsx, ...scope };
  runInNewContext(compile(`globalThis.result = (${declaration.initializer.getText(parsed)});`), context);
  return context.result;
}
test('staff edit menu allows basic count data and area correction without price access', async () => {
  const menu = actualEditorExpression('editorContent', {
    editView:'actions',onChangeArea:async()=>true,canEditBasic:true,choosingArea:false,product:{name:'火腿'},
    ChevronRight:()=>null,notice:'',form:React.createElement('form',null,'品名 單位 規格'),
  });
  const html=renderToStaticMarkup(menu);
  assert.match(html,/修改品項資料/);assert.match(html,/更改儲物區/);assert.doesNotMatch(html,/<form|<input|單價/);
  let rpcCall;
  const form=actualEditorExpression('form',{
    canEditBasic:true,busy:false,fieldBasicEdit:true,setFieldBusy(){},storeId:'store',
    product:{id:'item'},draft:{name:'火腿',count_unit:'包',specification:'500g',updated_at:'v1'},includePrice:false,
    operation:{busy:false,error:'',setError(){},run:()=>assert.fail('staff must not call manager product edit')},
    rpcAny:async(name,args)=>{rpcCall={name,args};return {data:{id:'item',name:'火腿',count_unit:'包',specification:'500g',updated_at:'v2'},error:null};},
    appError:error=>String(error),onSaveAttempt(){},onSaved:async()=>{},setNotice(){},close(){},setDraft(){},
  });
  const formHtml=renderToStaticMarkup(form);
  assert.match(formHtml,/品名/);assert.match(formHtml,/單位/);assert.match(formHtml,/規格/);assert.doesNotMatch(formHtml,/單價/);
  await form.props.onSubmit({preventDefault(){}});
  assert.equal(rpcCall.name,'update_pilot_count_item_basic');
  assert.equal(rpcCall.args.p_store_id,'store');assert.equal(rpcCall.args.p_product_id,'item');
});
test('manager chooses product or area editing before entering a form, preserving an unsaved basic draft', () => {
  const scope={onChangeArea:async()=>true,canEditBasic:true,choosingArea:false,product:{name:'火腿'},ChevronRight:()=>null,notice:'',form:React.createElement('form',null,React.createElement('input',{defaultValue:'尚未儲存的品名'}))};
  const actions=renderToStaticMarkup(actualEditorExpression('editorContent',{...scope,editView:'actions'}));
  assert.match(actions,/修改品項資料/);assert.match(actions,/更改儲物區/);assert.doesNotMatch(actions,/<form/);
  const basic=renderToStaticMarkup(actualEditorExpression('editorContent',{...scope,editView:'basic'}));
  assert.match(basic,/尚未儲存的品名/);assert.doesNotMatch(basic,/更改儲物區|count-edit-choice/);
});
test('area correction opens only after quantity and note drafts have been saved', async () => {
  for(const failed of [true,false]){
    const events=[];
    const scope={mutationLock:{current:false},countRefreshRequired:false,persistZone:async()=>{events.push('flush');return {error:failed};},setZoneNotice(){},setZonePicker:value=>events.push(value.mode)};
    const result=await actualHandler('openCountZoneCorrection',scope)({productId:'item',sourceZoneId:'source',productName:'火腿'});
    assert.equal(result,!failed);assert.deepEqual(events,failed?['flush']:['flush','move']);
  }
});
test('confirmed correction uses the new move operation and follows the item into its target zone', async () => {
  const h=assignmentHarness({action:'count.move-zone'});assert.equal(await h.run(),true);
  assert.equal(h.requests[0].action,'count.move-zone');assert.equal(h.requests[0].data.expected_updated_at,'saved');
  assert.ok(h.events.indexOf('flush')<h.events.indexOf('assign:saved'));
  assert.ok(h.events.includes('zone:target'));assert.ok(h.events.includes('query:'));
  assert.match(h.notices.at(-1),/儲物區已更正.*數量與備註已保留/);
});
test('a timed-out correction or a failed refresh blocks both counting and repeated area actions', async () => {
  for(const options of [{rpcError:'COUNT_SAVE_TIMEOUT'},{refresh:false}]){
    const h=assignmentHarness({...options,action:'count.move-zone'});assert.equal(await h.run(),false);
    assert.equal(h.refreshGate.at(-1),true);assert.equal(h.pickerGate.at(-1),true);assert.ok(!h.events.includes('close'));
    const gated=actualHandler('mutateZone',{...h.scope,zoneReloadRequired:true});
    const count=h.requests.length;assert.equal(await gated('count.move-zone',{}),false);assert.equal(h.requests.length,count);
  }
});
test('a completed count or changed draft requires fresh progress, while a target collision allows a different choice', async () => {
  for(const rpcError of ['COUNT_SESSION_NOT_ACTIVE','COUNT_DRAFT_CHANGED']){
    const h=assignmentHarness({action:'count.move-zone',rpcError});await h.run();
    assert.equal(h.refreshGate.at(-1),true);assert.equal(h.pickerGate.at(-1),true);assert.match(h.notices.at(-1),/重新讀取共同進度/);
  }
  const collision=assignmentHarness({action:'count.move-zone',rpcError:'COUNT_TARGET_ALREADY_HAS_PRODUCT'});await collision.run();
  assert.equal(collision.refreshGate.length,0);assert.equal(collision.pickerGate.length,0);assert.match(collision.notices.at(-1),/選擇其他區域/);
});
test('unknown move recovery refreshes directly without reopening the normal leave guard', async () => {
  const events=[];
  const scope={mutationLock:{current:false},editingProductId:'',countRefreshRequired:true,setBusy(){},persistZone:async()=>{events.push('flush');return {};},loadCountData:async()=>{events.push('read');return {};},setZonePicker:value=>events.push(value===null?'close':'open'),setZoneNotice(){},setNotice(){},leaveEntry:()=>assert.fail('normal leave is blocked for unknown outcomes')};
  await actualHandler('reloadZoneProgress',scope)();assert.deepEqual(events,['flush','read','close']);assert.equal(scope.mutationLock.current,false);
});
test('a retried uncertain move retains its idempotency request identifier', async () => {
  const requests=[];let sequence=0;
  const scope={zoneRequests:{current:new Map()},storeId:'store',crypto:{randomUUID:()=>`request-${++sequence}`},
    withCountSaveTimeout:request=>request({}),supabase:{rpc:(_name,args)=>({abortSignal:async()=>{requests.push(args);if(requests.length===1)throw new Error('timeout');return {data:{zone_id:'target'}};}})},
  };
  const run=actualHandler('runZoneOperation',scope),payload={session_id:'session',source_zone_id:'source',target_zone_id:'target',product_id:'item',expected_updated_at:'saved'};
  await assert.rejects(run('count.move-zone',payload),/timeout/);await run('count.move-zone',payload);
  assert.equal(requests[0].p_request_id,requests[1].p_request_id);assert.equal(sequence,1);
});
