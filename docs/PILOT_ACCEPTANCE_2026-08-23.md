# PantryFlow 受控 Pilot 驗收紀錄｜2026-08-23

最後更新：2026-08-22  
分支：`feat/receipt-review-ui-integration`  
PR：[#7](https://github.com/rockru4211-lang/pantryflow/pull/7)（OPEN，不合併 main）

## 證據規則

只有由正式 Supabase Auth、Database、私有 Storage 與 Gemini Edge Function 產生，且可由另一台裝置重新查得的記錄才算通過。repository 自動測試、localStorage、預設資料、畫面截圖或假成功訊息都不能代替真實驗收。

## 環境前置狀態

| 項目 | 實際狀態 | 判定 |
|---|---|---|
| PR | #7 為 OPEN，head 是 `feat/receipt-review-ui-integration` | 符合不合併 main 要求 |
| Supabase | 專案 `tkedzwlzknetmhpsmths` 為 `ACTIVE_HEALTHY` | 可連線，不代表新 schema 已就緒 |
| Supabase Preview | 只有 `main`，狀態 `MIGRATIONS_FAILED` | 阻塞 PR 隔離驗收 |
| 遠端 migration | `daily_receipt_workbench_queue`、`controlled_pilot_catalog_count_lots`、hardening migration 已成功套用；既有 25 個 batch 均有門市／日期 | schema 通過，操作未驗收 |
| Edge Functions | `enqueue-receipt-ocr` v1、`process-receipt-ocr` v11 為 ACTIVE 且要求 JWT | 部署通過，真實貨單未驗收 |
| Security advisor | 本輪 trigger-only functions 已撤銷 API 執行權；`enqueue_receipt_ocr` 的 signed-in 警告屬刻意公開且函式內驗證 Organization／角色／擁有者 | 本輪 hardening 通過；專案既有警告另行追蹤 |
| GitHub Pages | 已只新增此單一分支 policy；workflow run `32579279780` 成功部署 commit `224a119`，公開檔案雜湊相符；還原方式見 `docs/TEMPORARY_PAGES_PILOT_DEPLOYMENT.md` | 部署通過 |
| 測試帳號 | 正式資料庫目前只有 2 個 ADMIN profile、沒有 STAFF；repository 不保存密碼 | 未通過 |

## 七項實測證據

| # | 驗收場景 | 結果 | 證據／失敗原因 |
|---|---|---|---|
| 1 | STAFF 手機真實登入，建立／輸入盤點 | 未執行，不可用 | 正式專案目前沒有 STAFF profile，且缺 PR 預覽部署 |
| 2 | ADMIN 在另一台電腦看到同筆盤點、差異與操作者 | 未執行，不可用 | 缺兩台裝置與 ADMIN 測試帳號 |
| 3 | STAFF 上傳多張真實貨單到私有 Storage，背景 OCR 完成 | 未執行，不可用 | queue 與 worker 已部署，但沒有 STAFF 帳號與真實測試上傳 |
| 4 | ADMIN 跨裝置修正、商品編碼並正式收貨 | 未執行，不可用 | 新 schema 已部署，但 PR 前端尚無可測 URL |
| 5 | 驗證未稅、稅額、含稅總額與 Excel | 未執行，不可用 | 需以真實貨單及正式收貨資料驗算 |
| 6 | 驗證錯誤數量、模糊貨單、多區域同商品不覆蓋 | 未執行，不可用 | 需在已部署 schema 建立真實事件後查核 |
| 7 | GitHub Pages、RLS、角色、手機／桌機同資料流 | 部分通過，整項未通過 | Pages 與本輪 RLS 部署通過；尚缺 STAFF 與跨裝置角色實測 |

## 已完成但不等於現場驗收

- JavaScript 語法、diff 與 HTML ID 檢查。
- 7 項 repository 自動測試：背景 queue、每日工作台維度、手機只排程一次、ADMIN 商品匯入、空白與 0、批次事件不可覆蓋、ERP 提醒。
- 靜態掃描確認前端沒有 `service_role`、Gemini API key 或其他 privileged credential。

## 明晚驗收順序

1. 先修復或建立可隔離的 Supabase Preview，依 migration 順序套用 schema，部署 `enqueue-receipt-ocr` 與 `process-receipt-ocr`。
2. 以同一正式前端分支產生可分享的預覽 URL；不得另建 Demo。
3. 準備同 Organization 的 STAFF 與 ADMIN 帳號，由使用者保管密碼。
4. 依上表 1 至 7 操作，逐項記錄 session、batch、OCR run、receipt、Excel 及裝置證據。
5. 任何失敗項維持「不可用」，列入下一輪；不得以手動改資料或 localStorage 補成通過。
