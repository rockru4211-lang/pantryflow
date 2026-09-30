'use client';
/* eslint-disable @next/next/no-img-element -- QR is generated locally; no external image or scoring service. */
import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import {staffInvitationUrl} from '@/lib/staff-invitation';
export default function StaffInvitationCard({token,days=7,purpose='first',collapsed=false}:{token:string;days?:number;purpose?:'first'|'reset';collapsed?:boolean}) {
 const[expanded,setExpanded]=useState(!collapsed);
 const[url,setUrl]=useState('');const[qr,setQr]=useState('');const[message,setMessage]=useState('');
 useEffect(()=>{if(!expanded)return;let active=true;const link=staffInvitationUrl(token,window.location.origin,window.location.pathname==='/demo');
  // Effect derives browser-only link and local QR after mounting.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setUrl(link);void QRCode.toDataURL(link,{width:240,margin:2,errorCorrectionLevel:'M'}).then(value=>{if(active)setQr(value);});return()=>{active=false;};
 },[token,expanded]);
 if(!expanded)return <button type="button" className="shell-secondary full" onClick={()=>setExpanded(true)}>顯示設定連結與 QR Code</button>;
 return <section className="staff-invitation-card"><h3>{purpose==='reset'?'重新設定 PIN':'首次設定 PIN'}</h3><p>請交由本人設定六位數 PIN。連結 {days} 天內有效，只能使用一次。</p>
 {qr&&<img src={qr} width={180} height={180} alt="個人 PIN 設定 QR Code"/>}
 <button type="button" className="shell-secondary full" disabled={!url} onClick={async()=>{try{await navigator.clipboard.writeText(url);setMessage('設定連結已複製。');}catch{setMessage('請長按下方連結複製。');}}}>複製設定連結</button>
 <a className="text-button" href={url} target="_blank" rel="noopener noreferrer">開啟設定連結</a>{message&&<p role="status">{message}</p>}</section>;
}
