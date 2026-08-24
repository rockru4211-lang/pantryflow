# STORE-FIRST-ONBOARDING-FIX-20260824

狀態：`開發中／OPEN PR`
基準：`origin/main@84e03a294774d983ec98a1ee687f0f75dd97daeb`
分支：`fix/store-first-onboarding-auth-rpc-20260824`
部署：`未合併、未部署 Pages、migration 未套用、Edge Function 未部署`

## 已確認的狀態機

1. 無商家：只顯示商家名稱；下一步才顯示第一間門市名稱與門市代碼。
2. 有商家、無門市：只顯示「建立第一間門市」，完全不渲染門市成員、員工表單或盤點入口。
3. 有門市：顯示商家、目前門市選擇器、門市資料、門市成員，以及「新增店長／員工」「新增門市」兩個入口。
4. 新增門市與新增員工皆是獨立二級頁；每頁有「返回上一頁」。
5. 建立順序固定為：商家 → 第一間門市 → ADMIN／SUPERVISOR／STAFF 登入身分 → 門市代碼＋登入識別＋6 位 PIN。

本決策是使用者於 2026-08-24 明確核准的文字驗收規格，用來補足 `PF-UIV2-IMG-01` 未呈現的 Owner／管理者 onboarding 表單；不宣稱這些新增表單已出現在原定案圖，也不取代該圖。

## 資料與授權設計

### `public.create_owner_business(...)`

- 保留既有五個參數與 `jsonb` 回傳型別。
- 只使用 `auth.uid()`、Email verified、`profiles`、active `organization_members` 作為授權與狀態依據。
- 不讀取 `raw_user_meta_data`、`user_metadata` 或 `account_type`。
- 顯示名稱只讀 `profiles.display_name`，空值使用非個資的「管理者」。
- `pg_advisory_xact_lock` 以 user id 序列化重複提交。
- 同一 PostgreSQL transaction 建立 organization、第一間 store、organization membership、store membership、staff identity 與 audit log。
- 相同 Owner 重送時回傳既有 organization/store 並標示 `reused: true`。

### 門市

- 門市代碼前後端皆 `trim` 後轉大寫。
- Edge Function 依 organization 既有 store 數量判斷第一間門市；不信任瀏覽器傳入的 pilot flag。
- 第一間門市 `is_pilot_store=true`；後續門市為 `false`。
- production 已有 `stores_global_login_code_idx` 與門市內／organization constraint；重複代碼回應 `409 STORE_CODE_ALREADY_EXISTS`。
- 建立 store、建立建立者 membership、寫入 audit 任一步驟失敗即補償刪除本次新資料。

### 門市成員

- 單一必填 `loginIdentifier` 寫入 `store_memberships.login_identifier`。
- 合法角色只限 production enum：`ADMIN`（店長）、`SUPERVISOR`（主管）、`STAFF`（員工）。
- 呼叫者必須同時具備 active organization membership 與目標門市的 active `ADMIN`／`SUPERVISOR` membership；只有目標門市 `ADMIN` 可建立 ADMIN／SUPERVISOR。
- production 既有唯一索引 `(store_id, lower(login_identifier))` 保證同門市不可重複、不同門市可重複。
- Auth 內部密碼由 32 random bytes 轉 base64url，ASCII／UTF-8 長度 43 bytes，小於 bcrypt 72-byte 上限；不回傳、不寫資料庫、不記錄。
- 建立順序為 Auth → profile → organization membership → staff identity → store membership → PIN → audit。PIN 後續 audit 失敗時，service-role-only compensation RPC 先刪除 PIN，再刪除本次公開資料與 Auth user。
- migration 新增的 compensation RPC 未部署；因此本 PR 在 migration 核准前不可單獨部署新版 `manage-staff`。

### 員工 PIN 登入

