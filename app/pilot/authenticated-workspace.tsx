"use client";
import {useRef,useState,type ReactNode} from 'react';
import type {Session} from '@supabase/supabase-js';
import CountWorkspace from "./count-workspace";
import ReceivingWorkspace, { ReceivingActivity } from "./receiving-workspace";
import ExpiryWasteWorkspace, { ExpiryWasteActivity, type ExpiryWastePage } from "./expiry-waste-workspace";
import CountHistory from "./count-history";
import RoleHome, {OtherWorkspace,ShortagesWorkspace,viewTitles} from './role-home';
import TransfersWorkspace from './transfers-workspace';
import RecordsWorkspace, {RecordsActivity,type RecordSection} from './records-workspace';
import CatalogWorkspace from './catalog-workspace';
import ReportsWorkspace from './reports-workspace';
import BusinessSettings from './business-settings';
import MembersWorkspace from './members-workspace';
import ChangePasswordForm from "./change-password-form";
import {canManageBusiness,canViewReports,canExportData,hasCrossStore,type AppStore} from "@/lib/app-workspace";
import {AuthShell,FormalAppShell,type ShellRole,type ShellView} from "./app-shell";

type Props={session:Pick<Session,'user'>;profile:{display_name:string|null;role:string|null};stores:AppStore[];selectedStoreId:string;versionPanel:ReactNode;onStoreChange:(id:string)=>Promise<void>;onChanged:()=>Promise<void>;onSignOut:()=>Promise<void>;onChangePassword?:(current:string,next:string)=>Promise<string|null>;demo?:boolean;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
export default function AuthenticatedWorkspace({session,profile,stores,selectedStoreId,versionPanel,onStoreChange,onChanged,onSignOut,onChangePassword,demo=false,registerLeave}:Props){
  const [countStartPage, setCountStartPage] = useState<"overview" | "import" | "setup" | "management" | "start" | "details">("overview");
  const [view, setView] = useState<ShellView>("home");
  const leaveCount = useRef<(() => Promise<boolean>) | null>(null);
  const [recordId,setRecordId]=useState<string>();
  const [recordReturn,setRecordReturn]=useState<ShellView>("home");
  const [transferReturn,setTransferReturn]=useState<ShellView>("home");
  const [countReturnView,setCountReturnView]=useState<ShellView>("home");
  const [receiptStartPage,setReceiptStartPage]=useState<"list"|"status"|"company-tasks">("list");
  const [receiptBatchId,setReceiptBatchId]=useState<string>();
  const [receiptReturnView,setReceiptReturnView]=useState<ShellView>("home");
  const [expiryStartPage,setExpiryStartPage]=useState<ExpiryWastePage>("expiry");
  const [expiryReturnView,setExpiryReturnView]=useState<ShellView>("home");
  async function openExpiry(page:ExpiryWastePage,from:ShellView=view){if(leaveCount.current&&!await leaveCount.current())return;setExpiryStartPage(page);setExpiryReturnView(from);setView(page.startsWith("waste")||page==="history"?"waste":"expiry");}
  const [historicSession,setHistoricSession]=useState<string>();
  const selectedStore = stores.find(store => store.id === selectedStoreId);
  if(!selectedStore) return <AuthShell><p className="pilot-message" role="alert">目前沒有可使用的門市，請重新登入或洽商家管理者。</p><button className="text-button" onClick={()=>void onSignOut()}>返回登入</button></AuthShell>;
  const role: ShellRole = selectedStore.role;
  const currentBusinessType=selectedStore.business_type;
  const openCount = (page: "overview" | "import" | "setup" | "management" | "start" | "details",id?:string) => { if(view!=="count")setCountReturnView(view);setHistoricSession(id);setCountStartPage(page);setView("count"); };
  const openReceipt=(id?:string)=>{setReceiptReturnView(view);setReceiptBatchId(id);setReceiptStartPage(id?"status":"list");setView("receiving");};
  const navigate=async(next:ShellView)=>{
    if(leaveCount.current&&!await leaveCount.current())return;
    if(next==='count'){openCount('overview');return;}
    if(next==='manual'){openCount('management');return;}
    if(next==='receiving'){openReceipt();return;}
    if(next==='transfers'){setTransferReturn(view);setView(next);return;}
    if(next==='expiry'||next==='waste'){await openExpiry(next);return;}
    setRecordId(undefined);setRecordReturn(view);setView(next);
  };
  const changeStore=async(id:string)=>{if(leaveCount.current&&!await leaveCount.current())return;setView("home");setHistoricSession(undefined);await onStoreChange(id);};
  const signOut=async()=>{if(leaveCount.current&&!await leaveCount.current())return;setView("home");await onSignOut();};
  const go=(next:ShellView)=>void navigate(next);
  const activity=(mode:'activity'|'tasks'|'notifications')=><>
    {view!=='handover'&&<h1>{mode==='activity'?'作業紀錄':mode==='tasks'?'待辦':'通知'}</h1>}
    <ExpiryWasteActivity key={`expiry:${selectedStoreId}:${mode}`} storeId={selectedStoreId} mode={mode} onOpen={page=>openExpiry(page)}/>
    <ReceivingActivity storeId={selectedStoreId} tasks={mode==='tasks'} notifications={mode==='notifications'} onOpen={(id,companyTask)=>{setReceiptReturnView(view==='handover'?'handover':mode);setReceiptBatchId(id);setReceiptStartPage(companyTask?'company-tasks':'status');setView('receiving');}}/>
    <CountHistory storeId={selectedStoreId} notifications={mode!=='activity'} management={role!=='STAFF'} onOpen={id=>openCount('details',id)}/>
    <RecordsActivity storeId={selectedStoreId} mode={mode} onOpen={(section,id)=>{setRecordId(id);setRecordReturn(view==='handover'?'handover':mode);setView(section);}}/>
    {hasCrossStore(selectedStore)&&<button className="shell-secondary full" onClick={()=>go('transfers')}>借貸與調撥{mode==='activity'?'紀錄':'待處理'}</button>}
  </>;
  const workspace=()=>{
    if(view==='home')return <RoleHome key={`${session.user.id}:${selectedStoreId}`} store={selectedStore} stores={stores} onNavigate={go} onStore={id=>void changeStore(id)} versionPanel={versionPanel}/>;
    if(view==='other')return <OtherWorkspace store={selectedStore} onNavigate={go} onBack={()=>setView('home')}/>;
    if(view==='shortages')return <ShortagesWorkspace store={selectedStore} onNavigate={go} onBack={()=>setView('home')}/>;
    if(view==='transfers')return <TransfersWorkspace key={`${session.user.id}:${selectedStoreId}`} store={selectedStore} userId={session.user.id} returnLabel={`返回${viewTitles[transferReturn]||'首頁'}`} onBack={()=>setView(transferReturn)}/>;
    if(['incidents','handover','bulletins','company-tasks'].includes(view))return <>
      {view==='company-tasks'&&<><ReceivingActivity storeId={selectedStoreId} tasks onOpen={(id)=>{setReceiptReturnView('company-tasks');setReceiptBatchId(id);setReceiptStartPage('company-tasks');setView('receiving');}}/><ExpiryWasteActivity storeId={selectedStoreId} mode="tasks" onOpen={page=>openExpiry(page)}/></>}
      <RecordsWorkspace key={`${session.user.id}:${selectedStoreId}:${view}`} store={selectedStore} userId={session.user.id} section={view as RecordSection} pendingWork={view==='handover'?activity('tasks'):undefined} initialId={recordId} returnLabel={`返回${viewTitles[recordReturn]||'首頁'}`} onBack={()=>{setRecordId(undefined);setView(recordReturn);}}/>
    </>;
    if(view==='catalog'||view==='suppliers')return <CatalogWorkspace key={`${selectedStoreId}:${view}`} store={selectedStore} userId={session.user.id} section={view} onBack={()=>setView('home')} onImport={()=>openCount('import')} onReceiving={()=>openReceipt()} onReceipt={openReceipt}/>;
    if(view==='reports'||view==='exports'||view==='costs'||view==='audit')return <ReportsWorkspace key={`${selectedStoreId}:${view}`} userId={session.user.id} store={selectedStore} section={view} onBack={()=>setView('home')} onCount={id=>openCount('details',id)} onReceipt={openReceipt} onNavigate={go}/>;
    if(view==='business'||view==='preferences')return <BusinessSettings key={`${selectedStoreId}:${view}`} store={selectedStore} userId={session.user.id} section={view} onBack={()=>setView('settings')} onNavigate={go} onChanged={onChanged}/>;
    if(view==='members'||view==='permissions')return <MembersWorkspace key={`${selectedStoreId}:${view}`} store={selectedStore} userId={session.user.id} section={view} onBack={()=>setView('settings')} onChanged={onChanged}/>;
    if(view==='expiry'||view==='waste')return <ExpiryWasteWorkspace key={`${selectedStoreId}:${expiryStartPage}`} storeId={selectedStoreId} initialPage={expiryStartPage} returnLabel={expiryReturnView==='home'?'返回首頁':`返回${viewTitles[expiryReturnView]||'上一頁'}`} onBack={()=>setView(expiryReturnView)}/>;
    if(view==='receiving')return <ReceivingWorkspace key={`${selectedStoreId}:${receiptBatchId||'list'}`} storeId={selectedStoreId} organizationId={selectedStore.organization_id} role={role} businessType={currentBusinessType} initialBatchId={receiptBatchId} initialPage={receiptStartPage} returnLabel={receiptReturnView==='home'?'返回首頁':`返回${viewTitles[receiptReturnView]||'上一頁'}`} onBack={()=>setView(receiptReturnView)}/>;
    if(view==='activity'||view==='tasks'||view==='notifications')return activity(view);
    if(view==='settings')return <><h1>我的</h1><p>{profile.display_name}</p><p>{selectedStore.name}（{selectedStore.store_code}）</p><div className="shell-card shell-list"><button className="shell-list-row" onClick={()=>go('preferences')}><span><strong>設定</strong></span><b>›</b></button>{(canManageBusiness(selectedStore)||role==='SUPERVISOR')&&<button className="shell-list-row" onClick={()=>go('members')}><span><strong>員工與權限</strong></span><b>›</b></button>}{canManageBusiness(selectedStore)&&<button className="shell-list-row" onClick={()=>go('business')}><span><strong>商家與門市設定</strong></span><b>›</b></button>}{canManageBusiness(selectedStore)&&<button className="shell-list-row" onClick={()=>go('permissions')}><span><strong>角色與權限</strong></span><b>›</b></button>}{canViewReports(selectedStore)&&<button className="shell-list-row" onClick={()=>go('reports')}><span><strong>報表中心</strong></span><b>›</b></button>}{canExportData(selectedStore)&&<button className="shell-list-row" onClick={()=>go('exports')}><span><strong>資料匯出</strong></span><b>›</b></button>}{role!=='STAFF'&&<button className="shell-list-row" onClick={()=>openCount('management')}><span><strong>盤點設定與資料</strong></span><b>›</b></button>}</div>{!demo&&role!=='STAFF'&&profile.role!=='STAFF'&&!session.user.email?.endsWith('@auth.pantryflow.invalid')&&<ChangePasswordForm onChangePassword={onChangePassword!}/>}<button className="text-button" onClick={signOut}>{demo?'離開體驗':'登出'}</button>{versionPanel}</>;
    return <CountWorkspace key={`${selectedStoreId}:${historicSession||'current'}`} stores={[selectedStore]} organizationId={selectedStore.organization_id} session={session} initialPage={countStartPage} initialSessionId={historicSession} returnLabel={`返回${viewTitles[countReturnView]||'首頁'}`} onBack={()=>setView(countReturnView)} canViewFullDetails={role!=='STAFF'} canManage={role==='SUPERVISOR'||role==='OWNER'} canImport={role==='SUPERVISOR'||role==='OWNER'||(role==='LOGISTICS'&&currentBusinessType==='SINGLE_RESTAURANT')} businessType={currentBusinessType} registerLeave={handler=>{leaveCount.current=handler;registerLeave?.(handler);}}/>;
  };
  return <FormalAppShell role={role} businessType={currentBusinessType} storeName={selectedStore.name} stores={stores} storeId={selectedStoreId} onStoreChange={id=>void changeStore(id)} view={view} onNavigate={go}>{workspace()}</FormalAppShell>;
}
