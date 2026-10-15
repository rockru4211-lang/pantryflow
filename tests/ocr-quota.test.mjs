import test from 'node:test';import assert from 'node:assert/strict';import{createServer}from'vite';
const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
const{fetchGeminiOnceOrReuse,receiptSourceKey,fetchGeminiWith503Retry}=await server.ssrLoadModule('/supabase/functions/_shared/ocr-runtime.ts');await server.close();
test('busy, quota and ambiguous network responses never cause an automatic second model call',async()=>{
 for(const status of [503,429,500]){let calls=0;const result=await fetchGeminiOnceOrReuse(async()=>{calls++;return new Response('{"error":{"message":"busy"}}',{status});},'https://model.invalid',{});assert.equal(calls,1);assert.equal(result.response.status,status);}
 let calls=0;await assert.rejects(fetchGeminiOnceOrReuse(async()=>{calls++;throw Error('timeout');},'https://model.invalid',{}));assert.equal(calls,1);
 calls=0;await fetchGeminiWith503Retry(async()=>{calls++;return new Response('{}',{status:503});},'https://model.invalid',{});assert.equal(calls,1);
});
test('saved successful response survives a commit retry without a model call or invented attempts',async()=>{
 const cachedResponse={candidates:[{content:{parts:[{text:'{"lines":[]}' }]}}]};
 const result=await fetchGeminiOnceOrReuse(async()=>{throw Error('must not call provider');},'https://model.invalid',{}, {cachedResponse,onAttempt:async()=>{throw Error('must not invent a provider attempt');}});
 assert.equal(result.body,cachedResponse);assert.equal(result.response.ok,true);assert.deepEqual(result.attempts,[]);
});
test('cache identity changes with photo bytes, ordering, mime type, model and prompt',async()=>{
 const a={page_order:1,content_sha256:'a'.repeat(64),byte_size:20,mime_type:'image/jpeg'},b={...a,page_order:2,content_sha256:'b'.repeat(64)};
 const key=await receiptSourceKey([a,b],'model','prompt');assert.match(key,/^[a-f0-9]{64}$/);assert.equal(await receiptSourceKey([b,a],'model','prompt'),key);
 for(const [docs,model,prompt] of [[[a,{...b,content_sha256:'c'.repeat(64)}],'model','prompt'],[[{...a,page_order:2},{...b,page_order:1}],'model','prompt'],[[a,{...b,mime_type:'application/pdf'}],'model','prompt'],[[a,b],'different','prompt'],[[a,b],'model','different']])assert.notEqual(await receiptSourceKey(docs,model,prompt),key);
});
