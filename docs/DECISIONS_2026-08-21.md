# PantryFlow Pilot 上線決策｜2026-08-21

本文件是 2026-08-21 Pilot 第一階段的最高優先決策；若與較早決策衝突，以本文件為準。

## 1. Pilot 是公開測試產品，不是 Demo

正式登入後，帳號、Organization、盤點區域、商品、區域商品與盤點紀錄只讀寫 Supabase。`app.js` 內的預設商品與區域只能留在明確的 Prototype／Demo mode，不得混入 Pilot Cloud mode。

## 2. 使用者自行建立帳號與商家

新使用者可自行註冊、驗證 Email、登入、忘記密碼與更新密碼。首次登入若尚無 Organization，必須由使用者輸入商家名稱建立；建立者成為該 Organization 的 ADMIN。BeApe 僅是既有測試 Organization，不是新帳號預設值。

## 3. 盤點設定由商家建立

新 Organization 不自動建立區域或商品。ADMIN 可新增、改名、排序、停用盤點區域，新增商品，並將既有商品一次多選加入區域。停用保留歷史資料，不做實體刪除。

## 4. 正式盤點只使用 Supabase catalog

Pilot 盤點依 `count_zones → zone_products → products` 讀取。若沒有區域，顯示建立第一個區域；若區域沒有商品，提示加入商品。盲盤只顯示名稱、物料碼（若有）、數字輸入與唯讀單位。

## 5. 多租戶與權限

所有正式資料以 Organization 隔離。ADMIN 可管理 `products`、`count_zones`、`zone_products`；STAFF 只能執行獲准的現場作業，不可修改設定。前端只使用 publishable key，禁止使用 `service_role` 或 secret key。

## 6. Real Pilot 收貨 OCR（後續確認，優先於舊 mock 決策）

2026-08-21 晚間確認：公開 Pilot 的貨單辨識不得使用 mock。第一線只上傳原圖至私有 Storage，上傳成功後即可繼續工作；受 JWT 保護的 Edge Function 在伺服器端呼叫 OpenAI Vision。

每次辨識建立新的不可覆蓋 `receipt_ocr_runs` 版本，並保存 provider、model、prompt version、原始 provider response、逐欄 raw／normalized value、confidence、來源區域及 `TRUSTED／REVIEW／UNREADABLE` 判定。人工修正仍另存於 correction table。

可信度不得只採模型自評。品名衝突、圖片不清、欄位缺失及金額運算不一致一律進入人工核對；「功夫腿／功夫麵」類型的關鍵字衝突不得自動標記為 TRUSTED。

OpenAI key 與 Supabase server-side key 只存在 Edge Function Secrets，禁止進入前端或 GitHub。真實照片不得提交至公開 repository。
