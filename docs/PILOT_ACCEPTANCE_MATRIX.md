# PantryFlow 封閉 Pilot 完整性與驗收矩陣

最後更新：2026-08-23  
分支：`feat/receipt-review-ui-integration`／Preview：`pilot-v1-preview`  
整體判定：**封閉 Pilot／不可測**

## 判定規則與來源缺口

- 「完成」只適用於正式 route、可操作流程、Supabase 真實資料驗證及截圖證據均存在的項目。
- schema、靜態畫面、repository test 或部署成功本身只可判為「部分完成」。
- 截圖欄為「無」的項目不得作為 Pilot 通過證據。
- 正式需求來源已讀：`docs/CURRENT_PRODUCT_STATE.md`、`docs/DECISION_LOG.md`、`docs/DECISIONS_2026-08-20.md`、`docs/DECISIONS_2026-08-21.md`。
- **阻擋：`PantryFlow_盤點進貨_Pilot實作規格_v1.0.docx` 不在 repository 或目前 workspace，尚無法完成該來源的逐條對照。取得文件後必須補審本矩陣，不得推定內容。**

## A. 統一 App 與版本

| 定案需求 | 對應 route／元件／Supabase 資料表 | 狀態 | 可操作驗收步驟 | 截圖證據 | 不通過原因 |
|---|---|---|---|---|---|
| 正式入口只有 `pilot-v1/` | `pilot-v1/index.html`、`pilot-v1/app.js`；Pages artifact `pilot-v1/` | 完成 | 無痕開 Preview，檢查 HTML 與 Network 只載入 `pilot-v1` artifact | 無；瀏覽器自動化被網站權限阻擋 | 結構與線上 asset 掃描通過，但缺要求的瀏覽器截圖 |
| `legacy-demo/` 零引用、零 fallback | `tests/pilot-v1-structure.test.mjs`；無資料表 | 完成 | 執行 structure test；搜尋正式 HTML／JS 的 legacy、DEFAULT、MOCK、local fallback | 無 | 4/4 repository test 通過；仍缺 Network 截圖 |
| 預覽顯示 branch 與短 SHA | `#build-banner`、`build-info.js`、Pages workflow | 完成 | 開 Preview，比對 banner、deployment SHA、Git commit | 無 | 線上 `build-info.js` 已驗證，缺畫面截圖 |
| 統一米白、白卡、森林綠、淡綠、固定頂欄、四底部導覽 | `design-tokens.css`、`components/layout.js` | 部分完成 | 以 390px 寬度開登入與各角色首頁，逐項比對色票、間距、頂欄、底導覽 | 無 | 程式已統一 token；尚未逐張視覺核准 |
| 員工／主管／後勤同版型，只改焦點與輔色 | `layout()`、`homePage()` | 部分完成 | 以三個真實角色登入同一門市，擷取首頁並比對 DOM 結構 | 無 | 角色內容存在；沒有真實三角色登入與截圖 |
| 無全域掃描／條碼；拍收據只在進貨 | `layout.js`、`pages/receiving.js` | 部分完成 | 搜尋全域元件並逐頁檢查；確認 file input 只在進貨 route | 無 | 靜態程式符合；缺瀏覽器逐頁證據 |

## B. 帳號與門市

