import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createCountAutoSync} from '../lib/count-auto-sync.ts';

function harness(){
 let remote='one',allowed=true,enabled=true,refreshes=0,fail=false;
 const pending=[],unavailable=[];
 const sync=createCountAutoSync({enabled:()=>enabled,canApply:()=>allowed,readRevision:async()=>{if(fail)throw Error('offline');return remote;},refresh:async()=>{refreshes++;return true;},pending:x=>pending.push(x),unavailable:x=>unavailable.push(x)});
 return {sync,pending,unavailable,get refreshes(){return refreshes;},remote:v=>remote=v,allowed:v=>allowed=v,enabled:v=>enabled=v,fail:v=>fail=v};
}
test('idle readers update once per revision; unchanged polls never reload the workspace',async()=>{
 const h=harness();await h.sync.check();await h.sync.check();assert.equal(h.refreshes,1);
 h.remote('two');await h.sync.check();assert.equal(h.refreshes,2);
});
test('editing defers a changed revision and applies it after editing, without another remote change',async()=>{
 const h=harness();await h.sync.check();h.allowed(false);h.remote('two');await h.sync.check();assert.equal(h.refreshes,1);assert.equal(h.pending.at(-1),true);
 h.allowed(true);await h.sync.check();assert.equal(h.refreshes,2);assert.equal(h.pending.at(-1),false);
});
test('offline/hidden checks and reconnect preserve the last acknowledged revision',async()=>{
 const h=harness();await h.sync.check();h.fail(true);await h.sync.check();assert.equal(h.unavailable.at(-1),true);
 h.remote('two');h.enabled(false);h.fail(false);await h.sync.check();assert.equal(h.refreshes,1);
 h.enabled(true);await h.sync.check();assert.equal(h.refreshes,2);assert.equal(h.unavailable.at(-1),false);
});
test('overlapping triggers serialize, disposed readers cannot apply a late response',async()=>{
 let resolve;let reads=0,refreshes=0;
 const sync=createCountAutoSync({enabled:()=>true,canApply:()=>true,readRevision:()=>{reads++;return new Promise(r=>resolve=r);},refresh:async()=>{refreshes++;return true;},pending:()=>{},unavailable:()=>{}});
 const first=sync.check();await sync.check();assert.equal(reads,1);sync.dispose();resolve('v');await first;assert.equal(refreshes,0);
});
test('a read invalidated by input remains pending for the next idle check',async()=>{
 let success=false,calls=0;
 const sync=createCountAutoSync({enabled:()=>true,canApply:()=>true,readRevision:async()=>'v',refresh:async()=>{calls++;return success;},pending:()=>{},unavailable:()=>{}});
 await sync.check();success=true;await sync.check();await sync.check();assert.equal(calls,2);
});

// Execute the real staged loader, including its setters and draft refs.
const source=readFileSync(new URL('../app/pilot/count-workspace.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('count.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const workspace=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CountWorkspace');
const loader=workspace.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='loadCountData');
const compiled=ts.transpileModule(loader.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function loaderHarness(){
 const applied=[];let releaseDrafts;const data={
  count_zones:[{id:'zone',name:'Cold',zone_products:[{product_id:'p',products:{id:'p',name:'Milk',is_active:true,count_unit:'bottle'}}]}],
  inventory_count_sessions:{id:'session',status:'IN_PROGRESS',snapshot:{zones:[]}},
  count_zone_progress:[{zone_id:'zone',status:'NOT_STARTED'}],
 };
 const scope={AbortSignal,AbortController,storeId:'store',historySessionId:undefined,canManage:true,canViewFullDetails:false,page:'entry',selectedZoneId:'zone',countSession:{id:'session'},loadRequestId:{current:0},zeroItems:[],productOf:r=>r.products,
  supabase:{rpc:()=>{throw Error('background must not prepare or create zones');},from:table=>{
   const chain={abortSignal:()=>chain,select:()=>chain,eq:()=>chain,in:()=>chain,order:()=>chain,limit:()=>chain,maybeSingle:()=>chain,
    then:resolve=>table==='count_drafts'?new Promise(r=>releaseDrafts=()=>r({data:[{zone_id:'zone',product_id:'p',quantity:7,note:'other supervisor',updated_at:'new'}],error:null})).then(resolve):Promise.resolve({data:data[table],error:null}).then(resolve)};return chain;
  }},
  draftVersions:{current:{'zone:p':'old'}},savedDrafts:{current:{}},draftValues:{current:{'zone:p':{quantity:'3',note:'local'}}},dirtyDrafts:{current:{}},failedKeys:{current:new Set()},saveFailure:{current:false},publishDraftStatus:()=>applied.push('status'),
 };
 for(const name of ['setCatalogItems','setNotice','setBusy','setCountDataReady','setProgress','setQuantities','setNotes','setDiscrepancies','setSubmittedTotals','setZeroItems','setCompletedBy','setPaperCompletedBy','setZones','setCountSession','setCountRefreshRequired','setZoneReloadRequired','setImportRevision','setPage'])scope[name]=v=>applied.push([name,v]);
 runInNewContext(compiled,scope);
 return {scope,applied,release:async()=>{while(!releaseDrafts)await new Promise(r=>setImmediate(r));releaseDrafts();}};
}
test('background completion during user input does not touch quantities, versions, busy state or drafts',async()=>{
 const h=loaderHarness();let idle=true;const p=h.scope.loadCountData('store',undefined,()=>idle);
 idle=false;await p;assert.deepEqual(h.applied,[]);assert.equal(h.scope.draftVersions.current['zone:p'],'old');
 const h2=loaderHarness();let unchanged=true;const p2=h2.scope.loadCountData('store',undefined,()=>unchanged);
 await h2.release();unchanged=false;h2.scope.dirtyDrafts.current['zone:p']={quantity:'99',note:'unsaved'};await p2;
 assert.deepEqual(h2.applied,[]);assert.equal(h2.scope.dirtyDrafts.current['zone:p'].quantity,'99');assert.equal(h2.scope.draftVersions.current['zone:p'],'old');
});
test('idle background read applies another supervisor draft without loading flicker or writes',async()=>{
 const h=loaderHarness();const p=h.scope.loadCountData('store',undefined,()=>true);await h.release();await p;
 assert.equal(h.scope.draftValues.current['zone:p'].quantity,'7');assert.equal(h.scope.draftVersions.current['zone:p'],'new');
 assert(!h.applied.some(([name])=>name==='setBusy'));
});
test('navigation invalidates a late background response',async()=>{
 const h=loaderHarness();const p=h.scope.loadCountData('store',undefined,()=>true);await h.release();h.scope.loadRequestId.current++;await p;assert.deepEqual(h.applied,[]);
});
