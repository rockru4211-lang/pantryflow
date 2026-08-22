# Operations UI v2 舊版視覺預覽（已撤銷為驗收證據）

驗證日期：2026-08-22

viewport：390 × 844

基準：PF-20260822-OPS-HOME、PF-20260822-COUNT-V2；三張對話附件只採用共通綠色、卡片、資訊層級與正常資料弱化的視覺語言。

本檔截圖來自本地 `previewRole`，只能協助比對視覺，不是 Supabase 真實資料流或正式驗收證據。2026-08-22 共用產品邏輯要求生效後，本檔全部結果改為「待以非 production Supabase authenticated 流程重驗」。

## 既有角色首頁

| 角色 | 必達內容 | 截圖 | 結果 |
| --- | --- | --- | --- |
| STAFF | 今天先看什麼；盤點／收貨／效期入口 | [staff-home.png](screenshots/staff-home.png) | 視覺預覽；待真實重驗 |
| SUPERVISOR | 缺貨、即期、異常、收貨待核對、盤點完成率 | [supervisor-home.png](screenshots/supervisor-home.png) | 視覺預覽；待真實重驗 |
| ADMIN | 待核對事項、營運成果、盤點設定 | [admin-home.png](screenshots/admin-home.png) | 視覺預覽；待真實重驗 |

舊 `owner-home.png` 不再引用。現有 Supabase 沒有已核准 OWNER 角色；不得以預覽畫面建立角色事實或權限。

## STAFF 盤點主流程

| 階段 | 驗證 | 截圖 | 結果 |
| --- | --- | --- | --- |
| 任務選擇 | 先選盤點任務，再進區域 | [staff-count-task.png](screenshots/staff-count-task.png) | 視覺預覽；待真實重驗 |
| 區域／盲盤 | 依走動順序；不顯示舊數量或差異；0 顯示「已盤：0」，空值顯示「未盤」 | [staff-blind-count-zero.png](screenshots/staff-blind-count-zero.png) | 視覺預覽；待真實重驗 |

單元測試覆蓋 domain 與既有 Supabase adapter 路徑；尚未有非 production Supabase branch 可進行 authenticated 寫入，所以不可把本地預覽標為完成。
