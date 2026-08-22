# Operations UI v2 共用元件清單

| 元件 | 共用規則 | 第一個垂直切片 |
| --- | --- | --- |
| Task list / card | 同一 Task model、status tag、角色 selector | STAFF 今日盤點；SUPERVISOR 差異 |
| Zone selector | 真實 `sort_order`、進度、完成鎖定 | 選區域 |
| Blind count entry | 不顯示帳面量／差異；0 與未盤不同 | 自動保存 |
| Exception card | 同一 severity/status/reason/history | 盤點差異、OCR review |
| Receipt review card | Task card 的 receipt variant | 後勤待核對入口 |
| Reason selector | 一致原因碼＋備註，處理紀錄追加 | 差異回覆 |
| Fixed primary action | 依 transition guard 啟用 | 完成區域／全部完成 |
| Empty/error/offline | 不補假資料；明示下一步與同步狀態 | 所有頁面 |

後續頁面需在 PR 說明列出使用的 domain selector 與本表元件，不得另建頁面私有狀態規則。
