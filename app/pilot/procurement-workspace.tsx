"use client";

import {useEffect,useMemo,useState} from "react";
import {ClipboardList,Search} from "lucide-react";
import {supabase} from "@/lib/supabase-browser";
import {WorkspaceBack} from "./app-shell";

type Row={
  batch_id:string;
  row_key:string;
  receipt_date:string|null;
  supplier_name:string;
  product_code:string|null;
  product_name:string;
  specification:string|null;
  unit:string|null;
  quantity:number|null;
  unit_price:number|null;
  subtotal:number|null;
  status:string;
};

function money(value:number|null|undefined){
  return value===null||value===undefined?"—":`NT$ ${Number(value).toLocaleString()}`;
}
function date(value:string|null){return value||"日期待確認";}

export default function ProcurementWorkspace({storeId,userId,onBack}:{storeId:string;userId:string;onBack:()=>void}){
  const [rows,setRows]=useState<Row[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [query,setQuery]=useState("");
  const [period,setPeriod]=useState<"day"|"week"|"month">("day");

  useEffect(()=>{let alive=true;async function run(){
    setLoading(true);setError("");
    const {data,error}=await supabase.rpc("get_pilot_receipt_ledger",{p_store_id:storeId});
    if(!alive)return;
    if(error){setError("請購資料暫時無法載入。");setRows([]);}
    else setRows((Array.isArray(data)?data:[]) as Row[]);
    setLoading(false);
  }void run();return()=>{alive=false};},[storeId,userId]);

  const visible=useMemo(()=>{
    const q=query.trim().toLocaleLowerCase();
    return rows.filter(row=>!q||[row.supplier_name,row.product_code,row.product_name,row.specification].some(v=>String(v||"").toLocaleLowerCase().includes(q)));
  },[rows,query]);

  const groups=useMemo(()=>{
    const grouped=new Map<string,Row[]>();
    for(const row of visible){const key=row.supplier_name||"供應商待確認";const list=grouped.get(key)||[];list.push(row);grouped.set(key,list);}
    return [...grouped.entries()];
  },[visible]);

  const total=visible.reduce((sum,row)=>sum+(Number(row.subtotal)||0),0);

  return <><WorkspaceBack onBack={onBack}><div className="role-home-title"><div><span>BeApe</span><h1>請購</h1><p>依供應商整理已核對進貨資料，作為每日請購與採購核對依據。</p></div></div></WorkspaceBack>
    <section className="shell-section"><div className="shell-card"><div className="field"><label>檢視期間</label><div className="segmented-control">{(["day","week","month"] as const).map(v=><button key={v} type="button" className={period===v?"active":""} onClick={()=>setPeriod(v)}>{v==="day"?"每日":v==="week"?"每週":"每月"}</button>)}</div></div><label className="field">搜尋品項或供應商<div className="input-with-icon"><Search className="ui-icon"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="品名、編碼、供應商"/></div></label></div></section>
    <section className="shell-section"><div className="shell-section-head"><h2>請購彙整</h2><strong>{money(total)}</strong></div>{loading?<p>正在整理請購資料…</p>:error?<p role="alert" className="pilot-message">{error}</p>:groups.length===0?<div className="shell-card completion-card"><ClipboardList className="ui-icon"/><strong>目前沒有可整理的資料</strong><p>進貨核對完成後，品項會自動出現在這裡。</p></div>:groups.map(([supplier,items])=><article className="shell-card" key={supplier}><div className="shell-section-head"><div><h3>{supplier}</h3><small>{items.length} 項</small></div><strong>{money(items.reduce((sum,row)=>sum+(Number(row.subtotal)||0),0))}</strong></div><div className="receipt-desktop-table-wrap"><table className="receipt-desktop-table"><thead><tr><th>日期</th><th>編碼</th><th>品項</th><th>規格</th><th>數量</th><th>未稅單價</th><th>未稅金額</th></tr></thead><tbody>{items.map(row=><tr key={row.batch_id+":"+row.row_key}><td>{date(row.receipt_date)}</td><td>{row.product_code||"待建立"}</td><td><strong>{row.product_name}</strong></td><td>{row.specification||"—"}</td><td>{row.quantity??"—"} {row.unit||""}</td><td>{money(row.unit_price)}</td><td>{money(row.subtotal)}</td></tr>)}</tbody></table></div></article>)}</section>
    <p className="shell-note">第一版先用已核對進貨資料形成 BeApe 請購檢視。下一階段再接「實際請購量、建議採購量、送出請購單」。</p></>;
}
