# PantryFlow Release Checklist

每次準備 Pilot release 或部署 GitHub Pages 前逐項確認。任何未通過項目都必須在 PR 說明中標示，不可用 Demo／mock 畫面代替。

## 資料與安全

- [ ] 正式登入、Organization、catalog、盤點、receipt batches、OCR 與正式收貨均來自真實 Supabase。
- [ ] 正式貨單原圖只進私有 Storage，存取使用短效 signed URL。
- [ ] `localStorage`／mock 僅用於明確 Demo／暫存模式，未成為正式資料或驗收依據。
- [ ] 前端與 repository 無 Gemini/OpenAI secret、私鑰或其他 server-only credential。
- [ ] 前端無 `service_role` 暴露，只使用 Supabase publishable／anon key。
- [ ] RLS 以 Organization 隔離，STAFF、SUPERVISOR、ADMIN 權限符合決策。

## 同一產品與同一資料流

- [ ] 手機與 900px 以上桌機載入同一前端 build。
- [ ] 手機盤點與桌機盤點差異管理讀寫同一 Supabase 資料流。
- [ ] 手機貨單上傳與桌機收貨核對讀寫同一 receipt batch／OCR／正式收貨資料流。
- [ ] 未建立獨立 Demo 前端替代正式產品。
- [ ] 原圖、AI 原值、第一次實盤與歷史修正不可覆蓋。

## 文件治理

- [ ] `CURRENT_PRODUCT_STATE.md` 已反映本次功能、畫面與流程變更。
- [ ] `DECISION_LOG.md` 已新增或更新決策狀態與取代來源。
- [ ] 舊說明以 archive 保留，且標示封存日期、原因及不可作為正式依據。
- [ ] 日期決策原檔未刪除。
- [ ] PR 已列出資料來源、受影響流程、是否有 mock、驗收方式。

## GitHub Pages 驗收

- [ ] Pages workflow 使用本次預期 commit／branch 成功建置與部署。
- [ ] 手機 viewport 可登入、盤點、上傳多張貨單，且底部導覽與主要按鈕可操作。
- [ ] 900px 以上出現左側管理導覽與右側內容，不顯示手機底部導覽。
- [ ] 重新載入、直接 hash URL 與返回操作正常。
- [ ] 瀏覽器 console 無阻斷流程的錯誤。

## Supabase 端到端驗收

- [ ] 新帳號可完成 Email 驗證、Organization 建立與角色載入。
- [ ] 盤點第一次實盤、原因、複盤／更正與差異管理可跨裝置讀取且保留歷史。
- [ ] 多張貨單可分成獨立 batches；同一貨單多頁可明確合併；單張失敗不影響其他張。
- [ ] 原圖位於私有 Storage，Gemini OCR 由 JWT Edge Function 執行且建立版本化 run。
- [ ] 後勤可查看原圖、AI 原值、人工修正，並以單一正式交易完成收貨。
- [ ] 收貨及盤點 Excel 可重新產生，修改匯出檔不會回寫 Supabase。
- [ ] ADMIN 可重新整理進貨與盤點差異；非 ADMIN 無法進入受限管理頁。
