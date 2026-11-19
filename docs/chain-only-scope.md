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

## 2026-10-15 新專案建立與接續點

使用者已在原組織建立 `xu-chain`（東京，`hewanlhkyzptbdbrvtpl`）；已確認 ACTIVE_HEALTHY。新庫未複製百花猿帳號、營運資料或檔案。

已在新庫套用 `xu_disable_automatic_table_grants`，確認 postgres 建立 public 資料表的 anon/authenticated/service_role 預設授權為 0。已依序套用前 10 份原始 migration（最後為 `20260821150409_allocate_receipt_ocr_run_version.sql`）。遠端 migration 名稱以 `xu_` 加完整原始檔名記錄來源；遠端版本號由服務產生，與檔案時間戳不同，勿直接執行 db push 重播。

下一份為 `20260822142659_daily_receipt_workbench_queue.sql`。連線工具兩次回覆 `Invalid or expired requestState`；重新讀取 migration 清單確認尚未套用，因此在此停止重試。先前 complete_pilot_v01_schema 的審查拒絕，經讀取新庫零帳號／零商品／零貨單／零檔案證據與核對原始交易內容後已通過，並成功套用。

程式與 CI/test 設定已改向新 project ref，但 `databaseIsolation.status` 維持 `pending`，禁止發布。最新 typecheck、verify:source、326/326 測試、lint（僅既有 Hook 警告）、CI build 通過。

新增 `20261015041430_xu_explicit_api_grants.sql` 尚未套用，須在原始 114 份全部完成後執行：只授予瀏覽器所需表格 SELECT，先確認 RLS；伺服器 service_role 取得既有 public 表格操作權限；不恢復新表自動授權。

剩餘：繼續初始化、完整資料庫回滾測試與 advisors、Edge Functions、Auth Site URL/redirects、Google provider、OCR 私密設定及 Cloudflare 新連線環境。本機 Wrangler 未登入，現有連線工具沒有 Auth config 寫入功能。尚未合併 PR、部署或切換任何正式網站。
