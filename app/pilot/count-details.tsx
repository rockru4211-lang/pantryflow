"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { displayTime } from "./inventory-catalog";
type Entry = { id: string; name: string; unit: string; zone: string; quantity: number; opening_quantity: number | null; entered_at: string; entered_by: string | null };
export default function CountDetails({ sessionId }: { sessionId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [message, setMessage] = useState("正在讀取明細…");
  useEffect(() => {
    let active = true;
    void supabase.rpc("get_pilot_count_details", { p_session_id: sessionId }).then(({ data, error }) => {
      if (!active) return;
      setEntries(Array.isArray(data) ? data as unknown as Entry[] : []);
      setMessage(error ? "明細讀取失敗，請重新進入。" : "");
    });
    return () => { active = false; };
  }, [sessionId]);
  return <div className="submitted-details"><h3>完整盤點明細（{entries.length} 筆）</h3>
    <p className="helper">期初是開始盤點時的紀錄；未提供的品項不計算差異。</p>
    {entries.map(entry => <article className="catalog-item" key={entry.id}>
      <b>{entry.name}｜{entry.zone}</b><p>實盤：<strong>{entry.quantity} {entry.unit}</strong>｜期初：{entry.opening_quantity ?? "未提供"}</p>
      <small>盤點人：{entry.entered_by || "未提供"}｜送出時間：{displayTime(entry.entered_at)}</small>
    </article>)}
    {message && <p role="status">{message}</p>}
  </div>;
}
