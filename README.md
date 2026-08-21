# PantryFlow Pilot v0.1

PantryFlow 是餐飲第一線的營運秘書。BeApe Pilot v0.1 專注兩條可實際試用的流程：

- 手機盲盤：分區輸入、自動存檔、不可覆蓋的第一次實盤與更正紀錄、差異整理、盤點 Excel。
- 進貨／收貨後勤：多張貨單上傳、私有原圖、待核對、商品編碼、疑問欄位修正、正式收貨、對帳 Excel。

前端維持 static HTML、CSS、vanilla JavaScript 與 GitHub Pages；正式資料來源使用 Supabase Auth、Database 與 Storage。`localStorage` 只提供尚未設定雲端時的展示與暫存，不是 Pilot 正式資料來源。

## 設定與啟動

1. 依照 [Pilot 設定指南](docs/PILOT_SETUP.md)建立 Supabase schema、seed 與測試帳號。
2. 將 Supabase Project URL 與 publishable／anon key 填入 `config.js`。
3. 開啟 `index.html` 本機測試，或推送 `main` 由 GitHub Pages 部署。

請勿把 Supabase `service_role` key 寫入前端或 repository。

## 線上網址

https://rockru4211-lang.github.io/pantryflow/

未填入 Supabase 設定時，頁面會顯示「本機展示」；填妥後才是可跨裝置同步的 Pilot 模式。
