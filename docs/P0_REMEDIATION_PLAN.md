# PantryFlow P0 修復計畫

最後更新：2026-08-22  
狀態：計畫定案前；尚未授權大量實作  
產品狀態：**內部整合中，不可現場使用**

本計畫只處理 `DECISION_AUDIT_2026-08-22.md` 的 P0 與第一條可信垂直流程。停止新增外觀、每日收貨工作台、Excel 匯入、效期擴充與寄庫功能；既有相關程式只做必要隔離，不在本里程碑追加能力。

## 第一個固定里程碑

> 管理者建立商家／門市／員工 → 員工 PIN 快速登入 → 真實 Supabase 盲盤 → ADMIN 在另一台裝置看到同一筆盤點與操作者。

只有以下整條鏈均通過才算里程碑完成：

1. ADMIN 以正式管理登入建立 Organization、Store 與獨立 STAFF 身分。
2. STAFF 不使用共用帳號，依門市＋姓名／員編＋PIN 取得自己的短期 Supabase Auth session。
3. STAFF 只能讀指定門市的區域／商品，盲盤時看不到帳面數量；0、空白、小數可自動保存。
4. 完成區域後建立不可覆蓋的 `INITIAL_COUNT`，操作者必須是該 STAFF 的 `profiles.id`。
5. ADMIN 在另一台裝置查到同一 session、store、zone、原始 count entry、操作者與時間。
6. STAFF 不可讀 ADMIN-only 管理資料；換 organization、store 或 user ID 的越權查詢均回傳 0 rows／403。
7. 任何一項失敗，整條流程標示「未通過」，不可宣稱可現場使用。

## 七項 P0 修復矩陣

