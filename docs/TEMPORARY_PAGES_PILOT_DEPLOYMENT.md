# PantryFlow 暫時 GitHub Pages Pilot 部署

最後更新：2026-08-22

## 部署前基準

- 公開網址：`https://rockru4211-lang.github.io/pantryflow/`
- 原部署分支：`main`
- 原部署 commit：`dee9cbbe7ec278f498cd3bb331d5792a5a41dbab`
- 原成功 workflow run：`32499961727`
- environment：`github-pages`
- 原 deployment branch policy：只允許 `main`

## 暫時 Pilot 部署

- 分支：`feat/receipt-review-ui-integration`
- 部署 commit：`224a1194ac480b30d04c0631341704d4e58e4cd7`
- 成功 workflow run：`32579279780`
- 公開網址：`https://rockru4211-lang.github.io/pantryflow/`
- 驗證：GitHub Actions 的 Checkout、Configure Pages、Upload site、Deploy 全部成功；公開 `index.html` 與該 commit 的 SHA-256 均為 `15146bc5012b449ec4c8cdd32a9266ad530931f7c9fd19f770c677691c8cd869`。
- branch policy：只在原本 `main` 之外新增精確分支 `feat/receipt-review-ui-integration`，未加入 wildcard。

## 測試後還原 main

1. 在 GitHub repository 開啟 **Actions**。
2. 選擇 **Deploy PantryFlow to GitHub Pages**。
3. 點 **Run workflow**，Branch 選擇 `main`，再次按 **Run workflow**。
4. 確認新 run 的 `headBranch` 為 `main`、所有步驟成功，並以公開 `index.html` 對照 `main` commit `dee9cbb`（若 main 屆時已有新 commit，應先確認要還原到哪一個 main commit）。
5. 開啟 **Settings → Environments → github-pages → Deployment branches and tags**。
6. 刪除 `feat/receipt-review-ui-integration` policy，只保留 `main`。
7. 再次檢查公開網址已呈現 main，並把還原 run 與 commit 寫回本文件或驗收紀錄。

CLI 等價操作：

```sh
gh workflow run deploy-pages.yml --repo rockru4211-lang/pantryflow --ref main
gh run list --repo rockru4211-lang/pantryflow --workflow deploy-pages.yml --limit 1
gh api --method DELETE repos/rockru4211-lang/pantryflow/environments/github-pages/deployment-branch-policies/57994108
```

刪除的是暫時 deployment policy，不是 Git branch、PR、Pages deployment history 或產品資料。
