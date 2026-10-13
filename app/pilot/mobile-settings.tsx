'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Bell,ChevronRight,Smartphone,UserRound} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {appError,type AppStore} from '@/lib/app-workspace';
import {useNotificationPreferences} from './use-notification-preferences';
import type {ShellView} from './app-shell';
type LoginDevice={id:string;current:boolean;label:string;device_type:string|null;created_at:string;last_seen_at:string};
export default function MobileSettings({store,userId,displayName,demo,versionPanel,onNavigate,onSignOut}:{store:AppStore;userId:string;displayName:string;demo:boolean;versionPanel:ReactNode;onNavigate:(view:ShellView)=>void;onSignOut:()=>void}){
 const [page,setPage]=useState<'home'|'notifications'|'devices'|'help'>('home');
 const prefs=useNotificationPreferences(userId,store.id);
 return <div className="my-page mobile-settings">
  {page!=='home'&&<button className="shell-back" onClick={()=>setPage('home')}>‹ 返回設定</button>}
  <h1>{{home:'設定',notifications:'通知設定',devices:'登入裝置',help:'操作協助'}[page]}</h1>
  {page==='home'&&<>
   <section className="mobile-settings-person"><UserRound aria-hidden="true"/><div><strong>{displayName||'目前帳號'}</strong><small>目前登入人員</small></div></section>
   <div className="shell-card">
    <button className="my-menu-row" onClick={()=>setPage('notifications')}><Bell className="my-menu-icon" aria-hidden="true"/><span className="my-menu-copy"><strong>通知設定</strong><small>調整此裝置的通知顯示</small></span><ChevronRight className="my-chevron" aria-hidden="true"/></button>
    <button className="my-menu-row" onClick={()=>setPage('devices')}><Smartphone className="my-menu-icon" aria-hidden="true"/><span className="my-menu-copy"><strong>登入裝置</strong><small>查看自己的登入紀錄</small></span><ChevronRight className="my-chevron" aria-hidden="true"/></button>
   </div>
   <button className="my-sign-out" onClick={onSignOut}>{demo?'離開體驗':'登出此裝置'}</button>
   <footer className="mobile-settings-footer"><button className="text-button" onClick={()=>setPage('help')}>操作協助</button><p>百花猿整合系統</p>{versionPanel}</footer>
  </>}
  {page==='notifications'&&<>
   <p className="shell-note">設定只套用於此帳號、此門市在這台裝置的通知列表。</p>
   <div className="shell-card mobile-settings-options">
    <label className="checkbox-row"><span><strong>門市公告</strong><small>顯示門市發布的公告</small></span><input type="checkbox" checked={prefs.value.bulletins} disabled={!prefs.ready} onChange={e=>prefs.save({...prefs.value,bulletins:e.target.checked})}/></label>
    <label className="checkbox-row"><span><strong>作業完成通知</strong><small>盤點、調撥與廢棄等完成紀錄</small></span><input type="checkbox" checked={prefs.value.completed} disabled={!prefs.ready} onChange={e=>prefs.save({...prefs.value,completed:e.target.checked})}/></label>
   </div>
   {prefs.error&&<p role="alert">{prefs.error}</p>}
   <p className="shell-note">變更會自動儲存。待處理提醒仍會保留，完整紀錄可在「紀錄」查看。目前不發送手機推播。</p>
   <button className="shell-secondary full" onClick={()=>onNavigate('notifications')}>查看通知</button>
  </>}
  {page==='devices'&&<LoginDevices demo={demo}/>}
  {page==='help'&&<Help storeName={store.name}/>}
 </div>;
}
function LoginDevices({demo}:{demo:boolean}){
 const [rows,setRows]=useState<LoginDevice[]>(()=>demo?[{id:'demo',current:true,label:'體驗裝置',device_type:null,created_at:new Date().toISOString(),last_seen_at:new Date().toISOString()}]:[]);const[loaded,setLoaded]=useState(demo);const[error,setError]=useState('');const[notice,setNotice]=useState('');const[busy,setBusy]=useState(false);const[confirm,setConfirm]=useState(false);const[revision,setRevision]=useState(0);const lock=useRef(false);
 useEffect(()=>{let alive=true;if(demo)return;
  void (async()=>{try{const{data,error}=await supabase.rpc('get_my_login_devices');if(error)throw error;if(alive){setRows(data as unknown as LoginDevice[]);setLoaded(true);setError('');}}catch(e){if(alive)setError(appError(e));}})();return()=>{alive=false;};
 },[demo,revision]);
 const signOutOthers=async()=>{if(lock.current||demo)return;lock.current=true;setBusy(true);setError('');try{const{error}=await supabase.auth.signOut({scope:'others'});if(error)throw error;setConfirm(false);setNotice('已登出其他裝置，此裝置繼續使用。');setRows([]);setLoaded(false);setRevision(r=>r+1);}catch(e){setError(appError(e));}finally{lock.current=false;setBusy(false);}};
 return <><p className="shell-note">只顯示你自己的登入紀錄。最近使用時間不代表裝置目前在線。</p>{error&&<p role="alert">{error}<button className="text-button" disabled={busy} onClick={()=>{setError('');setLoaded(false);setRevision(r=>r+1);}}>重新讀取</button></p>}{notice&&<p role="status">{notice}</p>}{!loaded&&!error&&<p role="status">正在讀取…</p>}
 <div className="shell-card shell-list">{rows?.map(row=><section className="mobile-login-device" key={row.id}><strong>{row.label}{row.current?'（此裝置）':''}</strong><small>{row.device_type==='PERSONAL'?'個人裝置':row.device_type==='SHARED'?'共用裝置':'瀏覽器登入'}</small><small>最近使用 {new Date(row.last_seen_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}</small></section>)}</div>
 {loaded&&rows.length===0&&<p>目前沒有其他登入紀錄。</p>}
 {!!rows?.some(row=>!row.current)&&!demo&&(confirm?<section className="shell-card mobile-settings-confirm"><p>登出此帳號的所有其他裝置？其他裝置需重新登入，此裝置不受影響。</p><div className="shell-button-stack"><button className="shell-primary" disabled={busy} onClick={()=>void signOutOthers()}>{busy?'處理中…':'確認登出其他裝置'}</button><button className="shell-secondary" disabled={busy} onClick={()=>setConfirm(false)}>取消</button></div></section>:<button className="shell-secondary full" onClick={()=>setConfirm(true)}>登出其他裝置</button>)}
 <p className="shell-note">個人裝置授權與 PIN 重設請洽後勤。</p></>;
}
function Help({storeName}:{storeName:string}){
 const[notice,setNotice]=useState('');const[report,setReport]=useState('');
 const copyReport=async()=>{const text=`門市：${storeName}\n發生時間：${new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}\n操作功能：\n問題說明：\n請附上問題畫面截圖，交給後勤協助。`;try{await navigator.clipboard.writeText(text);setNotice('已複製問題回報格式，填寫後交給後勤。');}catch{setReport(text);setNotice('請複製下方格式，填寫後交給後勤。');}};
 return <><div className="shell-card mobile-settings-help">
  <details><summary>貨單上傳</summary><p>從首頁進入貨單上傳，拍照或選取檔案；確認上傳成功即可，後續核對由後勤處理。</p></details>
  <details><summary>盤點與缺少品項</summary><p>輸入實際數量；現場確實沒有庫存可選「本次無庫存」。尚未確認的品項保留未填，最後選「完成本次盤點」，確認後可略過未填。</p><p>不需盤點的品項可從「⋯」移出；缺少品項請洽後勤新增。</p></details>
  <details><summary>調撥與廢棄</summary><p>從首頁選擇作業，確認品項、數量與門市後送出；完成後可在「紀錄」查詢。</p></details>
  <details><summary>功能權限與 PIN</summary><p>食譜、供應商與抽盤等功能由後勤設定權限。食譜僅呈現已發布的主食譜流程。需要開通功能或重設 PIN，請洽後勤。</p></details>
 </div><section className="mobile-settings-report"><h2>問題回報</h2><p className="shell-note">提供門市、操作功能、發生時間及截圖，方便後勤查找問題。</p><button className="shell-secondary full" onClick={()=>void copyReport()}>複製回報格式</button>{notice&&<p role="status">{notice}</p>}{report&&<textarea aria-label="問題回報格式" readOnly value={report} rows={6}/>}</section></>;
}
