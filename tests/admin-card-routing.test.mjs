import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const compilerOptions={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React};
const compile=code=>ts.transpileModule(code,{compilerOptions,fileName:'actual-component.tsx'}).outputText;
function source(path){const text=readFileSync(new URL(path,import.meta.url),'utf8');return ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);}
const routing=source('../app/pilot/authenticated-workspace.tsx');
const shell=source('../app/pilot/app-shell.tsx');
const home=source('../app/pilot/role-home.tsx');
const policy=source('../lib/app-workspace.ts');
function actualFunction(ast,name,scope){
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 assert.ok(node,`Use the actual ${name} function`);
 runInNewContext(compile(node.getText(ast)),scope,{timeout:1000});
 return scope[name];
}
function initializer(ast,name){
 for(const node of ast.statements)if(ts.isVariableStatement(node)){
  const declaration=node.declarationList.declarations.find(d=>d.name.getText(ast)===name);
  if(declaration?.initializer)return declaration.initializer.getText(ast);
 }
 throw Error(`Missing actual initializer ${name}`);
}
const rolePolicies={exports:{}};
for(const name of ['isStoreReadOnly','hasCrossStore','canViewReports','canManageBusiness','roleLabel','appError'])actualFunction(policy,name,rolePolicies);
const titles=runInNewContext(compile(`(${initializer(home,'viewTitles')});`),{});
const makeStore=(overrides={})=>({id:'store-a',organization_id:'org-a',name:'測試店',store_code:'TEST',business_type:'SINGLE_RESTAURANT',store_mode:'SINGLE',linked_store_count:1,role:'LOGISTICS',settings:{},...overrides});

function elements(tree,predicate){
 const found=[];
 function visit(node){
  if(Array.isArray(node)){node.forEach(visit);return;}
  if(!React.isValidElement(node))return;
  if(predicate(node))found.push(node);
  visit(node.props.children);
 }
 visit(tree);return found;
}
function label(node){if(node===null||node===undefined||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(label).join('');return React.isValidElement(node)?label(node.props.children):String(node);}
function button(tree,text){const result=elements(tree,n=>n.type==='button'&&label(n).includes(text));assert.equal(result.length,1,`One actual button named ${text}`);return result[0];}

// Run the entire real shell component with persistent hooks and inert children.
// Event handlers, routing branches, return callbacks and JSX props are not copied.
function workspaceHarness(store=makeStore(),otherStores=[],navigation={}){
 const hooks=[],writes=[];let cursor=0,tree;
 const props={session:{user:{id:'user',email:'qa@example.test'}},profile:{role:store.role},stores:[store,...otherStores],selectedStoreId:store.id,versionPanel:null,onStoreChange:async()=>{},onChanged:async()=>{},onSignOut:async()=>{}};
 const scope={React,exports:{},...rolePolicies,viewTitles:titles,
  canManageStores:s=>!!s.can_manage_stores,canManageMembers:s=>!!s.can_manage_members,
  useState(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{hooks[index].value=typeof next==='function'?next(hooks[index].value):next;writes.push(index);}];},
 useRef(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:{current:initial}};return hooks[index].value;},
 };
 scope.useNavigationState=(key,initial)=>scope.useState(Object.hasOwn(navigation,key)?navigation[key]:initial);
 for(const name of ['AuthShell','FormalAppShell','RememberPosition','StoreArchive','StockWorkspace','RoleHome','OtherWorkspace','ShortagesWorkspace','TransfersWorkspace','ReceivingWorkspace','ExpiryWasteActivity','RecordsWorkspace','CatalogWorkspace','ReportsWorkspace','BusinessSettings','ChangePasswordForm','MembersWorkspace','ExpiryWasteWorkspace','MyWorkspace','CountWorkspace','InventoryMonthlyWorkspace','ArchivedStoreLinks','WorkFeed','PartnersStoresWorkspace','ReadOnlyStoreWorkspace','SpotCheckWorkspace'])scope[name]=name;
 const component=actualFunction(routing,'WorkspaceContent',scope);
 const render=()=>{cursor=0;tree=component(props);return tree;};
 const find=name=>{const result=elements(tree,n=>n.type===name);assert.equal(result.length,1,`One actual ${name} route`);return result[0];};
 const invoke=async(fn,...args)=>{await fn(...args);for(let i=0;i<3;i++)await Promise.resolve();return render();};
 render();
 return {render,find,invoke,writes,props,get tree(){return tree;},navigate:next=>invoke(find('FormalAppShell').props.onNavigate,next)};
}
function countRoute(h){
 const direct=elements(h.tree,node=>node.type==='CountWorkspace');
 if(direct.length)return direct[0];
 const monthly=h.find('InventoryMonthlyWorkspace');
 return monthly.props.renderSpotCount(monthly.props.registerLeave,()=>{});
}

