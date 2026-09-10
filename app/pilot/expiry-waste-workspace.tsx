"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  CalendarClock,
  TriangleAlert,
  Search,
  CircleHelp,
  Trash2,
  ClipboardList,
  Check,
  Eye,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import type { Json } from "@/lib/database.types";
import {
  attentionReasons,
  cadences,
  expiryCategory,
  expiryError,
  monthRange,
  taipeiDate,
  units,
  wasteReasons,
  wasteSummary,
  type ExpiryItem,
  type ExpiryWorkspaceData,
  type RiskLocation,
} from "@/lib/expiry-waste";
import { ExpiryFoodList, WasteHistoryRows } from "./expiry-waste-cards";
import { displayTime } from "./inventory-catalog";

export type ExpiryWastePage =
  | "expiry"
  | "urgent"
  | "upcoming"
  | "special"
  | "reminder"
  | "risks"
  | "risk-detail"
  | "risk-settings"
  | "risk-form"
  | "risk-result"
  | "risk-issue"
  | "risk-expired"
  | "used"
  | "waste"
  | "waste-new"
  | "discard"
  | "complete"
  | "history"
  | "erp";
const changed = "pantryflow-expiry-waste-changed";
function useWorkspace(storeId: string, from: string, until: string) {
  const [data, setData] = useState<ExpiryWorkspaceData | null>(null),
    [error, setError] = useState("");
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(
    async (force = false) => {
      if (pending.current && !force) return;
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      const current = ++sequence.current;
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const { data: value, error: failure } = await supabase
          .rpc("get_pilot_expiry_waste", {
            p_store_id: storeId,
            p_from: from,
            p_until: until,
          })
          .abortSignal(controller.signal);
        if (current !== sequence.current) return;
        if (failure) throw failure;
        setData(value as unknown as ExpiryWorkspaceData);
        setError("");
      } catch {
        if (current === sequence.current)
          setError("資料暫時無法讀取，請重試。");
      } finally {
        clearTimeout(timer);
        if (pending.current === controller) pending.current = null;
      }
    },
    [storeId, from, until],
  );
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    // RPC results update state after the network response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(refreshVisible, 6000);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener(changed, refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    // This is a request generation counter, not a DOM ref.
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++;
      pending.current?.abort();
      pending.current = null;
      clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener(changed, refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);
  return { data, error, refresh };
}
function Intro({
  title,
  copy = "",
  badge = "",
}: {
  title: string;
  copy?: string;
  badge?: string;
}) {
  return (
    <div className="shell-page-intro">
      {badge && <span className="shell-kicker">{badge}</span>}
      <h1>{title}</h1>
      {copy && <p>{copy}</p>}
    </div>
  );
}
function Back({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button className="shell-back" onClick={onBack}>
      ‹ <span>{label}</span>
    </button>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <section className="shell-card expiry-empty-state">
      <span>
        <ClipboardList className="ui-icon" />
      </span>
      <div>
        <strong>{children}</strong>
      </div>
    </section>
  );
}

