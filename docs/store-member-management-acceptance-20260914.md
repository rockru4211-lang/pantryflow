# 門市與員工管理收斂驗收（2026-09-14）

本次替換第 9 項，延續 v104 已通過的八項功能。正式來源為 `rockru4211-lang/pantryflow`，修改分支 `feat/store-member-management`；入口仍是 `app/page.tsx` → `PilotClient` → `AuthenticatedWorkspace`。原 Sites 專案及 Logo、角色外殼、主要導覽不變。

## 已接通

- 「我的」保留兩個管理入口：門市設定、員工與權限。帳號設定、報表與作業入口保留。
- 門市卡片顯示名稱、系統代碼與管理；新增只填名稱。`store.create` 在同一交易建立門市、管理者關聯與預設設定，沿用 request ID 防止重複。
- 卡片內集中基本資料、既有功能／提醒、作業設定、裝置及企業資料。企業資料明確標示共用；門市作業設定保存在各店。
- 成員頁直接列出目前門市成員與新增入口。頁首只列出可管理門市，切換時留在管理頁並重新套用該店身分。
- 新增成員預設只填姓名／暱稱與身分；自動帶入門市，產生 PIN 邀請連結與 QR Code。既有管理 Email 邀請收進選用設定。角色細部權限、代理與交接仍可操作。
- 管理授權、工作身分、額外功能及顯示姓名各店保存，調整 A 店不改 B 店。店長只能管理員工，不能建店、建立老闆或提高自己權限；主管不能授予超出自己的角色／功能範圍。
- 老闆補齊缺少的企業門市關聯，保留已明確停用或設定不同身分的既有關聯。撤銷管理權優先於角色名稱；交接不可讓不具管理資格的成員成為唯一管理者。

## 實際驗證

- 本機型別、lint、正式 build、來源契約及 Node 測試；完整乾淨資料庫重建與 pgTAP 另由同 commit 的 GitHub CI 驗證。
- Beta 真實資料庫隔離交易：工作身分、Email 邀請、交接 102 項；新增門市、各店權限隔離、店長限制、撤銷與重試 61 項，合計 163 項通過。測試交易回滾。
- 正式 Auth 帳號／PostgREST／Edge Function：既有隔離企業新增 1 店（2 → 3），兩店各新增 1 位員工；登出再登入後門市、設定、成員及額外權限仍在。建店重送取得同 ID；建員重送拒絕重複且維持各 1 筆。
- 新員工邀請啟用一次後回傳 USED，之後可用既有 PIN 登入方式進入唯一授權門市。舊 QA 員工 PIN 與進貨讀取也通過。帳密、PIN、Token 不放入文件或 Git。
- 390px 手機與 820px 平板瀏覽器實測免登入體驗版：新店卡片、名稱單欄建店、兩欄建員、QR Code、成員頁切店、設定保存及重新開啟。平板寬度 820px，文件無水平溢出。店長畫面不顯示門市設定，新增角色只提供員工。
- 本次手機／平板驗收是瀏覽器尺寸實測；真實帳號保存、登入與權限採正式 Auth/API 驗證，未冒稱為實體手機真人驗收。

## 遷移與資料保留

已套用至 `qckwzwyeqpuqogbydvvl`：

- `20260914104422_store_member_management.sql`
- `20260914111254_store_management_grant_revocation.sql`
- `20260914111712_preserve_revoked_owner_scope.sql`

`manage-staff` 已部署第 10 版，使用 `auth.getUser` 與伺服器管理範圍檢查。資料庫型別重新產生並經專案既有 normalize 腳本處理，維持期初數量可為 null。

更新前後一致：22 筆盤點單、686 筆盤點明細、1 筆進貨單、3 筆進貨明細、507 個品項、16 個匯入來源檔，逐表內容摘要相同。驗收新門市及人員只位於既有隔離 QA 企業。

## 既有限制

免登入版是瀏覽器隔離資料，不寄真實 Email；正式 Email 邀請繼續使用原服務。沒有新增或更動金流、OCR、盤點保存流程。

Supabase 安全檢查仍列出既有私有 RPC 架構提示與未開啟外洩密碼檢查；本次沒有新增公開 SECURITY DEFINER API。參考 [資料庫檢查說明](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) 與 [密碼安全設定](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

## 操作入口

- 原 App：https://pantryflow-app-shell-preview.rockru4211.chatgpt.site/
- 免登入：https://pantryflow-app-shell-preview.rockru4211.chatgpt.site/demo
- 選老闆 → 我的 → 門市設定／員工與權限。