test('administrative same-view entries retain their original return target and reset receipt/history entries',async()=>{
 for(const [view,component] of [['receiving','ReceivingWorkspace'],['transfers','TransfersWorkspace'],['waste','ExpiryWasteWorkspace'],['catalog','CatalogWorkspace'],['reports','ReportsWorkspace']]){
  const h=workspaceHarness(makeStore({store_mode:'MULTI',linked_store_count:2}));
  await h.navigate(view);const first=h.find(component);
  await h.navigate(view);const repeated=h.find(component);
  assert.equal(repeated.props.returnLabel,'返回首頁',view);
  if(['receiving','transfers','waste','reports'].includes(view))assert.notEqual(first.key,repeated.key,`${view}: explicit entry remounts`);
  if(view==='receiving'){assert.equal(repeated.props.initialPage,'list');assert.equal(repeated.props.initialBatchId,undefined);}
  if(view==='transfers')assert.equal(repeated.props.initialPage,'home');
  if(view==='waste')assert.equal(repeated.props.initialPage,'history');
  if(view==='reports')assert.equal(repeated.props.initialPage,'home');
  await h.invoke(repeated.props.onBack);
  assert.equal(h.find('FormalAppShell').props.view,'home',view);
 }
});

test('explicit transfer entry overrides the remembered landing while a record ID still opens detail',()=>{
 const ast=source('../app/pilot/transfers-workspace.tsx');
 const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='TransfersWorkspace');
 const declaration=component.body.statements.filter(ts.isVariableStatement).flatMap(n=>Array.from(n.declarationList.declarations)).find(n=>ts.isArrayBindingPattern(n.name)&&n.name.elements[0]?.name?.getText(ast)==='page');
 assert.ok(declaration?.initializer);
 for(const [initialId,initialPage,landing,expected] of [[undefined,'home','monthly','home'],['movement-1','home','history','detail'],[undefined,undefined,'history','history']]){
  const result=runInNewContext(compile(`(${declaration.initializer.getText(ast)});`),{initialId,initialPage,landing,useState:value=>[value,()=>{}]});
  assert.equal(result[0],expected);
 }
});

test('blocked count saves do not change any navigation state, including expiry IDs and return origins',async()=>{
 for(const role of ['STAFF','SUPERVISOR','LOGISTICS','OWNER'])for(const next of ['home','receiving','transfers','expiry','waste','reports','settings']){
  const h=workspaceHarness(makeStore({role}));await h.navigate('count');
  countRoute(h).props.registerLeave(async()=>false);
  const before=h.writes.length;
  await h.navigate(next);
  assert.equal(h.writes.length,before,`${role} → ${next} cannot mutate route state after a failed save`);
  assert.equal(h.find('FormalAppShell').props.view,['LOGISTICS','OWNER'].includes(role)?'inventory-monthly':'count');
 }
});

