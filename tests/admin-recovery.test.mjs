import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';

function actualHandler(filename,component,name,scope){
 const source=readFileSync(new URL(`../app/pilot/${filename}`,import.meta.url),'utf8');
 const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===component);
 assert.ok(fn?.body);
 let code;
 for(const node of fn.body.statements){
  if(ts.isFunctionDeclaration(node)&&node.name?.text===name)code=node.getText(ast);
  if(ts.isVariableStatement(node)){
   const variable=node.declarationList.declarations.find(item=>item.name.getText(ast)===name);
   if(variable?.initializer)code=`globalThis.${name}=(${variable.initializer.getText(ast)});`;
  }
 }
 assert.ok(code,`Actual ${component}.${name} must exist`);
 runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope,{timeout:1000});
 return scope[name];
}
function recoveryScope(){
 const scope={draft:{id:'p',name:'未儲存名稱',updated_at:'old-version'},recoverySequence:{current:0},recoveryIdentity:{current:'store:edit:p'},notice:'',page:'edit',busy:false,error:'REVISION_CONFLICT',calls:[],
  empty:{id:'',name:'',code:'',aliases:'',safety_quantity:'',note:''},useCallback:fn=>fn,
 };
 scope.setDraft=value=>{scope.draft=value;};scope.clearDraft=()=>{scope.draft=scope.empty;};
 scope.setPage=value=>{scope.page=value;};scope.setNotice=value=>{scope.notice=value;};scope.setReloading=value=>{scope.busy=value;};
 scope.operation={setError:value=>{scope.error=value;},run:async(action,data)=>{scope.calls.push({action,data});}};
 return scope;
}
const latestProduct={id:'p',name:'同事確認的品名',product_code:'FRESH',category:'食材',base_unit:'袋',specification:'500g',current_supplier_id:'supplier-new',aliases:['新別名'],safety_quantity:0,note:'新的主檔備註',is_active:false,updated_at:'new-version'};
const latestSupplier={id:'p',name:'同事確認的廠商',supplier_code:'SUP',contact_name:'新聯絡人',phone:'0222222222',delivery_note:'星期三到貨',is_active:false,updated_at:'new-version'};

test('catalog and supplier conflict recovery loads the whole latest record before another save',async()=>{
 for(const product of [true,false]){
  const scope=recoveryScope();scope.product=product;
  scope.workspace={refresh:async()=>({products:[latestProduct],suppliers:[latestSupplier]})};
  actualHandler('catalog-workspace.tsx','CatalogWorkspace','openProduct',scope);
  actualHandler('catalog-workspace.tsx','CatalogWorkspace','openSupplier',scope);
  await actualHandler('catalog-workspace.tsx','CatalogWorkspace','reloadDraft',scope)();
  assert.equal(scope.draft.updated_at,'new-version');assert.equal(scope.error,'');assert.equal(scope.busy,false);
  if(product){assert.equal(scope.draft.name,latestProduct.name);assert.equal(scope.draft.unit,'袋');assert.equal(scope.draft.supplier_id,'supplier-new');assert.equal(scope.draft.safety_quantity,'0');}
  else {assert.equal(scope.draft.name,latestSupplier.name);assert.equal(scope.draft.phone,latestSupplier.phone);assert.equal(scope.draft.delivery_note,latestSupplier.delivery_note);}
  await actualHandler('catalog-workspace.tsx','CatalogWorkspace','save',scope)();
  assert.equal(scope.calls[0].data.updated_at,'new-version');assert.equal(scope.calls[0].data.name,product?latestProduct.name:latestSupplier.name);
 }
});

test('failed or superseded catalog recovery leaves unsaved input intact',async()=>{
 for(const reason of ['failed','different-item','unmounted']){
  const scope=recoveryScope();scope.product=true;const original=scope.draft;let finish;
  scope.workspace={refresh:()=>new Promise(resolve=>{finish=resolve;})};scope.openProduct=()=>assert.fail('must not replace another draft');scope.openSupplier=scope.openProduct;
  const pending=actualHandler('catalog-workspace.tsx','CatalogWorkspace','reloadDraft',scope)();
  if(reason==='different-item')scope.recoveryIdentity.current='other-store:edit:other';
  if(reason==='unmounted')scope.recoverySequence.current++;
  finish(reason==='failed'?undefined:{products:[latestProduct]});await pending;
  assert.equal(scope.draft,original);assert.equal(scope.error,'REVISION_CONFLICT');
 }
});

