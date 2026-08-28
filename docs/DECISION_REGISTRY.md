# PantryFlow 決策登錄表

本表是需求能否進入開發、部署與驗收的唯一索引。詳細規格仍以「來源」欄連結的原始決策為準；狀態不同於程式碼是否存在，不得互相代替。

## 狀態定義

`討論中` → `已定案` → `開發中` → `已合併待部署` → `已上線待驗收` → `驗收通過`

`BLOCKED` 表示缺少不可替代的決策證據；`暫緩` 表示決策仍有效但不在本輪交付。狀態變更時，必須同時更新日期、證據與 `docs/RELEASE_STATUS.md`。

## 已登錄決策

| 決策 ID | 日期 | 來源／來源圖 | 適用角色 | 流程 | 目前狀態 | 實作或驗收證據 |
| --- | --- | --- | --- | --- | --- | --- |
| PF-20260820-HOME | 2026-08-20 | [DECISIONS §1](DECISIONS_2026-08-20.md#1-首頁正式版)（文字決策） | 全角色 | 登入 → 首頁 → 今日重點／每日作業／建議／留言板 | 開發中 | 現行首頁已有 Pilot 部分流程；尚未依 UI v2 定案圖驗收 |
| PF-HOME-ROLES-FINAL-20260827 | 2026-08-27 | [`PF-HOME-ROLES-FINAL-20260827.md`](decisions/PF-HOME-ROLES-FINAL-20260827.md)／[`定案圖`](decisions/assets/PF-HOME-ROLES-FINAL-20260827.jpg)，SHA-256 `24f085a3…4e8c` | STAFF、ADMIN、SUPERVISOR、LOGISTICS、OWNER | 登入 → 依角色進入綠／橘／藍／紫獨立首頁 | 開發中 | 依既有無條碼決策，底部「掃描」改為依角色顯示的「待辦」；本輪未合併、未部署，Supabase 不變 |
| PF-20260820-COUNT | 2026-08-20 | [DECISIONS §4](DECISIONS_2026-08-20.md#4-盤點流程)（文字決策） | STAFF、SUPERVISOR、ADMIN | 區域 → 盲盤 → 差異 → 原因 → 完成 | 已上線待驗收 | production `dee9cbbe…`；尚缺 UI v2 圖對照驗收 |
| PF-20260820-RECEIPT-UPLOAD | 2026-08-20 | [DECISIONS §6](DECISIONS_2026-08-20.md#6-進貨第一線只上傳照片)（文字決策） | 現場人員 | 拍照／選圖 → 確認清楚 → 上傳 → 離開 | 驗收通過 | PR #5；production `dee9cbbe…`；17 個 Deno 測試 |
| PF-20260820-RECEIPT-REVIEW | 2026-08-20 | [DECISIONS §7–11](DECISIONS_2026-08-20.md#7-收貨待核對)（文字決策） | 有核對權限者 | 待核對 → 編碼 → 明細 → 修正另存 → 成果 | 已上線待驗收 | OCR 原值、人工修正與正式收貨分離；尚缺完整手機驗收證據 |
| PF-20260821-CLOUD | 2026-08-21 | [DECISIONS §1–5](DECISIONS_2026-08-21.md#1-pilot-是公開測試產品不是-demo)（文字決策） | ADMIN、SUPERVISOR、STAFF | 註冊／登入 → 建立商家 → 權限化作業 | 已上線待驗收 | production `dee9cbbe…`；Supabase Auth／organization RLS |
| PF-20260821-OCR | 2026-08-21 | [DECISIONS §6–7](DECISIONS_2026-08-21.md#6-real-pilot-收貨-ocr後續確認優先於舊-mock-決策)（文字決策） | 上傳者、核對者 | 私有原圖 → Gemini → 版本化 run → 人工核對 | 驗收通過 | PR #4；migration `20260821142316_allocate_receipt_ocr_run_version`; Edge Function production v10 |
| PF-20260821-MULTI-ROUTING | 2026-08-21 | 使用者核准的 PR #5 需求（尚未另存定案圖） | 上傳者、核對者 | 預設一圖一 batch；明確選擇時才多頁合併；各 batch 平行 OCR | 驗收通過 | PR #5；production `dee9cbbe…`；17 個 Deno 測試 |
| PF-UIV2-IMG-01 | 2026-08-23 | [`PF-UI-V2/01-login-registration-store.png`](decisions/PF-UI-V2/01-login-registration-store.png)，SHA-256 `5890df4d…f587fce2` | 員工、店長／主管、後勤／管理 | 選身分 → 選門市／識別方式 → 確認身分 → 6 位 PIN | 已取代 | 2026-08-26 由 `PF-LOGIN-FINAL-20260826` 取代；保留歷史，不得再用於實作 |
| PF-UIV2-IMG-02 | 2026-08-23 | [`PF-UI-V2/02-receiving.png`](decisions/PF-UI-V2/02-receiving.png)，SHA-256 `86a396b2…6aa1067a` | 有進貨核對權限者 | 原始單據核對 → 商品對應／編碼 → 確認收貨 → 條件式 ERP 待辦 | 已定案 | 原圖已鎖定；上傳／OCR 排隊畫面未呈現在圖中，不得猜測 |
| PF-UIV2-IMG-03 | 2026-08-23 | [`PF-UI-V2/03-count.png`](decisions/PF-UI-V2/03-count.png)，SHA-256 `bb6429ab…bbedd5d` | STAFF、SUPERVISOR、ADMIN | 任務 → 區域 → 盲盤 → 區域完成 → 全部完成 → 差異 | 已定案 | 原圖已鎖定；待以手機及桌機實作截圖逐項驗收 |
| PF-COUNT-MODES-FINAL-20260827 | 2026-08-27 | [`PF-COUNT-MODES-FINAL-20260827.md`](decisions/PF-COUNT-MODES-FINAL-20260827.md)／既有 [`03-count.png`](decisions/PF-UI-V2/03-count.png)／Notion 最終畫面 | STAFF、ADMIN、SUPERVISOR、LOGISTICS、OWNER | 建立商家選營運模式 → 六步盲盤 → 依模式完成／紙本 → 匯出；依角色進入執行、稽查、分析或管理摘要 | 開發中 | Node 57／57、Sites 預覽 8／8；Sites v5 瀏覽器檢查及使用者畫面定案完成；未合併、未部署，Supabase production 不變 |
| PF-PILOT-COUNT-RECEIVING-FINAL-20260827 | 2026-08-27 | [`PF-PILOT-COUNT-RECEIVING-FINAL-20260827.md`](decisions/PF-PILOT-COUNT-RECEIVING-FINAL-20260827.md)／Notion 最終規格 | STAFF、ADMIN、SUPERVISOR、LOGISTICS、OWNER | 主管盤點設定 → 員工盲盤 → 雙匯出；多圖貨單 → 後勤核對發布 → Owner 摘要／稽查 | 開發中 | `feature/count-receiving-pilot-final-20260827`；Node 61／61；未合併、未部署，Supabase production 不變 |
| PF-PILOT-FUNCTIONAL-REPAIR-20260827 | 2026-08-27 | [`PF-PILOT-FUNCTIONAL-REPAIR-20260827.md`](decisions/PF-PILOT-FUNCTIONAL-REPAIR-20260827.md)／主管 production 實測 | ADMIN、SUPERVISOR、STAFF、進貨核對者 | session 失效 → 重登；區域完整設定；CSV／XLSX 預覽 → 正式匯入 → 原位置回填；多圖 → OCR → 查看／重試 | 已上線待驗收 | PR #23；main `1fc049f1…`；Pages 同 SHA；migration `20260827104642`；Node 66／66 |
| PF-COUNT-FIRST-TESTABLE-20260828 | 2026-08-28 | [`PF-COUNT-FIRST-TESTABLE-20260828.md`](decisions/PF-COUNT-FIRST-TESTABLE-20260828.md)／使用者要求先取得盤點＋進貨測試版 | STAFF、ADMIN、SUPERVISOR、進貨核對者 | 一次匯入／建區 → 每日自動盤點 → 盲盤自動保存 → 差異；多圖貨單 → OCR → 實收與到貨差異 | 開發中／測試站待驗收 | `fix/count-receiving-testable-20260828`；production 當日排程盤點已存在；28 批待核對、587 個 OCR 欄位；GitHub 與既有 production migrations 對齊中 |
| PF-SUPABASE-CANONICAL-BASELINE-20260823 | 2026-08-23 | [`SUPABASE_CANONICAL_BASELINE_20260823.md`](SUPABASE_CANONICAL_BASELINE_20260823.md) | 發版治理 | production 唯讀擷取 → immutable baseline → 空白本機重建 → fingerprint diff | 開發中 | `chore/supabase-canonical-baseline-20260823`；不修改 production，PR 合併前須取得 blank-stack workflow 成功證據 |
| PF-LOGIN-SEQUENTIAL-20260825 | 2026-08-25 | [`PF-LOGIN-SEQUENTIAL-20260825.md`](decisions/PF-LOGIN-SEQUENTIAL-20260825.md) | Owner、ADMIN、SUPERVISOR、後勤、STAFF | 三身份入口 → 對應登入 → Owner 建商家／門市或員工 PIN → session／門市角色 | 已取代 | 2026-08-26 由 `PF-LOGIN-FINAL-20260826` 取代；未合併、未部署 |
| PF-LOGIN-FINAL-20260826 | 2026-08-26；2026-08-27 覆寫 | [`PF-LOGIN-FINAL-20260826.md`](decisions/PF-LOGIN-FINAL-20260826.md)／[`定案圖`](decisions/assets/PF-LOGIN-FINAL-20260826.jpeg)，SHA-256 `66fe4c03…1ff28` | Owner、ADMIN、SUPERVISOR、後勤、STAFF | 兩入口 → 員工／管理登入；新商家逐步建立；登入後新增員工；主管設定裝置政策／逾時驗證 | 開發中 | 2026-08-27：登入者裝置控制移至「設定 → 登入與裝置」；本輪未合併、未部署 |

## 新決策登錄規則

1. 一個可獨立開發或驗收的決策使用一個 ID；不得以聊天標題代替。
2. 來源圖需存於 repository 的 `docs/decisions/assets/`，或使用團隊可長期存取且版本固定的連結，並記錄檔名、日期與雜湊。
3. 「角色」需指出誰看得到、誰可操作；「流程」需寫清楚起點、主要動作與完成狀態。
4. PR 只能引用 `已定案` 或 `開發中` 的決策。改變流程或角色時先新增／更新決策，不可只改程式。
5. 合併、部署與驗收是三個不同狀態；每次狀態變更均附 commit、workflow／function version、測試或截圖證據。
