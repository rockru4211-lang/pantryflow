# Operations UI v2 驗收基準

## 來源鎖定（開發前硬閘門）

進貨與盤點仍使用 2026-08-23 的鎖定圖；登入／註冊已由使用者於 2026-08-26 以 `PF-LOGIN-FINAL-20260826` 新圖取代。圖片未呈現的版面仍不得自行推測，也不得因來源已鎖定就宣稱現有程式通過畫面驗收。

| 順序 | 決策 ID | 圖檔／永久連結 | 定案日期 | SHA-256 | 涵蓋頁面 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | PF-LOGIN-FINAL-20260826 | [`PF-LOGIN-FINAL-20260826.jpeg`](decisions/assets/PF-LOGIN-FINAL-20260826.jpeg) | 2026-08-26 | `66fe4c030e95b51e50e0740e9d0fbdf82df8d02b0eb4bbdb2398186570e1ff28` | 兩入口、員工快速登入、管理登入、新商家、登入後新增員工、記住裝置 | LOCKED／開發中 |
| 01A | PF-HOME-ROLES-FINAL-20260827 | [`PF-HOME-ROLES-FINAL-20260827.jpg`](decisions/assets/PF-HOME-ROLES-FINAL-20260827.jpg) | 2026-08-27 | `24f085a34ed390440b3dc67f9d0aa0c261aac29cd96646fe31a5b2045db44e8c` | 員工、店長／主管、後勤／管理、Owner 四種登入後首頁 | LOCKED／開發中 |
| 02 | PF-UIV2-IMG-02 | [`02-receiving.png`](decisions/PF-UI-V2/02-receiving.png) | 2026-08-23 | `86a396b2f55a2f2f3b0a799042a6ebfa28b778dc4ddfb4d47572ed886aa1067a` | 進貨人工核對、商品 Mapping／編碼、收貨完成 | LOCKED |
| 03 | PF-UIV2-IMG-03 | [`03-count.png`](decisions/PF-UI-V2/03-count.png) | 2026-08-23 | `bb6429ab81a166919ece9cac8182e1176c3641783777f3bd1cf3b7927bbedd5d` | 任務、區域、盲盤、完成、差異 | LOCKED |
| 03A | PF-COUNT-MODES-FINAL-20260827 | [`PF-COUNT-MODES-FINAL-20260827.md`](decisions/PF-COUNT-MODES-FINAL-20260827.md)／Notion 最終畫面 | 2026-08-27 | 文字覆寫；保留 03 原圖 | 營運模式、兩種完成畫面、員工匯出、四角色盤點分工 | LOCKED／開發中 |
| 04 | PF-PILOT-COUNT-RECEIVING-FINAL-20260827 | [`PF-PILOT-COUNT-RECEIVING-FINAL-20260827.md`](decisions/PF-PILOT-COUNT-RECEIVING-FINAL-20260827.md)／Notion 最終規格 | 2026-08-27 | 文字覆寫；保留 02／03 原圖 | 盤點匯入／雙匯出、進貨多圖／發布、角色及餐飲模式分流 | LOCKED／開發中 |

三張圖片共同定案日為 2026-08-23。後續若要取代任一圖片，必須新增決策紀錄、保留被取代原圖並記錄新舊 SHA-256；不得直接覆寫本次檔案。

## 逐頁必達條件

以下條件由已鎖定圖片及既有文字決策共同建立。圖片是畫面、資訊層級與流程呈現的最高驗收依據；資料完整性、權限與不可覆蓋規則仍由既有文字決策補充。圖片未呈現的畫面標為 `NOT DEPICTED`，不得自行設計後宣稱符合定案圖。

