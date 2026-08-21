# PantryFlow Pilot v0.1 設定指南

本指南把 BeApe Pilot 接到 Supabase。正式試用前必須完成全部步驟；未設定 Supabase 時只會進入本機展示模式。

## 1. 建立 Supabase 專案

在 Supabase 建立新專案，記下：

- Project URL
- Publishable key，或 legacy anon key

這兩個值是瀏覽器端公開設定，安全性由 RLS 保護。不可使用或提交 `service_role` key。

## 2. 建立資料庫與私有 Storage

在 Supabase SQL Editor 依序執行：

1. `supabase/migrations/202608200001_pilot_v01.sql`
2. `supabase/seed.sql`

Migration 會建立資料表、RLS、不可覆蓋規則、交易式完成收貨函式，以及私有 `receipt-documents` bucket。

Seed 會建立固定 BeApe organization：

`00000000-0000-4000-8000-000000000001`

並加入 30 個商品、4 個盤點區域與 5 個供應商。

## 3. 建立三個 Pilot 帳號

在 Supabase Authentication 建立三個 Email/Password 使用者。從 `auth.users` 取得各自 UUID，然後在 SQL Editor 執行以下範例，將 `<..._AUTH_UUID>` 換成真實 UUID：

```sql
insert into public.profiles (id, organization_id, display_name, role, store)
values
  ('<ADMIN_AUTH_UUID>', '00000000-0000-4000-8000-000000000001', 'BeApe 管理員', 'ADMIN', 'BeApe'),
  ('<SUPERVISOR_AUTH_UUID>', '00000000-0000-4000-8000-000000000001', 'BeApe 主管', 'SUPERVISOR', 'BeApe'),
  ('<STAFF_AUTH_UUID>', '00000000-0000-4000-8000-000000000001', 'BeApe 員工', 'STAFF', 'BeApe')
on conflict (id) do update set
  organization_id = excluded.organization_id,
  display_name = excluded.display_name,
  role = excluded.role,
  store = excluded.store,
  is_active = true;
```

## 4. 填入前端公開設定

編輯 `config.js`：

```js
window.PANTRYFLOW_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_PUBLISHABLE_OR_ANON_KEY',
  organizationId: '00000000-0000-4000-8000-000000000001'
};
```

`config.example.js` 是欄位範例。正式環境仍只能放 publishable／anon key。

## 5. 部署與跨裝置驗證

推送至 `main` 後，等待 GitHub Pages 完成部署，再開啟：

https://rockru4211-lang.github.io/pantryflow/

至少用兩個不同帳號／裝置驗證：

1. STAFF 或 SUPERVISOR 建立盤點與上傳貨單。
2. ADMIN 在另一台裝置看到盤點結果與「收貨待核對」。
3. ADMIN 修正疑問欄位、完成收貨並匯出 Excel。
4. 回到第一台裝置重新整理，確認資料來自同一 organization。

## 6. 上線前檢查

- 頁首顯示「雲端已連線」，不是「本機展示」。
- Storage bucket `receipt-documents` 是 Private。
- 前端與 GitHub repository 內沒有 `service_role` key。
- 三個帳號角色與 organization 正確。
- RLS 下 STAFF 無法開啟其他人貨單原圖或後勤核對資料。
- ADMIN 能重新匯出盤點與進貨 Excel。