| 定案需求 | 對應 route／元件／Supabase 資料表 | 狀態 | 可操作驗收步驟 | 截圖證據 | 不通過原因 |
|---|---|---|---|---|---|
| Owner 建立商家帳號、完成第一門市 | 登入 Owner form、onboarding page、`signUpOwner`、`create_owner_business`；`organizations`、`stores`、`organization_members`、`store_memberships`、`audit_logs` | 部分完成 | 註冊新 Email→驗證→填商家與第一門市→重新登入→查 DB memberships／audit | 無 | UI、Auth 與 RPC 已接線；未用真實新 Owner 走完 |
| 管理／後勤 Email 登入 | management login、`signInWithPassword`；`auth.users`、`profiles`、memberships | 部分完成 | ADMIN／SUPERVISOR／LOGISTICS 各登入並確認門市隔離與首頁焦點 | 無 | Email 登入可用；缺後勤正式角色資料與跨角色證據 |
| 姓名／暱稱＋6 位 PIN | staff login、`staff-pin-login`；`staff_identities`、private PIN tables | 部分完成 | 建立 NAME_OR_NICKNAME 門市員工→PIN 登入→確認 session/user/store | 無 | schema、Edge Function、UI 存在；沒有真實 STAFF |
| 員工編號＋6 位 PIN | staff login、`staff-pin-login`；同上 | 部分完成 | 建立 EMPLOYEE_NUMBER 門市員工→員編＋PIN 登入 | 無 | 未建立真實員編門市與員工 |
| 主管建立、停用、重設員工 PIN | `manage-staff` Edge Function；`profile`／`utilityPage` 成員管理；staff identity／membership／private PIN tables | 部分完成 | 主管新增員工→登入→停用後拒絕→重設 PIN→舊 PIN 拒絕／新 PIN 成功 | 無 | 正式 UI 與後端 action 已接線；尚未以真實主管／員工驗證 Edge 部署與完整結果 |
| PIN 失敗 5 次鎖 15 分鐘 | `verify_staff_pin`、`staff_login_attempts`、`staff_pin_credentials` | 部分完成 | 同一員工錯 PIN 5 次→第 6 次顯示鎖定→15 分鐘或主管重設後登入 | 無 | migration／Edge 邏輯存在；未實測 |
| 行為追溯到人、門市、時間 | memberships、`audit_logs`、各 actor/store/timestamp 欄位 | 部分完成 | 各角色操作後查 audit 與業務事件 actor、store、created_at | 無 | schema 不等於所有 route 已寫 audit；無端到端證據 |
| 三個乾淨 Pilot 門市、至少一主管一員工 | `stores`、memberships、staff identities | 未完成 | 建三門市且不承接舊 sessions／batches，逐一登入 | 無 | 現有正式環境紀錄顯示缺指定 Pilot 資料 |

## C. 商品與區域：先建檔才能盤點

| 定案需求 | 對應 route／元件／Supabase 資料表 | 狀態 | 可操作驗收步驟 | 截圖證據 | 不通過原因 |
|---|---|---|---|---|---|
| 商品手建完整欄位 | 尚無正式 `pilot-v1` catalog page；`products`、`suppliers`、supplier history | 未完成 | ADMIN 輸入編碼、品名、分類、兩單位、換算、供應商、啟用→重載驗證 | 無 | `pilot-v1/` 沒有可操作頁與完整寫入 service |
| Excel 固定範本下載與匯入 | 尚無正式 route／component；catalog schema | 未完成 | 下載固定模板→填商品→上傳→預覽→確認正式寫入 | 無 | 無 template、parser、preview 與正式 import UI |
| Excel 欄位／格式錯誤列 | 尚無 | 未完成 | 匯入缺必填、錯單位、錯換算列，確認逐列中文錯誤且不寫入 | 無 | 未實作 |
| Excel 重複商品處理 | 尚無 | 未完成 | 匯入重複編碼／品名，選擇略過或更新策略並驗證結果 | 無 | 未實作 |
| 區域建立、命名、排序、停用 | 尚無正式 `pilot-v1` settings page；`count_zones` | 未完成 | 建立三區→改名→排序→停用→重載驗證且歷史保留 | 無 | schema 存在，正式 UI／service 不存在 |
| 商品加入／移出區域、排序／移動 | 尚無；`zone_products` | 未完成 | 商品跨兩區加入→排序→移動→移出→重載驗證 | 無 | 未實作 |
| 無商品或區域時阻擋盤點並導向建檔 | `pages/count.js` 只顯示 session overview | 未完成 | 空門市點開始盤點，確認不能建 session 且有 catalog／zone 導向 | 無 | 正式入口沒有建檔 gate |
| 一份真實商品 Excel 完整匯入 | 同 Excel route | 未完成 | 對三門市至少一份正式模板走完並核對 DB | 無 | 無檔案、帳號、門市與實作 |

