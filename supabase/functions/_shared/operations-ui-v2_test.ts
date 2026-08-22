import "../../../operations-ui-v2.js";

type OperationsUi = {
  canonicalRole: (role: string) => string;
  roleHomeModel: (role: string, facts?: Record<string, unknown>) => Record<string, unknown>;
  countInputState: (value: unknown) => string;
};

const ui = (globalThis as typeof globalThis & { PantryOperationsUiV2: OperationsUi }).PantryOperationsUiV2;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

for (const role of ['STAFF', 'SUPERVISOR', 'ADMIN', 'OWNER']) {
  Deno.test(`operations UI renders ${role} from profile role`, () => {
    const model = ui.roleHomeModel(role, {});
    assert(model.role === role, `${role} must not be replaced by a hard-coded role`);
  });
}

Deno.test('missing operational facts never become fake numbers', () => {
  const model = ui.roleHomeModel('SUPERVISOR', {}) as { metrics: Array<[string, unknown]> };
  assert(model.metrics.every(([, value]) => value === null), 'missing metrics must remain null');
});

Deno.test('count input distinguishes zero from uncounted', () => {
  assert(ui.countInputState('') === 'UNCOUNTED', 'empty input must be uncounted');
  assert(ui.countInputState('0') === 'COUNTED_ZERO', 'zero must be counted');
  assert(ui.countInputState('1.5') === 'COUNTED', 'positive quantities must be counted');
});

Deno.test('OWNER migration extends the real app_role and management predicates', async () => {
  const sql = await Deno.readTextFile(new URL('../../migrations/20260822005433_add_owner_role.sql', import.meta.url));
  assert(/alter type public\.app_role add value if not exists 'OWNER'/.test(sql), 'organization member enum must include OWNER');
  assert(/current_role\(\) in \('OWNER', 'ADMIN'\)/.test(sql), 'OWNER must receive admin management permission');
  assert(!/update public\.(profiles|organization_members)/.test(sql), 'migration must not rewrite existing members');
});

Deno.test('cloud home facts are queried from Supabase and do not inherit demo inventory', async () => {
  const backend = await Deno.readTextFile(new URL('../../../pilot-backend.js', import.meta.url));
  const app = await Deno.readTextFile(new URL('../../../app.js', import.meta.url));
  assert(backend.includes('loadOperationsHomeFacts()'), 'home facts must have a Supabase data path');
  assert(app.includes('formalCloud: true'), 'cloud products must opt out of demo fallbacks');
  assert(app.includes("const fallback = product.formalCloud ? null"), 'formal cloud products must not inherit demo quantities');
});
