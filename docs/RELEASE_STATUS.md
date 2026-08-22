# PantryFlow Release Status

最後核對：2026-08-22（Asia/Taipei）

## Production 基準

| 項目 | Production 值 | 證據／備註 |
| --- | --- | --- |
| GitHub repository | `rockru4211-lang/pantryflow` | production frontend 由 `main` 發佈 |
| Frontend commit | `dee9cbbe7ec278f498cd3bb331d5792a5a41dbab` | PR #5 merge commit |
| GitHub Pages | run `#25`，`success` | 2026-08-21 23:52:49 +08:00 完成；[workflow run](https://github.com/rockru4211-lang/pantryflow/actions/runs/32499961727) |
| Production URL | `https://rockru4211-lang.github.io/pantryflow/` | 管理者應以「更多」頁的 commit／run 再核對手機快取 |
| OCR Edge Function | `process-receipt-ocr` production v10 | 2026-08-21 上線驗證紀錄；本分支不修改或部署 Supabase |

## 已部署功能

| 決策 | 功能 | 部署狀態 | 驗收狀態 |
| --- | --- | --- | --- |
| PF-20260821-CLOUD | Supabase Auth、organization 隔離、雲端盤點 catalog | 已部署 | 待依 UI v2 圖做完整手機驗收 |
| PF-20260820-COUNT | 區域盲盤、自動保存、差異整理、追加更正、Excel | 已部署 | 待依 UI v2 圖做完整手機驗收 |
| PF-20260821-OCR | Gemini retry、缺欄位人工確認、版本／並行安全、寫入錯誤追蹤 | 已部署（frontend + Edge Function v10） | 後端 smoke test 已完成 |
| PF-20260821-MULTI-ROUTING | 預設一圖一貨單、明確多頁模式、平行 OCR 與失敗隔離 | 已部署（commit `dee9cbbe…`） | 17 個 Deno 測試通過；production UI 已可測 |

## 已定案但尚未完整上線

| 決策 | 狀態 | 尚缺條件 |
| --- | --- | --- |
| PF-20260820-HOME | 開發中 | 現行 Pilot 頁面尚未依 operations-ui-v2 定案圖完成／驗收 |
| PF-20260820-RECEIPT-REVIEW | 已部署部分流程、待完整驗收 | 需補齊 UI v2 手機畫面與完整角色／資料流證據 |

## 討論中／阻塞中

| 項目 | 狀態 | 原因 |
| --- | --- | --- |
| Operations UI v2 共用骨架與垂直切片 | 開發中 | `feature/operations-ui-v2`：Task／Count／Inventory Event／Exception domain、現有三角色投影、盤點主流程；尚未 merge 或部署 |
| OWNER 角色 | 討論中／BLOCKED | 本 UI 分支不得修改 role、enum、RLS、migration；若需正式 OWNER 必須獨立決策 |
| Operations UI v2 三張來源圖 | 語意待校正 | 已收到附件與 SHA-256，但內容是效期／Demo／廢棄頁，與同訊息列出的盤點／角色圖名稱不一致 |
| 本控管機制 | 開發中 | 已納入 `feature/operations-ui-v2`；尚未 merge、尚未部署，因此 production 尚看不到管理者版本資訊 |
| 效期、廢棄、借貸、叫貨等廣泛 Alpha 模組 | 暫緩／非本輪正式 Pilot | 文件有產品方向，但本輪 production 雲端 Pilot 只承諾盤點與進貨／收貨後勤 |

## 發版更新規則

1. PR 開啟時列入「開發中」，填寫預定版本；merge 後改為「已合併待部署」。
2. GitHub Pages／Edge Function 成功後記錄完整 commit、workflow run／function version 與時間，改為「已上線待驗收」。
3. production 手機依 `docs/UI_V2_ACCEPTANCE.md` 驗收並核對管理者版本後，才能標示「驗收通過」。
4. frontend 與 Supabase 分開記錄版本；任一部署失敗不得把另一項推定為成功。
