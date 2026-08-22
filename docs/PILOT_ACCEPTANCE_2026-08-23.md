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
| 遠端 migration | 最新為 `allocate_receipt_ocr_run_version`；每日工作台及本輪 migration 尚未套用 | 未通過 |
| Edge Functions | 遠端只有 `process-receipt-ocr`；`enqueue-receipt-ocr`／新版 worker 尚未部署 | 未通過 |
| GitHub Pages | `https://rockru4211-lang.github.io/pantryflow/` 只由 `main` 或人工 workflow dispatch 部署 | PR #7 尚無可實測版本 |
| 測試帳號 | repository 不保存密碼；尚未取得可操作的 STAFF／ADMIN 測試帳號 | 未通過 |

## 七項實測證據

| # | 驗收場景 | 結果 | 證據／失敗原因 |
|---|---|---|---|
| 1 | STAFF 手機真實登入，建立／輸入盤點 | 未執行，不可用 | 缺 PR 預覽部署及 STAFF 測試帳號 |
| 2 | ADMIN 在另一台電腦看到同筆盤點、差異與操作者 | 未執行，不可用 | 缺兩台裝置與 ADMIN 測試帳號 |
| 3 | STAFF 上傳多張真實貨單到私有 Storage，背景 OCR 完成 | 未執行，不可用 | queue migration 與 enqueue function 尚未部署 |
| 4 | ADMIN 跨裝置修正、商品編碼並正式收貨 | 未執行，不可用 | 新 schema 與 PR 前端尚未部署 |
| 5 | 驗證未稅、稅額、含稅總額與 Excel | 未執行，不可用 | 需以真實貨單及正式收貨資料驗算 |
| 6 | 驗證錯誤數量、模糊貨單、多區域同商品不覆蓋 | 未執行，不可用 | 需在已部署 schema 建立真實事件後查核 |
| 7 | GitHub Pages、RLS、角色、手機／桌機同資料流 | 未執行，不可用 | PR 分支沒有 Pages URL；Supabase Preview migration 失敗 |

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
