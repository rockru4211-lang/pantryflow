import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {settleLoginDevice} from '../lib/login-device-setup.ts';

const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const parse=path=>ts.createSourceFile(path,readFileSync(new URL(path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const client=parse('../app/pilot/pilot-client.tsx');
const component=client.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='PilotClient');
const switchNode=component.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='switchWorkspaceStore');
const policy=parse('../lib/app-workspace.ts');
const parseNode=policy.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='parseAppContext');
const storeModule={exports:{}};
runInNewContext(compile(readFileSync(new URL('../lib/baihuayuan.ts',import.meta.url),'utf8')),storeModule);

function harness({contextError,registrationError,missingTarget=false,wrongUser=false,readOnly=false,settling}={}){
 const events=[],writes=[];
 const stores=[{id:'one',name:'BeApe',organization_id:'org',role:'SUPERVISOR',access_mode:'EDIT'},
  ...missingTarget?[]:[{id:'two',name:'Gras',organization_id:'org',role:'SUPERVISOR',access_mode:readOnly?'VIEW':'EDIT'}]];
 const scope={exports:{},session:{user:{id:'actor'}},workspaceUser:{current:'actor'},authOperation:{current:false},workspaceRequest:{current:0},
  normalizeBaihuayuanStores:storeModule.exports.normalizeBaihuayuanStores,deviceId:()=> 'device',
  settleLoginDevice:async(...args)=>{events.push('settle');if(settling)await settling();return settleLoginDevice(...args);},
  supabase:{rpc:async(name,args)=>{
   events.push(name);
   if(name==='get_app_context')return {data:{user_id:wrongUser?'other':'actor',stores},error:contextError};
   assert.equal(name,'register_app_device');assert.equal(args.p_store_id,'two');
   return {data:{authorized:true,device_type:'PERSONAL',remember_device:true,reauth_days:7,choice_required:false},error:registrationError};
  }},
  rememberStoreNavigation:(...args)=>{events.push('navigation');writes.push(['navigation',...args]);},
  setStores:value=>{events.push('stores');writes.push(['stores',value]);},
  setReauthStores:()=>{},
  setSelectedStoreId:value=>{events.push('selected');writes.push(['selected',value]);},
  localStorage:{setItem:(...args)=>writes.push(['memory',...args])},
 };
 runInNewContext(compile(parseNode.getText(policy)),scope);
 runInNewContext(compile(switchNode.getText(client)),scope);
 return {scope,events,writes,switch:(navigation)=>scope.switchWorkspaceStore('two',navigation)};
}

for(const [name,options] of [
 ['context read failure',{contextError:{message:'offline'}}],
 ['revoked target store',{missingTarget:true}],
 ['another authenticated identity',{wrongUser:true}],
 ['target device rejection',{registrationError:{message:'APP_FORBIDDEN'}}],
])test(`${name} cannot change the selected store, navigation or remembered data store`,async()=>{
 const h=harness(options);
 await assert.rejects(h.switch({view:'members',memberStartPage:'new'}));
 assert.deepEqual(h.writes,[]);
});

test('switching publishes target permissions and navigation only after device checks complete',async()=>{
 let settle;const h=harness({readOnly:true,settling:()=>new Promise(resolve=>{settle=resolve;})});
 const navigation={view:'members',memberStartPage:'new'};
 const pending=h.switch(navigation);
 for(let i=0;i<8;i++)await Promise.resolve();
 assert.deepEqual(h.writes,[]);
 settle();await pending;
 assert.deepEqual(h.events,['get_app_context','register_app_device','settle','navigation','stores','selected']);
 const fresh=h.writes.find(([kind])=>kind==='stores')[1];
 assert.equal(fresh.find(store=>store.id==='two').access_mode,'VIEW');
 assert.deepEqual(h.writes.find(([kind])=>kind==='navigation'),['navigation','actor','two',navigation]);
 assert.deepEqual(h.writes.find(([kind])=>kind==='selected'),['selected','two']);
 assert.deepEqual(h.writes.find(([kind])=>kind==='memory'),['memory','count-store:actor','two']);
});

test('an identity change during device checking cancels the stale switch without any commit',async()=>{
 let settle;const h=harness({settling:()=>new Promise(resolve=>{settle=resolve;})});
 const pending=h.switch({view:'business'});
 for(let i=0;i<8;i++)await Promise.resolve();
 h.scope.workspaceUser.current='different-user';settle();
 await assert.rejects(pending,/STORE_ACCESS_CHANGED/);
 assert.deepEqual(h.writes,[]);
});