| P0 | 根因 | Schema／RLS／前端／Edge Function 變更 | 相依順序 | 可驗收條件 | 預估工作量與風險 | 必須停用的舊文件／程式 |
|---|---|---|---|---|---|---|
| P0-1 登入入口與個人身分 | 現行只有 Email／密碼＋公開自助註冊；所有新帳號都可自行建立 Organization 成為 ADMIN。沒有受控管理建帳與 STAFF 快速登入。 | Schema：採下方 Store／membership／private PIN 模型。RLS：只有 organization ADMIN 可建立／停用員工。前端：仅保留管理／後勤、店長、員工快速登入三個入口；本里程碑只完成管理與 STAFF PIN。Edge：新增 ADMIN-only `provision-staff`、`reset-staff-pin` 與公開但嚴格限速的 `staff-pin-login`。 | 先 P0-2、P0-3，再建 Edge 與前端。 | 新 STAFF 有獨立 `auth.users`、`profiles`、membership；PIN 登入後 `auth.uid()` 等於該員工，不是共用門市 user。 | 2–3 工程日；**高風險**：Auth session 簽發、暴力破解、帳號列舉、離職停權。 | 停用 STAFF 的 Email 自助註冊與自行建立商家；`DECISION_LOG` 2026-08-21 全員自助註冊改標部分取代；`PILOT_SETUP` 全員 Email 建帳不得當正式 STAFF 流程。 |
| P0-2 Store membership 與角色 | `organization_members` 只有 organization role；`profiles.store` 是文字，無法表達一人多店、每店角色、停權或員編唯一性。 | Schema：建立 `stores`、`store_memberships`；membership 連 `profiles.id`，含 `role`、`employee_number_normalized`、`is_active`、時間與建立者。盤點 session／zone 增加 `store_id`。RLS helper 以 `(auth.uid(), store_id)` 判斷角色，不讀可修改的 user metadata。 | 第一個正式 migration；完成 backfill 與約束後才切 RLS。 | 同一 organization 可有多店；同員工可在不同店有不同角色；STAFF 只見獲准門市；停用 membership 後新請求立即拒絕。 | 1.5–2 工程日；**高風險**：既有 `profiles.store` 與 receipt `store_name` 無可靠 ID，需要明確 backfill map。 | 停用以 `profiles.store` 字串做授權或關聯；不得把 Organization role 當門市 role。 |
| P0-3 操作者 FK、PostgREST 與中文錯誤 | `count_entries_entered_by_fkey` 只連 `auth.users`；前端卻以該名稱嵌套 `profiles`，導致 schema-cache relationship error，並把原始英文 error 直接顯示。 | Schema：保留 auth FK，再新增具唯一名稱的 `count_entries_entered_by_profile_fkey → profiles.id`；同樣補齊 session 與其他 actor profile FK，驗證既有資料後 `NOTIFY pgrst, 'reload schema'`。前端：所有 nested select 使用顯式 FK hint 與 `actor` alias。UI：統一中文錯誤分類及「重新載入資料」。 | 可先獨立修復；是後續登入與 ADMIN 查詢前置條件。 | PostgREST 顯式 join 回 200；真實 ADMIN 可載入盤點報表；斷網／schema 錯誤不顯示 raw DB error且有重試。 | 0.5–1 工程日；**中風險**：remote schema 曾先行變更但 branch 尚未提交，須先 reconcile migration history。 | 停用 `profiles!count_entries_entered_by_fkey` 舊查詢；不得以隱藏錯誤取代修 FK。 |
| P0-4 Cloud mode 禁止 local／seed fallback | Cloud 與 Prototype 共用 `data`、`saveAndRender()`、首頁、inventory、expiry、issues 與 count baseline；登入後仍可能把固定 seed 呈現成正式結果。 | 前端：建立明確 `cloudStore`／`prototypeStore` 邊界；Cloud route 只能由 backend response 建 state。未接正式資料的 route 在 Cloud mode 不掛載或明確不可用，不執行 local mutations。測試：以禁止字串／fixture 注入與 runtime assertion 防回歸。 | P0-3 後立即做，且早於可信盤點差異。 | 清空 Supabase 測試 organization 後，Cloud UI 顯示真正 empty state；任何預設商品、效期、異常、數量均不出現；跨瀏覽器重載結果一致。 | 1.5–2.5 工程日；**高風險**：單檔 `app.js` 耦合深，可能影響現有 Prototype。 | Cloud mode 停用 `DEFAULT_*`、`MOCK_*`、`COUNT_BASELINES`、local expiry/issues/inventory 成果與 localStorage 正式判斷；未接正式資料的入口不再呈現可操作成功。 |
| P0-5 真實盲盤與可信差異 | 輸入雖寫 Supabase，但差異／嚴重度依前端 `countBaselines`、seed `qty/safe` 或 fallback estimate；正式「帳面基準」沒有 snapshot 來源。 | Schema：session 建立時保存 organization/store/catalog snapshot；另以 `count_baseline_snapshots`（或 session snapshot 中有結構驗證的等價設計）保存前次已確認數量、來源與時間。差異由 SQL/RPC 以 initial entry 與 immutable baseline 計算，禁止前端自行決定正式差異。RLS：STAFF 可寫自己的 draft／initial；送出前不可 select baseline；ADMIN 可在送出後讀差異。前端：盲盤只傳 observation，送出後讀 server result。 | P0-2、P0-3、P0-4 後。 | STAFF network response／DOM 在送出前均無 baseline；0、空白、小數重載正確；多區域加總與每區原始 entry 同時存在；ADMIN 計算可由 SQL 重算一致。 | 2–3 工程日；**最高風險**：差異定義、session snapshot、空白與多區域聚合若不先定案會產生錯帳。 | 停用正式流程中的 `getCountBaseline()` fallback、`COUNT_BASELINES`、以 seed `qty` 計算差異、client-only正式結案。 |
| P0-6 RLS 與角色行為 | 現有 helper 取單一 organization role；無 store scope；前端 ADMIN-only 判斷不能代替 DB 授權；SUPERVISOR／店長權限未收斂。 | Schema/RLS：建立 `current_store_role(store_id)`／`can_manage_store(store_id)` 等最小 stable helper；只讀 private membership，明確 revoke；所有盤點表 policy 同時檢查 organization、store、active membership、actor ownership。Edge：每次管理操作重新驗證 JWT 與 membership，不信任 request role／user metadata。 | P0-2 schema 後、資料 backfill 完成才切換；與 P0-5 同 migration train 驗證。 | ADMIN、店長、STAFF 的 allow/deny matrix 全部以兩 organization、兩 store、兩裝置測試；變造 UUID 不越權；停用帳號後 session 不能繼續寫。 | 1.5–2.5 工程日；**高風險**：錯誤 policy 可能外洩或造成全站 0 rows。 | 停用只靠 `data-pilot-admin-only`、`go()` route guard 或 JWT user metadata 的授權假設。 |
| P0-7 跨裝置證據與發布停止線 | 過去把語法測試、畫面存在、Pages 部署當完成；正式 STAFF 不存在，真實盤點與 operator join 未通過。 | 測試／發布：建立固定 acceptance runbook、測試資料標記與清理策略；記錄 user/store/session/entry IDs、兩裝置時間、RLS negative tests。Pages 只部署指定 commit；失敗立即回復 main。文件：CURRENT state 將 repository checks 與 real acceptance 永久分欄。 | 所有前六項完成後；不能平行宣稱完成。 | ADMIN 建店／員工、STAFF PIN 登入盲盤、ADMIN 跨裝置看到相同 entry/operator；負向 RLS 全過；證據寫入驗收紀錄。 | 1–1.5 工程日；**中高風險**：需要兩個真實裝置／帳號，不能由靜態工具替代。 | 停用「7/7 自動測試＝Pilot 通過」、Demo screenshot、同裝置 localStorage 與假成功訊息。 |

