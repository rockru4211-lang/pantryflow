import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/staff-pin-login/index.ts', import.meta.url), 'utf8');
const handlerSource = ts.transpile(source.replace(/^import .*$/gm, ''), {target:ts.ScriptTarget.ES2022});

function setup() {
  const calls = [];
  const store = {storeName:'測試門市',storeCode:'TEST',loginMode:'NAME_OR_NICKNAME'};
  const staff = {...store,loginIdentifier:'staff1',displayName:'員工甲',role:'STAFF'};
  const admin = {
    async rpc(name, args) {
      calls.push([name,args]);
      if(name==='check_staff_login_rate') return {data:true};
      if(name==='get_staff_invitation') return {data:{...staff,status:'VALID'}};
      if(name==='get_pilot_staff_login_context') {
        if(args.p_identifier==='unknown') return {data:null,error:{message:'LOGIN_CONTEXT_NOT_FOUND'}};
        return {data:staff};
      }
      if(name==='verify_staff_pin') return {data:[{outcome:'INVALID'}]};
      assert.fail(name);
    }
  };
  let serve;
  runInNewContext(handlerSource,{
    createClient:()=>admin,crypto, TextEncoder, console,
    Deno:{env:{get:()=>'test'},serve:fn=>{serve=fn;}},
    jsonResponse:(body,status=200)=>Response.json(body,{status})
  });
  return {store,calls,async send(body) {
    const response = await serve(new Request('https://example.invalid',{method:'POST',body:JSON.stringify(body)}));
    const {correlationId,...result}=await response.json();
    return {status:response.status,...result};
  }};
}

test('store context and invitation expose only store details before PIN',async()=>{
  const {send,calls,store}=setup();
  for(const identifier of ['員工甲','unknown']) {
    assert.deepEqual(await send({action:'context',storeCode:'TEST',identifier}),{status:200,context:store});
  }
  assert.ok(calls.filter(([name])=>name==='get_pilot_staff_login_context').every(([,args])=>args.p_identifier===null));
  assert.deepEqual(await send({action:'invitation',invitationToken:'invitation'}),{status:200,context:{...store,status:'VALID'}});
});

test('identity resolution stays in the PIN service and failures return the same response',async()=>{
  const {send,calls}=setup();
  const failed={status:401,error:'INVALID_STAFF_CREDENTIALS'};
  for(const identifier of ['員工甲','unknown']) {
    assert.deepEqual(await send({storeCode:'TEST',identifier,pin:'111111'}),failed);
  }
  assert.equal(calls.find(([name])=>name==='verify_staff_pin')[1].p_identifier,'staff1');
});