test('home count and urgency cards invoke their explicit destinations, while normal expiry keeps its landing page',async()=>{
 const h=workspaceHarness(makeStore({role:'OWNER'}));
 const props=h.find('RoleHome').props;
 const d={receipt_pending:2,expiry_urgent:3,incidents:1,count_completed:4,receipt_erp_pending:0,bulletins:[],month_receipt_amount:null,month_waste_amount:null};
 const scope={React,exports:{},icons:{},viewTitles:titles,localMonth:()=> '2026-09',useWorkFeed:()=>({}),useDashboard:()=>({data:{'store-a':d}}),useState:value=>[value,()=>{}],useEffect:()=>{},ClipboardList:()=>null,canManageMembers:s=>!!s.can_manage_members,...rolePolicies};
 const component=actualFunction(home,'RoleHome',scope);
 const tree=component(props);
 await h.invoke(button(tree,'盤點紀錄').props.onClick);
 assert.equal(h.find('ReportsWorkspace').props.initialPage,'counts');
 await h.navigate('home');
 const current=component(h.find('RoleHome').props);
 await h.invoke(button(current,'即期風險').props.onClick);
 assert.equal(h.find('ExpiryWasteWorkspace').props.initialPage,'urgent');
 assert.equal(h.find('ExpiryWasteWorkspace').props.returnLabel,'返回首頁');
 await h.navigate('expiry');
 assert.equal(h.find('ExpiryWasteWorkspace').props.initialPage,'expiry');
});

test('report count and receipt detail returns restore the report route without forcing its home page',async()=>{
 for(const detail of ['count','receipt']){
  const h=workspaceHarness();await h.invoke(h.find('RoleHome').props.onCountRecords);
  const report=h.find('ReportsWorkspace');
  await h.invoke(detail==='count'?report.props.onCount:report.props.onReceipt,`${detail}-saved`);
  const child=h.find(detail==='count'?'CountWorkspace':'ReceivingWorkspace');
  assert.equal(child.props.returnLabel,'返回報表中心');
  if(detail==='count'){assert.equal(child.props.initialPage,'details');assert.equal(child.props.initialSessionId,'count-saved');}
  else {assert.equal(child.props.initialPage,'status');assert.equal(child.props.initialBatchId,'receipt-saved');}
  await h.invoke(child.props.onBack);
  assert.equal(h.find('ReportsWorkspace').props.initialPage,undefined,'The persisted report page/month/search remain authoritative on return');
  await h.navigate('reports');
  assert.equal(h.find('ReportsWorkspace').props.initialPage,'home','Explicit sidebar entry resets the report landing page');
 }
});

test('report waste history retains the requested month and ordinary administrative waste entries clear it',async()=>{
 const h=workspaceHarness();await h.navigate('costs');
 await h.invoke(h.find('ReportsWorkspace').props.onWasteHistory,'2026-08');
 const detail=h.find('ExpiryWasteWorkspace');
 assert.equal(detail.props.initialPage,'history');assert.equal(detail.props.initialMonth,'2026-08');assert.equal(detail.props.returnLabel,'返回成本分析');
 await h.invoke(detail.props.onBack);assert.equal(h.find('ReportsWorkspace').props.section,'costs');assert.equal(h.find('ReportsWorkspace').props.initialPage,undefined);
 await h.navigate('waste');assert.equal(h.find('ExpiryWasteWorkspace').props.initialMonth,undefined);
 for(const [role,expected] of [['STAFF','waste'],['SUPERVISOR','waste'],['LOGISTICS','history'],['OWNER','history']]){
  const user=workspaceHarness(makeStore({role}));await user.navigate('waste');assert.equal(user.find('ExpiryWasteWorkspace').props.initialPage,expected,role);
 }
});

test('explicit expiry and waste entries leave an archived-store view after the save guard permits navigation',async()=>{
 for(const next of ['expiry','waste']){
  const h=workspaceHarness();await h.navigate('activity');
  await h.invoke(h.find('ArchivedStoreLinks').props.onOpen,'archived-store');
  assert.equal(h.find('StoreArchive').props.storeId,'archived-store');
  await h.navigate(next);
  assert.equal(h.find('ExpiryWasteWorkspace').props.storeId,'store-a',next);
 }
});