估算為單一工程師專注時間，不含等待產品決策、Email／裝置協作或 Supabase Preview 修復；第一條可信垂直流程合計約 **10–15 工程日**。若先限縮到單一 Organization／單一 Store 的受控資料移轉，可降低 backfill 範圍，但不能省略正式 Store ID、獨立身分、PIN 安全與 RLS。

## 最小安全資料模型

### `public.stores`

| 欄位 | 規則 |
|---|---|
| `id uuid` | PK，random UUID |
| `organization_id uuid` | FK `organizations.id`，不可空 |
| `store_code text` | Organization 內唯一；供管理與快速登入選店，不使用可猜 UUID |
| `name text` | 顯示名稱，不作授權依據 |
| `is_active boolean` | 停用保留歷史，不刪除 |
| `created_by uuid` | FK `profiles.id` |
| timestamps | 實際建立／更新時間 |

### `public.store_memberships`

| 欄位 | 規則 |
|---|---|
| `id uuid` | PK |
| `organization_id uuid`、`store_id uuid` | 同 organization 的複合完整性；不可只相信前端傳入 organization |
| `user_id uuid` | FK `profiles.id`；該 profile 同時對應 `auth.users.id` |
| `role text` | 第一里程碑只開 `ADMIN`、`MANAGER`、`STAFF`；權限矩陣另表固定 |
| `employee_number_normalized text` | Store 內唯一、大小寫／空白標準化；顯示值可另存 |
| `display_name text` | 門市顯示名；不取代不可變 user identity |
| `is_active boolean` | 停權不刪歷史 |
| `created_by uuid`、timestamps | FK `profiles.id` 與完整稽核時間 |

建議唯一約束：`unique(store_id, employee_number_normalized)`、`unique(store_id, user_id)`。所有引用 store 的表需能驗證 store 與 organization 一致，優先使用複合 FK 或 trigger constraint，不接受只靠 RLS 補救資料完整性。

### `private.staff_pin_credentials`

此表放在**不暴露給 Data API** 的 `private` schema；`anon`、`authenticated` 均無任何 table privilege。

| 欄位 | 規則 |
|---|---|
| `membership_id uuid` | PK/FK `store_memberships.id` |
| `pin_hash text` | 使用目前 Supabase/Postgres 支援的慢速密碼雜湊（實作前確認 pgcrypto／Auth 官方方案）；絕不存明文、可逆 PIN 或 log |
| `credential_version integer` | reset 時遞增，舊 login challenge 失效 |
| `failed_attempts integer` | 只由受控 server function 更新 |
| `locked_until timestamptz` | 指數退避／短期鎖定 |
| `changed_at`、`changed_by` | reset 稽核；`changed_by` 連 `profiles.id` |

