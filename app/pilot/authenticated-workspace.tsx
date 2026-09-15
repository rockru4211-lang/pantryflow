"use client";
import {useRef,useState,type ReactNode} from 'react';
import type {Session} from '@supabase/supabase-js';
import {WorkspaceMemory,RememberPosition} from './workspace-memory';
import StoreArchive,{ArchivedStoreLinks} from './store-archive';
import StockWorkspace from './stock-workspace';
import CountWorkspace from "./count-workspace";
import ReceivingWorkspace from "./receiving-workspace";
import ExpiryWasteWorkspace, { ExpiryWasteActivity, type ExpiryWastePage } from "./expiry-waste-workspace";
import WorkFeed from "./work-feed";
import type {WorkEntry} from "@/lib/workflow-rules";
import RoleHome, {OtherWorkspace,ShortagesWorkspace,viewTitles} from './role-home';
import TransfersWorkspace from './transfers-workspace';
import RecordsWorkspace, {type RecordSection} from './records-workspace';
import CatalogWorkspace from './catalog-workspace';
import ReportsWorkspace from './reports-workspace';
import BusinessSettings from './business-settings';
import MembersWorkspace from './members-workspace';
import MyWorkspace from './my-workspace';
import ChangePasswordForm from "./change-password-form";
import {canManageStores,canManageMembers,type AppStore} from "@/lib/app-workspace";
import {AuthShell,FormalAppShell,type ShellRole,type ShellView} from "./app-shell";

