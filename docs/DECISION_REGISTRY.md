# PantryFlow 決策登錄表

本表是需求能否進入開發、部署與驗收的唯一索引。詳細規格仍以「來源」欄連結的原始決策為準；狀態不同於程式碼是否存在，不得互相代替。

## 狀態定義

`討論中` → `已定案` → `開發中` → `已合併待部署` → `已上線待驗收` → `驗收通過`

`BLOCKED` 表示缺少不可替代的決策證據；`暫緩` 表示決策仍有效但不在本輪交付。狀態變更時，必須同時更新日期、證據與 `docs/RELEASE_STATUS.md`。

## 已登錄決策

| 決策 ID | 日期 | 來源／來源圖 | 適用角色 | 流程 | 目前狀態 | 實作或驗收證據 |
| --- | --- | --- | --- | --- | --- | --- |
| PF-20260820-HOME | 2026-08-20 | [DECISIONS §1](DECISIONS_2026-08-20.md#1-首頁正式版)（文字決策） | 全角色 | 登入 → 首頁 → 今日重點／每日作業／建議／留言板 | 開發中 | 現行首頁已有 Pilot 部分流程；尚未依 UI v2 定案圖驗收 |
| PF-20260820-COUNT | 2026-08-20 | [DECISIONS §4](DECISIONS_2026-08-20.md#4-盤點流程)（文字決策） | STAFF、SUPERVISOR、ADMIN | 區域 → 盲盤 → 差異 → 原因 → 完成 | 已上線待驗收 | production `dee9cbbe…`；尚缺 UI v2 圖對照驗收 |
| PF-20260820-RECEIPT-UPLOAD | 2026-08-20 | [DECISIONS §6](DECISIONS_2026-08-20.md#6-進貨第一線只上傳照片)（文字決策） | 現場人員 | 拍照／選圖 → 確認清楚 → 上傳 → 離開 | 驗收通過 | PR #5；production `dee9cbbe…`；17 個 Deno 測試 |
| PF-20260820-RECEIPT-REVIEW | 2026-08-20 | [DECISIONS §7–11](DECISIONS_2026-08-20.md#7-收貨待核對)（文字決策） | 有核對權限者 | 待核對 → 編碼 → 明細 → 修正另存 → 成果 | 已上線待驗收 | OCR 原值、人工修正與正式收貨分離；尚缺完整手機驗收證據 |
| PF-20260821-CLOUD | 2026-08-21 | [DECISIONS §1–5](DECISIONS_2026-08-21.md#1-pilot-是公開測試產品不是-demo)（文字決策） | ADMIN、SUPERVISOR、STAFF | 註冊／登入 → 建立商家 → 權限化作業 | 已上線待驗收 | production `dee9cbbe…`；Supabase Auth／organization RLS |
| PF-20260821-OCR | 2026-08-21 | [DECISIONS §6–7](DECISIONS_2026-08-21.md#6-real-pilot-收貨-ocr後續確認優先於舊-mock-決策)（文字決策） | 上傳者、核對者 | 私有原圖 → Gemini → 版本化 run → 人工核對 | 驗收通過 | PR #4；migration `20260821142316_allocate_receipt_ocr_run_version`; Edge Function production v10 |
| PF-20260821-MULTI-ROUTING | 2026-08-21 | 使用者核准的 PR #5 需求（尚未另存定案圖） | 上傳者、核對者 | 預設一圖一 batch；明確選擇時才多頁合併；各 batch 平行 OCR | 驗收通過 | PR #5；production `dee9cbbe…`；17 個 Deno 測試 |
| PF-UIV2-IMG-01 | 2026-08-23 | [`PF-UI-V2/01-login-registration-store.png`](decisions/PF-UI-V2/01-login-registration-store.png)，SHA-256 `5890df4d…f587fce2` | 員工、店長／主管、後勤／管理 | 選身分 → 選門市／識別方式 → 確認身分 → 6 位 PIN | 已定案 | 原圖已鎖定；Owner 註冊／建店表單未呈現在圖中，不得猜測 |
| PF-UIV2-IMG-02 | 2026-08-23 | [`PF-UI-V2/02-receiving.png`](decisions/PF-UI-V2/02-receiving.png)，SHA-256 `86a396b2…6aa1067a` | 有進貨核對權限者 | 原始單據核對 → 商品對應／編碼 → 確認收貨 → 條件式 ERP 待辦 | 已定案 | 原圖已鎖定；上傳／OCR 排隊畫面未呈現在圖中，不得猜測 |
| PF-UIV2-IMG-03 | 2026-08-23 | [`PF-UI-V2/03-count.png`](decisions/PF-UI-V2/03-count.png)，SHA-256 `bb6429ab…bbedd5d` | STAFF、SUPERVISOR、ADMIN | 任務 → 區域 → 盲盤 → 區域完成 → 全部完成 → 差異 | 已定案 | 原圖已鎖定；待以手機及桌機實作截圖逐項驗收 |

## 新決策登錄規則

1. 一個可獨立開發或驗收的決策使用一個 ID；不得以聊天標題代替。
2. 來源圖需存於 repository 的 `docs/decisions/assets/`，或使用團隊可長期存取且版本固定的連結，並記錄檔名、日期與雜湊。
3. 「角色」需指出誰看得到、誰可操作；「流程」需寫清楚起點、主要動作與完成狀態。
4. PR 只能引用 `已定案` 或 `開發中` 的決策。改變流程或角色時先新增／更新決策，不可只改程式。
5. 合併、部署與驗收是三個不同狀態；每次狀態變更均附 commit、workflow／function version、測試或截圖證據。
