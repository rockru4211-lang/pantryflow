# PantryFlow Pilot v0.1

PantryFlow 是餐飲第一線的營運秘書。BeApe Pilot v0.1 專注兩條可實際試用的流程：

- 手機盲盤：分區輸入、自動存檔、不可覆蓋的第一次實盤與更正紀錄、差異整理、盤點 Excel。
- 進貨／收貨後勤：多張貨單上傳、私有原圖、待核對、商品編碼、疑問欄位修正、正式收貨、對帳 Excel。

正式前端位於 `pilot-v1/`，維持 static HTML、CSS、vanilla JavaScript 與 GitHub Pages；正式資料來源只使用 Supabase Auth、Database、私有 Storage 與背景 Edge Functions。缺少雲端設定或正式資料時只顯示阻擋／空狀態，不使用 seed、mock 或 `localStorage` 回退。

## 設定與啟動

1. 依照 migrations 建立正式 Supabase schema 與受控測試帳號，不執行 Demo seed。
2. 將 Supabase Project URL 與 publishable key 填入 `pilot-v1/config.js`。
3. 本機只從 `pilot-v1/index.html` 啟動；Pages 只由 `pilot-v1-preview` 部署 `pilot-v1/` artifact。

請勿把 Supabase `service_role` key 寫入前端或 repository。

## 線上網址

https://rockru4211-lang.github.io/pantryflow/

`legacy-demo/` 只保留歷史追溯，禁止被正式 Pilot 載入或部署。
