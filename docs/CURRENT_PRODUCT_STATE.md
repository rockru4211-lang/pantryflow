# PantryFlow 現行產品狀態

最後更新：2026-08-22

本文件是 PantryFlow Pilot 的現況入口。產品願景與歷史決策仍保留，但實作、驗收與 PR 說明必須先以本文件及 `docs/DECISION_LOG.md` 為準。

## 正式 Pilot 範圍

正式 Pilot 目前只有兩條真實流程：

### A. 盤點

手機盤點 → 差異／原因 → ADMIN 盤點差異管理。

- 第一線依區域盲盤，使用手機快速輸入數量。
- 第一次實盤、複盤與更正是不可覆蓋事件。
- 差異與原因寫入正式 Supabase 資料表。
- ADMIN 在同一產品的桌機管理畫面查看差異、未回覆原因與完整 Excel。
- 相符品項不在管理明細展開，但仍保留於摘要及可重新產生的 Excel。

### B. 進貨／收貨

手機多張貨單上傳 → 私有 Storage → Gemini OCR → 後勤收貨待核對 → 正式收貨／Excel。

- 手機可將每張照片分成獨立貨單，或明確指定同一貨單多頁。
- 原圖存入 Supabase 私有 Storage；上傳成功並排入耐久佇列後第一線工作結束，手機不等待 Gemini。
- 受 JWT 保護的排程 Edge Function 使用有限並行背景 worker 執行 Gemini；失敗會保留原因、有限重試並可人工重跑。
- OCR run、逐欄 AI 原值、人工修正及正式收貨分開保存，不互相覆蓋。
- ADMIN 依 Organization、門市與實際收貨日進入每日收貨工作台，以供應商／貨單分組查看待處理與歷史資料。
- 工作台右側核對原圖、每次 OCR run、AI 原值、人工值與商品編碼，並以單一原始 batch／供應商完成正式收貨；呈現分組不會合併不同供應商、稅額或原圖。
- Excel 是可重建成果，不是原始資料來源。

## 正式資料來源

- 身分與登入：Supabase Auth。
- 結構化營運資料：Supabase Database，依 Organization 與 RLS 隔離。
- 貨單原圖：Supabase 私有 Storage。
- OCR：伺服器端 Edge Function 與 Gemini；模型金鑰只存在 Edge Function Secrets。

`mock`、預設展示資料及 `localStorage` 禁止作為正式 Pilot 資料、跨裝置同步依據或驗收證據。正式測試分支若缺少 Supabase 公開連線設定，必須停止載入，不得退回 local／seed 模式。前端只能使用 Supabase publishable／anon key，禁止放置伺服器密鑰。

## P0 身份修復進度

- 所有畫面固定標示「內部整合中，不可現場使用」，直到七項 P0 與跨裝置驗收全部通過。
- 已套用 `store_staff_pin_identity`：新增正式 `stores`、`staff_identities`、`store_memberships`，既有管理帳號只承接管理身份；沒有搬移任何舊盤點 session 或 OCR batch。
- 員工只能由 ADMIN／SUPERVISOR 建立，每人對應獨立 `auth.users`、profile、organization membership 與 store membership；公開自助註冊入口已停用。
- 員工 PIN 固定 6 位數，以 bcrypt 存於未暴露 Data API 的 `private` schema；錯誤 5 次鎖定 15 分鐘，重設由主管透過受 JWT 保護的 Edge Function 執行。
- 員工 PIN 驗證成功後交換的是正式 Supabase Auth session；不自製 JWT，也不以 `localStorage` 模擬身份。
- 上述項目已完成 schema／Edge Function／前端接線與 repository 測試，但尚未建立指定 Pilot 門市與真實 STAFF，跨裝置實測尚未通過，因此仍不可現場使用。

## 同一產品、同一資料流

主管桌機畫面與手機現場畫面是同一個 static HTML／CSS／vanilla JavaScript 產品、同一套帳號權限及同一條 Supabase 資料流。桌機只是 900px 以上的管理呈現；手機保留現場快速操作。不得另建第二個 Demo 前端替代正式產品。

## 分支、PR 與驗收狀態

| 項目 | 現況 |
|---|---|
| 基準 | 最新 `main`：`dee9cbb`，整合與產品文件已持續提交於 PR #7 |
| 整合分支 | `feat/receipt-review-ui-integration` |
| 整合 PR | [#7](https://github.com/rockru4211-lang/pantryflow/pull/7)，OPEN、未合併 `main` |
| 本文件分支 | `feat/receipt-review-ui-integration` |
| 文件治理 | 已直接納入並更新整合 PR #7，未建立第二套產品分支 |
| 本次設計 | `docs/RECEIPT_DAILY_WORKBENCH_DESIGN.md`；先行 commit `2fff913` |
| 已完成驗收 | JavaScript 語法、12 項 repository 自動測試、diff、前端 privileged credential 靜態掃描；actor profile FK 已在正式 Supabase 驗證 |
| 真實環境狀態 | P0 migration `store_staff_pin_identity` 已套用；`manage-staff` v2 與 `staff-pin-login` v1 已部署。資料庫仍只有 2 個管理身份、0 間正式 Store、0 個 PIN 員工，尚未進行真實登入驗收 |
| 暫時測試部署 | Pages 已以最小 policy 暫時部署 commit `224a119`；原 main 部署與完整還原方式見 `docs/TEMPORARY_PAGES_PILOT_DEPLOYMENT.md` |
| 尚待驗收 | 正式專案目前只有 2 個 ADMIN profile、沒有 STAFF；真實帳號、貨單與兩台裝置的七項證據尚未完成，詳見 `docs/PILOT_ACCEPTANCE_2026-08-23.md` |

## 下一個待辦

目前只執行 `docs/P0_REMEDIATION_PLAN.md` 的第一條可信垂直流程。下一步是建立指定 Pilot Store、正式 baseline 與 store-aware RLS，然後以真實 ADMIN／STAFF 跨裝置驗收。每日收貨工作台、Excel 匯入、寄庫與外觀擴充全部暫停；PR #7 不得由本任務自動合併。