另建 append-only `private.staff_auth_events`，只記 success/failure、membership、時間、IP 雜湊／request trace（若法規與隱私允許）；不得記 PIN、OTP、access token 或完整敏感裝置資料。

### Auth session 原則

- 每位 STAFF 仍有獨立 `auth.users`，`profiles.id = auth.users.id`；PIN 只是受控登入憑證，不建立自製 JWT。
- `staff-pin-login` 驗證 store、active membership、員編／opaque selector、PIN、lockout 後，必須使用 Supabase Auth 官方支援的 Admin link／OTP/session 流程產生一次性 session；實作前以當時官方文件與 SDK 版本做 spike 驗證。
- service role 只存在 Edge Function；瀏覽器永遠收不到 service key、PIN hash 或 Admin API response。
- PIN reset 必須使舊 credential version 失效並撤銷既有 STAFF sessions；若 Supabase 的 global sign-out 行為無法滿足即時停權，敏感 RPC/RLS 仍每次檢查 active membership。
- 門市員工清單不得匿名公開姓名與員編。若產品要求選姓名，先用 store access code／一次性 challenge 限縮查詢，回傳最少顯示資料與 opaque login handle，並做 rate limit／anti-enumeration。

### 盤點 actor 與 store 完整性

- `count_entries.entered_by` 同時保留對 `auth.users.id` 的既有 FK，新增命名清楚的 `count_entries_entered_by_profile_fkey → profiles.id` 供 PostgREST join。
- `inventory_count_sessions.started_by` 同樣新增 profile FK；所有前端 nested select 必須使用精確 constraint hint，例如 `actor:profiles!count_entries_entered_by_profile_fkey(...)`。
- `inventory_count_sessions.store_id` 不可空；`count_zones.store_id` 不可空。entry 的 store 由 session／zone 約束推導，禁止前端任意指定另一店。
- initial count、correction 與 discrepancy 都保存 immutable actor/time；正式差異不得從 localStorage 或 DOM 計算後直接當權威值。

## Migration plan（只規劃，不在本任務執行）

| 階段 | Migration／部署 | 內容 | 進入條件 | 回復策略 |
|---|---|---|---|---|
| M0 | baseline audit | 匯出 constraint、policy、migration history、profiles／organizations／zone／session actor 缺漏統計；修復 Supabase Preview `MIGRATIONS_FAILED`。 | 無 | 純唯讀；不需回復。 |
| M1 | `fix_count_actor_profile_relationships` reconcile | 將已在 remote 先行套用的 actor profile FK 與 repository migration history 對齊；驗證資料、reload PostgREST cache、跑顯式 join。 | M0 對照一致 | 新 FK 可 drop，不碰原 auth FK；若 remote/history 不一致先停。 |
| M2 | `create_stores_and_memberships` | 新增 stores、store memberships、複合唯一與 explicit grants/RLS；先 nullable backfill，不切正式流量。 | 明確確認現有 Organization 對應哪一門市 | 新表可保留 unused；不刪既有 `profiles.store`。 |
| M3 | `backfill_pilot_store_scope` | 為受控 Pilot 建立明確 store；回填 zone/session/membership。每筆 mapping 先產報告，未知值停止，不猜測。 | 使用者核准 mapping | 以 migration audit table 保存 old/new；可逐列回復，禁止大量無條件 update。 |
| M4 | `create_private_staff_pin_credentials` | private credentials、auth events、hash verify/reset functions；revoke PUBLIC，advisor 無 exposed definer function。 | M2 membership ready | drop private objects；不影響 Email ADMIN。 |
| M5 | Edge Functions | 部署 `provision-staff`、`reset-staff-pin`、`staff-pin-login`；JWT、ADMIN membership、rate limit、anti-enumeration、session spike 測試。 | M4 security tests pass | 保留 Email ADMIN；關閉新 functions 即可回復。 |
| M6 | `enforce_count_store_scope` | session/zone store_id 轉 NOT NULL，正式 baseline snapshot，actor/store FK，store-aware RLS；先建立新 policy，再以 role matrix 驗證後移除舊 policy。 | M3 backfill 0 unknown；M5 可登入 | transaction 內 policy swap；保留前一 policy SQL 作立即回復。 |
| M7 | Cloud frontend cutover | 移除 STAFF Email signup；接 PIN flow；Cloud state 禁 seed/local；正式 blind count 只用 server baseline/result；未正式頁不掛載。 | M1–M6 staging 全過 | Pages 可重新部署已記錄的上一 commit；DB additive schema保留。 |
| M8 | cross-device acceptance | 兩裝置、ADMIN/STAFF、positive/negative RLS、0/blank/decimal、多區域、重載與 actor 查詢。 | 指定 preview URL 與測試帳號 | 失敗即回 Pages 舊 commit，標未通過；不刪測試歷史，依標記封存。 |

