# 序：連鎖餐飲開發範圍

2026-10-15：序專注連鎖餐飲；百花猿 beape / beape-ops 維持獨立版本。

本次移除註冊、商家設定與公開體驗的獨立餐廳選項。新註冊固定使用 CHAIN_RESTAURANT；單店試行及多店設定均保留。尚未完成的舊獨立餐廳註冊草稿，先回到品牌確認，再透過既有版本檢查流程儲存連鎖設定。

正式工作區僅使用帳號既有的連鎖門市授權，包含門市選擇、跨店總覽及日常作業。只有獨立門市授權的帳號會看到範圍說明與返回登入，不能在本版進入獨立作業。未更改會員授權、PIN、歷史資料或既有商家類型。

員工、店長、區主管、老闆及連鎖既有盤點、效期、借貸／調撥、廢棄、ERP 提醒沿用。此修改是應用程式入口收斂，不是新的資料庫權限邊界；共用後端及歷史雙模式相容程式保留，避免影響百花猿。未宣稱停用後端的獨立 API。

驗證：typecheck、verify:source、lint（僅既有 inventory-import-flow Hook 警告）、CI 設定建置及 325 項測試通過，包含舊草稿、舊門市授權及公開體驗四種連鎖身分。尚未使用正式帳號驗證，也尚未部署。本地建置使用 CI placeholder，不能作為正式發布成品；發布須從合併後的確切 main SHA 以正式環境設定重新建置，沿用既有 Cloudflare worker，並執行 verify:release / verify:production。

## 2026-10-15 補充：正式分開資料庫

依使用者提供的截圖，百花猿保留目前 Supabase `qckwzwyeqpuqogbydvvl`，序另外建立專案，不複製百花猿營運資料、帳號或檔案。不得拿現有停用專案直接覆寫。兩套正式網址與分支維持原位。

已準備：正式建置及 `verify:release` 增加資料庫拆分檢查；拆分狀態 pending 時禁止發布。`supabase/config.toml` 改為序正式網址，管理邀請回跳亦指向序；這些設定只能部署至新專案，不能套入百花猿共用後端。

尚待執行：
1. 確認新專案所屬 Supabase 組織，查詢及確認建立費用。建議名稱 `xu-chain`，區域東京 `ap-northeast-1`；目前未建立。
2. 對新專案依順序套用 main 的 114 份 migration，檢查種子資料，驗證 RLS、角色拒絕、重試與隔離。不從百花猿匯出或刪除實際資料。
3. 設定新專案 Auth 的正式網址、Google 登入／郵件設定、Storage 與必要 Edge Functions。只部署 main 所需功能，逐一驗證帳號建立、PIN、盤點與資料上傳。既有序帳號如需搬遷，須另確認歸屬與範圍，不能整批複製共用 Auth。
4. 把新的 project ref 同步寫入 release-source、supabase-browser 與 CI 測試設定；正式 Cloudflare 環境只放新專案 publishable key，不能放 service-role key。核對新專案、登入與儲存通過後才能將 databaseIsolation.status 設為 ready。
5. 以同一 main SHA 建置部署到 pantryflow，執行正式版本／資源檢查，並實測新增資料只出現在序新專案；另只讀驗證百花猿原網址和資料仍正常。

此階段只是準備程式與發布門檻，不代表已完成資料庫建立、資料搬遷、Auth 設定或上線。
