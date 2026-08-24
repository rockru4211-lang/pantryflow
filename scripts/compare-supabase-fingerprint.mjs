import { readFile, writeFile } from 'node:fs/promises';

const [expectedPath, actualPath, reportPath] = process.argv.slice(2);
if (!expectedPath || !actualPath || !reportPath) {
  throw new Error('usage: node scripts/compare-supabase-fingerprint.mjs EXPECTED ACTUAL REPORT');
}

const expectedDocument = JSON.parse(await readFile(expectedPath, 'utf8'));
const actualDocument = JSON.parse((await readFile(actualPath, 'utf8')).trim());
const expected = expectedDocument.snapshot;
const actual = actualDocument.snapshot;

const categories = ['enums', 'tables', 'columns', 'constraints', 'indexes', 'policies', 'functions', 'triggers'];
const identity = {
  enums: item => `${item.schema_name}.${item.type_name}.${item.sort_order}`,
  tables: item => `${item.schema_name}.${item.table_name}`,
  columns: item => `${item.schema_name}.${item.table_name}.${item.ordinal_position}.${item.column_name}`,
  constraints: item => `${item.schema_name}.${item.table_name}.${item.constraint_name}`,
  indexes: item => `${item.schemaname}.${item.tablename}.${item.indexname}`,
  policies: item => `${item.schemaname}.${item.tablename}.${item.policyname}`,
  functions: item => `${item.schema_name}.${item.function_name}(${item.arguments})`,
  triggers: item => `${item.schema_name}.${item.table_name}.${item.trigger_name}`,
};

const differences = {};
for (const category of categories) {
  const expectedMap = new Map(expected[category].map(item => [identity[category](item), JSON.stringify(item)]));
  const actualMap = new Map(actual[category].map(item => [identity[category](item), JSON.stringify(item)]));
  const missing = [...expectedMap.keys()].filter(key => !actualMap.has(key));
  const unexpected = [...actualMap.keys()].filter(key => !expectedMap.has(key));
  const changed = [...expectedMap.keys()].filter(key => actualMap.has(key) && expectedMap.get(key) !== actualMap.get(key));
  differences[category] = {
    expected: expectedMap.size,
    actual: actualMap.size,
    missing,
    unexpected,
    changed,
  };
}

const matches = expectedDocument.fingerprint_sha256 === actualDocument.fingerprint_sha256;
const report = {
  baseline_id: 'PF-SUPABASE-CANONICAL-BASELINE-20260823',
  expected_fingerprint_sha256: expectedDocument.fingerprint_sha256,
  actual_fingerprint_sha256: actualDocument.fingerprint_sha256,
  matches,
  differences,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!matches) process.exitCode = 1;
