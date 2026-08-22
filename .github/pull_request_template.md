## 對應決策（必填）

- 決策 ID：
- 決策登錄／原始來源連結：
- 目前狀態（已定案／開發中）：

## 變更與第一線減量

- 本 PR 做了什麼：
- 減少第一線哪一步工作：
- 明確不包含：

## 手機版驗證截圖（必填）

> 附實機或等效手機 viewport；至少包含主要、空白、錯誤與完成狀態中受影響者。若不涉及 UI，填「不適用」並說明原因。

- 裝置／viewport：
- 截圖或 artifact 連結：
- 對應 UI 定案圖與差異：

## 資料流測試（必填）

- 測試指令／案例：
- 輸入 → 處理 → 儲存／輸出：
- 權限／RLS：
- 不可覆蓋資料驗證：
- 結果：

## Production 部署版本（必填）

- Frontend target commit：
- GitHub Pages run：`未部署`／連結與 run number
- Supabase migration：`無`／名稱與套用狀態
- Edge Function：`無變更`／function name + version
- Production smoke／驗收：`未執行`／證據

## Checklist

- [ ] 對應決策已存在於 `docs/DECISION_REGISTRY.md`，且不是「討論中」或 `BLOCKED`
- [ ] 已更新 `docs/UI_V2_ACCEPTANCE.md`（若影響 UI）
- [ ] 已更新 `docs/RELEASE_STATUS.md`
- [ ] 已附手機版驗證截圖或合理的不適用說明
- [ ] 已執行並記錄資料流、權限與不可覆蓋測試
- [ ] 未把已合併、已部署、已驗收混為同一狀態
- [ ] 未提交 secret、真實貨單或使用者資料
