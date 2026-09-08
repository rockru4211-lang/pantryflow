import test from 'node:test';
import assert from 'node:assert/strict';
import { withCountSaveTimeout } from '../lib/count-save.ts';

test('a hanging request is aborted and rejected, so save controls can recover', async()=>{
  let signal;
  await assert.rejects(withCountSaveTimeout(s=>{signal=s;return new Promise(()=>{});},15),/COUNT_SAVE_TIMEOUT/);
  assert.equal(signal.aborted,true);
});
test('a timed-out save does not prevent a later retry succeeding',async()=>{
  await assert.rejects(withCountSaveTimeout(()=>new Promise(()=>{}),10),/COUNT_SAVE_TIMEOUT/);
  const result=await withCountSaveTimeout(()=>Promise.resolve({rows:96}),50);
  assert.deepEqual(result,{rows:96});
});
test('server failures and thrown client errors are returned without hanging',async()=>{
  const result=await withCountSaveTimeout(()=>Promise.resolve({error:{code:'40001'}}),50);
  assert.equal(result.error.code,'40001');
  await assert.rejects(withCountSaveTimeout(()=>{throw new Error('network');},50),/network/);
});