function renderAdminShell(props){
 const scope={React,exports:{},roleLabel:rolePolicies.roleLabel};
 scope.roleMeta=runInNewContext(compile(`(${initializer(shell,'roleMeta')});`),{});
 for(const name of ['Bell','CalendarClock','Trash2','Truck','ClipboardList','Home','ListChecks','UserRound','Package','ChartNoAxesCombined','ArrowLeftRight','Warehouse','DaisyLogo','Tags','UtensilsCrossed','Users','ShoppingCart'])scope[name]=()=>null;
 actualFunction(shell,'navIcon',scope);actualFunction(shell,'adminNavIcon',scope);
 const component=actualFunction(shell,'FormalAppShell',scope);
 return component({...props,children:null});
}
test('actual 百花猿 desktop menu uses current-store capabilities and exposes receiving entries',()=>{
 const unrelated=makeStore({id:'store-b',organization_id:'org-b'});
 for(const [store,others,expected] of [[makeStore(),[unrelated],false],[makeStore({store_mode:'MULTI',linked_store_count:2}),[],true]]){
  const h=workspaceHarness(store,others);const actualProps=h.find('FormalAppShell').props;
  assert.equal(actualProps.crossStoreEnabled,expected);
  const tree=renderAdminShell(actualProps),html=renderToStaticMarkup(tree);
  assert.equal(html.includes('調撥建檔'),expected);
  assert.ok(html.includes('貨單管理'));assert.ok(html.includes('進貨明細'));
  assert.equal(elements(tree,n=>n.type==='button'&&label(n)==='調撥建檔').length,expected?1:0);
 }
 const denied=workspaceHarness(makeStore({permissions:{reports_view:false,data_export:false}}));
 const html=renderToStaticMarkup(renderAdminShell(denied.find('FormalAppShell').props));
 assert.ok(!html.includes('報表分析'));assert.ok(!html.includes('成本分析'));
});

test('stock operations are restricted to field roles in both the direct and count-nested entry',async()=>{
 const count=source('../app/pilot/count-workspace.tsx');
 const component=count.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CountWorkspace');
 const stockReturn=component.body.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(count)==='stockOpen');
 assert.ok(stockReturn&&ts.isReturnStatement(stockReturn.thenStatement));
 for(const business_type of ['SINGLE_RESTAURANT','CHAIN_RESTAURANT'])for(const role of ['STAFF','SUPERVISOR','LOGISTICS','OWNER']){
  const h=workspaceHarness(makeStore({role,business_type}));await h.navigate('stock');const expected=['STAFF','SUPERVISOR'].includes(role);
  const canManage=['SUPERVISOR','OWNER'].includes(role)||(role==='LOGISTICS'&&business_type==='SINGLE_RESTAURANT');
  assert.equal(h.find('StockWorkspace').props.canOperate,expected,role);
  assert.equal(h.find('StockWorkspace').props.canManage,canManage,`${business_type} ${role}`);
  await h.navigate('count');
  if(!expected&&business_type==='SINGLE_RESTAURANT'){
   const monthly=h.find('InventoryMonthlyWorkspace');
   if(monthly.props.renderSpotCount){const spot=monthly.props.renderSpotCount(monthly.props.registerLeave,()=>{});assert.equal(spot.type,'SpotCheckWorkspace');assert.equal(spot.props.store.id,'store-a');}
   continue;
  }
  const props=countRoute(h).props;assert.equal(props.canOperateStock??false,expected);
  const scope={React,StockWorkspace:'StockWorkspace',storeId:'store-a',session:props.session,canImport:props.canImport,canManage:props.canManage,canOperateStock:props.canOperateStock,setStockOpen:()=>{}};
  const nested=runInNewContext(compile(`(${stockReturn.thenStatement.expression.getText(count)});`),scope);
  assert.equal(nested.props.canOperate,expected,role);
  assert.equal(nested.props.canManage,canManage,`${business_type} ${role}`);
 }
});