export default function ExpiryWasteWorkspace({
  storeId,
  initialPage = "expiry",
  onBack,
  returnLabel = "返回首頁",
}: {
  storeId: string;
  initialPage?: ExpiryWastePage;
  onBack: () => void;
  returnLabel?: string;
}) {
  const [page, setPage] = useState<ExpiryWastePage>(initialPage),
    [filter, setFilter] = useState<"today" | "month" | "choose">("today"),
    [month, setMonth] = useState(taipeiDate().slice(0, 7)),
    [showAmount, setShowAmount] = useState(false);
  const today = taipeiDate(),
    range =
      filter === "today"
        ? [today, today]
        : monthRange(filter === "month" ? today.slice(0, 7) : month);
  const { data, error, refresh } = useWorkspace(storeId, range[0], range[1]);
  const [item, setItem] = useState<ExpiryItem | null>(null),
    [risk, setRisk] = useState<RiskLocation | null>(null),
    [issueType, setIssueType] = useState<"LABEL" | "OTHER">("LABEL");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [result, setResult] = useState<{
      id: string;
      type: string;
      already_completed?: boolean;
      active?: boolean;
    } | null>(null);
  const [formOpenedAt, setFormOpenedAt] = useState(0);
  const [name, setName] = useState(""),
    [unit, setUnit] = useState(""),
    [date, setDate] = useState(""),
    [attention, setAttention] = useState(attentionReasons[0]);
  const [erpRows, setErpRows] = useState<ExpiryWorkspaceData["erp_pending"]>(
      [],
    ),
    [erpDay, setErpDay] = useState("");
  const [completionOrigin, setCompletionOrigin] = useState<
    "expiry" | "waste" | "risk" | "erp"
  >("expiry");
  const erpSnapshot = useRef(false);
  // Capture the opened server snapshot once so new waste cannot be accidentally acknowledged.
  useEffect(() => {
    if (page === "erp" && data && !erpSnapshot.current) {
      erpSnapshot.current = true;
      const day = data.erp_pending[0]?.work_date || data.today;
      setErpDay(day);
      setErpRows(data.erp_pending.filter((w) => w.work_date === day));
    }
  }, [page, data]);
  const lock = useRef(false),
    request = useRef<{ signature: string; id: string } | null>(null);
  const [historyBack, setHistoryBack] = useState<ExpiryWastePage>("waste");
  function go(next: ExpiryWastePage) {
    if (next === "history")
      setHistoryBack(
        ["urgent", "discard", "used"].includes(page) ? "urgent" : "waste",
      );
    setMessage("");
    setPage(next);
    document.querySelector(".shell-content")?.scrollTo({ top: 0 });
  }
  function openForm(next: ExpiryWastePage, selected?: ExpiryItem) {
    request.current = null;
    setFormOpenedAt(Date.now());
    setName("");
    setUnit(selected?.unit || "");
    setDate("");
    setAttention(attentionReasons[0]);
    setItem(selected || null);
    go(next);
  }
  async function save(
    action: string,
    payload: Json,
    done: (saved: {
      id: string;
      type: string;
      already_completed?: boolean;
      active?: boolean;
    }) => void,
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    const signature = JSON.stringify({ action, payload });
    if (!request.current)
      request.current = { signature, id: crypto.randomUUID() };
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 20000);
    try {
      const { data: saved, error: failure } = await supabase
        .rpc("save_pilot_expiry_waste", {
          p_store_id: storeId,
          p_request_id: request.current.id,
          p_action: action,
          p_data: payload,
        })
        .abortSignal(abort.signal);
      if (failure) throw failure;
      const value = saved as unknown as {
        id: string;
        type: string;
        already_completed?: boolean;
        active?: boolean;
      };
      setResult(value);
      done(value);
      window.dispatchEvent(new Event(changed));
      void refresh(true);
    } catch (failure) {
      setMessage(expiryError(failure));
    } finally {
      clearTimeout(timer);
      lock.current = false;
      setBusy(false);
    }
  }
  const formValues = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return new FormData(event.currentTarget);
  };
  const text = (form: FormData, key: string) =>
    String(form.get(key) || "").trim();
  const back = (label: string, target: ExpiryWastePage) => (
    <Back label={label} onBack={() => go(target)} />
  );
  const rootBack = () => <Back label={returnLabel} onBack={onBack} />;
  const status = (
    <>
      {error && (
        <p role="alert">
          {error}{" "}
          <button className="text-button" onClick={() => void refresh()}>
            重試
          </button>
        </p>
      )}
      {message && <p role="alert">{message}</p>}
    </>
  );
  if (!data)
    return (
      <>
        {rootBack()}
        {status}
        {!error && <p role="status">正在讀取資料…</p>}
      </>
    );
  const { permissions } = data;
  const field = permissions.field;
  const urgent = data.items.filter((i) => i.category === "urgent");
  const risks = data.risks.filter((r) => r.is_active && r.due);
  const selectedLive = item?.id
    ? data.items.find((i) => i.id === item.id)
    : item;
  const selectedMissing = item?.id && !selectedLive;
  const completion = data.waste.find((r) => r.id === result?.id);
  const used = data.used.find((r) => r.id === result?.id);
  const unitOptions = [
    ...new Set([
      ...(item?.unit ? [item.unit] : []),
      ...data.products.flatMap((p) => (p.base_unit ? [p.base_unit] : [])),
      ...units,
    ]),
  ];
  const unitInput = (label: string) => (
    <select
      name="unit"
      aria-label={label}
      required
      value={unit}
      onChange={(e) => setUnit(e.target.value)}
    >
      <option value="">選擇單位</option>
      {unitOptions.map((u) => (
        <option key={u}>{u}</option>
      ))}
    </select>
  );
  const zoneInput = (label: string, defaultValue = "") => (
    <select
      name="zone_id"
      aria-label={label}
      required
      defaultValue={defaultValue}
    >
      <option value="">選擇儲放區</option>
      {data.zones.map((z) => (
        <option key={z.id} value={z.id}>
          {z.name}
        </option>
      ))}
    </select>
  );
  const confirmResult = (origin: "expiry" | "waste" | "risk" | "erp") => () => {
    setCompletionOrigin(origin);
    go("complete");
  };
  let content: ReactNode;
  if (page === "expiry")
    content = (
      <>
        {rootBack()}
        <Intro
          title="效期提醒"
          copy="現場效期表負責完整記錄，序只提醒容易被遺漏的事情。"
        />
        <section className="shell-section">
          <div className="shell-section-head">
            <h2>今天需要看</h2>
            <span>只顯示重點</span>
          </div>
          <div className="expiry-entry-grid">
            {(
              [
                [
                  "urgent",
                  "立即處理",
                  urgent.length,
                  "已到期或今天到期",
                  "danger",
                  TriangleAlert,
                ],
                [
                  "upcoming",
                  "預告",
                  data.items.filter((i) => i.category === "upcoming").length,
                  "即將到期，提前留意",
                  "warning",
                  CalendarClock,
                ],
                [
                  "risks",
                  "風險區",
                  risks.length,
                  "容易遺漏的儲物死角",
                  "risk",
                  Search,
                ],
                [
                  "special",
                  "特別注意",
                  data.items.filter((i) => i.category === "special").length,
                  "使用週期長的邊緣食材",
                  "special",
                  CircleHelp,
                ],
              ] as const
            ).map(([route, title, count, copy, tone, Icon]) => (
              <button
                className={`expiry-entry-card ${tone}`}
                key={route}
                onClick={() => go(route)}
              >
                <span className="expiry-entry-icon">
                  <Icon className="ui-icon" />
                </span>
                <span className="expiry-entry-copy">
                  <strong>{title}</strong>
                  <small>{copy}</small>
                </span>
                <b>
                  {count} {route === "risks" ? "處" : "項"}
                </b>
                <i aria-hidden="true">›</i>
              </button>
            ))}
          </div>
        </section>
        {field && (
          <button
            className="expiry-suggest-link"
            onClick={() => openForm("reminder")}
          >
            ＋ 新增現場提醒 <b>›</b>
          </button>
        )}
        <p className="shell-note">
          員工、店長與主管共用同一份待處理清單。完成廢棄或確認已用完後，品項會移出效期頁，完成資料保留在作業紀錄／廢棄紀錄。
        </p>
      </>
    );
  else if (page === "urgent" || page === "upcoming" || page === "special") {
    const rows = data.items.filter((i) => i.category === page);
    content = (
      <>
        {back("返回效期提醒", "expiry")}
        <Intro
          title={
            page === "urgent"
              ? "立即處理"
              : page === "upcoming"
                ? "預告"
                : "特別注意"
          }
          badge={`${rows.length} 項`}
          copy={
            page === "urgent"
              ? "只顯示尚未完成的品項；完成資料保存於作業紀錄。"
              : page === "upcoming"
                ? "即將到期，提前留意。"
                : "使用週期長、容易被遺忘的食材。"
          }
        />
        {rows.length ? (
          <ExpiryFoodList
            items={rows}
            today={data.today}
            canOperate={field}
            onDiscard={(i) => openForm("discard", i)}
            onUsed={(i) => openForm("used", i)}
          />
        ) : (
          <>
            <Empty>
              {page === "urgent"
                ? "目前沒有需要立即處理的效期品項"
                : page === "upcoming"
                  ? "目前沒有預告品項"
                  : "目前沒有特別注意品項"}
            </Empty>
            {page === "urgent" && (
              <button
                className="shell-secondary full"
                onClick={() => go("history")}
              >
                查看廢棄紀錄
              </button>
            )}
          </>
        )}
      </>
    );
  } else if (page === "reminder")
    content = (
      <>
        {back("返回效期提醒", "expiry")}
        <Intro
          title="新增現場提醒"
          copy="巡視現場時，補記自製、分裝、開封或容易遺忘的少數食材。"
          badge="現場巡視"
        />
        {field && (
          <form
            onSubmit={(e) => {
              const f = formValues(e);
              void save(
                "REMINDER",
                {
                  name: text(f, "name"),
                  expires_on: text(f, "date"),
                  zone_id: text(f, "zone_id"),
                  attention_reason: attention,
                },
                () => go("expiry"),
              );
            }}
          >
            <fieldset disabled={busy}>
              <section className="shell-card expiry-suggest-form">
                <label>
                  <span>品項名稱</span>
                  <input
                    name="name"
                    aria-label="品項名稱"
                    required
                    maxLength={200}
                  />
                </label>
                <label>
                  <span>到期日</span>
                  <input
                    name="date"
                    aria-label="到期日"
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label>
                  <span>目前儲放區</span>
                  {zoneInput("目前儲放區")}
                  <small>請確認現場實際儲放位置。</small>
                </label>
                <label>
                  <span>為什麼需要注意</span>
                  <select
                    aria-label="注意原因"
                    value={attention}
                    onChange={(e) => setAttention(e.target.value)}
                  >
                    {attentionReasons.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
              </section>
              <section className="shell-card expiry-no-action">
                <strong>資料來源：現場巡視</strong>
                <span>
                  進貨驗收負責建立大部分包裝效期；這裡只補上現場臨時發現的提醒。
                </span>
              </section>
              {date && (
                <section className="shell-card expiry-no-action">
                  <strong>
                    系統判定：
                    {(
                      {
                        urgent: "立即處理",
                        upcoming: "預告",
                        special: "特別注意",
                      } as Record<string, string>
                    )[expiryCategory(date, attention, data.today) || ""] ||
                      "尚未進入提前提醒"}
                  </strong>
                  <span>依日期與注意原因提醒，進入提前 3 日時顯示於預告。</span>
                </section>
              )}
              <button className="shell-primary full">
                {busy ? "儲存中…" : "新增提醒"}
              </button>
            </fieldset>
          </form>
        )}
      </>
    );
  else if (page === "risks")
    content = (
      <>
        {back("返回效期提醒", "expiry")}
        <Intro
          title="風險區"
          copy="容易遺漏的儲物死角。"
          badge={`${risks.length} 處`}
        />
        <div className="expiry-risk-list">
          {risks.map((r) => (
            <button
              key={r.id}
              className="shell-card expiry-risk-card expiry-risk-link"
              onClick={() => {
                setRisk(r);
                go("risk-detail");
              }}
            >
              <span>
                <Search className="ui-icon" />
              </span>
              <div>
                <strong>{r.name}</strong>
                <small>
                  {r.zone_name}｜{r.detail}
                </small>
                <em>{cadences[r.cadence]}提醒</em>
              </div>
              <b>›</b>
            </button>
          ))}
        </div>
        {!risks.length && <Empty>目前沒有需要提醒的風險位置</Empty>}
        {(permissions.manage || !field) && (
          <button
            className="shell-secondary full"
            onClick={() => go("risk-settings")}
          >
            {permissions.manage ? "設定本店風險區" : "查看門市風險區設定"}
          </button>
        )}
      </>
    );
  else if (page === "risk-detail" && risk)
    content = (
      <>
        {back("返回風險區", "risks")}
        <Intro
          title={risk.name}
          copy={`${risk.zone_name}｜${risk.detail}`}
          badge={`${cadences[risk.cadence]}提醒`}
        />
        <section className="shell-card expiry-risk-focus">
          <span>
            <Eye className="ui-icon" />
          </span>
          <div>
            <strong>本位置的查看重點</strong>
            <p>
              查看{risk.detail}
              ，留意到期品、日期標示與保存狀況。現場正常時直接返回即可。
            </p>
          </div>
        </section>
        {field && (
          <section className="shell-section">
            <div className="shell-section-head">
              <h2>只有發現問題時才回報</h2>
            </div>
            <div className="shell-button-stack">
              <button
                className="shell-primary"
                onClick={() => openForm("risk-expired")}
              >
                發現到期品
              </button>
              <button
                className="shell-secondary"
                onClick={() => {
                  request.current = null;
                  setIssueType("LABEL");
                  go("risk-issue");
                }}
              >
                日期／標示異常
              </button>
              <button
                className="shell-secondary"
                onClick={() => {
                  request.current = null;
                  setIssueType("OTHER");
                  go("risk-issue");
                }}
              >
                回報其他問題
              </button>
            </div>
          </section>
        )}
      </>
    );
  else if (page === "risk-settings")
    content = (
      <>
        {back("返回風險區", "risks")}
        <Intro
          title="本店風險區設定"
          copy="依本店格局設定容易遺漏的位置；不需要加入食材。"
        />
        {permissions.manage && (
          <button
            className="shell-primary full"
            onClick={() => {
              setRisk(null);
              request.current = null;
              go("risk-form");
            }}
          >
            ＋ 新增風險位置
          </button>
        )}
        <div className="expiry-risk-list">
          {data.risks.map((r) => (
            <article className="shell-card expiry-risk-card" key={r.id}>
              <span>
                <Search className="ui-icon" />
              </span>
              <div>
                <strong>
                  {r.name}
                  {!r.is_active ? "（已停用）" : ""}
                </strong>
                <small>
                  {r.zone_name}｜{r.detail}・{cadences[r.cadence]}提醒
                </small>
              </div>
              {permissions.manage ? (
                <button
                  onClick={() => {
                    setRisk(r);
                    request.current = null;
                    go("risk-form");
                  }}
                >
                  編輯
                </button>
              ) : (
                <b>唯讀</b>
              )}
            </article>
          ))}
        </div>
        {!data.risks.length && <Empty>尚未設定風險位置</Empty>}
      </>
    );
  else if (page === "risk-form" && permissions.manage)
    content = (
      <>
        {back("返回風險區設定", "risk-settings")}
        <Intro
          title={risk ? "編輯風險位置" : "新增風險位置"}
          copy="只設定容易被忽略的實際位置，不建立整區巡檢清單。"
        />
        <form
          onSubmit={(e) => {
            const native = e.nativeEvent as SubmitEvent;
            const f = formValues(e);
            void save(
              "RISK_SAVE",
              {
                id: risk?.id || null,
                updated_at: risk?.updated_at || null,
                name: text(f, "name"),
                detail: text(f, "detail"),
                zone_id: text(f, "zone_id"),
                cadence: text(f, "cadence"),
                is_active:
                  (native.submitter as HTMLButtonElement)?.value !== "pause",
              },
              () => go("risk-result"),
            );
          }}
        >
          <fieldset disabled={busy}>
            <section className="shell-card expiry-suggest-form expiry-risk-form">
              <label>
                <span>所屬儲物區</span>
                {zoneInput("所屬儲物區", risk?.zone_id)}
              </label>
              <label>
                <span>死角位置名稱</span>
                <input
                  name="name"
                  aria-label="死角位置名稱"
                  required
                  maxLength={200}
                  defaultValue={risk?.name}
                  placeholder="例如：工作台抽屜"
                />
              </label>
              <label>
                <span>補充位置</span>
                <input
                  name="detail"
                  aria-label="補充位置"
                  required
                  maxLength={500}
                  defaultValue={risk?.detail}
                  placeholder="例如：抽屜最內側"
                />
              </label>
              <label>
                <span>提醒頻率</span>
                <select
                  name="cadence"
                  aria-label="提醒頻率"
                  defaultValue={risk?.cadence || "DAILY"}
                >
                  {Object.entries(cadences).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </section>
            <div className="shell-button-stack">
              <button className="shell-primary" value="save">
                {busy
                  ? "儲存中…"
                  : risk && !risk.is_active
                    ? "重新啟用此風險位置"
                    : "儲存風險位置"}
              </button>
              {risk?.is_active && (
                <button className="shell-ghost" value="pause">
                  停用此風險位置
                </button>
              )}
              <button
                className="shell-secondary"
                type="button"
                onClick={() => go("risk-settings")}
              >
                取消
              </button>
            </div>
          </fieldset>
        </form>
      </>
    );
  else if (page === "risk-result")
    content = (
      <>
        {back("返回風險區設定", "risk-settings")}
        <section className="completion-state">
          <span>
            <Check className="ui-icon" />
          </span>
          <h1>{result?.active ? "風險位置已儲存" : "風險位置已停用"}</h1>
        </section>
        <section className="shell-card completion-card">
          <strong>
            {result?.active ? "已套用本店風險區提醒" : "員工不再收到此位置提醒"}
          </strong>
          <p>
            {result?.active
              ? "員工會依設定頻率看到這個位置。"
              : "歷史異常紀錄仍會保留，需要時可重新啟用。"}
          </p>
        </section>
        <button
          className="shell-primary full"
          onClick={() => go("risk-settings")}
        >
          返回風險區設定
        </button>
      </>
    );
  else if (page === "risk-issue" && risk && field)
    content = (
      <>
        {back("返回風險位置", "risk-detail")}
        <Intro
          title={issueType === "LABEL" ? "日期／標示異常" : "回報其他問題"}
          copy={`${risk.name}・${risk.zone_name}｜${risk.detail}`}
        />
        <form
          onSubmit={(e) => {
            const f = formValues(e);
            void save(
              "RISK_ISSUE",
              { risk_id: risk.id, type: issueType, note: text(f, "note") },
              confirmResult("risk"),
            );
          }}
        >
          <fieldset disabled={busy}>
            <section className="shell-card expiry-suggest-form">
              <label>
                <span>現場狀況</span>
                <textarea
                  name="note"
                  aria-label="現場狀況"
                  required
                  maxLength={2000}
                />
              </label>
            </section>
            <button className="shell-primary full">
              {busy ? "儲存中…" : "回報異常"}
            </button>
          </fieldset>
        </form>
      </>
    );
  else if (page === "risk-expired" && risk && field)
    content = (
      <>
        {back("返回風險位置", "risk-detail")}
        <Intro
          title="發現到期品"
          copy={`${risk.name}・${risk.zone_name}｜${risk.detail}`}
        />
        <form
          onSubmit={(e) => {
            const f = formValues(e);
            const action = (e.nativeEvent as SubmitEvent)
              .submitter as HTMLButtonElement;
            const expiry = text(f, "date");
            if (expiry > data.today) {
              setMessage("請確認現場到期日；此入口處理已到期品。");
              return;
            }
            setItem({
              id: "",
              name: text(f, "name"),
              expires_on: expiry,
              zone_id: text(f, "zone_id"),
              zone_name:
                data.zones.find((z) => z.id === text(f, "zone_id"))?.name || "",
              attention_reason: "保存期限短",
              source: "FIELD",
              unit: null,
              category: "urgent",
              created_at: "",
            });
            setUnit("");
            request.current = null;
            go(action.value === "used" ? "used" : "discard");
          }}
        >
          <section className="shell-card expiry-suggest-form">
            <label>
              <span>品項名稱</span>
              <input
                name="name"
                aria-label="品項名稱"
                required
                maxLength={200}
              />
            </label>
            <label>
              <span>到期日</span>
              <input
                name="date"
                aria-label="到期日"
                type="date"
                required
                max={data.today}
              />
            </label>
            <label>
              <span>目前儲放區</span>
              {zoneInput("目前儲放區", risk.zone_id)}
            </label>
          </section>
          <div className="shell-button-stack">
            <button className="shell-primary" value="discard">
              登記廢棄
            </button>
            <button className="shell-secondary" value="used">
              已使用完
            </button>
          </div>
        </form>
      </>
    );
  else if ((page === "used" || page === "discard") && item) {
    const overdue = item.expires_on < data.today;
    const base = item.id
      ? { expiry_id: item.id }
      : {
          new_expiry: {
            name: item.name,
            expires_on: item.expires_on,
            zone_id: item.zone_id,
            risk_id: risk?.id,
          },
        };
    content = (
      <>
        {back(
          item.id ? "返回立即處理" : "返回到期品",
          item.id ? "urgent" : "risk-expired",
        )}
        <Intro
          title={
            page === "used"
              ? "確認已使用完"
              : overdue
                ? "登記廢棄並回報延誤"
                : "登記廢棄"
          }
          copy={
            page === "used"
              ? "確認現場已無此批次，再移除效期提醒。"
              : overdue
                ? "請填寫延誤原因，完成廢棄紀錄。"
                : "正常處理今日到期品，只需確認廢棄數量與單位。"
          }
          badge={item.name}
        />
        {selectedMissing ? (
          <>
            <Empty>此品項已處理完成</Empty>
            <button
              className="shell-secondary full"
              onClick={() => go("history")}
            >
              查看廢棄紀錄
            </button>
          </>
        ) : page === "used" ? (
          <>
            <section className="shell-card result-list">
              <div>
                <span>品項</span>
                <strong>{item.name}</strong>
              </div>
              <div>
                <span>效期批次</span>
                <strong>{item.expires_on}</strong>
              </div>
              <div>
                <span>儲放區</span>
                <strong>{item.zone_name}</strong>
              </div>
            </section>
            <section className="shell-card expiry-no-action">
              <strong>只結束這個批次與區域的追蹤</strong>
              <span>
                商品與歷史效期紀錄仍會保留；其他批次或其他區域不受影響。
              </span>
            </section>
            {field && (
              <button
                className="shell-primary full"
                disabled={busy}
                onClick={() => void save("USED", base, confirmResult("expiry"))}
              >
                {busy ? "儲存中…" : "確認使用完並移除"}
              </button>
            )}
          </>
        ) : (
          field && (
            <form
              onSubmit={(e) => {
                const f = formValues(e);
                void save(
                  "WASTE",
                  {
                    ...base,
                    quantity: text(f, "quantity"),
                    unit,
                    delay_reason: text(f, "delay_reason"),
                  },
                  confirmResult("expiry"),
                );
              }}
            >
              <fieldset disabled={busy}>
                {overdue && (
                  <section className="shell-card quantity-reason-card">
                    <header>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.zone_name}・到期日 {item.expires_on}
                        </small>
                      </span>
                      <b>已逾期</b>
                    </header>
                    <label className="quantity-reason-note">
                      <span>為什麼未在到期前處理？（必填）</span>
                      <textarea
                        name="delay_reason"
                        aria-label="為什麼未在到期前處理？"
                        required
                        rows={3}
                        maxLength={2000}
                      />
                    </label>
                  </section>
                )}
                <section className="shell-card expiry-discard-form">
                  <div>
                    <span>儲放區</span>
                    <strong>{item.zone_name}</strong>
                  </div>
                  <div>
                    <span>標籤到期日</span>
                    <strong>{item.expires_on}</strong>
                  </div>
                  <div>
                    <span>廢棄原因</span>
                    <strong>效期到期</strong>
                  </div>
                  <label>
                    <span>廢棄數量</span>
                    <div className="expiry-discard-quantity">
                      <input
                        name="quantity"
                        type="number"
                        aria-label="廢棄數量"
                        required
                        min="0.001"
                        step="0.001"
                      />
                      {unitInput("廢棄單位")}
                    </div>
                  </label>
                </section>
                <button className="shell-primary full">
                  {busy
                    ? "儲存中…"
                    : overdue
                      ? "回報延誤並記錄廢棄"
                      : "確認並記錄廢棄"}
                </button>
              </fieldset>
            </form>
          )
        )}
      </>
    );
  } else if (page === "waste")
    content = (
      <>
        {rootBack()}
        <Intro title="廢棄" badge={data.store_name} />
        <div className="transfer-entry-grid">
          {field && (
            <button
              className="transfer-status-card"
              onClick={() => {
                openForm("waste-new");
                setFilter("today");
              }}
            >
              <span>
                <Trash2 className="ui-icon" />
              </span>
              <span>
                <strong>新增廢棄</strong>
                <small>品項、數量與原因</small>
              </span>
              <b>新增 ›</b>
            </button>
          )}
          <button
            className="transfer-status-card"
            onClick={() => go("history")}
          >
            <span>
              <ClipboardList className="ui-icon" />
            </span>
            <span>
              <strong>廢棄紀錄</strong>
              <small>查看已保存的紀錄</small>
            </span>
            <b>紀錄 ›</b>
          </button>
        </div>
      </>
    );
  else if (page === "waste-new" && field) {
    const duplicate = data.waste.find(
      (w) =>
        w.name === name && formOpenedAt - Date.parse(w.created_at) < 30 * 60000,
    );
    content = (
      <>
        {back("返回廢棄", "waste")}
        <Intro title="新增廢棄" badge={data.store_name} />
        <form
          onSubmit={(e) => {
            const f = formValues(e);
            const matches = data.products.filter((p) => p.name === name);
            void save(
              "WASTE",
              {
                name,
                quantity: text(f, "quantity"),
                unit,
                reason: text(f, "reason"),
                note: text(f, "note"),
                product_id: matches.length === 1 ? matches[0].id : null,
              },
              confirmResult("waste"),
            );
          }}
        >
          <fieldset disabled={busy}>
            <section className="shell-card transfer-form">
              <label>
                <span>品項</span>
                <input
                  name="name"
                  aria-label="品項"
                  list="waste-item-options"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    const p = data.products.filter(
                      (p) => p.name === e.target.value,
                    );
                    if (p.length === 1 && p[0].base_unit)
                      setUnit(p[0].base_unit);
                    else setUnit("");
                  }}
                />
                <datalist id="waste-item-options">
                  {data.products.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>數量</span>
                <div className="transfer-quantity">
                  <input
                    name="quantity"
                    type="number"
                    aria-label="數量"
                    required
                    min="0.001"
                    step="0.001"
                  />
                  {unitInput("單位")}
                </div>
              </label>
              <label>
                <span>廢棄原因</span>
                <select name="reason" aria-label="廢棄原因">
                  {wasteReasons.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>補充說明（選填）</span>
                <textarea
                  name="note"
                  aria-label="補充說明（選填）"
                  maxLength={2000}
                />
              </label>
            </section>
            <p className="shell-note">門市、經手人與時間會自動保存。</p>
            {duplicate && (
              <p className="shell-note">
                {name} {displayTime(duplicate.created_at)} 已登記{" "}
                {duplicate.quantity} {duplicate.unit}，仍要新增嗎？
              </p>
            )}
            <button className="shell-primary full">
              {busy ? "儲存中…" : "完成廢棄紀錄"}
            </button>
          </fieldset>
        </form>
      </>
    );
  } else if (page === "history") {
    const summary = wasteSummary(data.waste);
    const label =
      filter === "today" ? "今天" : filter === "month" ? "本月" : month;
    content = (
      <>
        {initialPage === "history"
          ? rootBack()
          : back(
              historyBack === "urgent" ? "返回立即處理" : "返回廢棄",
              historyBack,
            )}
        <Intro title="廢棄紀錄" badge={label} />
        <div className="filter-chips">
          {(["today", "month", "choose"] as const).map((v, i) => (
            <button
              key={v}
              className={filter === v ? "active" : ""}
              onClick={() => setFilter(v)}
            >
              {["今天", "本月", "選擇月份"][i]}
            </button>
          ))}
        </div>
        {filter === "choose" && (
          <input
            type="month"
            aria-label="選擇月份"
            value={month}
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
        )}
        {!data.has_erp && (
          <button
            className="shell-secondary full"
            onClick={() => setShowAmount((v) => !v)}
          >
            {showAmount ? "隱藏金額" : "顯示金額"}
          </button>
        )}
        <section className="shell-card result-list">
          <div>
            <span>{label}筆數</span>
            <strong>{summary.count} 筆</strong>
          </div>
          <div>
            <span>主要原因</span>
            <strong>{summary.reason}</strong>
          </div>
          {showAmount && !data.has_erp && (
            <div>
              <span>
                已提供參考金額
                {summary.unpriced > 0 ? `（${summary.unpriced} 筆未提供）` : ""}
              </span>
              <strong>
                {summary.unpriced === summary.count
                  ? "未提供"
                  : `NT$${summary.amount.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`}
              </strong>
            </div>
          )}
        </section>
        {data.waste.length ? (
          <WasteHistoryRows
            rows={data.waste}
            showAmount={showAmount && !data.has_erp}
            audit={permissions.audit}
          />
        ) : (
          <Empty>此期間沒有廢棄紀錄</Empty>
        )}
        {!data.has_erp && (
          <p className="shell-note">
            參考金額依最近一筆已發布、相同單位的進貨單價估算；未提供的價格不補
            0。
          </p>
        )}
      </>
    );
  } else if (page === "erp") {
    const rows = erpRows;
    const day = erpDay;
    content = (
      <>
        {rootBack()}
        <Intro
          title="登入 ERP 輸入今日廢棄"
          copy="依下列彙整一次輸入。"
          badge={`${rows.length} 筆`}
        />
        {!data.has_erp ? (
          <Empty>此門市未啟用公司流程</Empty>
        ) : (
          <>
            <section className="shell-card result-list">
              <div>
                <span>門市</span>
                <strong>{data.store_name}</strong>
              </div>
              <div>
                <span>廢棄日期</span>
                <strong>{day || data.today}</strong>
              </div>
              <div>
                <span>統一輸入時間</span>
                <strong>{data.erp_time}</strong>
              </div>
              <div>
                <span>目前狀態</span>
                <strong>{rows.length ? "等待輸入 ERP" : "已完成"}</strong>
              </div>
            </section>
            {[...new Set(data.erp_pending.map((w) => w.work_date))].length >
              1 && (
              <div className="filter-chips">
                {[...new Set(data.erp_pending.map((w) => w.work_date))].map(
                  (d) => (
                    <button
                      key={d}
                      onClick={() => {
                        setErpDay(d);
                        setErpRows(
                          data.erp_pending.filter((w) => w.work_date === d),
                        );
                        request.current = null;
                      }}
                    >
                      {d}
                    </button>
                  ),
                )}
              </div>
            )}
            <div className="shell-card result-list">
              {rows.map((w) => (
                <div key={w.id}>
                  <span>
                    {w.name}
                    <small>
                      {w.reason}・{w.actor_name}・{displayTime(w.created_at)}
                    </small>
                  </span>
                  <strong>
                    {w.quantity} {w.unit}
                  </strong>
                </div>
              ))}
            </div>
            {permissions.manage && rows.length > 0 && (
              <button
                className="shell-primary full"
                disabled={busy}
                onClick={() => {
                  setErpRows(rows);
                  setErpDay(day);
                  void save(
                    "ERP_COMPLETE",
                    { work_date: day, waste_ids: rows.map((w) => w.id) },
                    confirmResult("erp"),
                  );
                }}
              >
                {busy ? "儲存中…" : "確認已完成 ERP 輸入"}
              </button>
            )}
            <p className="shell-note">
              序保存應輸入明細、現場紀錄人、完成回報人與時間，供主管查核。
            </p>
          </>
        )}
      </>
    );
  } else if (page === "complete")
    content = (
      <>
        {rootBack()}
        <section className="completion-state">
          <span>
            <Check className="ui-icon" />
          </span>
          <h1>
            {result?.type === "USED"
              ? "已使用完，提醒已移除"
              : result?.type === "RISK_ISSUE"
                ? "異常已回報"
                : result?.type === "ERP_COMPLETE"
                  ? "已回報完成 ERP 輸入"
                  : "廢棄紀錄已完成"}
          </h1>
          {result?.already_completed && (
            <p>此筆已由門市人員處理，沒有重複新增。</p>
          )}
          {(completion || used) && (
            <p>
              {(completion || used)!.actor_name}・
              {displayTime((completion || used)!.created_at)}
            </p>
          )}
        </section>
        {completion && (
          <section className="shell-card completion-card">
            <strong>本次廢棄紀錄</strong>
            <p>
              品項：{completion.name}
              <br />
              數量：{completion.quantity} {completion.unit}
              <br />
              原因：{completion.reason}
              {completion.zone_name && (
                <>
                  <br />
                  儲放區：{completion.zone_name}
                </>
              )}
              {permissions.audit && completion.delay_reason && (
                <>
                  <br />
                  未處理原因：{completion.delay_reason}
                </>
              )}
            </p>
          </section>
        )}
        {used && (
          <section className="shell-card completion-card">
            <strong>{used.name}</strong>
            <p>
              {used.expires_on}・{used.zone_name}
            </p>
          </section>
        )}
        {completion && data.has_erp && (
          <section className="shell-card completion-card erp">
            <strong>已加入今日 ERP 廢棄彙整</strong>
            <p>{data.erp_time} 提醒負責人登入 ERP 輸入。</p>
          </section>
        )}
        <button
          className="shell-primary full"
          onClick={() =>
            completionOrigin === "erp"
              ? onBack()
              : go(
                  completionOrigin === "waste"
                    ? "waste"
                    : completionOrigin === "risk"
                      ? "risks"
                      : "urgent",
                )
          }
        >
          {completionOrigin === "erp"
            ? "返回公司流程待辦"
            : completionOrigin === "waste"
              ? "返回廢棄"
              : completionOrigin === "risk"
                ? "返回風險區"
                : "返回立即處理"}
        </button>
      </>
    );
  else
    content = (
      <>
        {rootBack()}
        <Empty>目前身份無法執行此操作</Empty>
      </>
    );
  return (
    <div className="expiry-waste-flow">
      {content}
      {status}
    </div>
  );
}

