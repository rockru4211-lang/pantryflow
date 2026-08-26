# PF-LOGIN-SEQUENTIAL-20260825

狀態：**已取代**（由 `PF-LOGIN-FINAL-20260826` 取代）
日期：2026-08-25
來源：使用者要求依「登入 → 登入後畫面 → 盤點 → 進貨」逐項處理；本決策只處理第一項。

> 2026-08-26 更新：三身份入口與單頁 Owner 建店流程已被最新定案圖取代。本文件只保留歷史，不得再作為實作或驗收依據。

## 本階段鎖定範圍

1. 初始頁固定顯示「員工快速登入／店長／主管／後勤／管理」三個身份入口，順序依 `PF-UIV2-IMG-01`。
2. 店長／主管及後勤／管理共用 Supabase Email＋密碼 Auth；身份入口不取代真實 membership 權限。
3. 管理帳號支援註冊、Email 驗證、忘記密碼及設定新密碼。
4. 新 Owner 驗證 Email 後，先以既有 `create_owner_business` 原子流程建立商家及第一間門市，再進入該門市的 ADMIN 首頁。
5. 員工依序輸入門市識別碼、姓名／暱稱或員工編號、6 位 PIN；連續錯誤 5 次鎖定 15 分鐘。
6. 登入後的實際頁面角色只取自 `store_memberships.role`；Owner 身份只增加管理能力，不可阻止 Owner 以該門市 ADMIN 角色進入。

## 明確排除

- 本階段不修改登入後首頁資訊架構。
- 本階段不修改盤點資料流或畫面。
- 本階段不修改進貨／OCR 資料流或畫面。
- 本階段不新增 production migration 或部署 Edge Function。

## 驗證

- JavaScript syntax check。
- 登入元件、Supabase Auth 接線、Owner 建店、員工 PIN、安全鎖定及 session restore 自動測試。
- 唯讀核對 production migration `20260823001757_owner_business_onboarding`、`staff-pin-login` 與 `manage-staff` 已存在。
