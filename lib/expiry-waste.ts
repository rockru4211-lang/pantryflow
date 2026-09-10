export type ExpiryItem = {
  id: string;
  name: string;
  expires_on: string;
  zone_id: string | null;
  zone_name: string;
  attention_reason: string;
  source: string;
  unit: string | null;
  category: "urgent" | "upcoming" | "special";
  created_at: string;
};
export type RiskLocation = {
  id: string;
  name: string;
  zone_id: string;
  zone_name: string;
  detail: string;
  cadence: string;
  is_active: boolean;
  due: boolean;
  updated_at: string;
};
export type WasteRecord = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  reason: string;
  note: string | null;
  delay_reason: string | null;
  source: string;
  store_name: string;
  zone_name: string | null;
  expires_on: string | null;
  actor_name: string;
  created_at: string;
  work_date: string;
  reference_price: number | null;
  reference_amount: number | null;
  erp_report: { actor_name: string; created_at: string } | null;
};
export type ExpiryWorkspaceData = {
  today: string;
  store_name: string;
  has_erp: boolean;
  erp_time: string;
  erp_reminder_due: boolean;
  permissions: { field: boolean; manage: boolean; audit: boolean };
  items: ExpiryItem[];
  risks: RiskLocation[];
  zones: { id: string; name: string }[];
  products: { id: string; name: string; base_unit: string | null }[];
  waste: WasteRecord[];
  used: {
    id: string;
    name: string;
    zone_name: string;
    expires_on: string;
    actor_name: string;
    created_at: string;
  }[];
  issues: {
    id: string;
    type: string;
    note: string;
    actor_name: string;
    created_at: string;
    snapshot: RiskLocation;
  }[];
  erp_pending: Pick<
    WasteRecord,
    | "id"
    | "name"
    | "quantity"
    | "unit"
    | "reason"
    | "actor_name"
    | "created_at"
    | "work_date"
  >[];
};
export const attentionReasons = [
  "保存期限短",
  "使用速度慢",
  "容易被遺忘",
  "高單價食材（主管自訂）",
];
export const wasteReasons = [
  "效期到期",
  "品質異常",
  "製作或操作損耗",
  "保存或設備異常",
  "供應商問題",
  "其他",
];
export const cadences: Record<string, string> = {
  DAILY: "每日",
  MON: "每週一",
  WED: "每週三",
  FRI: "每週五",
};
export const units = [
  "份",
  "包",
  "公克",
  "公斤",
  "瓶",
  "盒",
  "罐",
  "個",
  "箱",
  "袋",
  "公升",
  "毫升",
  "台斤",
  "顆",
  "片",
  "支",
  "CAN",
];
export const taipeiDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export function monthRange(month: string): [string, string] {
  const [year, m] = month.split("-").map(Number);
  return [
    `${month}-01`,
    `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, "0")}`,
  ];
}
export function expiryCategory(
  date: string,
  reason: string,
  today: string,
): "urgent" | "upcoming" | "special" | null {
  if (date <= today) return "urgent";
  if (Date.parse(date) - Date.parse(today) <= 3 * 86400000) return "upcoming";
  return attentionReasons.slice(1).includes(reason) ? "special" : null;
}
export const expiryDateLabel = (date: string, today: string) =>
  `${date < today ? "已到期" : date === today ? "今日到期" : "到期日"}｜${date.replaceAll("-", "/")}`;
export function wasteSummary(rows: WasteRecord[]) {
  const reasons = new Map<string, number>();
  for (const r of rows) reasons.set(r.reason, (reasons.get(r.reason) || 0) + 1);
  const priced = rows.filter((r) => r.reference_amount !== null);
  return {
    count: rows.length,
    reason:
      [...reasons]
        .sort((a, b) => b[1] - a[1])
        .map((r) => r[0])
        .slice(0, 2)
        .join("、") || "—",
    amount: priced.reduce((sum, r) => sum + r.reference_amount!, 0),
    unpriced: rows.length - priced.length,
  };
}
export function expiryError(error: unknown): string {
  const text =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
  const messages: Record<string, string> = {
    STORE_ACCESS_DENIED: "無法讀取此門市，請重新登入。",
    FIELD_MANAGER_REQUIRED: "只有本店店長／主管可以操作。",
    FIELD_ROLE_REQUIRED: "此身份可查看，現場處理由門市人員執行。",
    QUANTITY_UNIT_REQUIRED: "請填寫大於 0 的實際數量及單位，數量最多三位小數。",
    DELAY_REASON_REQUIRED: "請填寫「為什麼未在到期前處理？」。",
    ZONE_REQUIRED: "請選擇本店目前使用的儲放區。",
    RISK_CHANGED: "此位置已由其他人更新，請返回設定頁重新開啟。",
    RISK_NOT_FOUND: "此風險位置已停用或不存在，請返回風險區。",
    ERP_LIST_CHANGED: "彙整內容已更新，請返回待辦重新開啟後確認。",
    EXPIRY_NOT_DUE: "此品項尚未到期，請返回效期提醒。",
    REQUEST_REUSED: "此表單先前已儲存不同內容，請至作業紀錄確認。",
  };
  return (
    Object.entries(messages).find(([key]) => text.includes(key))?.[1] ||
    "尚未確認儲存完成，請重試；同一操作不會重複建檔。"
  );
}
