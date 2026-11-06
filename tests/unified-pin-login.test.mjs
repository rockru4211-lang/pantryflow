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

const sharedMemory={storeCode:'8888',storeName:'BeApe',loginMode:'NAME',policy:{authorized:true,device_type:'SHARED',remember_device:true,reauth_days:1}};
function expiryHarness({memory=sharedMemory,remembered='',reason='idle',changedIdentity=false}={}){
 const state={identifier:'previous-user',pin:'123456',mode:'welcome'},calls=[];
 const scope={workspaceUser:{current:'person'},workspaceRequest:{current:1},selectedStoreId:'store',authOperation:{current:false},
  supabase:{rpc:async()=>({data:reason}),auth:{getSession:async()=>({data:{session:{user:{id:changedIdentity?'another-person':'person'},access_token:'token'}}}),signOut:async options=>calls.push(options)}},
  readLoginMemory:()=>memory,readRememberedPerson:()=>remembered,clearLoginMemory:()=>{state.cleared=true;},
  sessionStorage:{removeItem:key=>calls.push(key)},openSessionKey:id=>`session:${id}`,sameAuthSession:(a,b)=>a===b,
  setSession:v=>{state.session=v;},setAuthPassword:v=>{state.password=v;},setStaffPin:v=>{state.pin=v;},setReauthOnly:v=>{state.reauthOnly=v;},
  setRememberPersonChecked:v=>{state.remember=v;},setStaffIdentifier:v=>{state.identifier=v;},setStaffStoreCode:v=>{state.store=v;},setLoginContext:v=>{state.context=v;},
  setMode:v=>{state.mode=v;},setAuthEmail:v=>{state.email=v;},setMessage:v=>{state.message=v;}};
 const functionSource=source.slice(source.indexOf('  async function expireSession('),source.indexOf('  useEffect(()=>{'));
 const code=ts.transpileModule(functionSource+'\nreturn expireSession;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 return {state,calls,expire:new Function(...Object.keys(scope),code)(...Object.values(scope))};
}
test('shared-device expiry returns to the complete PIN form with only the remembered name',async()=>{
 const h=expiryHarness({remembered:'Ruru'});await h.expire();
 assert.equal(h.state.mode,'welcome');assert.equal(h.state.identifier,'Ruru');assert.equal(h.state.remember,true);assert.equal(h.state.pin,'');assert.equal(h.state.session,null);
 assert.deepEqual(h.calls,['session:person',{scope:'local'}]);
});
test('unremembered shared-device expiry clears a previous person and never opens identity-only login',async()=>{
 const h=expiryHarness();await h.expire();assert.equal(h.state.mode,'welcome');assert.equal(h.state.identifier,'');assert.equal(h.state.remember,false);assert.equal(h.state.pin,'');
});
test('personal-device PIN expiry and missing device memory use the same unified form',async()=>{
 const personal=expiryHarness({memory:{...sharedMemory,identifier:'BeApe',policy:{...sharedMemory.policy,device_type:'PERSONAL'}}});await personal.expire();
 assert.equal(personal.state.mode,'welcome');assert.equal(personal.state.identifier,'BeApe');assert.equal(personal.state.pin,'');
 const missing=expiryHarness({memory:null,remembered:'Ruru'});await missing.expire();assert.equal(missing.state.mode,'welcome');assert.equal(missing.state.identifier,'Ruru');
});
test('administrator email expiry retains the email form and clears its password',async()=>{
 const h=expiryHarness({memory:{...sharedMemory,email:'owner@example.invalid'}});await h.expire();
 assert.equal(h.state.mode,'login');assert.equal(h.state.email,'owner@example.invalid');assert.equal(h.state.password,'');assert.equal(h.state.reauthOnly,true);
});
test('revoked devices clear device hints without restoring credentials or losing saved work',async()=>{
 const h=expiryHarness({reason:'revoked',memory:{...sharedMemory,identifier:'stale-device-person'},remembered:'Ruru'});await h.expire();
 assert.equal(h.state.mode,'welcome');assert.equal(h.state.identifier,'Ruru');assert.equal(h.state.cleared,true);assert.equal(h.state.store,'');assert.equal(h.state.context,undefined);assert.equal(h.state.pin,'');
 assert.deepEqual(h.calls,['session:person',{scope:'local'}]);
});
test('stale identity, store or session expiry cannot sign out a newer login',async()=>{
 for(const [options,args] of [[{changedIdentity:true},[]],[{},[false,'different-person']],[{},[false,'person','another-store']],[{},[false,'person','store','old-token']]]){
  const h=expiryHarness(options);await h.expire(...args);assert.deepEqual(h.calls,[]);assert.equal(h.state.identifier,'previous-user');
 }
});

test('signed-out bootstrap clears old input unless a saved name or personal device supplies a hint',async()=>{
 const functionSource=source.slice(source.indexOf('  async function loadWorkspace('),source.indexOf('  async function switchWorkspaceStore('));
 for(const [memory,remembered,identifier,mode] of [[sharedMemory,'','','welcome'],[sharedMemory,'Ruru','Ruru','welcome'],[{...sharedMemory,identifier:'BeApe'},'','BeApe','welcome'],[{...sharedMemory,email:'owner@example.invalid'},'','','login']]){
  const state={identifier:'previous-user',mode:'welcome'},scope={workspaceRequest:{current:0},workspaceUser:{current:'person'},workspaceToken:{current:undefined},devicePreference:{current:undefined},
   readLoginMemory:()=>memory,readRememberedPerson:()=>remembered,checkCompatibility:async()=>true};
  for(const field of ['Profile','Stores','ReauthStores','Invitations','SelectedStoreId','OwnerSetup','WorkspaceError','Session','Busy','Initializing','RememberPersonChecked','StaffStoreCode','LoginContext','StaffPin','AuthEmail','ReauthOnly'])scope[`set${field}`]=value=>{state[field]=value;};
  scope.setStaffIdentifier=value=>{state.identifier=value;};scope.setMode=value=>{state.mode=value;};
  const code=ts.transpileModule(functionSource+'\nreturn loadWorkspace;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  await new Function(...Object.keys(scope),code)(...Object.values(scope))(null);
  assert.equal(state.identifier,identifier);assert.equal(state.mode,mode);assert.equal(state.StaffPin,'');assert.equal(state.RememberPersonChecked,!!remembered);
 }
});