| 頁面／狀態 | 必達畫面 | 必達互動與資料條件 | 圖面依據 | 狀態 |
| --- | --- | --- | --- | --- |
| 登入入口 | 白底、墨綠 PantryFlow、A 版多瓣小雛菊；員工快速登入、管理帳號登入、建立新商家 | 兩種登入方式；管理角色登入後由權限分流 | PF-LOGIN-FINAL-20260826 | 開發中；待 PR 手機／production 驗收 |
| ADMIN Email／Password 登入 | 三張既有定案圖均未呈現；不得宣稱既有定案 | 提案只可涵蓋既有 ADMIN Auth、membership、session、登出 | PF-LOGIN-UI-PROPOSAL-20260824 | PROPOSAL；待使用者看桌機／手機截圖決定 |
| 員工快速登入 | 門市代碼、確認門市、固定識別方式、確認身分、6 位 PIN | 帳號與 PIN 由主管建立；連續錯誤 5 次鎖定 15 分鐘；匿名門市預覽後端尚缺 | PF-LOGIN-FINAL-20260826 | 前端開發中／後端預覽能力待 Supabase 階段 |
| Owner 註冊／建立門市 | 建立帳號、驗證 Email、建立商家、第一間門市、第一位管理者、完成 | 新增員工移到登入後設定，不得阻塞註冊 | PF-LOGIN-FINAL-20260826 | 開發中 |
| 記住裝置 | 登入頁只顯示主管設定的唯讀政策摘要；設定頁管理個人／共用、1／7／30 天或每次 | 登入者不可自行修改；未授權裝置不得保存身分；員工逾時只重輸 PIN，管理帳號只重輸密碼 | PF-LOGIN-FINAL-20260826（2026-08-27 覆寫） | 開發中 |
| 四種角色首頁 | STAFF 綠、ADMIN／SUPERVISOR 橘、LOGISTICS 藍、OWNER 紫；區塊順序、卡片與數字依圖；五欄導覽為首頁／作業紀錄／待辦／通知／我的 | 登入後依真實角色直接分流；「待辦」內容依角色；後勤與 Owner 不得借用店長首頁；資料先用安全範例，待 Supabase 階段串接 | PF-HOME-ROLES-FINAL-20260827 | 開發中 |
| 盤點任務／區域 | 日期、狀態、區域進度、項目數、開始盤點；依現場順序選區域 | 全部區域完成前不得產生最終差異 | PF-UIV2-IMG-03 | LOCKED／待實作驗收 |
| 區域盲盤 | 品名、數字輸入、唯讀單位、區域進度；只在效期異常時提示 | 不顯示上次數量／差異；輸入即自動保存；原始實盤不可覆蓋 | PF-UIV2-IMG-03 | LOCKED／待實作驗收 |
| 盤點完成／差異 | 區域完成、全部區域完成及差異總覽為不同狀態；差異頁只列異常 | 全區完成後才整理差異；原因與更正／重盤另存事件 | PF-UIV2-IMG-03 | LOCKED／待實作驗收 |
| 建立商家營運模式 | 純白底；中小餐廳／單店與連鎖餐飲／多門市兩個選項；說明日後可調整 | 使用既有 `business_type`；不拆登入或前端；未啟用功能完全隱藏 | PF-COUNT-MODES-FINAL-20260827 | LOCKED／開發中 |
| 中小餐廳盤點完成 | 完成區域／品項、查看明細、匯出明細、返回首頁；不出現紙本或跨店元件 | 員工可匯出；原始數量不可覆蓋 | PF-COUNT-MODES-FINAL-20260827 | LOCKED／開發中 |
| 連鎖餐飲盤點完成 | 完成區域／品項、謄寫企業紙本、匯出明細、門市紀錄 | 紙本完成需留經手人與時間並由主管確認；正式持久化待 Supabase 階段 | PF-COUNT-MODES-FINAL-20260827 | LOCKED／前端開發中 |
| 四角色盤點頁 | STAFF 綠執行；ADMIN／SUPERVISOR 橘設定與稽查；LOGISTICS 藍整理分析；OWNER 紫看結論與政策 | 後勤不得覆蓋原始實盤；Owner 不做後勤逐筆整理；四者不得共用同頁只換色 | PF-COUNT-MODES-FINAL-20260827 | LOCKED／開發中 |
| 主管盤點設定 | 純白畫布；區域、匯入驗證、本次品項與發布任務分區呈現 | 匯入先顯示已對應／未對應／重複／缺單位；中小餐廳可選品，連鎖依公司範本固定；正式來源位置保存待 Supabase | PF-PILOT-COUNT-RECEIVING-FINAL-20260827 | 前端開發中／資料持久化待後續 |
| 員工盤點匯出 | 完成頁同時顯示原格式回填版與完整稽核明細；連鎖另顯示紙本必做 | 回填版保持來源位置、新品另表；目前 CSV 外殼已接線，真正 Excel 位置映射待 Supabase／試算表階段 | PF-PILOT-COUNT-RECEIVING-FINAL-20260827 | 前端開發中／位置映射待後續 |
| 主管盤點功能修復 | 保留白底定案呈現；區域卡提供重新命名、排序、品項增減與停用；匯入卡顯示驗證統計及正式確認 | 原檔 private Storage；來源工作表／列號／數量欄位不可覆蓋；同門市區域名稱唯一；原位置 XLSX 回填 | PF-PILOT-FUNCTIONAL-REPAIR-20260827 | 已上線待驗收；main `1fc049f1…`、migration `20260827104642` |
| 貨單上傳／OCR 處理狀態 | 本張定案圖從人工核對開始，未呈現上傳及排隊版面 | 不得從文字規格猜測圖面；原圖及 OCR run 仍須不可覆蓋 | PF-UIV2-IMG-02 | NOT DEPICTED |
| 進貨人工核對 | 原始收據、OCR 原文、數量、單價、未稅、稅額、含稅及人工確認狀態 | 修改另存操作者、時間及原始辨識；每筆可回查原始收據 | PF-UIV2-IMG-02 | LOCKED／待實作驗收 |
| 商品對應／編碼 | OCR 品名 → 商品主檔；選擇既有商品或建立新商品／編碼；正確／已修正／無法判讀 | 儲存並確認收貨前須完成每筆核對 | PF-UIV2-IMG-02 | LOCKED／待實作驗收 |
| 收貨完成 | 一般餐廳完成核對並結案；已啟用 ERP 的連鎖餐飲顯示待處理與提醒主管 | ERP 步驟只依商家設定顯示 | PF-UIV2-IMG-02 | LOCKED／待實作驗收 |
| 多圖貨單上傳 | 純白畫布；同一貨單／不同貨單選擇、多圖預覽、最多 10 張、疑似重複提醒 | 不同貨單分批建立；原圖保留；完整跨批次重複判定待 Supabase | PF-PILOT-COUNT-RECEIVING-FINAL-20260827 | 前端開發中 |
| OCR 狀態／重試修復 | 保留現有白底多圖畫面；批次明確顯示識別中、待核對、已完成或辨識失敗 | 前端狀態與 DB enum 一致；上傳者／主管可讀同店結果；失敗保留原圖及 run 並建立新版重試 | PF-PILOT-FUNCTIONAL-REPAIR-20260827 | 已上線待驗收；RLS 已核對，既有 OCR v11／enqueue v1 ACTIVE |
| 進貨角色分工 | STAFF／主管為現場上傳驗收；LOGISTICS 為藍色核對發布；OWNER 為紫色摘要稽查 | 只有發布資料進正式統計；Owner 不得看到人工修正表單或後勤待核對佇列 | PF-PILOT-COUNT-RECEIVING-FINAL-20260827 | 開發中 |