- 外部 request 維持 `{ storeCode, identifier, pin }`。
- 外部失敗統一為 `INVALID_STAFF_CREDENTIALS`，避免洩漏帳號是否存在。
- 伺服器安全日誌只記錄 `correlationId` 與原因：`STORE_CODE_NOT_FOUND`、`STAFF_IDENTIFIER_NOT_FOUND`、`INVALID_PIN`、`INACTIVE_MEMBERSHIP`、`INACTIVE_STORE`。
- 日誌不包含 store code、identifier、PIN、Auth token 或個資。
- 既有 `verify_staff_pin` 繼續負責 bcrypt 驗證、5 次失敗鎖定 15 分鐘及 append-only attempt history。

## Private schema／RLS 唯讀確認

2026-08-24 對 production `tkedzwlzknetmhpsmths` 執行只讀 ACL 查詢：

| Table | RLS | ACL | anon／authenticated table grants |
| --- | --- | --- | --- |
| `private.staff_pin_credentials` | off | `postgres=arwdDxtm/postgres` | 0 |
| `private.staff_login_attempts` | off | `postgres=arwdDxtm/postgres` | 0 |

兩表位於未暴露的 `private` schema，且 anon／authenticated 無 table grant；本 PR 不因 advisor 警告擅自啟用 RLS。Security advisor 的 RLS／Security Definer 警告保留為後續整體安全審查，參考 [Supabase database linter remediation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)。

## 本機／靜態驗收

本機沒有 Docker，因此沒有可用的空白 Supabase stack；以下結果不得解讀為真實資料 E2E 或可直接部署。

| 項目 | 結果 | 證據 |
| --- | --- | --- |
| 全部 Node tests | PASS（49/49） | `node --test tests/*.test.mjs` |
| 所有前端 JavaScript 語法 | PASS | `node --check` |
| Edge Function TypeScript | PASS | Deno 2.9.5 `deno check` |
| Migration PostgreSQL parse | PASS（9 statements） | `pglast` parser |
| Store-first 三狀態互斥 | PASS（靜態元件） | `tests/store-first-onboarding.test.mjs` |
| STAFF／SUPERVISOR／ADMIN provisioning | PASS（純函式 harness） | `tests/staff-provisioning.test.mjs` |
| 內部密碼 byte length | PASS（256 次隨機產生） | 全部 43 bytes，且 `<72` |
| 1440×1000／390×844 | PASS（實際元件＋CSS） | `tests/artifacts/store-first-onboarding/browser-results.json` |
| Browser console | PASS（10 個 viewport/state 組合皆 0） | 同上 |
| 二級頁返回 | PASS | 新增員工 → 返回門市成員，console 0 |
| 真實 create owner/store/staff/PIN E2E | BLOCKED | 無隔離 Supabase；production 禁止寫入 |

## 隔離環境驗收計畫

1. 建立非 production Supabase branch／全新空白專案。
2. 依 canonical baseline 重建，再套用 `20260824095042_store_first_onboarding_auth_fix.sql`。
3. 驗證無商家 → RPC 原子建立商家／第一門市，並重送同一請求確認只存在一組資料。
4. 驗證已有商家無門市 → 建立第一門市 → 自動選定 → 新增員工。
5. 分別建立 STAFF、SUPERVISOR、ADMIN，核對 Auth/profile/identity/org membership/store membership/PIN/audit 一致。
6. 注入 profile、membership、PIN、audit 各階段失敗，確認無孤立 Auth 或公開／private 半套資料。
7. 驗證同門市重複 identifier 為 409，不同門市相同 identifier 成功。
8. 驗證正確 PIN、錯誤 store／identifier／PIN、inactive membership／store、鎖定與 correlation log。
9. 完成後刪除隔離環境；未經批准不得把上述步驟指向 production。

## Production untouched 基準

- Production migrations：18 筆，最後仍為 `20260823133159_single_store_operational_slice`；本地 migration 不在 production。
- `manage-staff`：production v3，SHA-256 `4503743e…a783694`。
- `staff-pin-login`：production v1，SHA-256 `bddefeda…65a1be`。
- 本任務未呼叫 migration apply／db push／repair／function deploy／任何 production insert、update、delete。
