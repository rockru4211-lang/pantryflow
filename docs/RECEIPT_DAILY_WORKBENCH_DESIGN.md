# 每日收貨工作台：資料設計與 migration plan

日期：2026-08-22  
狀態：已核准實作（PR #7）

## 現況與不變條件

目前正式流程已將每次現場上傳拆成 `receipt_upload_batches`，原圖存於私有 Storage 並由 `receipt_documents` 留下不可覆蓋的路徑；每次辨識建立新的 `receipt_ocr_runs.version`，AI 原值寫入 `receipt_ocr_fields`，人工修正另寫 `receipt_review_corrections`。正式收貨由 `finalize_goods_receipt` 以單一 `source_batch_id` 建立 `goods_receipts`／`receipt_lines`，並以唯一限制保持冪等。

本次維持下列邊界：

- 不修改或刪除既有原圖、OCR run、AI 原值、人工修正、正式收貨及稽核紀錄。
- 每次 OCR 嘗試都建立新的 run；重試或人工重跑不得更新舊 run 的辨識結果。
- 每筆正式收貨仍只對應一個原始 upload batch。每日工作台只提供查詢、分組與操作入口，不合併不同供應商、稅額或原圖的正式收貨。
- 正式資料只來自 Supabase Auth、Database 與私有 Storage；不新增 mock 或 localStorage 正式流程。

## 最小可行資料設計

### 1. 批次增加工作台快照

在 `receipt_upload_batches` 加入：

| 欄位 | 用途 |
| --- | --- |
| `store_name text` | 上傳當下門市快照，避免日後人員調店改寫歷史歸屬 |
| `work_date date` | 門市實際收貨日；初始值按 `Asia/Taipei` 由 `uploaded_at` 推導，可在正式收貨時以確認日期補齊 |

既有資料只做非破壞性回填：`store_name` 取上傳者 `profiles.store`，找不到時標記「未指定門市」；`work_date` 取台北時區上傳日期。完成回填後設為非空。這兩個欄位是歷史快照，不以 profile join 即時計算。

工作台索引以 `(organization_id, work_date, store_name, status)` 為主。供應商名稱來自最新成功 OCR 的 `document.supplier_name`，正式完成後以 `goods_receipts.supplier_id` 為準；MVP 不建立容易失真的彙總表。

### 2. 耐久 OCR 工作佇列

新增 `receipt_ocr_jobs`，一列代表一次排程要求：

- 關聯：`organization_id`、`batch_id`、`requested_by`。
- 狀態：`QUEUED`、`RUNNING`、`SUCCEEDED`、`FAILED`。
- 重試：`attempt_count`、`max_attempts`、`available_at`、`locked_at`、`lease_token`、`last_error`。
- 追溯：`created_at`、`started_at`、`completed_at`，以及成功時的 `ocr_run_id`。
- 同一批次同時間最多一個 `QUEUED`／`RUNNING` job；完成或失敗後可追加新 job 重跑。

前端只能透過 `enqueue_receipt_ocr` RPC 排程自己組織內、有權限的批次；一般使用者可讀自己組織內 job 狀態，但不可直接更新或刪除。租約、完成與重試 RPC 只授權 `service_role`，並明確撤銷 `anon`／`authenticated` 執行權。所有新 public table 明確設定 grants、啟用 RLS 並建立 organization policy。

### 3. 背景執行模型

`process-receipt-ocr` Edge Function 改為排程端點：

1. 驗證 JWT、profile、organization、批次與原圖。
2. 呼叫 `enqueue_receipt_ocr`，立即回傳 `202` 與 job 狀態。
3. 以 `EdgeRuntime.waitUntil` 啟動 drain；worker 每輪最多租用 2 個 job，有限並行處理。
4. 每次 attempt 先使用既有 `create_receipt_ocr_run` 建立新版本，再讀私有原圖並呼叫 Gemini。
5. 成功標記 job／run 成功；失敗保留錯誤，未達上限則延遲後回到 `QUEUED`，達上限則 `FAILED`。過期 lease 可由下一次 drain 接手。

上傳端只等待檔案與資料列成功、以及短時間的 enqueue 回應，不等待 Gemini。管理者可對失敗 job 重新排程；任何新的上傳、重新整理或人工重跑都會觸發 drain。正式環境可再以 Supabase Cron 定期呼叫同一 worker，作為低流量時的保險，不改變資料模型。

## 每日工作台查詢與互動

桌機「進貨管理」以 organization RLS 為界，依 `store_name + work_date` 查詢批次，並提供門市、日期、供應商與狀態篩選。

- 今日摘要：辨識中、待核對、有疑問、異常、已完成。
- 預設清單：`UPLOADED`／`PROCESSING`、`READY_FOR_REVIEW`／`REVIEWING`，以及最新 OCR 或 job 失敗項目。
- 「查看全部」：加入已完成資料，不隱藏歷史。
- 供應商／貨單分組：只影響呈現；每個 batch 保有自己的原圖、OCR runs、修正與 finalize 按鈕。
- 右側詳情：原圖簽名網址、全部 OCR run、選定 run 的 AI 原值、人工修正、商品 mapping，以及單批正式收貨。

手機仍保留既有快速拍照／多張路由；成功排程後立即回首頁，批次在桌機與手機均顯示「辨識中」。

## Migration 與回復策略

1. 新增 nullable 快照欄位與 `receipt_ocr_jobs`、索引、約束、grants、RLS、RPC。
2. 回填既有批次的門市與日期，再將快照欄位改為非空並設定新資料預設／建立批次時明確寫入。
3. 部署相容新舊批次的前端與 Edge Function；正式收貨 RPC 僅補充 `work_date`，不改寫任何歷史 OCR 或原圖。
4. 驗證 RLS、匿名與 authenticated 無法直接修改 job，worker RPC 不對前端角色開放。
5. 若需回復應用版本，保留新增欄位與 job 紀錄；舊應用會忽略加法式 schema，不需刪資料或逆向 migration。

## 驗收

- 多張貨單上傳後，前端不等待 Gemini 即返回；新批次顯示辨識中。
- 同時最多處理 2 個 job，失敗可重試且每次產生新 OCR run。
- 重新整理後 job 狀態、原圖、每次 AI 原值、人工修正及正式收貨皆可追溯。
- 日工作台可依門市、日期、供應商、狀態篩選；預設只顯示待處理，查看全部包含完成資料。
- finalize 一次只接受一個 `batch_id`，無跨供應商／稅額／原圖合併路徑。
- 前端 bundle 與 repository 無 `service_role`、Gemini key 或其他 secret；既有手機、RLS 與 Excel 測試持續通過。
