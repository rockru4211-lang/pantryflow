# PantryFlow Release Status

最後核對：2026-08-27（Asia/Taipei）

## 目前開發中

| 任務 | Branch | 基準 commit | 範圍 | 部署狀態 |
| --- | --- | --- | --- | --- |
| PF-SUPABASE-CANONICAL-BASELINE-20260823 | `chore/supabase-canonical-baseline-20260823` | `bf7112a51f53f16f79b4751627666621bda654ea` | production schema／migration／Function 唯讀 baseline 與空白本機重建驗證 | PR #13 OPEN；空白重建與 fingerprint diff 通過；未合併、production 未變更 |
| PF-LOGIN-REAL-20260823 | `feat/pf-login-real-20260823` | `ddedcdcc6e4876fd6d57442e975718ba633a6aaa` | 定案身分入口；沿用既有 Supabase Auth、membership、門市載入、session restore、登出；不新增後端能力 | PR #12；未合併、未部署 |
| PF-LOGIN-SEQUENTIAL-20260825 | 歷史候選稿（未推送） | `84e03a294774d983ec98a1ee687f0f75dd97daeb` | 歷史登入候選版：三身份入口、管理者登入／註冊／密碼重設、Owner 建商家與第一門市、員工 PIN | 已由 `PF-LOGIN-FINAL-20260826` 取代；只保留決策歷史，不部署 |
| PF-LOGIN-FINAL-20260826 | `feature/login-role-home-final-20260827` | `84e03a294774d983ec98a1ee687f0f75dd97daeb` | 兩入口、逐步員工／管理登入、新商家流程、登入後新增員工、主管裝置政策與逾時驗證 | 開發中；Node 48／48 通過；未合併、未部署；production 不變 |
| PF-HOME-ROLES-FINAL-20260827 | `feature/login-role-home-final-20260827` | `84e03a294774d983ec98a1ee687f0f75dd97daeb` | STAFF 綠、ADMIN／SUPERVISOR 橘、LOGISTICS 藍、OWNER 紫四種獨立首頁；五欄導覽以「待辦」取代「掃描」 | 開發中；Node 48／48 通過；登入預覽 Sites v4 已更新；未合併、未部署；真實資料待 Supabase，production 不變 |

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
| 本控管機制 | 開發中 | 位於 `chore/release-governance`；尚未 merge、尚未部署，因此 production 尚看不到管理者版本資訊 |
| 效期、廢棄、借貸、叫貨等廣泛 Alpha 模組 | 暫緩／非本輪正式 Pilot | 文件有產品方向，但本輪 production 雲端 Pilot 只承諾盤點與進貨／收貨後勤 |

## 發版更新規則

1. PR 開啟時列入「開發中」，填寫預定版本；merge 後改為「已合併待部署」。
2. GitHub Pages／Edge Function 成功後記錄完整 commit、workflow run／function version 與時間，改為「已上線待驗收」。
3. production 手機依 `docs/UI_V2_ACCEPTANCE.md` 驗收並核對管理者版本後，才能標示「驗收通過」。
4. frontend 與 Supabase 分開記錄版本；任一部署失敗不得把另一項推定為成功。
