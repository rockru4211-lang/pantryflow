# 調撥更新：驗證修復紀錄

本次只修復百花猿調撥的發布前驗證，不新增食譜功能，也不更動正式業務資料或 PIN。

## 已查明

原 Public demo frontend verification #48 的 source、typecheck、lint、build 通過，Node 全套測試為 147 項／138 通過／9 失敗。PWA 測試仍要求序與旧預覽網址，與百花猿現有 manifest 不符；本次改為嚴格驗證百花猿既有名稱和 beape-ops 網址，其餘安裝及發信檢查不刪除。

Merchant beta verification #248 能從零套用全部 migration，但既有資料庫回歸失敗。原本 tests/sql/transfer-directions.sql 不在 supabase test db 自動探索範圍；新增獨立 CI 在一次性本機 Supabase 執行這個完整回滾測試。原有兩套完整驗證維持，不把新檢查當作全套通過。

## 正式發布仍有前置條件

正式資料庫尚未提供明確調撥來源及 transfer_catalogs。先前正式套用曾遭工具安全檢查阻擋；不可透過 SQL 執行工具、額外工作流程或其他方式繞過。此提交僅更新修正分支的測試，不執行正式遷移、不合併 beape、不部署。待取得授權更新成功及實際驗證結果，才另行記錄發布完成。
