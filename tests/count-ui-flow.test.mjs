import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/pilot/count-workspace.tsx', import.meta.url), 'utf8');

test('count flow advances directly between zones without an intermediate continue screen', () => {
  assert.match(source, /setSelectedZoneId\(next\.id\);goTo\("entry"\)/);
  assert.match(source, /else if\(\["DRAFT","IN_PROGRESS"\]\.includes\(refreshed\.status\|\|""\)\) goTo\("overview"\);/);
  assert.doesNotMatch(source, /繼續下一區/);
});