每個 migration 必須由 `supabase migration new` 建立、明確 `GRANT`、RLS、constraint 名稱與索引；DDL 使用 Supabase migration 工具套用。每次 DDL 後跑 security/performance advisors、PostgREST query 與 RLS positive/negative tests。不得用 `SECURITY DEFINER` 逃避 RLS；若 Auth/credential 邊界確實需要，函式放 private schema、撤銷 PUBLIC、檢查 `auth.uid()`／membership，且只由 Edge service role 呼叫。

## RLS 最小驗收矩陣

| 行為 | ADMIN | MANAGER | STAFF | 非本店／非本 Organization |
|---|---:|---:|---:|---:|
| 建立 Store／員工／重設 PIN | 允許 | 本里程碑不開放 | 拒絕 | 拒絕 |
| 讀本店 catalog／zones | 允許 | 允許 | 允許 | 拒絕 |
| 建立本店 count session | 允許 | 允許 | 允許（依排定規則） | 拒絕 |
| 寫自己的 draft／initial count | 允許 | 允許 | 允許 | 拒絕 |
| 修改／刪除 initial count | 拒絕 | 拒絕 | 拒絕 | 拒絕 |
| 送出前讀 baseline | 允許（管理畫面） | 待後續定案 | 拒絕 | 拒絕 |
| 讀全店差異與操作者 | 允許 | 待後續定案 | 只讀自己或完全拒絕，先採拒絕 | 拒絕 |

## 實作前必須先定案的窄問題

這些問題不阻止完成資料模型設計，但進入 M3／M5 前必須由產品明確回答，不能由工程猜測：

1. Pilot 的既有 Organization 中，哪一個正式門市名稱／代碼要承接現有 zones、sessions 與 batches？
2. 員工快速登入是必須「看到姓名清單」，還是可輸入員編；若要姓名清單，門市識別／access code 與隱私範圍為何？
3. PIN 長度與重試規則：建議至少 6 位數、5 次失敗鎖 15 分鐘；是否接受？
4. 店長在第一里程碑只登入但不管理，或需要讀全店差異？本計畫預設第一里程碑先驗 ADMIN＋STAFF，MANAGER 權限不猜測。
5. 正式盤點 baseline 的權威來源：上一個 CLOSED session、人工期初，或 ERP 匯入？第一里程碑建議只允許「上一個 CLOSED session／ADMIN 核准期初」兩種有來源 snapshot。

## 停止線

- 本計畫完成後仍不開始大量改碼；需先確認上述窄問題與 migration/backfill 順序。
- 在第一條可信垂直流程通過前，不修飾或擴充每日收貨工作台、Excel 匯入、效期 UI、寄庫或其他畫面。
- 不再宣稱週日可現場使用；只有 `P0_REMEDIATION_PLAN` 的跨裝置驗收全部通過後，才能重新評估受控 Pilot 狀態。
