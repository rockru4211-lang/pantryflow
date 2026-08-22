import "../../../work-domain.js";
import "../../../work-components.js";
import "../../../operations-ui-v2.js";

type Domain = Record<string, (...args: any[]) => any> & { ROLE: Record<string, string> };
const root = globalThis as typeof globalThis & { PantryWorkDomain: Domain; PantryWorkComponents: Record<string, (...args: any[]) => string>; PantryOperationsUiV2: Record<string, (...args: any[]) => any> };
const domain = root.PantryWorkDomain;
const ui = root.PantryOperationsUiV2;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

for (const role of ['STAFF', 'SUPERVISOR', 'ADMIN']) Deno.test(`existing profile role projects to shared ${role} home`, () => assert(ui.roleHomeModel(role, {}).role === role, 'role changed'));
Deno.test('unknown and proposed OWNER roles cannot expand current privileges', () => assert(domain.canonicalRole('OWNER') === 'STAFF', 'unknown role must use least privilege'));
Deno.test('missing operational facts never become fake numbers', () => assert(ui.roleHomeModel('SUPERVISOR', {}).metrics.every(([, value]: [string, unknown]) => value === null), 'missing metric invented'));
Deno.test('blind count distinguishes zero, uncounted and invalid', () => {
  assert(domain.countInputState('') === 'UNCOUNTED', 'empty'); assert(domain.countInputState('0') === 'COUNTED_ZERO', 'zero'); assert(domain.countInputState('-1') === 'INVALID', 'negative');
});
Deno.test('count session cannot complete until every zone is complete', () => {
  const session = { status: 'IN_PROGRESS' };
  assert(!domain.canTransitionCount({ session, zones: [{ status: 'COMPLETED' }, { status: 'IN_PROGRESS' }] }, 'COMPLETE_SESSION'), 'partial session completed');
  assert(domain.canTransitionCount({ session, zones: [{ status: 'COMPLETED' }] }, 'COMPLETE_SESSION'), 'complete session blocked');
});
Deno.test('supervisor projection only contains review and exception work', () => {
  const items = [{ id: 'a', status: 'IN_PROGRESS', type: 'COUNT', exceptions: [] }, { id: 'b', status: 'WAITING_REVIEW', type: 'COUNT', exceptions: [] }, { id: 'c', status: 'IN_PROGRESS', type: 'COUNT', exceptions: [{ status: 'OPEN' }] }];
  assert(domain.selectVisibleTasks(items, 'SUPERVISOR').map((x: any) => x.id).join(',') === 'b,c', 'normal work leaked');
});
Deno.test('OCR review is projected into the shared task stream', () => {
  const tasks = domain.buildWorkItems({ receiptBatches: [{ id: 'b1', status: 'READY_FOR_REVIEW', created_at: '2026-08-22' }], ocrRuns: [{ id: 'r1', batch_id: 'b1', status: 'UNREADABLE' }] });
  assert(tasks[0].type === 'RECEIPT_REVIEW' && tasks[0].exceptions[0].severity === 'CRITICAL', 'OCR task mapping');
});
Deno.test('inventory event preserves actor, source and raw record', () => {
  const raw = { id: 'e1', session_id: 's1', organization_id: 'o1', product_id: 'p1', quantity: '0', unit: 'kg', entered_by: 'u1', entered_at: 'now' };
  const event = domain.inventoryEvent('COUNT', raw);
  assert(event.quantity === 0 && event.actorId === 'u1' && event.sourceId === 's1' && event.raw === raw, 'provenance lost');
});
Deno.test('cloud adapter checks context errors and no OWNER migration remains', async () => {
  const backend = await Deno.readTextFile(new URL('../../../pilot-backend.js', import.meta.url));
  assert(backend.includes('loadWorkContext()') && backend.includes('if (result.error) throw result.error'), 'adapter error check');
  for await (const entry of Deno.readDir(new URL('../../migrations/', import.meta.url))) assert(!entry.name.includes('owner_role'), 'OWNER migration remains');
});
Deno.test('shared workflow components cover reusable states', () => {
  for (const name of ['taskCard', 'statusTag', 'emptyState', 'errorState', 'offlineState', 'fixedAction']) assert(typeof root.PantryWorkComponents[name] === 'function', `${name} missing`);
});
