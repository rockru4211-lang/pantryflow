import test from 'node:test';
import assert from 'node:assert/strict';
import {assertClientEnvironment} from '../scripts/client-env.mjs';
const project='qckwzwyeqpuqogbydvvl';
const valid={NEXT_PUBLIC_SUPABASE_URL:`https://${project}.supabase.co`,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test-public-value'};
test('build rejects absent or wrong-project client settings without echoing keys',()=>{
  for(const field of Object.keys(valid))assert.throws(()=>assertClientEnvironment({...valid,[field]:''},project),error=>error.message.includes(field)&&!error.message.includes(valid.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY));
  for(const url of ['invalid','https://unrelated.supabase.co'])assert.throws(()=>assertClientEnvironment({...valid,NEXT_PUBLIC_SUPABASE_URL:url},project),/指定專案/);
  assert.doesNotThrow(()=>assertClientEnvironment(valid,project));
});
test('CI placeholder is accepted only for CI builds',()=>{
  const ci={...valid,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'ci-placeholder-publishable-key'};
  assert.throws(()=>assertClientEnvironment(ci,project),/佔位/);
  assert.doesNotThrow(()=>assertClientEnvironment({...ci,NEXT_PUBLIC_APP_ENV:'ci'},project));
});
