'use client';

import {useEffect,useRef,useState} from 'react';
import {appError} from '@/lib/app-workspace';
import {supabase} from '@/lib/supabase-browser';

type LoginDevice={id:string;current:boolean;label:string;device_type:string|null;created_at:string;last_seen_at:string};

export default function LoginDevices({demo}:{demo:boolean}){
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
