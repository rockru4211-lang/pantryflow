"use client";

import { useEffect, useId, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { attentionReasons, expiryError } from "@/lib/expiry-waste";
import { withCountSaveTimeout } from "@/lib/count-save";
import type { Json } from "@/lib/database.types";

type Reminder = {
  id: string;
  expires_on: string;
  zone_id: string | null;
  zone_name: string;
  attention_reason: string;
  revision: number;
  created_at: string;
  source: string;
};
type Item = {
  key: string;
  name: string | null;
  unit: string | null;
  zone_id: string | null;
  reminders: Reminder[];
};
type Options = {
  store_name: string;
  run_id: string | null;
  items: Item[];
  zones: { id: string; name: string }[];
};

// The source workspace stays mounted, including its inputs, draft queue and scroll position.
export default function ContextExpiryForm({
  storeId,
  contextType,
  contextId,
  zoneId,
  onClose,
}: {
  storeId: string;
  contextType: "COUNT" | "RECEIPT";
  contextId: string;
  zoneId?: string;
  onClose: (saved: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [options, setOptions] = useState<Options | null>(null);
  const [selection, setSelection] = useState("");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [reason, setReason] = useState("保存期限短");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const request = useRef<{ id: string; data: Json } | null>(null);
  const selected = options?.items
    .flatMap((item) => [
      ...item.reminders.map((reminder) => ({
        value: `${item.key}:${reminder.id}`,
        item,
        reminder,
      })),
      { value: `${item.key}:new`, item, reminder: null },
    ])
    .find((option) => option.value === selection);

  useEffect(() => {
    const element = dialog.current!;
    const scroller = element.closest(".shell-content");
    const top = scroller?.scrollTop || 0;
    element.showModal();
    return () => {
      element.close();
      // Closing a native dialog restores focus; restore the exact source reading position too.
      requestAnimationFrame(() => scroller?.scrollTo({ top }));
    };
  }, []);
  useEffect(() => {
    let active = true;
    void withCountSaveTimeout((signal) =>
      supabase
        .rpc("get_pilot_context_expiry", {
          p_store_id: storeId,
          p_context_type: contextType,
          p_context_id: contextId,
          p_zone_id: zoneId,
        })
        .abortSignal(signal),
    )
      .then((result) => {
        if (!active) return;
        if (result.error) throw result.error;
        setOptions(result.data as unknown as Options);
      })
      .catch((e) => {
        if (active) setError(contextError(e));
      });
    return () => {
      active = false;
    };
  }, [storeId, contextType, contextId, zoneId, reload]);

  function choose(value: string) {
    setSelection(value);
    setError("");
    const item = options?.items.find((i) => value.startsWith(`${i.key}:`));
    const reminder = item?.reminders.find(
      (r) => value === `${item.key}:${r.id}`,
    );
    setDate(reminder?.expires_on || "");
    setLocation(
      reminder
        ? reminder.zone_id ||
            options?.zones.find((z) => z.name === "未分類")?.id ||
            "unclassified"
        : item?.zone_id || "",
    );
    setReason(reminder?.attention_reason || "保存期限短");
  }
  async function save() {
    if (lock.current || !selected || !date || !location) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const data: Json = {
      item_key: selected.item.key,
      new_batch: !selected.reminder,
      expiry_id: selected.reminder?.id || null,
      revision: selected.reminder?.revision ?? null,
      run_id: options?.run_id || null,
      expires_on: date,
      zone_id: location === "unclassified" ? null : location,
      attention_reason: contextType === "RECEIPT" ? "包裝效期" : reason,
    };
    // Keep the same operation ID even after an uncertain response or corrected input.
    // A committed earlier payload must never turn into a second batch on retry.
    request.current = { id: request.current?.id || crypto.randomUUID(), data };
    try {
      const pending = request.current;
      const result = await withCountSaveTimeout((signal) =>
        supabase
          .rpc("save_pilot_context_expiry", {
            p_store_id: storeId,
            p_request_id: pending.id,
            p_context_type: contextType,
            p_context_id: contextId,
            p_zone_id: zoneId,
            p_data: pending.data,
          })
          .abortSignal(signal),
      );
      if (result.error) throw result.error;
      if (
        !result.data ||
        typeof result.data !== "object" ||
        !("id" in result.data)
      )
        throw new Error("SAVE_NOT_CONFIRMED");
      onClose(true);
    } catch (e) {
      setError(contextError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="context-expiry-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!lock.current) onClose(false);
      }}
    >
      <h2 id={titleId}>加入效期提醒</h2>
      {options && (
        <p className="context-expiry-source">
          {options.store_name}・
          {contextType === "RECEIPT" ? "進貨包裝效期" : "盤點現場提醒"}
        </p>
      )}
      {!options ? (
        <>
          {!error && <p role="status">正在讀取品項…</p>}
          {error && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setError("");
                setReload((x) => x + 1);
              }}
            >
              重新讀取品項
            </button>
          )}
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="field">
            品項
            <select
              required
              value={selection}
              disabled={busy}
              onChange={(event) => choose(event.target.value)}
            >
              <option value="">請選擇品項</option>
              {options.items.map((item, index) => (
                <optgroup
                  label={item.name || `第 ${index + 1} 項・品名未提供`}
                  key={item.key}
                >
                  {item.reminders.map((r, i) => (
                    <option key={r.id} value={`${item.key}:${r.id}`}>
                      {item.name}｜{r.expires_on}・{r.zone_name}・批次 {i + 1}
                    </option>
                  ))}
                  {
                    <option value={`${item.key}:new`} disabled={!item.name}>
                      {item.name || "品名未提供"}
                      {item.reminders.length ? "｜補記其他批次" : ""}
                    </option>
                  }
                </optgroup>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <label className="field">
                到期日
                <input
                  type="date"
                  required
                  min="2000-01-01"
                  max="2200-01-01"
                  value={date}
                  disabled={busy}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label className="field">
                儲放區
                <select
                  required
                  value={location}
                  disabled={busy}
                  onChange={(e) => setLocation(e.target.value)}
                >
                  <option value="">請確認儲放區</option>
                  {!options.zones.some((z) => z.name === "未分類") && (
                    <option value="unclassified">未分類</option>
                  )}
                  {options.zones.map((z) => (
                    <option value={z.id} key={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </label>
              {contextType === "COUNT" && (
                <label className="field">
                  注意原因
                  <select
                    value={reason}
                    disabled={busy}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    {selected.reminder?.attention_reason === "包裝效期" && (
                      <option value="包裝效期">包裝效期</option>
                    )}
                    {attentionReasons.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <div className="context-expiry-actions">
            <button
              type="button"
              className="shell-secondary"
              disabled={busy}
              onClick={() => onClose(false)}
            >
              取消
            </button>
            <button
              type="submit"
              className="shell-primary"
              disabled={busy || !selected || !date || !location}
            >
              {busy ? "儲存中…" : "儲存提醒"}
            </button>
          </div>
        </form>
      )}
      {!options && (
        <button
          type="button"
          className="shell-secondary"
          onClick={() => onClose(false)}
        >
          取消
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}

function contextError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String(error.message)
        : "";
  const messages: Record<string, string> = {
    COUNT_CONTEXT_CLOSED: "本次盤點已完成，請返回查看最新進度。",
    RECEIPT_REVIEWER_REQUIRED: "此貨單由授權核對人員處理。",
    CONTEXT_ITEM_REQUIRED: "請先選擇已有品名的品項。",
    RECEIPT_CONTEXT_CHANGED: "貨單辨識資料已更新，請取消後重新開啟提醒。",
    EXPIRY_CONTEXT_MISMATCH: "此批次已更新，請取消後重新選擇。",
    EXPIRY_ALREADY_COMPLETED: "這筆提醒已完成處理，請返回查看紀錄。",
    EXPIRY_CHANGED:
      "其他人已更正這筆提醒，您的輸入仍保留；請取消後重新查看該批次。",
  };
  return messages[message] || expiryError(error);
}
