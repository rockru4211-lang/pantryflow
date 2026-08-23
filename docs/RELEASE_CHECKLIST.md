# PantryFlow Release Checklist

本清單是每次測試與正式交付的必要閘門。任何欄位未完成時，狀態只能標示為「未部署」或「未驗收」。

## 1. 定案來源

- [ ] 已列出 Notion 定案頁面永久連結、頁面版本／最後編輯時間與決策人。
- [ ] 已列出對應 decision ID，且 repository 決策文件與 Notion 定案一致。
- [ ] 所有附圖已視為驗收規格，並保存原始圖或不可變連結。
- [ ] 已逐項記錄手機與桌機的版面、資訊層級、文字、狀態及互動驗收條件。
- [ ] 本次內容沒有混入 `legacy-demo/`、mock、local fallback 或未定案功能。

## 2. Git 與 PR

- [ ] 開發 branch 由最新 `main` 建立。
- [ ] 所有變更經單一 PR 合併，PR 明列 decision ID、資料來源、影響流程及風險。
- [ ] PR required checks 全部通過，且有指定 reviewer 核准。
- [ ] 合併後記錄完整 `main` Git SHA；前端、migration 與 Edge Function 均取自該 SHA。
- [ ] 沒有從 feature／preview／archive branch 直接部署。

## 3. Supabase

- [ ] 已保存 production migration list，並與該 `main` SHA 的 `supabase/migrations/` 逐版比對。
- [ ] `main` 與 production 不存在未解釋的 migration version／name drift。
- [ ] 所有待部署 migration 已在隔離的 non-production 環境依序套用成功。
- [ ] 已執行 schema diff、RLS／權限檢查及 Supabase security／performance advisors。
- [ ] Edge Function bundle 已嵌入或附帶完整 Git SHA，部署清單包含 slug、version、SHA 與 source digest。
- [ ] production environment 已設定人工核准；核准前沒有執行 migration repair、db push 或 function deploy。
- [ ] 已準備可驗證、非破壞性的回復方案。

## 4. GitHub Pages

- [ ] Pages workflow 僅由 `main` push 觸發，且沒有 `workflow_dispatch`。
- [ ] checkout 的 HEAD 等於事件的完整 `GITHUB_SHA`。
- [ ] artifact path 僅為 `pilot-v1/`，artifact 內不含 `legacy-demo/` 或 repository 根目錄舊前端。
- [ ] workflow run URL、run ID、完整 Git SHA 與 artifact digest 已記錄。
- [ ] 測試網址實際顯示 branch、完整 Git SHA 與 UTC 部署時間，且與 workflow 完全一致。
- [ ] 若任一版本欄位缺失、為 `unknown` 或不一致，deployment 判定失敗。

## 5. 視覺與流程驗收

- [ ] 手機實機截圖涵蓋登入、首頁及本次所有受影響流程。
- [ ] 桌機截圖涵蓋同一批流程，並與定案附圖逐項比對。
- [ ] 已測試 Owner／ADMIN／SUPERVISOR／STAFF 的允許與拒絕路徑。
- [ ] 已完成一條由登入、資料建立、現場操作、後勤核對到成果輸出的完整流程測試。
- [ ] 已完成跨裝置／重新登入驗證，資料不是來自 localStorage、mock 或 seed fallback。
- [ ] 原始資料、人工修正、操作者、門市與時間均可追溯且未被覆寫。
- [ ] 錯誤、離線、權限不足與部分失敗情境有明確結果，不留下半套正式資料。

## 6. 交付紀錄

- [ ] Branch：
- [ ] 完整 Git SHA：
- [ ] PR：
- [ ] Pages workflow run：
- [ ] 測試網址與頁面版本標記：
- [ ] Production migrations：
- [ ] Edge Function versions／SHA：
- [ ] 測試命令與結果：
- [ ] 手機／桌機截圖位置：
- [ ] 核准人與核准時間：
