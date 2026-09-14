'use client';
/* eslint-disable @next/next/no-img-element -- QR is generated locally; no external image or scoring service. */
import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import {staffInvitationUrl} from '@/lib/staff-invitation';
export default function StaffInvitationCard({token,days=7}:{token:string;days?:number}) {
 const[url,setUrl]=useState('');const[qr,setQr]=useState('');const[message,setMessage]=useState('');
 useEffect(()=>{let active=true;const link=staffInvitationUrl(token,window.location.origin,window.location.pathname==='/demo');
  // Effect derives browser-only link and local QR after mounting.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setUrl(link);void QRCode.toDataURL(link,{width:240,margin:2,errorCorrectionLevel:'M'}).then(value=>{if(active)setQr(value);});return()=>{active=false;};
 },[token]);
 return <section className="staff-invitation-card"><h3>邀請員工設定 PIN</h3><p>本人開啟邀請，設定自己的六位數 PIN 後即可進入首頁。{days} 天內有效，只能啟用一次。</p>
 {qr&&<img src={qr} width={240} height={240} alt="員工首次啟用邀請 QR Code"/>}
 <button type="button" className="shell-secondary full" onClick={async()=>{try{await navigator.clipboard.writeText(url);setMessage('邀請連結已複製。');}catch{setMessage('請長按下方連結複製。');}}}>複製邀請連結</button>
 <a className="text-button" href={url} target="_blank" rel="noopener noreferrer">開啟邀請</a>{message&&<p role="status">{message}</p>}</section>;
}