export function ExpiryWasteActivity({
  storeId,
  mode,
  onOpen,
}: {
  storeId: string;
  mode: "home" | "activity" | "tasks" | "notifications";
  onOpen: (page: ExpiryWastePage) => void;
}) {
  const today = taipeiDate(),
    [month, setMonth] = useState(today.slice(0, 7));
  const range = mode === "activity" ? monthRange(month) : [today, today];
  const { data, error, refresh } = useWorkspace(storeId, range[0], range[1]);
  if (error)
    return (
      <p role="alert">
        效期與廢棄{error}
        <button className="text-button" onClick={() => void refresh()}>
          重試
        </button>
      </p>
    );
  if (!data) return null;
  const urgent = data.items.filter((i) => i.category === "urgent");
  const erpDue = data.erp_pending.filter(
    (w) => w.work_date < data.today || data.erp_reminder_due,
  );
  const row = (title: string, copy: string, page: ExpiryWastePage) => (
    <button className="shell-list-row" onClick={() => onOpen(page)}>
      <span>
        <strong>{title}</strong>
        <small>{copy}</small>
      </span>
      <b>›</b>
    </button>
  );
  if (mode === "activity")
    return (
      <section className="shell-section">
        <div className="shell-section-head">
          <h2>效期與廢棄紀錄</h2>
        </div>
        <label>
          月份{" "}
          <input
            type="month"
            aria-label="效期與廢棄紀錄月份"
            value={month}
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
        </label>
        <div className="shell-card shell-list">
          {row("廢棄紀錄", `${data.waste.length} 筆`, "history")}
        </div>
        <div className="shell-card timeline-list">
          {data.used.map((r) => (
            <article key={r.id}>
              <i />
              <div>
                <strong>{r.name}・已使用完</strong>
                <small>
                  {r.expires_on}・{r.zone_name}・{r.actor_name}・
                  {displayTime(r.created_at)}
                </small>
              </div>
            </article>
          ))}
          {data.issues.map((r) => (
            <article key={r.id}>
              <i />
              <div>
                <strong>
                  {r.type === "LABEL" ? "日期／標示異常" : "其他問題"}・
                  {r.snapshot.name}
                </strong>
                <small>
                  {r.snapshot.zone_name}｜{r.snapshot.detail}・{r.actor_name}・
                  {displayTime(r.created_at)}
                </small>
                <p>{r.note}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  return (
    <>
      {urgent.length > 0 && (
        <section className="shell-section">
          <div className="shell-card shell-list">
            {row(
              "效期需要處理",
              `${urgent.length} 項已到期或今天到期`,
              "urgent",
            )}
          </div>
        </section>
      )}
      {mode !== "home" &&
        data.has_erp &&
        (mode === "tasks" ? data.erp_pending : erpDue).length > 0 && (
          <section className="shell-section">
            <div className="shell-section-head">
              <h2>公司流程待辦</h2>
            </div>
            <div className="shell-card shell-list">
              {row(
                "今日 ERP 廢棄彙整",
                `${data.erp_pending.length} 筆・${data.erp_time} 統一輸入`,
                "erp",
              )}
            </div>
          </section>
        )}
    </>
  );
}
