"use client";
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {displayTime} from './inventory-catalog';
export default function CountHistory({storeId,onOpen,notifications=false,management=false}:{storeId:string;onOpen:(id:string)=>void;notifications?:boolean;management?:boolean}){
 const [rows,setRows]=useState<{id:string;status:string;started_at:string;completed_at:string|null}[]>([]);const [message,setMessage]=useState('正在讀取…');
 useEffect(()=>{let active=true;void supabase.from('inventory_count_sessions').select('id,status,started_at,completed_at').eq('store_id',storeId).order('started_at',{ascending:false}).then(({data,error})=>{if(active){setRows(data||[]);setMessage(error?'紀錄讀取失敗，請重新進入。':'');}});return()=>{active=false;};},[storeId]);
 return <><h2>{notifications?'盤點進度':'盤點紀錄'}</h2>{notifications&&<p>本門市盤點進度</p>}<div className="shell-card shell-list">{rows.map(row=><button className="shell-list-row" key={row.id} onClick={()=>onOpen(row.id)}><span><strong>{notifications?(row.completed_at?'盤點已保存':'盤點已開始'):`${displayTime(row.started_at)} 盤點`}</strong><small>{notifications?`${displayTime(row.completed_at||row.started_at)}・`:''}{row.status==='REVIEWING'?(management?'待確認差異':'已保存'):row.status==='CLOSED'?'已完成':'進行中'}</small></span><b>›</b></button>)}</div>{!rows.length&&<p>{message||(notifications?'尚無盤點通知。':'尚無盤點紀錄。')}</p>}</>;
}
