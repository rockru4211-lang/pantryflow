import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';
const server=await createServer({configFile:false,server:{middlewareMode:true}});
const {observedFetch}=await server.ssrLoadModule('/lib/operation-trace.ts');
await server.close();
const endpoint='https://qckwzwyeqpuqogbydvvl.supabase.co';
test('tracing persists outside a failed request and never copies operational payloads or credentials',async()=>{
 const sent=[];const raw=async(url,init)=>{sent.push({url,init});return new Response(JSON.stringify(url.endsWith('/record_app_attempt')?null:{code:'42501',message:'secret private contents'}),{status:url.endsWith('/record_app_attempt')?200:403});};
 const fetcher=observedFetch(raw,endpoint,'public-test-key');
 const result=await fetcher(endpoint+'/rest/v1/rpc/save_pilot_count_drafts',{method:'POST',headers:{Authorization:'Bearer mock-session'},body:JSON.stringify({p_session_id:'11111111-1111-4111-8111-111111111111',p_entries:[{quantity:20,password:'never-copy',pin:'never-copy'}]})});
 assert.equal(result.status,403);assert.equal(sent.length,3);
 const logs=sent.filter(s=>s.url.endsWith('/record_app_attempt')).map(s=>JSON.parse(s.init.body));
 assert.deepEqual(logs.map(s=>s.p_phase),['START','FAILED']);assert.equal(logs[0].p_attempt_id,logs[1].p_attempt_id);
 assert.equal(logs[1].p_context.error_code,'42501');assert(!JSON.stringify(logs).includes('never-copy'));assert(!JSON.stringify(logs).includes('private contents'));assert(!JSON.stringify(logs).includes('mock-session'));
});
test('Auth calls are never observed or transformed and a tracer failure cannot block a successful save',async()=>{
 let calls=0;const raw=async(url)=>{calls++;if(url.endsWith('/record_app_attempt'))throw Error('logging unavailable');return new Response('{}',{status:200});};
 const fetcher=observedFetch(raw,endpoint,'public-test-key');
 await fetcher(endpoint+'/auth/v1/token',{method:'POST',body:JSON.stringify({password:'do-not-log'})});assert.equal(calls,1);
 const result=await fetcher(endpoint+'/rest/v1/rpc/app_operation',{method:'POST',headers:{Authorization:'Bearer mock-session'},body:JSON.stringify({p_store_id:'11111111-1111-4111-8111-111111111111',p_request_id:'22222222-2222-4222-8222-222222222222'})});
 assert.equal(result.status,200);assert.equal(calls,4);
});
