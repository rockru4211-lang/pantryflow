"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type Reminder = { id: string; started_at: string; items: { name: string; quantity: number; unit: string }[] };

export default function XuCountInbox({storeId, revision}: {storeId:string; revision:number}) {
  const [rows,setRows] = useState<Reminder[]>([]);
  const [error,setError] = useState("");
  const [working,setWorking] = useState(false);
  const [retry,setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    async function refresh() {
      const result = await supabase.rpc("xu_order_inbox",{p_store:storeId});
      if (!current) return;
      setError(result.error ? "叫貨提醒讀取失敗" : "");
      if (!result.error) setRows(result.data as unknown as Reminder[]);
    }
    void refresh();
    window.addEventListener("focus",refresh);
    const timer = window.setInterval(refresh,60000);
    return () => { current=false; window.clearInterval(timer); window.removeEventListener("focus",refresh); };
  },[storeId,revision,retry]);
  async function handle(id:string) {
    setWorking(true);
    const result = await supabase.rpc("xu_order_inbox",{p_store:storeId,p_handled:id});
    setWorking(false);
    if (result.error) setError("提醒處理失敗，請重試");
    else { setError(""); setRetry(value=>value+1); setRows(result.data as unknown as Reminder[]); }
  }
  return <>{error && <button className="text-button" onClick={()=>setRetry(n=>n+1)}>{error} · 重試</button>}
    {rows.length>0 && <details className="shell-card xu-reminders"><summary>叫貨提醒（{rows.length}）</summary>
      {rows.map(row=><section key={row.id}><strong>{new Date(row.started_at).toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"})}</strong>
        {row.items.map(item=><p key={JSON.stringify(item)}>{item.name} · 實盤剩餘 {item.quantity} {item.unit}</p>)}
        <button className="text-button" disabled={working} onClick={()=>void handle(row.id)}>標為已處理</button></section>)}</details>}</>;
}
