# Supabase Production Drift Report — 2026-08-23

## 結論

Production project `tkedzwlzknetmhpsmths` 為 `ACTIVE_HEALTHY`，Supabase Git branch metadata 的 default branch 是 `main`，但 production migration history 與 GitHub `main@dee9cbbe7ec278f498cd3bb331d5792a5a41dbab` 不一致。Production 已包含尚未合併 `main` 的 schema 與 Edge Functions，因此目前不能宣稱 production 可追溯到單一 `main` SHA。

本報告全程唯讀。沒有新增、套用、repair migration，也沒有部署 Edge Function。

## Production 已套用、但 main 缺少的 migration version

下列版本存在於 production migration history，但 `main` 沒有同版本檔案：

| Production version | Production name | Repository 中最接近的來源 |
|---|---|---|
| `20260820155238` | `pilot_v01_core_schema` | `202608200001_pilot_v01.sql` 的部分內容；不是同一 migration identity |
| `20260820155258` | `harden_rls_helper_permissions` | main 的初始 schema 演進；沒有同版本檔案 |
| `20260821040206` | `repair_legacy_table_columns` | `202608210002_repair_legacy_table_columns.sql`；版本不同 |
| `20260821040539` | `complete_pilot_v01_schema` | main 初始 schema 演進；沒有同版本檔案 |
| `20260821040603` | `repair_seed_conflict_indexes` | `202608210001_repair_seed_conflict_indexes.sql`；版本不同 |
| `20260821040649` | `harden_pilot_helper_functions` | main 初始 schema 演進；沒有同版本檔案 |
| `20260821061154` | `pilot_self_service_onboarding` | `20260821060423_pilot_self_service_onboarding.sql`；版本不同 |
| `20260821150409` | `allocate_receipt_ocr_run_version` | `20260821142316_allocate_receipt_ocr_run_version.sql`；版本不同 |
| `20260822142659` | `daily_receipt_workbench_queue` | preview 檔 `20260822120500_daily_receipt_workbench_queue.sql` |
| `20260822142701` | `controlled_pilot_catalog_count_lots` | preview 檔 `20260822041733_controlled_pilot_catalog_count_lots.sql` |
| `20260822142832` | `harden_controlled_pilot_functions` | preview 檔 `20260822043000_harden_controlled_pilot_functions.sql` |
| `20260822145005` | `fix_count_actor_profile_relationships` | preview 檔 `20260822144836_fix_count_actor_profile_relationships.sql` |
| `20260822154229` | `store_staff_pin_identity` | preview 檔 `20260822153719_store_staff_pin_identity.sql` |
| `20260822162954` | `enforce_store_isolation` | preview 檔 `20260822162724_enforce_store_isolation.sql` |
| `20260823001757` | `owner_business_onboarding` | preview 檔 `20260823001506_owner_business_onboarding.sql` |
| `20260823133159` | `single_store_operational_slice` | preview 檔 `20260823132516_single_store_operational_slice.sql` |

只有以下 production versions 與 `main` 檔名完全一致：

- `20260821101514_real_receipt_ocr_pipeline.sql`
- `20260821101809_harden_receipt_finalization.sql`

## Main 有、但 production 未套用的 migration version

以下檔案存在於 `main`，但 production history 沒有相同 version：

- `202608200001_pilot_v01.sql`
- `202608210001_repair_seed_conflict_indexes.sql`
- `202608210002_repair_legacy_table_columns.sql`
- `20260821060423_pilot_self_service_onboarding.sql`
- `20260821142316_allocate_receipt_ocr_run_version.sql`

其中多數有名稱相近、版本不同的 production migration。這表示曾以直接套用或重新命名方式建立 history。不得直接執行 `supabase db push`；否則可能把等價 DDL 視為未執行 migration 再次套用。

## Production Edge Functions

Production metadata 沒有保存 Git SHA。下表 SHA 是依 production 原始碼與 Git history 比對得到的最接近來源，不是由 deployment metadata 證明的不可變關聯。

| Function | Production version | JWT | 最接近的 source commit |
|---|---:|---|---|
| `process-receipt-ocr` | 11 | required | `573500194a6546744db3aca8382167c4d58b666e`；包含較早 `826b75d…` OCR hardening |
| `enqueue-receipt-ocr` | 1 | required | `573500194a6546744db3aca8382167c4d58b666e` |
| `manage-staff` | 2 | required | `9d7947edef9ec767b480dd1a07de75ab39ba4d18` |
| `staff-pin-login` | 1 | disabled；Function 自行驗證 PIN 並交換 session | `53f4f470c7aa69f67e211bfe14cf96742a00665f` |

在正式發版流程建立前，以上 Functions 均不得再從本機或 feature branch 部署。未來 deployment manifest 必須同時記錄 function slug、production version、完整 `main` SHA 與 bundle digest。

## `MIGRATIONS_FAILED`

可證實事實：

- Supabase branch id：`50776556-f48c-4273-bad3-2a7fa48eca11`
- branch name／git branch：`main`
- status：`MIGRATIONS_FAILED`
- 建立及最後更新時間：`2026-08-20T16:03:33.973492Z`
- production project 本身仍為 `ACTIVE_HEALTHY`
- 目前 branch-action log 查詢結果為空；可用 logs 只涵蓋最近 24 小時，沒有保留 2026-08-20 的錯誤本文。

因此，現有可讀證據不足以誠實指出單一 SQL statement 或 error code。確切失敗本文已不在目前可取得的 log retention 內。可確認的直接風險是：Git migration versions 與 production history 已分裂，且初始 schema 在 production 被拆成多個不同 identity；這足以阻止自動 migration，但不能在沒有重現前宣稱它就是 2026-08-20 的唯一錯誤原因。

## 安全修復方案（尚未執行）

1. 凍結 production migration 與 Function deployment。
2. 從 production 匯出唯讀 schema、migration history、function source digest，保存為 release evidence。
3. 在全新的 non-production Supabase branch／獨立測試 project，從準備合併的 `main` SHA 重播 migrations，取得第一個失敗的確切 SQL 與 error code。
4. 逐項比對「不同 version、相同意圖」的 migrations；用 schema diff 證明等價，不以名稱猜測。
5. 在 PR 中建立經審核的 canonical migration history／baseline。不得修改已執行 SQL 來假裝一致。
6. 只有在使用者另行明確核准後，才可對 production 執行 migration history repair；repair 前後都要保存 migration list 與 schema diff。
7. 後續只允許受保護 workflow 從同一個完整 `main` SHA 部署 migration 與 Edge Functions，並輸出 deployment manifest。

在第 3～6 步完成以前，`MIGRATIONS_FAILED` 不得標示為已修復，production 也不得執行 `db push`。
