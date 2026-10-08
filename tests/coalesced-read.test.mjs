import test from 'node:test';
import assert from 'node:assert/strict';
import {coalescedRead} from '../lib/coalesced-read.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('focus and timer share an in-flight read and failure permits retry',async()=>{
 const first=deferred();let calls=0;const read=coalescedRead(()=>{calls++;return calls===1?first.promise:Promise.resolve('new');});
 const a=read(),b=read();assert.equal(a,b);await flush();assert.equal(calls,1);
 first.reject(Error('timeout'));await assert.rejects(a,/timeout/);assert.equal(await read(),'new');assert.equal(calls,2);
});
test('post-write refresh waits for the older read then fetches the committed revision',async()=>{
 const first=deferred(),second=deferred();let calls=0;const read=coalescedRead(()=>++calls===1?first.promise:second.promise);
 const before=read();const after=read(true);await flush();assert.equal(calls,1);
 first.resolve('old');assert.equal(await before,'old');await flush();assert.equal(calls,2);
 second.resolve('saved');assert.equal(await after,'saved');
});
test('an older failed read cannot prevent the post-write refresh',async()=>{
 const first=deferred();let calls=0;const read=coalescedRead(()=>++calls===1?first.promise:Promise.resolve('saved'));
 const before=read();const after=read(true);first.reject(Error('timeout'));await assert.rejects(before);assert.equal(await after,'saved');
});