## D. 盤點

| 定案需求 | 對應 route／元件／Supabase 資料表 | 狀態 | 可操作驗收步驟 | 截圖證據 | 不通過原因 |
|---|---|---|---|---|---|
| 首頁有開始盤點入口 | `homePage`「盤點」row→`count` | 部分完成 | STAFF 登入首頁→點盤點→進入可開始任務 | 無 | 首頁入口存在，但 count route 只有歷史 overview |
| 任務→區域→盲盤→區域完成→全部完成 | `pages/count.js`；count session／zone progress／entries／drafts | 未完成 | 主管建任務並指派→STAFF 逐區 autosave→完成區域→完成全部 | 無 | `pilot-v1/` 未實作流程 |
| 盲盤不可見上次數量、差異、成本 | 未完成的 count entry component | 未完成 | STAFF 手機檢視 DOM／畫面及 Network，確認只見名稱、單位與輸入 | 無 | 正式輸入畫面不存在 |
| 商品×批次×區域×狀態獨立；數量效期分離 | `inventory_lots`、`inventory_lot_events`、count tables | 部分完成 | 同商品建多區、多 lot/state，分別盤點並查不可覆蓋事件 | 無 | lot schema 存在；盤點 UI/service 未接 |
| 完成後主管看差異 | discrepancy tables；尚無正式 management page | 未完成 | STAFF 完成→另一裝置主管只看到差異與未回覆原因 | 無 | `pilot-v1/` 無差異管理頁 |
| 差異以原因＋更正／重盤事件處理 | discrepancies／correction RPC/schema | 部分完成 | 主管選原因→新增更正或重盤→確認原 entry 未改 | 無 | schema 部分存在；正式可操作 UI 缺失 |
| 紙本匯出、回填／匯入、App 皆留來源／操作者／時間 | 尚無正式 `pilot-v1` export/import component；count actor/source 欄位 | 未完成 | 匯出紙本→回填匯入→比對 source、actor、timestamp 與原始事件 | 無 | 未實作 |
| 一次真實跨裝置盲盤 | 全盤點資料流 | 未完成 | STAFF 手機盤點→ADMIN 另一裝置查看同筆資料與操作者 | 無 | 無正式 STAFF／任務／資料與畫面 |

## E. 進貨

| 定案需求 | 對應 route／元件／Supabase 資料表 | 狀態 | 可操作驗收步驟 | 截圖證據 | 不通過原因 |
|---|---|---|---|---|---|
| 進貨入口含工作台，不只上傳 | `pages/receiving.js` 目前 upload＋簡單 batch list | 部分完成 | 依角色進入：STAFF 見快速上傳；後勤見每日工作台與 detail | 無 | 正式每日工作台 UI 未移入 `pilot-v1/` |
| 多張照片上傳→背景 OCR 狀態 | receipt upload service、private Storage、enqueue/process functions、batches/jobs/runs | 部分完成 | STAFF 多選真實照片→立即返回→狀態 processing→worker 完成 | 無 | schema／Edge／最小 upload 存在；無真實操作證據 |
| 每日工作台只彙整，原始收據／頁面可回查 | 尚無正式 workbench component；batches/documents/runs | 未完成 | 依 store＋work date 開工作台→分組→開原 batch、每頁原圖與 runs | 無 | `pilot-v1/` 只有 batch list |
| 人工核對：原圖、OCR 可改、商品對應／建商品、三種判定 | 尚無正式 detail component；OCR fields、corrections、mappings、products | 未完成 | 後勤開原圖→逐欄改→商品 mapping／建立→選正確／已更正／無法辨識 | 無 | 未實作 |
| 未稅、稅額、含稅顯示 | receipt schema 有欄位；正式 detail 未實作 | 未完成 | 用真實收據核對三金額與計算關係 | 無 | 無可操作畫面與真實資料 |
| 寄庫購入、領用、餘額、事件、低庫存 | `pages/consignment.js` 空狀態；無完整正式 tables/service | 未完成 | 建供應商寄庫→領用→驗證餘額、actor、日期、提醒且不混實體庫存 | 無 | 未實作 |
| ERP 僅連鎖＋啟用後顯示人工驗收與提醒 | homepage conditional flag、receipt schema部分欄位 | 未完成 | 單店確認不顯示；連鎖開啟後完成收貨→待驗收→隔日提醒→人工完成 | 無 | 正式 organization/store feature flag 與流程未完成 |
| 至少一張真實收據走完 OCR→核對 | 全進貨流 | 未完成 | STAFF 上傳→OCR run→ADMIN 核對／mapping→正式收貨 | 無 | 無正式帳號、照片與端到端證據 |

