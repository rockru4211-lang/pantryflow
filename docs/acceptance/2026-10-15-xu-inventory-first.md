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
