# PantryFlow 文件封存區

`docs/archive/` 保留曾經有效、但已被後續產品或技術決策取代的說明。封存不是刪除；歷史內容須保持可追溯。

## 規則

- 每份封存文件頂端必須標示封存日期、原因，以及「不可作為正式開發依據」。
- 不得封存仍被程式、migration、Edge Function、GitHub Pages 或現行 Supabase／OCR 流程實際使用的檔案。
- 新開發依序閱讀 `../CURRENT_PRODUCT_STATE.md`、`../DECISION_LOG.md` 與最新 `../DECISIONS_*.md`；封存文件不在正式必讀清單。
- 如需引用封存內容，必須同時指出後續取代決策。

## 封存清單

| 文件 | 封存日期 | 原位置 | 原因 | 現行替代依據 |
|---|---|---|---|---|
| `V1_SCOPE.md` | 2026-08-22 | `docs/` 根目錄（封存前） | Alpha 範圍混有「收貨可先使用 mock/local state」等已被 2026-08-21 正式 Pilot 決策取代的說明。完整保留供歷史追溯。 | `../CURRENT_PRODUCT_STATE.md`、`../DECISION_LOG.md`、`../DECISIONS_2026-08-21.md` |