test('a removed catalog record returns to the list without creating an empty edit form',async()=>{
 const scope=recoveryScope();scope.product=true;scope.workspace={refresh:async()=>({products:[]})};
 scope.openProduct=()=>assert.fail('missing record cannot reopen');scope.openSupplier=scope.openProduct;
 await actualHandler('catalog-workspace.tsx','CatalogWorkspace','reloadDraft',scope)();
 assert.equal(scope.page,'list');assert.equal(scope.draft.id,'');assert.equal(scope.calls.length,0);
});

test('mapping recovery replaces the selected source and unsaved mapping before the next save',async()=>{
 const scope=recoveryScope();scope.selected={id:'line',name:'原辨識品項',unit:'箱',modified_at:'old-version'};scope.draft={product_id:'unsaved-product',factor:'24'};
 const latest={id:'line',batch_id:'batch',name:'同事已核對品項',quantity:0,unit:'包',product_id:'current-product',inventory_status:'MAPPING_PENDING',modified_at:'new-version'};
 scope.workspace={refresh:async()=>({lines:[latest]})};scope.setSelected=value=>{scope.selected=value;};scope.needsFactor=false;
 await actualHandler('product-mapping.tsx','ProductMapping','reloadSelected',scope)();
 assert.equal(scope.selected,latest);assert.equal(scope.draft.product_id,'current-product');assert.equal(scope.draft.factor,'');assert.equal(scope.error,'');assert.equal(scope.busy,false);
 await actualHandler('product-mapping.tsx','ProductMapping','save',scope)();
 assert.equal(scope.calls[0].action,'mapping.resolve');assert.equal(scope.calls[0].data.modified_at,'new-version');assert.equal(scope.calls[0].data.product_id,'current-product');assert.equal(scope.calls[0].data.factor,null);
});

test('a mapping no longer pending returns to the list and cannot be submitted from the closed editor',async()=>{
 const scope=recoveryScope();scope.selected={id:'line',modified_at:'old-version'};scope.setSelected=value=>{scope.selected=value;};scope.workspace={refresh:async()=>({lines:[]})};
 await actualHandler('product-mapping.tsx','ProductMapping','reloadSelected',scope)();
 assert.equal(scope.selected,undefined);assert.equal(scope.draft,scope.empty);assert.equal(scope.error,'');
 await actualHandler('product-mapping.tsx','ProductMapping','save',scope)();assert.equal(scope.calls.length,0);
});

test('failed, superseded or late mapping reloads preserve the current editor',async()=>{
 for(const reason of ['failed','different-item','unmounted','superseded']){
  const scope=recoveryScope();scope.selected={id:'line',modified_at:'old-version'};scope.draft={product_id:'unsaved-product',factor:'24'};
  const original=scope.selected;const originalDraft=scope.draft;let finish;
  scope.setSelected=value=>{scope.selected=value;};scope.workspace={refresh:()=>new Promise(resolve=>{finish=resolve;})};
  const pending=actualHandler('product-mapping.tsx','ProductMapping','reloadSelected',scope)();
  if(reason==='different-item')scope.recoveryIdentity.current='other-store:other-line';
  if(reason==='unmounted'||reason==='superseded')scope.recoverySequence.current++;
  finish(reason==='failed'?undefined:{lines:[{id:'line',modified_at:'new-version'}]});await pending;
  assert.equal(scope.selected,original);assert.equal(scope.draft,originalDraft);assert.equal(scope.error,'REVISION_CONFLICT');
 }
});

