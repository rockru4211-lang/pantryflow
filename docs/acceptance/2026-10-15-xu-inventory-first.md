# 序：盤點優先版本（尚未發布）

## 範圍

接續 `codex/xu-chain-only-20261015` 的獨立新庫設定，只修改序，未修改 beape 分支或 beape-ops。正式登入後改用盤點專用工作區，首頁直接使用既有 CountWorkspace，沿用儲物區、搜尋、自動儲存、衝突保護、完成、歷史與匯出；底部只保留盤點與設定。門市／人員管理仍依現有門市授權顯示。離開盤點、切店與登出沿用儲存檢查，不丟棄未儲存輸入。公開 demo 保留原本示範。

本次未將百花猿最新盤點整包覆蓋到序；兩個分支資料結構已有差異。先讓序現有盤點核心在新庫正常運作，再逐項移植已驗證的改善。

## 新庫接續點

專案：`xu-chain` / `hewanlhkyzptbdbrvtpl`。禁止將下列 migration 套用到百花猿 `qckwzwyeqpuqogbydvvl`。

本次確認新庫開始時 users、organizations、products、inventory_count_sessions 均為 0。從早上前 10 份初始化接續，已成功套用：

- 20260822142659_daily_receipt_workbench_queue
- 20260822142701_controlled_pilot_catalog_count_lots
- 20260822142832_harden_controlled_pilot_functions
- 20260822145005_fix_count_actor_profile_relationships
- 20260822154229_store_staff_pin_identity
- 20260822162954_enforce_store_isolation
- 20260823001757_owner_business_onboarding
- 20260823133159_single_store_operational_slice
- 20260825022059_store_first_onboarding_auth_fix
- 20260903130711_separate_store_mode_and_erp_onboarding
- 20260904055100_merchant_beta_schema_contract

遠端 migration 名稱是 `xu_` 加原始檔名，版本時間由服務產生。請先比對遠端清單，不能直接 db push 重播。

下一份 `20260904092500_fix_count_session_status_enum.sql` 回覆 `Invalid or expired requestState`；隨後查詢遠端清單確認最後成功仍為 merchant_beta_schema_contract。工具在本次初始化中多次出現此錯誤，重試部分成功；尚未完成所有 115 份 migration。

## 發布阻礙

- 新庫完整初始化、明確 API grants、RLS／角色拒絕／盤點全流程回滾測試尚未完成。
- Edge Functions、正式帳號／PIN／Google 往返登入尚未驗收。
- databaseIsolation.status 維持 pending；禁止將測試建置發布到正式 worker。
- GitHub main 與 pantryflow 正式網站尚未切換，本文件不是上線證明。

驗證結果另依本次測試紀錄補充；CI placeholder 建置僅驗證程式可建置，不作正式產物。

## 本次驗證

- TypeScript、verify:source、CI placeholder 建置通過。
- 328/328 自動測試通過，包含四種連鎖身分的盤點專用導覽。
- 完整 lint：0 errors，1 項既有 inventory-import-flow Hook 警告；本次異動檔 lint 通過。
- 未進行正式瀏覽器登入或資料庫全流程驗收，未部署。

## 使用者核准上線後的接續紀錄

使用者已明確同意「序」盤點版本上線；此授權仍有效，不需再次要求核准。尚未發布，原因是資料庫初始化工具持續回覆 `Invalid or expired requestState`，不是 SQL 錯誤，也不是使用者拒絕授權。

本輪已成功套用並讀回確認：

- 20260904092500_fix_count_session_status_enum
- 20260904100429_import_pilot_inventory
- 20260904102452_allow_file_import_opening_balance_source
- 20260905153515_supplier_inventory_import_results
- 20260906170000_inventory_import_source_and_supplier_resolution
- 20260907095552_nullable_openings_and_staff_activation
- 20260907101111_retain_import_time_for_missing_fields
- 20260907145950_editable_count_zones
- 20260907151000_scope_count_zone_names_to_store

下一份為 `20260908023948_count_preview_parity.sql`。連續兩次 apply_migration 回覆請求失效；再次讀回遠端清單確認最後成功仍為 `xu_20260907151000_scope_count_zone_names_to_store`。不要跳過或重播成功部分。剩餘初始化、回滾驗收、正式建置及 Cloudflare 部署仍須完成。main 與百花猿未變更。

## 2026-11-19 每日盤點獨立驗收

「序」專屬庫已套用 `xu_20260908110000_xu_store_daily_count`。此檔接在 `xu_20260908105748_count_completion_retry` 後，只使用既有的門市身分、品項、儲物區與盤點資料表。日後套用完整作業架構時，`20261119090000_xu_daily_count.sql` 會把同一組盤點操作接到屆時的門市權限。

正式庫的交易回滾測試以同一項火腿分兩區，先填 1 包，另一區留白。送出時整張退回且正式明細為零。補填 0 包後重送，只有兩筆分區明細，合計 1 包。主管收到一筆叫貨提醒。模擬跨日後，下一張表的實盤欄位空白，內部期初為 1 包。測試結束後確認正式帳號與盤點單數量均為零，匿名角色無送出權限。

手機入口仍需登入後取得門市身分及驗證裝置，目前專屬庫尚未提供 `get_app_context` 與 `register_app_device`。本次僅發布盤點後端，尚未切換正式手機網站。