## 每頁驗收證據

每個 PR 至少附：

1. 實機或等效手機 viewport 截圖，包含主要畫面、空狀態、錯誤狀態及完成狀態。
2. 圖片對照說明（圖號、差異、是否經重新定案），不得只寫「looks good」。
3. 權限驗證：至少涵蓋該頁可操作角色與不可操作角色。
4. 資料流驗證：輸入、Supabase／本機資料來源、寫入結果、重新整理後狀態及不可覆蓋紀錄。
5. production 驗收時拍到 ADMIN 版本資訊，並與 GitHub Pages workflow 的 commit／run 一致。

### PF-LOGIN-REAL-20260823 合併前證據

- Branch：`feat/pf-login-real-20260823`；基準：`main@ddedcdcc6e4876fd6d57442e975718ba633a6aaa`。
- 自動測試：登入 DOM／真實 Supabase 接線、全站 JavaScript 語法、Pages governance 與既有 runtime smoke 共 9 項通過。
- 尚未合併、未部署；feature branch 不會覆蓋正式 Pages 網址。
- 手機畫面、真實帳號角色／RLS、session restore 與 production 版本標記仍須在可追溯部署後驗收，未提前標示通過。

## 通過規則

- `必達畫面`、`必達互動與資料條件` 全部通過，且無未說明差異。
- 手機截圖、資料流測試、部署版本皆可追溯至同一 commit。
- 合併但未部署只能標示「已合併待部署」；已部署但未以 production 手機驗證只能標示「已上線待驗收」。
- 任一來源圖缺失、版本不明或與文字決策衝突時，維持 `BLOCKED` 並先完成定案。
