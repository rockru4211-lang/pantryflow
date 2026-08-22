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
- 原圖存入 Supabase 私有 Storage；上傳成功後第一線工作結束。
- 受 JWT 保護的 Edge Function 使用 Gemini 執行真實 OCR。
- OCR run、逐欄 AI 原值、人工修正及正式收貨分開保存，不互相覆蓋。
- ADMIN 在同一產品的桌機畫面核對原圖、AI 原值、人工值，並以正式交易完成收貨。
- Excel 是可重建成果，不是原始資料來源。

## 正式資料來源

- 身分與登入：Supabase Auth。
- 結構化營運資料：Supabase Database，依 Organization 與 RLS 隔離。
- 貨單原圖：Supabase 私有 Storage。
- OCR：伺服器端 Edge Function 與 Gemini；模型金鑰只存在 Edge Function Secrets。

`mock`、預設展示資料及 `localStorage` 只能存在於明確標示的 Prototype／Demo 或暫存模式，禁止作為正式 Pilot 資料、跨裝置同步依據或驗收證據。前端只能使用 Supabase publishable／anon key，禁止放置伺服器密鑰。

## 同一產品、同一資料流

主管桌機畫面與手機現場畫面是同一個 static HTML／CSS／vanilla JavaScript 產品、同一套帳號權限及同一條 Supabase 資料流。桌機只是 900px 以上的管理呈現；手機保留現場快速操作。不得另建第二個 Demo 前端替代正式產品。

## 分支、PR 與驗收狀態

| 項目 | 現況 |
|---|---|
| 基準 | 最新 `main`：`dee9cbb`，加上整合 commit `404c6e5` |
| 整合分支 | `feat/receipt-review-ui-integration` |
| 整合 PR | [#7](https://github.com/rockru4211-lang/pantryflow/pull/7)，OPEN、未合併 `main` |
| 本文件分支 | `feat/receipt-review-ui-integration` |
| 文件治理 | 已直接納入並更新整合 PR #7，未建立第二套產品分支 |
| 已完成驗收 | JavaScript 語法、HTML ID、diff、前端 privileged credential 靜態掃描；PR #7 merge state CLEAN |
| 尚待驗收 | GitHub Pages 實際部署；ADMIN、SUPERVISOR、STAFF 以正式 Supabase 帳號完成手機／桌機端到端驗收 |

## 下一個待辦

依 `docs/RELEASE_CHECKLIST.md` 在部署環境完成 GitHub Pages 與 Supabase 驗收，特別確認 RLS、私有原圖 signed URL、Gemini OCR、正式收貨交易，以及 ADMIN 盤點差異重新整理／Excel。PR #7 不得由本任務自動合併。
