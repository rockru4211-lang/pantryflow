# Operations UI v2 第一版手機驗證

驗證日期：2026-08-22

viewport：390 × 844

基準：PF-20260822-OPS-HOME、PF-20260822-COUNT-V2；三張對話附件只採用共通綠色、卡片、資訊層級與正常資料弱化的視覺語言。

本地 `previewRole` 僅在 `localhost`／`127.0.0.1` 生效，用於重現畫面；production 路徑只讀取 Supabase `profiles.role`。預覽不代表正式營運資料，所有缺值均顯示「尚無資料」。

## 四角色首頁

| 角色 | 必達內容 | 截圖 | 結果 |
| --- | --- | --- | --- |
| STAFF | 今天先看什麼；盤點／收貨／效期入口 | [staff-home.png](screenshots/staff-home.png) | 通過 |
| SUPERVISOR | 缺貨、即期、異常、收貨待核對、盤點完成率 | [supervisor-home.png](screenshots/supervisor-home.png) | 通過；缺資料不造數字 |
| ADMIN | 待核對事項、營運成果、盤點設定 | [admin-home.png](screenshots/admin-home.png) | 通過 |
| OWNER | 全局營運、成員／權限、商家／設定入口 | [owner-home.png](screenshots/owner-home.png) | 首頁通過；成員與商家編輯流程待下一版 |

## STAFF 盤點主流程

| 階段 | 驗證 | 截圖 | 結果 |
| --- | --- | --- | --- |
| 任務選擇 | 先選盤點任務，再進區域 | [staff-count-task.png](screenshots/staff-count-task.png) | 通過 |
| 區域／盲盤 | 依走動順序；不顯示舊數量或差異；0 顯示「已盤：0」，空值顯示「未盤」 | [staff-blind-count-zero.png](screenshots/staff-blind-count-zero.png) | 通過 |

資料流另由 Deno tests 與既有 Supabase count flow 驗證：草稿 upsert、區域完成轉 immutable `INITIAL_COUNT`、完成區域後刪除可替換草稿、全區完成才進差異整理。production migration 與寫入 smoke test 尚未執行。
