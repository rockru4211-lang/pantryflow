"use client";
import { CalendarClock, TriangleAlert } from "lucide-react";
import {
  expiryDateLabel,
  type ExpiryItem,
  type WasteRecord,
} from "@/lib/expiry-waste";
const displayTime = (value: string) =>
  new Date(value).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });

export function ExpiryFoodList({
  items,
  today,
  canOperate,
  onDiscard,
  onUsed,
}: {
  items: ExpiryItem[];
  today: string;
  canOperate: boolean;
  onDiscard: (item: ExpiryItem) => void;
  onUsed: (item: ExpiryItem) => void;
}) {
  return (
    <div className="expiry-direct-list">
      {items.map((item) => (
        <article
          className={`shell-card expiry-food-card ${item.category === "urgent" ? "danger" : item.category === "upcoming" ? "warning" : "special"}`}
          key={item.id}
        >
          <span className="expiry-food-icon">
            {item.category === "urgent" ? (
              <TriangleAlert className="ui-icon" />
            ) : (
              <CalendarClock className="ui-icon" />
            )}
          </span>
          <div className="expiry-food-copy">
            <strong>{item.name}</strong>
            <span>{expiryDateLabel(item.expires_on, today)}</span>
            <small>{item.zone_name}</small>
          </div>
          {canOperate && item.category === "urgent" && (
            <div className="expiry-food-actions">
              <button className="shell-primary" onClick={() => onDiscard(item)}>
                登記廢棄
              </button>
              <button className="shell-secondary" onClick={() => onUsed(item)}>
                已使用完
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
export function WasteHistoryRows({rows,onOpen}:{rows:WasteRecord[];onOpen:(row:WasteRecord)=>void}) {
 return <div className="shell-card shell-list">{rows.map(r=><button type="button" className="shell-list-row" key={r.id} onClick={()=>onOpen(r)}><span><strong>{r.name} {r.quantity} {r.unit}</strong><small>{r.reason}・{r.actor_name}・{displayTime(r.created_at)}</small>{r.review_status==="PENDING"&&<small>待行政確認金額與庫存</small>}</span><b aria-hidden="true">›</b></button>)}</div>;
}
export function WasteDetail({row,audit,showAmount}:{row:WasteRecord;audit:boolean;showAmount:boolean}) {
 return <section className="shell-card result-list"><div><span>品項</span><strong>{row.name}</strong></div><div><span>數量</span><strong>{row.quantity} {row.unit}</strong></div><div><span>原因</span><strong>{row.reason}</strong></div><div><span>經手人</span><strong>{row.actor_name}</strong></div><div><span>時間</span><strong>{displayTime(row.created_at)}</strong></div>
 {row.zone_name&&<div><span>儲放區</span><strong>{row.zone_name}</strong></div>}{row.expires_on&&<div><span>效期批次</span><strong>{row.expires_on}</strong></div>}{row.note&&<p>{row.note}</p>}{audit&&row.delay_reason&&<p>未在到期前處理原因：{row.delay_reason}</p>}{row.review_status&&<div><span>行政狀態</span><strong>{row.review_status==="PENDING"?"待確認":"已確認"}</strong></div>}{row.review&&<><div><span>確認人</span><strong>{row.review.reviewer_name}</strong></div><div><span>確認時間</span><strong>{displayTime(row.review.reviewed_at)}</strong></div>{row.review.stock_warning&&<p>庫存提示：確認前系統可用 {row.review.available_before??0} {row.unit}，低於本次確認廢棄量。</p>}</>}{row.erp_report&&<p>ERP 回報：{row.erp_report.actor_name}・{displayTime(row.erp_report.created_at)}</p>}<p>來源：{row.source==='EXPIRY'?'效期處理':'現場登記'}</p>{showAmount&&row.review_status!=="PENDING"&&<div><span>廢棄金額</span><strong>{row.reference_amount===null?'未提供':`NT${row.reference_amount.toLocaleString('zh-TW',{maximumFractionDigits:2})}`}</strong></div>}</section>;
}
