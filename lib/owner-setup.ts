export type OwnerSetupDraft = {
  organization_name: string; business_type: string; store_mode: string;
  store_name: string; store_code: string; staff_login_mode: string; work_role: string;
};
export type OwnerSetup = { required: boolean; step: "business" | "store" | "manager" | "complete"; revision: number; draft: OwnerSetupDraft };
export function parseOwnerSetup(value: unknown): OwnerSetup {
  const v = value as Partial<OwnerSetup> | null;
  if (!v || typeof v.required !== "boolean" || !["business", "store", "manager", "complete"].includes(v.step || "") || (v.required && (!v.draft || !Number.isInteger(v.revision))))
    throw new Error("OWNER_SETUP_READ_FAILED");
  if (v.required === (v.step === "complete")) throw new Error("OWNER_SETUP_READ_FAILED");
  const d = v.draft;
  return { required: v.required, step: v.step!, revision: v.revision || 0, draft: {
    organization_name: d?.organization_name || "", business_type: d?.business_type || "", store_mode: d?.store_mode || "",
    store_name: d?.store_name || "", store_code: d?.store_code || "", staff_login_mode: d?.staff_login_mode || "NAME_OR_NICKNAME", work_role: d?.work_role || "",
  } };
}
export function ownerSetupError(message: string) {
  if (/OWNER_WORK_ROLE_REQUIRED/.test(message)) return "請選擇您的工作身分。";
  if (/INVITE_ACCEPT_REQUIRED/.test(message)) return "此帳號有商家邀請，請重新開啟並確認加入。";
  if (/OWNER_STORE_CODE_TAKEN|stores_store_code/.test(message)) return "此門市代碼已被使用，請換一個代碼。";
  if (/OWNER_BUSINESS_NAME_REQUIRED/.test(message)) return "請填寫餐廳／品牌名稱。";
  if (/OWNER_SETUP_BUSINESS_REQUIRED/.test(message)) return "請確認餐廳類型與門市數量。";
  if (/OWNER_SETUP_STORE_REQUIRED/.test(message)) return "請填寫門市名稱、2–32 位英數門市代碼，並選擇員工登入方式。";
  if (/OWNER_SETUP_VALUE_TOO_LONG/.test(message)) return "名稱或門市代碼過長，請縮短後再試。";
  if (/OWNER_SETUP_CHANGED/.test(message)) return "設定已在另一個視窗更新，請重新開啟以接續最新進度。";
  if (/OWNER_EMAIL_NOT_VERIFIED/.test(message)) return "請先完成 Email 驗證，再接續商家設定。";
  if (/OWNER_SETUP_NOT_READY/.test(message)) return "請返回確認商家與門市資料，再完成設定。";
  return "無法讀取或儲存商家設定，請稍後重試；目前輸入會保留。";
}
