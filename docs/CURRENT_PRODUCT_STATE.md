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

`mock`、預設展示資料及 `localStorage` 只能存在於明確標示的 Prototype／Demo 或暫存模式，禁止作為正式 Pilot 資料、跨裝置同步依據或驗收證據。前端只能使用 Supabase publishable／anon key，禁止放置伺服器密鑰。

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
| 已完成驗收 | JavaScript 語法、7 項 repository 自動測試、HTML ID、diff、前端 privileged credential 靜態掃描 |
| 真實環境狀態 | Supabase 正式專案健康；每日工作台與受控 Pilot migrations 已套用，`enqueue-receipt-ocr` v1 與 `process-receipt-ocr` v11 已部署且要求 JWT。Preview 仍為 `MIGRATIONS_FAILED` |
| 暫時測試部署 | Pages 已以最小 policy 暫時部署 commit `224a119`；原 main 部署與完整還原方式見 `docs/TEMPORARY_PAGES_PILOT_DEPLOYMENT.md` |
| 尚待驗收 | 正式專案目前只有 2 個 ADMIN profile、沒有 STAFF；真實帳號、貨單與兩台裝置的七項證據尚未完成，詳見 `docs/PILOT_ACCEPTANCE_2026-08-23.md` |

## 下一個待辦

目前進入 2026-08-23 受控 Pilot 交付，正式範圍與七項驗收閘門見 `docs/CONTROLLED_PILOT_2026-08-23.md`。商品 Excel 匯入、空白／0 盤點語意、多區域加總、批次保存狀態與 ERP 待驗收提示必須先在 staging 驗證，再完成 GitHub Pages 與跨裝置真實驗收。寄庫本輪只有正式資料設計入口，完整採購、寄庫餘額、領回、轉入庫存與對帳列為下一輪。PR #7 不得由本任務自動合併。
