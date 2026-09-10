import test from 'node:test';import assert from 'node:assert/strict';import{createServer}from'vite';
const server=await createServer({configFile:false,server:{middlewareMode:true}});const{fetchGeminiWith503Retry}=await server.ssrLoadModule('/supabase/functions/_shared/ocr-runtime.ts');await server.close();
test('OCR records separate model attempts and durations through a retry',async()=>{
 let n=0;const snapshots=[];const r=await fetchGeminiWith503Retry(async()=>new Response('{}',{status:++n===1?503:200}),'https://model.invalid',{}, {sleep:async()=>{},onAttempt:async a=>snapshots.push(structuredClone(a))});
 assert.equal(n,2);assert.equal(r.attempts.length,2);assert.deepEqual(snapshots.map(x=>x.length),[1,2]);assert.deepEqual(r.attempts.map(x=>x.status),[503,200]);assert(r.attempts.every(x=>Number.isFinite(x.duration_ms)&&x.duration_ms>=0&&x.started_at));
});
test('model network/timeout failure persists its attempt before propagating failure',async()=>{
 let saved;await assert.rejects(fetchGeminiWith503Retry(async()=>{throw Error('network');},'https://model.invalid',{}, {onAttempt:async a=>{saved=structuredClone(a);}}));
 assert.equal(saved[0].status,0);assert.equal(saved[0].response.error,'MODEL_NETWORK_OR_TIMEOUT');assert(Number.isFinite(saved[0].duration_ms));
});