test('inventory management is administrative, preserves its entry across store switches and respects dirty review guard',async()=>{
 const h=workspaceHarness(makeStore(),[makeStore({id:'store-b'})]);await h.navigate('inventory-monthly');
 const monthly=h.find('InventoryMonthlyWorkspace');assert.equal(monthly.props.store.id,'store-a');
 monthly.props.registerLeave(async()=>false);await h.navigate('home');assert.equal(h.find('InventoryMonthlyWorkspace').props.store.id,'store-a');
 monthly.props.registerLeave(async()=>true);await h.invoke(h.find('FormalAppShell').props.onStoreChange,'store-b');await new Promise(resolve=>setImmediate(resolve));h.render();h.find('InventoryMonthlyWorkspace');
 for(const role of ['STAFF','SUPERVISOR']){const denied=workspaceHarness(makeStore({role}));await denied.navigate('inventory-monthly');assert.match(label(denied.tree),/沒有庫存管理權限/);}
});

const settleEvents=async()=>{for(let i=0;i<8;i++)await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));};
test('store switching stops before reading another store when the count save guard rejects',async()=>{
 const h=workspaceHarness(makeStore({role:'SUPERVISOR'}),[makeStore({id:'store-b'})]);
 await h.navigate('count');const original=h.find('CountWorkspace'),calls=[];
 original.props.registerLeave(async()=>false);
 h.props.onStoreChange=async id=>{calls.push(id);};h.render();
 h.find('FormalAppShell').props.onStoreChange('store-b');await settleEvents();h.render();
 assert.deepEqual(calls,[]);
 assert.equal(h.find('FormalAppShell').props.storeId,'store-a');
 assert.equal(h.find('CountWorkspace').key,original.key);
 assert.equal(h.find('FormalAppShell').props.switchingStore,false);
});

test('concurrent store clicks share one leave check and one switch request',async()=>{
 const h=workspaceHarness(makeStore({role:'SUPERVISOR'}),[makeStore({id:'store-b'})]);
 await h.navigate('count');let releaseGuard,releaseSwitch,guards=0;const calls=[];
 h.find('CountWorkspace').props.registerLeave(()=>{guards++;return new Promise(resolve=>{releaseGuard=resolve;});});
 h.props.onStoreChange=id=>{calls.push(id);return new Promise(resolve=>{releaseSwitch=resolve;});};h.render();
 const change=h.find('FormalAppShell').props.onStoreChange;
 change('store-b');change('store-b');await settleEvents();
 assert.equal(guards,1);assert.deepEqual(calls,[]);
 releaseGuard(true);await settleEvents();h.render();
 assert.deepEqual(calls,['store-b']);assert.equal(h.find('FormalAppShell').props.switchingStore,true);
 h.find('FormalAppShell').props.onStoreChange('store-b');await settleEvents();assert.equal(guards,1);
 releaseSwitch();await settleEvents();h.render();assert.equal(h.find('FormalAppShell').props.switchingStore,false);
});

test('failed switching retains the original keyed workspace while pending and after rejection',async()=>{
 const h=workspaceHarness(makeStore({role:'SUPERVISOR'}),[makeStore({id:'store-b'})]);
 await h.navigate('count');let rejectSwitch;
 h.find('CountWorkspace').props.registerLeave(async()=>true);
 const before=h.find('RememberPosition'),countBefore=h.find('CountWorkspace');
 h.props.onStoreChange=()=>new Promise((_resolve,reject)=>{rejectSwitch=reject;});h.render();
 h.find('FormalAppShell').props.onStoreChange('store-b');await settleEvents();h.render();
 assert.equal(h.find('RememberPosition').key,before.key);
 assert.equal(h.find('CountWorkspace').key,countBefore.key);
 assert.equal(elements(h.tree,node=>node.type==='div'&&node.props.inert===true).length,1);
 rejectSwitch(new Error('APP_FORBIDDEN'));await settleEvents();h.render();
 assert.equal(h.find('RememberPosition').key,before.key);
 assert.equal(h.find('CountWorkspace').key,countBefore.key);
 assert.equal(h.find('FormalAppShell').props.storeId,'store-a');
 assert.equal(elements(h.tree,node=>node.type==='div'&&node.props.inert===true).length,0);
 assert.equal(elements(h.tree,node=>node.props.role==='alert').length,1);
});

