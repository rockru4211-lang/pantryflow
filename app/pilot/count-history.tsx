"use client";
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {displayTime} from './inventory-catalog';
export default function CountHistory({storeId,onOpen}:{storeId:string;onOpen:(id:string)=>void}){
 const [rows,setRows]=useState<{id:string;status:string;started_at:string;completed_at:string|null}[]>([]);const [message,setMessage]=useState('正在讀取…');
 useEffect(()=>{let active=true;void supabase.from('inventory_count_sessions').select('id,status,started_at,completed_at').eq('store_id',storeId).order('started_at',{ascending:false}).then(({data,error})=>{if(active){setRows(data||[]);setMessage(error?'紀錄讀取失敗，請重新進入。':'');}});return()=>{active=false;};},[storeId]);
 return <><h1>作業紀錄</h1><div className="shell-card shell-list">{rows.map(row=><button className="shell-list-row" key={row.id} onClick={()=>onOpen(row.id)}><span><strong>{displayTime(row.started_at)} 盤點</strong><small>{row.status==='REVIEWING'?'已保存・待確認差異':row.status==='CLOSED'?'已完成':'進行中'}</small></span><b>›</b></button>)}</div>{!rows.length&&<p>{message||'尚無盤點紀錄。'}</p>}</>;
}
