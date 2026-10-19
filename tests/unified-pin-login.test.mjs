import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {readRememberedPerson,rememberPerson,rememberedPersonKey} from '../lib/remembered-person.ts';
const source=readFileSync('app/pilot/pilot-client.tsx','utf8');
const handler=source.slice(source.indexOf('  async function submitStaffPin('),source.indexOf('  const loginPreference='));
function harness({fail=false,remember=true}={}){
 const calls=[],messages=[],memory=[],lock={current:false};let finish;
 const pending=new Promise(resolve=>{finish=resolve;});
 const scope={authOperation:lock,setBusy:()=>{},setMessage:m=>messages.push(m),FormData:class{constructor(form){this.form=form;}get(k){return this.form[k]??null;}},mode:'welcome',staffStoreCode:'',staffIdentifier:'stale',rememberPersonChecked:remember,rememberDevice:false,
 supabase:{functions:{invoke:async(name,{body})=>{calls.push({name,body});await pending;if(fail)throw Error('offline');return {data:{session:{access_token:'access',refresh_token:'refresh'}}};}},auth:{setSession:async()=>({data:{session:{user:{id:'person'}}}})}},rememberPerson:x=>memory.push(x),setStaffPin:()=>{},clearRecovery:()=>{},localStorage:{},setRecoveryActive:()=>{},setAuthFlowOpen:()=>{},markAppSession:()=>{},loadWorkspace:async(s,personal)=>calls.push({personal})};
 const code=ts.transpileModule(handler+'\nreturn submitStaffPin;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const submit=new Function(...Object.keys(scope),code)(...Object.values(scope));
 return {calls,messages,memory,lock,finish,submit:()=>submit({preventDefault(){},currentTarget:{identifier:'  Ruru  ',pin:'123456'}})};
}
test('one submit uses the entered name and PIN, blocks double-submit, remembers only identifier',async()=>{const h=harness();const first=h.submit();await h.submit();assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].body,{storeCode:'',identifier:'Ruru',pin:'123456',unified:true});h.finish();await first;assert.deepEqual(h.memory,['Ruru']);assert.deepEqual(h.calls[1],{personal:false});assert.equal(h.lock.current,false);});
test('network failure releases the lock without saving identity and permits retry',async()=>{const h=harness({fail:true});const first=h.submit();h.finish();await first;assert.equal(h.lock.current,false);assert.deepEqual(h.memory,[]);assert.match(h.messages.at(-1),/網路/);await h.submit();assert.equal(h.calls.length,2);});
test('unchecked remember clears prior identity after successful login',async()=>{const h=harness({remember:false});const first=h.submit();h.finish();await first;assert.deepEqual(h.memory,[null]);});
test('remembered person is a bounded hint; blocked storage does not stop login',()=>{const map=new Map();const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};rememberPerson(' Ruru ',storage);assert.equal(readRememberedPerson(storage),'Ruru');assert.deepEqual([...map],[[rememberedPersonKey,'Ruru']]);rememberPerson(null,storage);assert.equal(readRememberedPerson(storage),'');const blocked={getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}};assert.equal(readRememberedPerson(blocked),'');assert.doesNotThrow(()=>rememberPerson('Ruru',blocked));});
