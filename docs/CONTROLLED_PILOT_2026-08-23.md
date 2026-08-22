# PantryFlow 受控 Pilot｜2026-08-23

狀態：實作與驗收中的正式交付範圍  
分支：`feat/receipt-review-ui-integration`  
PR：[#7](https://github.com/rockru4211-lang/pantryflow/pull/7)（不得合併 main）

## 交付定義

本次交付必須能由餐廳 STAFF 與 ADMIN 使用兩台裝置、個人帳號及同一 Organization 跑完一次真實盤點與真實進貨。正式資料只來自 Supabase Auth、Database 與私有 Storage；Gemini OCR 只在 Edge Function 背景執行。

任何只在 localStorage、預設資料或單一裝置成立的功能不列入可用範圍。沒有真實跨裝置證據的項目一律維持「待驗收」或「下一輪」。

## 本輪正式資料設計

### 商品主檔匯入

Excel 在瀏覽器只做解析與預檢，不是正式資料來源。ADMIN 必須先看到欄位對應及逐列結果，再以 `import_catalog_products` RPC 在單一資料庫交易中寫入 `products`。

必要欄位：商品名稱、基準單位、盤點單位。可選欄位：物料碼、規格、分類、供應商編碼。重複判定先比對 Organization 內物料碼，再提示同名＋規格候選；有錯誤或重複的列不會靜默覆蓋。

### 盤點的空白、0 與多區域

- `0` 是有效實盤數量。
- 空白是「本次未提供數量」，必須與 0 分開保存；不可拿空白製造假差異。
- 草稿可更新；送出區域後建立不可覆蓋的 `INITIAL_COUNT` observation。複盤／更正追加新事件。
- 同一商品可存在多個 `zone_products`，後勤按同一 session＋product 加總有效數量，同時保留各區域原始 observation、操作者及時間。

### 批次與保存狀態

新增不可覆蓋的 `inventory_lots` 身分與 `inventory_lot_events` 事件：

- `ORIGINAL_EXPIRY`：原廠效期。
- `THAWED_UNOPENED`：解凍未開封。
- `OPENED`：已開封。

lot 保存 Organization、門市、區域、商品、批號／原廠效期與來源；event 保存收貨、解凍、開封的發生日、數量、操作者與來源。狀態變更追加 event，不改寫上一個 event。正式收貨可建立 `RECEIVED` event 並關聯 `goods_receipt`／`receipt_line`。

盤點主畫面不展開效期細節；只有效期巡檢或異常入口查詢 lot 風險。

### ERP 邊界

完成 PantryFlow 收貨核對後，狀態為「已完成 PantryFlow 核對／待 ERP 驗收」。PantryFlow 保存可重建 Excel 與 ERP 回填所需欄位，但不宣稱已寫入或取代連鎖 ERP。

## 明晚驗收閘門

以下七項只有取得真實證據才可標示通過：

1. STAFF 手機登入並建立／輸入盤點。
2. ADMIN 在另一台裝置看到同一筆盤點、差異、操作者與時間。
3. STAFF 多張真實貨單進私有 Storage，離開頁面後背景 OCR 完成。
4. ADMIN 在另一台裝置完成修正、商品 mapping 與正式收貨。
5. 未稅、稅額、含稅總額及兩種 Excel 匯出正確。
6. 錯誤數量、模糊貨單、多區域同商品不覆蓋原始資料。
7. GitHub Pages、RLS、角色與行動／桌機版均通過。

## 下一輪：寄庫

本輪只建立正式設計入口，不建立按鈕、placeholder 或假成功流程。

完整寄庫下一輪必須一次設計：

- 採購／進貨來源與供應商。
- 供應商寄庫 lot 與所有權狀態。
- 寄庫餘額（不得只存可覆蓋總數，必須由事件重建）。
- 領回數量、日期、操作者與原始來源。
- 領回後轉入門市正式庫存 lot/event。
- 供應商對帳區間、期初、入庫、領回、調整、期末與差異。
- Organization／store RLS、冪等、沖銷與稽核。

在上述交易與權限邊界完成並通過測試前，寄庫不得標示為可用。
