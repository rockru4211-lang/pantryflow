# PantryFlow Alpha

PantryFlow 是為餐飲現場設計的行動營運秘書。這個 Alpha 原型聚焦於：

- 今日待辦與庫存健康度
- 手機盲盤、草稿保存與庫存自動更新
- 依公司順序產生盤點總表
- 低庫存與效期提醒
- 快速異常回報
- 手動調整庫存與有效日期
- 異常處理追蹤與 CSV 庫存報表

## 開啟方式

直接用瀏覽器開啟 `index.html`，不需要安裝 Node.js 或其他套件。

目前資料會保存在使用者瀏覽器的本機儲存空間，重新整理或再次開啟仍會保留。下一階段可改為 Next.js + Supabase，加入帳號登入、多門市、雲端同步與永久資料庫。

## 線上測試

推送至 `main` 後，GitHub Actions 會自動部署到 GitHub Pages：

https://rockru4211-lang.github.io/pantryflow/
