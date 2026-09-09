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
export function WasteHistoryRows({
  rows,
  showAmount,
  audit,
}: {
  rows: WasteRecord[];
  showAmount: boolean;
  audit: boolean;
}) {
  return (
    <div className="shell-card timeline-list">
      {rows.map((r) => (
        <article key={r.id}>
          <i />
          <div>
            <strong>
              {r.name} {r.quantity} {r.unit}
            </strong>
            <small>
              {r.store_name}・{r.reason}・{r.actor_name}・
              {displayTime(r.created_at)}
            </small>
            {showAmount && (
              <b>
                {r.reference_amount === null
                  ? "參考金額未提供"
                  : `參考金額 NT$${r.reference_amount.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`}
              </b>
            )}
            {(r.zone_name ||
              r.expires_on ||
              r.note ||
              r.erp_report ||
              (audit && r.delay_reason)) && (
              <details>
                <summary>完整紀錄</summary>
                {r.zone_name && <p>儲放區：{r.zone_name}</p>}
                {r.expires_on && <p>效期批次：{r.expires_on}</p>}
                {r.note && <p>{r.note}</p>}
                {audit && r.delay_reason && (
                  <p>未在到期前處理原因：{r.delay_reason}</p>
                )}
                {r.erp_report && (
                  <p>
                    ERP 回報：{r.erp_report.actor_name}・
                    {displayTime(r.erp_report.created_at)}
                  </p>
                )}
                <p>來源：{r.source === "EXPIRY" ? "效期處理" : "現場登記"}</p>
              </details>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
