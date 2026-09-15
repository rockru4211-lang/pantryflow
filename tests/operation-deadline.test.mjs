import test from 'node:test';
import assert from 'node:assert/strict';
import {operationDeadline} from '../lib/operation-deadline.ts';

test('a stalled receipt save stops waiting, aborts transport and permits a successful retry', async()=>{
 let firstSignal;let finish;
 await assert.rejects(operationDeadline(signal=>{firstSignal=signal;return new Promise(resolve=>{finish=resolve;});},10),/REQUEST_TIMEOUT/);
 assert.equal(firstSignal.aborted,true);
 assert.deepEqual(await operationDeadline(async()=>({saved:true}),100),{saved:true});
 finish({saved:true}); // A late first response cannot replace the retry's result.
});
test('receipt errors are preserved and a successful response cancels its deadline',async()=>{
 await assert.rejects(operationDeadline(async()=>{throw new Error('REVISION_CONFLICT');}),/REVISION_CONFLICT/);
 let signal;assert.equal(await operationDeadline(async next=>{signal=next;return 3;},10),3);
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(signal.aborted,false);
});