## F. 真實性與資料安全

| 定案需求 | 對應 route／元件／Supabase 資料表 | 狀態 | 可操作驗收步驟 | 截圖證據 | 不通過原因 |
|---|---|---|---|---|---|
| Pilot 資料只由 Supabase 提供 | `services/supabase.js`、auth/data services | 部分完成 | 離線／空 DB／新 org 檢查只出現空狀態；跨裝置重載一致 | 無 | 正式 service 無 local fallback；大部分功能 route 尚未完成 |
| 禁用 mock、seed、DEFAULT、localStorage fallback | structure test、static scan | 完成 | repository＋deployed assets 掃描禁止字串，空資料實測 | 無 | 靜態與線上掃描通過；缺空 org 瀏覽器截圖 |
| RLS 門市隔離 | store isolation migration與各表 policies | 部分完成 | A 店角色嘗試讀／寫 B 店所有核心表，確認 0 rows／拒絕 | 無 | migration 存在；未以三門市角色跑負向測試 |
| 原始盤點、差異、更正、圖片、OCR 原值不可覆寫 | append-only schema/RPC、private Storage upload upsert false | 部分完成 | 建原始事件→更正／重跑→查原 row/hash 未改且新增版本 | 無 | schema 設計存在；未端到端驗證所有資料型別 |
| 缺帳號／門市／資料時顯示封閉建置中 | login、home build state、empty states | 部分完成 | 新 org／無 membership／無資料各開 route 截圖 | 無 | 部分頁面有中文空狀態；未逐 route 驗證 |
| 前端無 service role／模型密鑰 | `pilot-v1/` static scan | 完成 | 掃描 repository 與部署 assets；檢查 Network bundle | 無 | 靜態掃描通過；缺瀏覽器 Network 截圖 |
| 三門市完整登入→建檔→盤點→進貨→人工核對 | 全系統 | 未完成 | 依 B→C→D→E 順序在三門市完成，保存 IDs、截圖與跨裝置結果 | 無 | 帳號、建檔、盤點與核對 UI／資料證據均不完整 |

## 目前缺項與實作依賴

| 順序 | 依賴層 | 阻擋缺項 | 進入下一層門檻 |
|---|---|---|---|
| 0 | 需求來源 | 缺指定 DOCX、缺已定案畫面原檔／可引用附件 | 取得並補審矩陣來源與畫面對照 |
| 1 | 帳號／門市 | 正式成員管理 UI、三門市／角色、PIN 全流程與 RLS 實測缺失 | Owner＋主管＋員工可跨裝置登入且門市隔離通過 |
| 2 | 商品／區域 | 完整商品 CRUD、Excel template/import、區域／商品設定與盤點 gate 缺失 | 真實 Excel 建檔、區域設定、期初資料可重載 |
| 3 | 盤點 | 任務、盲盤、autosave、完成、差異、更正、紙本來源鏈缺失 | 一次真實跨裝置盲盤與不可覆蓋驗證通過 |
| 4 | 進貨 | 每日工作台、人工核對、金額、mapping、寄庫、ERP flag 缺失 | 真實照片 OCR、人工核對與正式收貨通過 |
| 5 | 整體驗收 | 三門市完整資料與所有手機截圖缺失 | 矩陣全部「完成＋可操作＋有證據」 |
