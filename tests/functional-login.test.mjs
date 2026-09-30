import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {openingStore} from '../lib/store-access.ts';
const source=readFileSync(new URL('../supabase/functions/staff-pin-login/index.ts',import.meta.url),'utf8');
function harness(resolution={storeCode:'GRAS',loginIdentifier:'original-login'}){
 const calls=[];let handler;
 const admin={rpc:async(name,args)=>{calls.push({name,args});if(name==='check_staff_login_rate')return {data:true};if(name==='resolve_staff_login')return {data:resolution};if(name==='verify_staff_pin')return {data:[{outcome:'OK',auth_email:'fixture@example.invalid',store_id:'two',role:'STAFF'}]};if(name==='get_pilot_staff_login_context')return {data:{displayName:'Fixture',storeCode:'GRAS',loginIdentifier:'original-login'}};throw Error(name);},
 from:table=>{const query={select:()=>query,eq:()=>query,ilike:()=>query,maybeSingle:async()=>({data:table==='stores'?{id:'two',organization_id:'org',is_active:true}:table==='store_memberships'?{user_id:'fixture',is_active:true}:{is_active:true}})};return query;},
 auth:{admin:{generateLink:async()=>({data:{properties:{hashed_token:'fixture-token'}}})},verifyOtp:async()=>({data:{session:{access_token:'fixture-access',refresh_token:'fixture-refresh'}}})}};
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','require','Deno',compiled)({},name=>name.includes('supabase-js')?{createClient:()=>admin}:{corsHeaders:{},jsonResponse:(body,status=200)=>Response.json(body,{status})},{env:{get:()=> 'fixture'},serve:fn=>{handler=fn;}});
 return {calls,login:body=>handler(new Request('https://example.invalid/login',{method:'POST',body:JSON.stringify(body)}))};
}
test('unified name login uses the original verifier and unchanged six digit PIN',async()=>{
 const h=harness();const response=await h.login({identifier:'小明',pin:'482613',unified:true});assert.equal(response.status,200);
 assert.deepEqual(h.calls.find(c=>c.name==='verify_staff_pin').args,{p_store_code:'GRAS',p_identifier:'original-login',p_pin:'482613'});
 assert(!h.calls.some(c=>/activate|reset/.test(c.name)));assert.equal(h.calls.filter(c=>c.name==='check_staff_login_rate').length,2);
});
test('ambiguous names fail before any PIN validation',async()=>{const h=harness(null);assert.equal((await h.login({identifier:'同名',pin:'482613',unified:true})).status,401);assert(!h.calls.some(c=>c.name==='verify_staff_pin'));});
test('existing store-specific integrations retain their original login route',async()=>{const h=harness();assert.equal((await h.login({storeCode:'BEAPE',identifier:'original-login',pin:'482613'})).status,200);assert(!h.calls.some(c=>c.name==='resolve_staff_login'));assert.equal(h.calls.find(c=>c.name==='verify_staff_pin').args.p_store_code,'BEAPE');});
test('name confirmation resolves before showing the existing identity context',async()=>{const h=harness();const res=await h.login({action:'context',identifier:'小明',unified:true});assert.equal(res.status,200);assert.deepEqual(h.calls.find(c=>c.name==='get_pilot_staff_login_context').args,{p_store_code:'GRAS',p_identifier:'original-login'});assert(!h.calls.some(c=>c.name==='verify_staff_pin'));});
test('first login uses assigned default; later login uses last authorized active store',()=>{
 const a={id:'a',default_store_id:'b'},b={id:'b',default_store_id:'b'};
 assert.equal(openingStore([a,b]),b);assert.equal(openingStore([a,b],'a'),a);assert.equal(openingStore([a,b],'revoked'),b);assert.equal(openingStore([a,{...b,is_active:false}],'b'),a);assert.equal(openingStore([]),undefined);
});
