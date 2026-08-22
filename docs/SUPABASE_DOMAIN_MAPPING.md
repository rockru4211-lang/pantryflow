# Operations UI v2：Supabase 資料對應

| 共用模型 | 現有真實資料 | 讀取 | 寫入／不可變規則 |
| --- | --- | --- | --- |
| Role projection | `profiles.role`, `organization_members.role` | 登入後 profile | 不修改 role、enum、RLS；未知角色最小權限 |
| Task: count | `inventory_count_sessions`, `count_zone_progress` | `loadWorkContext` | session/progress 依既有 RLS 更新 |
| Task: receipt review | `receipt_upload_batches`, `receipt_ocr_runs` | `loadWorkContext` | OCR 不在 UI adapter 覆寫，只投影待辦 |
| Count Zone | `count_zones`, `zone_products.sort_order` | `loadCatalog` | 只有現有 ADMIN 可管理 |
| Count draft | `count_drafts` | `loadCountState` | 每項 autosave upsert；不是首次實盤歷史 |
| Count entry/event | `count_entries` | `loadCountState` | INITIAL_COUNT／RECOUNT／CORRECTION 追加，不覆蓋 |
| Count exception | `inventory_count_discrepancies` | `loadCountState` / `loadWorkContext` | 保留原因、操作者與時間 |
| OCR exception | `receipt_ocr_runs`, `receipt_ocr_fields` | receipt adapter | REVIEW／UNREADABLE 進共用 Exception；修正另存 |
| Inventory event | 既有 count／receipt／correction／waste／transfer records | adapter 正規化 | 必留 source、actor、time、raw |

缺少 expiry、shortage 或 handoff 的正式 table/query 時，Task selector 不製造資料，畫面顯示「尚無資料」與下一步。