type Props={session:Pick<Session,'user'>;profile:{display_name:string|null;role:string|null};stores:AppStore[];selectedStoreId:string;versionPanel:ReactNode;onStoreChange:(id:string)=>Promise<void>;onChanged:()=>Promise<void>;onSignOut:()=>Promise<void>;onChangePassword?:(current:string,next:string)=>Promise<string|null>;demo?:boolean;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
export default function AuthenticatedWorkspace(props:Props){return <WorkspaceMemory scope={`${props.session.user.id}:${props.selectedStoreId}`}><WorkspaceContent {...props}/></WorkspaceMemory>;}
function WorkspaceContent({session,profile,stores,selectedStoreId,versionPanel,onStoreChange,onChanged,onSignOut,onChangePassword,demo=false,registerLeave}:Props){
  const [countStartPage, setCountStartPage] = useState<"overview" | "import" | "setup" | "management" | "start" | "details">("overview");
  const [switching,setSwitching]=useState(false);const switchLock=useRef(false);
  const [businessEntry,setBusinessEntry]=useState<'home'|'store-home'>('home');
  const [view, setView] = useState<ShellView>("home");
  const [origins,setOrigins]=useState<Partial<Record<ShellView,ShellView>>>({});
  const [navRoot,setNavRoot]=useState<ShellView>("home");
  const backTo=(fallback:ShellView="home")=>setView(origins[view]||fallback);
  const leaveCount = useRef<(() => Promise<boolean>) | null>(null);
  const [archiveId,setArchiveId]=useState<string>();
  const [transferId,setTransferId]=useState<string>();
  const [targetMonth,setTargetMonth]=useState<string>();
  const [expiryId,setExpiryId]=useState<string>();
  const [catalogId,setCatalogId]=useState<string>();
  const [stockId,setStockId]=useState<string>();
  const [recordId,setRecordId]=useState<string>();
  const [recordWithinPage,setRecordWithinPage]=useState(false);
  const [recordReturn,setRecordReturn]=useState<ShellView>("home");
  const [transferReturn,setTransferReturn]=useState<ShellView>("home");
  const [countReturnView,setCountReturnView]=useState<ShellView>("home");
  const [receiptStartPage,setReceiptStartPage]=useState<"list"|"status"|"company-tasks">("list");
  const [receiptBatchId,setReceiptBatchId]=useState<string>();
  const [receiptReturnView,setReceiptReturnView]=useState<ShellView>("home");
  const [expiryStartPage,setExpiryStartPage]=useState<ExpiryWastePage>("expiry");
  const [expiryReturnView,setExpiryReturnView]=useState<ShellView>("home");
  async function openExpiry(page:ExpiryWastePage,from:ShellView=view,id?:string,month?:string){setExpiryId(id);setTargetMonth(month);if(leaveCount.current&&!await leaveCount.current())return;setExpiryStartPage(page);setExpiryReturnView(from);setView(page.startsWith("waste")||page==="history"?"waste":"expiry");}
  const [historicSession,setHistoricSession]=useState<string>();
  const selectedStore = stores.find(store => store.id === selectedStoreId);
  if(!selectedStore) return <AuthShell><p className="pilot-message" role="alert">目前沒有可使用的門市，請重新登入或洽商家管理者。</p><button className="text-button" onClick={()=>void onSignOut()}>返回登入</button></AuthShell>;
  const role: ShellRole = selectedStore.role;
  const canChangePassword = !demo && role !== 'STAFF' && profile.role !== 'STAFF' && !session.user.email?.endsWith('@auth.pantryflow.invalid') && !!onChangePassword;
  const currentBusinessType=selectedStore.business_type;
  const openCount = (page: "overview" | "import" | "setup" | "management" | "start" | "details",id?:string) => { if(view!=="count")setCountReturnView(view);setHistoricSession(id);setCountStartPage(page);setView("count"); };
  const openReceipt=(id?:string)=>{setReceiptReturnView(view);setReceiptBatchId(id);setReceiptStartPage(id?"status":"list");setView("receiving");};
  const navigate=async(next:ShellView)=>{
    if(next!==view)setOrigins(o=>({...o,[next]:view}));
    setArchiveId(undefined);
    if(leaveCount.current&&!await leaveCount.current())return;
    if(['home','activity','tasks','notifications','settings'].includes(next))setNavRoot(next);
    if(next==='count'){openCount('overview');return;}
    if(next==='manual'){openCount('management');return;}
    if(next==='receiving'){openReceipt();return;}
    if(next==='transfers'){setTransferId(undefined);setTargetMonth(undefined);setTransferReturn(view);setView(next);return;}
    if(next==='expiry'||next==='waste'){await openExpiry(next);return;}
    if(next==='catalog')setCatalogId(undefined);
    if(next==='stock')setStockId(undefined);
    if(next==='business')setBusinessEntry('home');
    setRecordId(undefined);setRecordWithinPage(false);setRecordReturn(view);setView(next==='permissions'?'members':next);
  };
  const changeStore=async(id:string)=>{if(switchLock.current||id===selectedStoreId)return;if(leaveCount.current&&!await leaveCount.current())return;switchLock.current=true;setSwitching(true);setArchiveId(undefined);if(!['business','members','permissions','settings','preferences'].includes(view)){setView('home');setNavRoot('home');}setBusinessEntry('home');setHistoricSession(undefined);setReceiptBatchId(undefined);setRecordId(undefined);setExpiryStartPage('expiry');try{await onStoreChange(id);}finally{switchLock.current=false;setSwitching(false);}};
  const signOut=async()=>{if(leaveCount.current&&!await leaveCount.current())return;setView("home");await onSignOut();};
  const go=(next:ShellView)=>void navigate(next);
  const openWork=(row:WorkEntry,month:string)=>{
    if(row.target==='count'){openCount(row.page==='overview'?'overview':'details',row.id);return;}
    if(row.target==='receiving'){setReceiptReturnView(view);setReceiptBatchId(row.id);setReceiptStartPage(row.page==='company-tasks'?'company-tasks':'status');setView('receiving');return;}
    if(row.target==='expiry'||row.target==='waste'){void openExpiry(row.page as ExpiryWastePage,view,row.id,month);return;}
    if(row.target==='transfers'){setTransferId(row.id);setTargetMonth(month);setTransferReturn(view);setView('transfers');return;}
    if(row.target==='stock'){setStockId(row.id);setOrigins(o=>({...o,stock:view}));setRecordReturn(view);setView('stock');return;}
    setRecordId(row.id);setRecordWithinPage(row.target===view);if(row.target!==view)setRecordReturn(view);setView(row.target as ShellView);
  };
  const activity=(mode:'activity'|'tasks'|'notifications')=><>{mode==='activity'&&<ArchivedStoreLinks store={selectedStore} onOpen={setArchiveId}/>}<WorkFeed store={selectedStore} mode={mode} handover={view==='handover'} onOpen={openWork}/></>;
  const workspace=()=>{
    if(archiveId)return <StoreArchive key={archiveId} storeId={archiveId} baseStore={selectedStore} userId={session.user.id} onBack={()=>setArchiveId(undefined)}/>;
    if(selectedStore.is_active===false&&view!=='business')return <><p className="shell-note">目前門市已停用，僅可查看歷史紀錄。</p>{canManageStores(selectedStore)&&<button className="shell-secondary" onClick={()=>go('business')}>門市設定與恢復</button>}<StoreArchive storeId={selectedStoreId} baseStore={selectedStore} userId={session.user.id} onBack={()=>setView('business')}/></>;
    if(view==='stock')return <StockWorkspace key={selectedStoreId} initialPositionId={stockId} storeId={selectedStoreId} userId={session.user.id} canManage={role!=='STAFF'} canOperate={['STAFF','SUPERVISOR'].includes(role)} onBack={()=>setView(recordReturn)}/>;
    if(view==='home')return <RoleHome key={`${session.user.id}:${selectedStoreId}`} store={selectedStore} stores={stores} onNavigate={go} onStore={id=>void changeStore(id)} versionPanel={versionPanel}/>;
    if(view==='other')return <OtherWorkspace store={selectedStore} onNavigate={go} onBack={()=>setView('home')}/>;
    if(view==='shortages')return <ShortagesWorkspace onProduct={['OWNER','LOGISTICS'].includes(role)&&currentBusinessType==='SINGLE_RESTAURANT'?id=>{setOrigins(o=>({...o,catalog:view}));setCatalogId(id);setView('catalog');}:undefined} store={selectedStore} onNavigate={go} onBack={()=>setView('home')}/>;
    if(view==='transfers')return <TransfersWorkspace initialId={transferId} initialMonth={targetMonth} key={`${session.user.id}:${selectedStoreId}`} store={selectedStore} userId={session.user.id} returnLabel={`返回${viewTitles[transferReturn]||'首頁'}`} onBack={()=>setView(transferReturn)}/>;
    if(['incidents','handover','bulletins','company-tasks'].includes(view))return <>
      {view==='company-tasks'&&<><ReceivingWorkspace embedded key={selectedStoreId} userId={session.user.id} storeId={selectedStoreId} organizationId={selectedStore.organization_id} role={role} businessType={currentBusinessType} initialPage="company-tasks" onBack={()=>setView(recordReturn)} onOpenReceipt={id=>{setReceiptReturnView('company-tasks');setReceiptBatchId(id);setReceiptStartPage('status');setView('receiving');}}/><ExpiryWasteActivity storeId={selectedStoreId} mode="tasks" onOpen={page=>openExpiry(page)}/></>}
      <RecordsWorkspace key={`${session.user.id}:${selectedStoreId}:${view}`} store={selectedStore} userId={session.user.id} section={view as RecordSection} pendingWork={view==='handover'?activity('tasks'):undefined} initialId={recordId} returnLabel={`返回${viewTitles[recordId&&recordWithinPage?view:recordReturn]||'首頁'}`} onBack={()=>{setRecordId(undefined);if(!recordId||!recordWithinPage)setView(recordReturn);setRecordWithinPage(false);}}/>
    </>;
    if(view==='catalog'||view==='suppliers')return <CatalogWorkspace returnLabel={`返回${viewTitles[origins[view]||"home"]||"上一頁"}`} initialProductId={catalogId} key={`${selectedStoreId}:${view}`} store={selectedStore} userId={session.user.id} section={view} onBack={()=>backTo()} onImport={()=>openCount('import')} onReceiving={()=>openReceipt()} onReceipt={openReceipt}/>;
    if(view==='reports'||view==='exports'||view==='costs'||view==='audit')return <ReportsWorkspace returnLabel={`返回${viewTitles[origins[view]||"home"]||"上一頁"}`} key={`${selectedStoreId}:${view}`} userId={session.user.id} store={selectedStore} section={view} onBack={()=>backTo()} onCount={id=>openCount('details',id)} onReceipt={openReceipt} onNavigate={go}/>;
    if(view==='business'&&!canManageStores(selectedStore))return <p role="alert">目前身分沒有此門市的設定權限。</p>;
    if((view==='members'||view==='permissions')&&!canManageMembers(selectedStore))return <p role="alert">目前身分沒有此門市的人員管理權限。</p>;
    if(view==='business'||view==='preferences')return <BusinessSettings returnLabel={`返回${viewTitles[origins[view]||"settings"]||"上一頁"}`} key={`${selectedStoreId}:${view}:${businessEntry}`} store={selectedStore} userId={session.user.id} section={view} stores={stores.filter(canManageStores)} initialPage={view==='business'?businessEntry:'home'} onManageStore={async id=>{await changeStore(id);setBusinessEntry('store-home');}} onBack={()=>backTo('settings')} onNavigate={go} onChanged={onChanged} accountContent={<>{canChangePassword&&<ChangePasswordForm onChangePassword={onChangePassword!}/>}<p className="my-account-identity">{profile.display_name || '目前帳號'} · {selectedStore.name}（{selectedStore.store_code}）</p>{versionPanel}</>}/>;
    if(view==='members'||view==='permissions')return <MembersWorkspace returnLabel={`返回${viewTitles[origins[view]||"settings"]||"上一頁"}`} key={`${selectedStoreId}:${view}`} store={selectedStore} userId={session.user.id} section={view} onBack={()=>backTo('settings')} onChanged={onChanged}/>;
    if(view==='expiry'||view==='waste')return <ExpiryWasteWorkspace initialRecordId={expiryId} initialMonth={targetMonth} key={`${selectedStoreId}:${expiryStartPage}`} storeId={selectedStoreId} initialPage={expiryStartPage} returnLabel={expiryReturnView==='home'?'返回首頁':`返回${viewTitles[expiryReturnView]||'上一頁'}`} onBack={()=>setView(expiryReturnView)}/>;
    if(view==='receiving')return <ReceivingWorkspace userId={session.user.id} key={`${selectedStoreId}:${receiptBatchId||'list'}`} storeId={selectedStoreId} organizationId={selectedStore.organization_id} role={role} businessType={currentBusinessType} initialBatchId={receiptBatchId} initialPage={receiptStartPage} returnLabel={receiptReturnView==='home'?'返回首頁':`返回${viewTitles[receiptReturnView]||'上一頁'}`} onBack={()=>setView(receiptReturnView)}/>;
    if(view==='activity'||view==='tasks'||view==='notifications')return activity(view);
    if(view==='settings')return <MyWorkspace store={selectedStore} canChangePassword={canChangePassword} demo={demo} onNavigate={go} onCountSettings={()=>openCount('management')} onSignOut={()=>void signOut()}/>;
    return <CountWorkspace key={`${selectedStoreId}:${historicSession||'current'}`} stores={[selectedStore]} organizationId={selectedStore.organization_id} session={session} initialPage={countStartPage} initialSessionId={historicSession} returnLabel={`返回${viewTitles[countReturnView]||'首頁'}`} onBack={()=>setView(countReturnView)} canViewFullDetails={role!=='STAFF'} canManage={role==='SUPERVISOR'||role==='OWNER'} canImport={role==='SUPERVISOR'||role==='OWNER'||(role==='LOGISTICS'&&currentBusinessType==='SINGLE_RESTAURANT')} businessType={currentBusinessType} registerLeave={handler=>{leaveCount.current=handler;registerLeave?.(handler);}}/>;
  };
  return <FormalAppShell role={role} businessType={currentBusinessType} storeName={selectedStore.name} stores={view==='business'?stores.filter(canManageStores):view==='members'||view==='permissions'?stores.filter(canManageMembers):stores} storeId={selectedStoreId} onStoreChange={id=>void changeStore(id)} view={view} activeView={navRoot} onNavigate={go}>{switching?<p role="status">正在切換門市…</p>:<RememberPosition key={`${selectedStoreId}:${view}`} name={view}>{workspace()}</RememberPosition>}</FormalAppShell>;
}