test('a failed target-store member request cannot open the old store member form',async()=>{
 const h=workspaceHarness(makeStore({can_manage_stores:true,can_manage_members:true}),[makeStore({id:'store-b',can_manage_stores:true,can_manage_members:true})]);
 await h.navigate('business');const calls=[];
 h.props.onStoreChange=async(id,navigation)=>{calls.push({id,navigation});throw Error('APP_FORBIDDEN');};h.render();
 await h.invoke(h.find('PartnersStoresWorkspace').props.onOpenPartners,'store-b',true);
 assert.equal(calls[0].id,'store-b');assert.equal(calls[0].navigation.memberStartPage,'new');
 assert.equal(h.find('PartnersStoresWorkspace').props.anchorStore.id,'store-a');
 assert.equal(elements(h.tree,node=>node.type==='MembersWorkspace').length,0);
 assert.equal(h.find('FormalAppShell').props.view,'business');
});

test('successful target navigation opens the requested member form in the newly mounted store scope',async()=>{
 const one=makeStore({can_manage_stores:true,can_manage_members:true});
 const two=makeStore({id:'store-b',can_manage_stores:true,can_manage_members:true});
 const h=workspaceHarness(one,[two]);await h.navigate('business');let destination;
 h.props.onStoreChange=async(id,navigation)=>{destination={id,navigation};};h.render();
 await h.invoke(h.find('PartnersStoresWorkspace').props.onOpenPartners,two.id,true);
 assert.equal(destination.id,two.id);
 const target=workspaceHarness(two,[one],destination.navigation);
 assert.equal(target.find('MembersWorkspace').props.store.id,two.id);
 assert.equal(target.find('MembersWorkspace').props.initialPage,'new');
 assert.equal(target.find('MembersWorkspace').props.returnLabel,'返回人員管理');
});

test('VIEW stores route through the read-only workspace even with a remembered write page and management flags',()=>{
 for(const view of ['home','count','members','business','receiving']){
  const store=makeStore({access_mode:'VIEW',can_manage_stores:true,can_manage_members:true});
  const h=workspaceHarness(store,[makeStore({id:'store-b',access_mode:'EDIT'})],{view});
  assert.equal(h.find('ReadOnlyStoreWorkspace').props.store.id,store.id);
  assert.equal(h.find('FormalAppShell').props.readOnly,true);
  assert.equal(elements(h.tree,node=>['CountWorkspace','MembersWorkspace','PartnersStoresWorkspace','ReceivingWorkspace','RoleHome'].includes(node.type)).length,0);
  const html=renderToStaticMarkup(renderAdminShell(h.find('FormalAppShell').props));
  assert.match(html,/僅查看/);assert.match(html,/門市資料/);
  assert.doesNotMatch(html,/admin-desktop-nav|新增夥伴|貨單收件箱/);
 }
});


test('百花猿 administrative home keeps personnel and inventory entries in the active store',async()=>{
 const h=workspaceHarness(makeStore({can_manage_members:true}));
 const scope={React,exports:{},icons:{},viewTitles:titles,...rolePolicies,
  localMonth:()=> '2026-09',useWorkFeed:()=>({rows:[]}),
  useDashboard:()=>({data:{'store-a':{receipt_pending:2,count_completed:4}}}),
  useState:value=>[value,()=>{}],useEffect:()=>{},canManageMembers:s=>!!s.can_manage_members};
 for(const name of ['Truck','ArrowLeftRight','Trash2','ClipboardList','UtensilsCrossed','Wrench','FileText','Warehouse'])scope[name]=()=>null;
 const component=actualFunction(home,'RoleHome',scope);
 await h.invoke(button(component(h.find('RoleHome').props),'人員管理').props.onClick);
 assert.equal(h.find('PartnersStoresWorkspace').props.anchorStore.id,'store-a');
 await h.navigate('home');
 await h.invoke(button(component(h.find('RoleHome').props),'庫存管理').props.onClick);
 assert.equal(h.find('InventoryMonthlyWorkspace').props.store.id,'store-a');
});