test('settings save keeps the draft revision until explicit reload replaces settings and revision together',async()=>{
 const scope=recoveryScope();scope.page='device';scope.business=false;scope.store={id:'store',business_type:'SINGLE_RESTAURANT'};
 scope.draft={remember_device:true,reauth_days:7,count_cadence:'MONTHLY'};scope.draftRevision=2;
 const latest={revision:3,settings:{remember_device:false,reauth_days:1,count_cadence:'MANUAL',erp_time:'18:30'}};
 scope.workspace={data:latest,refresh:async()=>latest};scope.onChanged=async()=>{};scope.setDraftRevision=value=>{scope.draftRevision=value;};scope.setDeviceTypes=()=>{};
 actualHandler('business-settings.tsx','BusinessSettings','open',scope);
 const save=actualHandler('business-settings.tsx','BusinessSettings','save',scope);
 await save();assert.equal(scope.calls[0].data.revision,2,'a list refresh cannot authorize a stale settings draft');
 await actualHandler('business-settings.tsx','BusinessSettings','reloadDraft',scope)();
 assert.equal(scope.draftRevision,3);assert.equal(scope.draft.remember_device,false);assert.equal(scope.draft.count_cadence,'MANUAL');assert.equal(scope.draft.erp_time,'18:30');
 await save();assert.equal(scope.calls[1].data.revision,3);assert.equal(scope.calls[1].data.settings.remember_device,false);
});

test('settings recovery handles removed stores and ignores a response for a different page',async()=>{
 for(const changedPage of [false,true]){
  const scope=recoveryScope();scope.page='store';scope.open=()=>assert.fail('do not create a settings draft for a missing store');let finish;
  scope.workspace={refresh:()=>new Promise(resolve=>{finish=resolve;})};
  const pending=actualHandler('business-settings.tsx','BusinessSettings','reloadDraft',scope)();
  if(changedPage)scope.recoveryIdentity.current='store:count-policy:';
  finish({stores:[]});await pending;
  assert.equal(scope.page,changedPage?'store':'home');assert.equal(scope.draft.id,changedPage?'p':undefined);
 }
});

test('workspace refresh returns data only from the current successful request',async()=>{
 const pending=[];const snapshots=[];
 const scope={storeId:'store',section:'catalog',filterJson:'{}',scope:'current',sequence:{current:0},useCallback:fn=>fn,
  setLoading:()=>{},setSnapshot:value=>snapshots.push(value),setFailure:()=>{},appError:error=>error.message,
  readWorkspace:()=>new Promise(resolve=>pending.push(resolve)),
 };
 const refresh=actualHandler('operation-hooks.ts','useWorkspace','refresh',scope);
 const old=refresh();const current=refresh();pending[1]({version:2});assert.equal((await current).version,2);
 pending[0]({version:1});assert.equal(await old,undefined);assert.equal(snapshots.length,1);assert.equal(snapshots[0].data.version,2);
 scope.readWorkspace=async()=>{throw Error('read failed');};assert.equal(await refresh(),undefined);
});

test('the settings inventory card opens the supplied count workspace route',()=>{
 const req=createRequire(import.meta.url);const source=readFileSync(new URL('../app/pilot/my-workspace.tsx',import.meta.url),'utf8');const exports={};
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(compiled,{exports,require:id=>id==='react/jsx-runtime'?req(id):id==='lucide-react'?new Proxy({},{get:()=>()=>null}):{canExportData:()=>false,canManageMembers:()=>false,canManageStores:()=>false,canViewReports:()=>false}});
 let countCalls=0;const tree=exports.default({store:{role:'LOGISTICS',business_type:'SINGLE_RESTAURANT'},onCountSettings:()=>countCalls++,onNavigate:()=>assert.fail('must not route to master catalogue'),onSignOut(){}});
 const nodes=[];const visit=node=>{if(Array.isArray(node)){node.forEach(visit);return;}if(!node||typeof node!=='object')return;nodes.push(node);visit(node.props?.children);};visit(tree);
 const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):typeof node==='string'?node:'';
 const card=nodes.find(node=>node.type==='button'&&text(node).includes('品項與盤點資料'));assert.ok(card);card.props.onClick();assert.equal(countCalls,1);
});
