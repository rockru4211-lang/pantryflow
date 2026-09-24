import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validCountQuantity } from '../lib/count-flow.ts';

const source = readFileSync(new URL('../app/pilot/count-workspace.tsx', import.meta.url), 'utf8');
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
function initializer(name) {
  for (const statement of workspace.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(node => node.name.getText(ast) === name);
    if (declaration?.initializer) return declaration.initializer.getText(ast);
  }
  throw new Error(`Missing initializer: ${name}`);
}
const completionExpressions = [];
function visit(node) {
  if (ts.isJsxExpression(node) && node.expression?.getText(ast).startsWith('page === "complete"')) completionExpressions.push(node.expression.getText(ast));
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
  const code = `globalThis.submitted = (${initializer('submitted')}); globalThis.result = (${completionExpressions[0]});`;
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
    assert.match(html, /本次盤點完成/); assert.match(html, /2 個區域・3 項已保存/);
    assert.match(html, /查看結果/); assert.match(html, /data-output-only="true"/);
    assert.doesNotMatch(html, /本區共|查看已盤清單|返回區域進度|繼續下一區|開始下一次盤點/);
  }
});
test('paper requirements and manager completion actions use the V2.1 labels', () => {
  const paper = completionHtml('CLOSED', { session: { paper_required: true, paper_completed_at: null }, scope: { businessType: 'CHAIN_RESTAURANT' } });
  assert.match(paper, /實際盤點已完成/); assert.match(paper, /開啟紙本謄寫表/);
  assert.doesNotMatch(paper, /data-output-only|開始盤點/);
  const manager = completionHtml('CLOSED', { scope: { canViewFullDetails: true, canManage: true, discrepancies: [{ id: 'd1' }] } });
  assert.match(manager, /查看盤點差異/); assert.match(manager, /開始盤點/);
});
