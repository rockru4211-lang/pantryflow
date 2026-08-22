# PantryFlow 定案總稽核｜2026-08-22

稽核狀態：完成文件與程式靜態對照；目前測試版 **不得宣稱可現場使用**。  
稽核基準：GitHub Pages 暫時部署 commit `224a119`、PR #7 分支 `feat/receipt-review-ui-integration`。  
範圍：`AGENTS.md`、`CURRENT_PRODUCT_STATE.md`、`DECISION_LOG.md`、兩份日期決策、`PRODUCT_VISION.md`、`docs/archive/`，以及登入、盤點、catalog、效期、進貨／OCR、每日收貨工作台、桌機版、權限與資料來源的實際程式。

> 稽核期間發現的 P0 FK 修復工作尚未提交或部署前端，因此不算目前測試版功能。正式 Supabase 已存在同名待提交 migration 的 schema 變更，但 Pages `224a119` 仍使用錯誤的舊 relationship hint；兩者不得混稱已修復。

> 後續決策註記（2026-08-23）：本文件保留 2026-08-22 當日稽核快照。下週封閉 Pilot 的最新範圍改以 `CLOSED_PILOT_SCOPE_2026-08-23.md` 為準；Excel 商品匯入、限定區域／商品拖移、寄庫與基本彙整／匯出均已升為 P0 Gate。

## 判定原則

- **符合**：定案流程與正式 Supabase 程式均存在，且沒有已知阻擋衝突。
- **部分符合**：只有一部分資料層／畫面完成、仍混用 local 狀態，或尚無真實驗收。
- **不符合**：目前程式與定案方向相反，或正式測試版存在阻擋錯誤。
- **未實作**：沒有正式 schema、權限與可操作流程；畫面文字、mock、placeholder 不算實作。

## 定案需求與現況對照

| 已定案需求 | 來源與日期 | 目前程式狀態 | 發現的衝突或舊規格 | 優先順序 | 不得再引用的舊決策或舊畫面 |
|---|---|---|---|---|---|
| 登入分成「管理／後勤登入」、「店長登入」及「員工快速登入」三條入口。 | 使用者定案，2026-08-22 | **不符合** | `index.html` 只有單一 Email／密碼登入與「建立帳號」分頁，沒有依工作角色分流。 | **P0** | 不得以目前單一卡片 Email 登入畫面作為定案稿。 |
| 員工依「門市 → 姓名／員編 → PIN」快速登入；每人仍是可追溯的獨立身分，不是共用帳號。 | 使用者定案，2026-08-22；`PRODUCT_VISION` §8 的個人追溯原則 | **未實作** | 無 `stores`、employee number、PIN credential／hash、失敗鎖定或門市成員選擇 schema；目前只有 Supabase Email Auth。 | **P0** | `DECISION_LOG` 2026-08-21「所有使用者自行 Email 註冊」對員工入口已被取代；`PILOT_SETUP` 的全員 Email/Password 建帳流程不得再當員工正式登入規格。 |
| 管理／後勤與店長登入不可被員工自助註冊流程混在一起；角色由正式成員／門市權限決定。 | 使用者定案，2026-08-22；`AGENTS` 帳號與權限；`PRODUCT_VISION` §8 | **不符合** | 任何新使用者可公開自助註冊並自行建立 Organization 成為 ADMIN；沒有後勤與店長的獨立受控建帳／加入組織流程。 | **P0** | `DECISIONS_2026-08-21` §2 與 `DECISION_LOG` 的「自行註冊＋自行建立商家」不得再無條件套用到所有角色。 |
| 角色屬於門市，至少能區分 ADMIN／後勤、店長／主管、STAFF；同一人不可用共享帳號。 | `AGENTS` 帳號與權限；`PRODUCT_VISION` §8；使用者定案，2026-08-22 | **不符合** | `organization_members` 的角色是 Organization 層級；沒有正式 `stores` membership。`profiles.store` 只是文字，不能表達一人多店或每店不同角色。 | **P0** | 不得把 `profiles.store` 字串或共用門市帳號視為正式門市權限模型。 |
| 正式資料只來自 Supabase Auth、Database、私有 Storage；mock／localStorage 不得成為正式結果。 | `CURRENT_PRODUCT_STATE`，2026-08-22；`DECISION_LOG` 2026-08-21；使用者 Pilot 限制 | **部分符合** | 盤點 catalog、receipt、OCR 已接 Supabase；但首頁缺貨／效期／異常、庫存推估、效期巡檢及部分盤點差異基準仍由 `app.js` 預設資料與 localStorage 驅動。 | **P0** | 封存 `V1_SCOPE` 的 mock/local 正式流程、任何 Demo 截圖與預設商品數字不得作驗收依據。 |
| Cloud mode 不得混入 Demo 資料；未上線功能必須明確標示下一輪。 | `DECISIONS_2026-08-21` §1；`PRODUCT_VISION` §13 | **不符合** | Cloud 登入後仍呼叫共用 `saveAndRender()`，首頁、inventory、issues、expiry 等區塊可顯示本機 seed；部分效期畫面可操作，容易被誤認正式功能。 | **P0** | 不得以「fallback 只在未設定 Supabase」概括整個 app；實際 Cloud UI 仍引用本機狀態。 |
| 手機盤點只使用正式 `count_zones → zone_products → products`，依現場區域操作。 | `DECISIONS_2026-08-21` §4；`CURRENT_PRODUCT_STATE` | **部分符合** | 登入後會載入正式 catalog 並映射區域；但整體啟動目前被 count actor PostgREST join 錯誤阻擋，且 UI 仍重用 local data 結構。 | **P0** | 不得以預設 `COUNT_AREAS`／seed 商品畫面證明正式 catalog 已可用。 |
| 盲盤時不顯示帳面或推估數字；只輸入數量、單位唯讀、自動保存。 | `DECISIONS_2026-08-20` §4；`PRODUCT_VISION` §6 | **部分符合** | 盤點輸入卡不顯示帳面值，單位唯讀並有 autosave；但尚未完成真實 STAFF 手機驗收，且載入 P0 阻擋。 | **P0** | 不得以 Prototype 盤點或單機 localStorage 自動保存當跨裝置證據。 |
| 0、空白與小數語意分離；空白不能當 0。 | `DECISION_LOG` 2026-08-22；`CONTROLLED_PILOT_2026-08-23` | **部分符合** | 前端與已套用 migration 有 `COUNTED/BLANK`；但尚未以 STAFF 正式帳號驗證自動保存、送出、重載與 ADMIN 讀取。 | **P0** | 不得以 repository 靜態測試宣稱現場通過。 |
| 第一次實盤不可覆蓋；複盤／更正追加事件並保存操作者、時間。 | `DECISIONS_2026-08-20` §4、§11；`CURRENT_PRODUCT_STATE` | **部分符合** | schema 與 append correction 路徑存在；目前 `count_entries → profiles` 的 deployed frontend join 使用錯誤 FK，造成登入／讀報表阻擋。 | **P0** | 不得把「資料列有 entered_by」等同 PostgREST 可正確讀出操作者。 |
| 同商品可在多區域盤點，後勤加總，但保留各區域原始 observation。 | `PRODUCT_VISION` §6；`DECISION_LOG` 2026-08-22 | **部分符合** | zone mapping 與 client-side aggregate 存在；加總／差異仍依 `data.countBaselines` 與 local fallback 計算，沒有正式帳面／前次確認資料來源的收斂。 | **P0** | 不得引用 local `COUNT_BASELINES`、預設 `qty/safe` 或畫面加總作正式結果。 |
| 送出後才顯示差異、原因、操作者與時間。 | `DECISIONS_2026-08-20` §4；使用者受控 Pilot 定案，2026-08-22 | **部分符合** | UI 流程在完成區域後進差異；但差異基準可能是 local 推估，ADMIN 操作者 join 目前會報 relationship error。 | **P0** | 不得以目前「盤點完成」摘要畫面作正式驗收稿。 |
| ADMIN／主管差異管理預設只看差異與未回覆原因；相符只在摘要與 Excel。 | `CURRENT_PRODUCT_STATE`；受控 Pilot 2026-08-22 | **部分符合** | 桌機頁結構、摘要、例外清單與 Excel 入口存在；目前正式查詢因錯誤 FK hint 無法載入，且只允許 ADMIN、未釐清店長／主管權限。 | **P0** | 不得引用已部署但載入失敗的頁面宣稱完成。 |
| ADMIN 可新增商品；Excel 匯入需明確 mapping、必填檢查、重複提示並寫正式 catalog。 | 使用者受控 Pilot 定案，2026-08-22 | **部分符合** | UI、RPC 與 migration 已存在；尚無真實 ADMIN Excel 匯入驗收，且登入 P0 阻擋整體使用。 | **P1** | 不得用表單存在或靜態測試替代實際 Supabase 寫入／重載驗證。 |
| ADMIN 可新增、改名、排序區域；商品可批量加入多區域（2026-08-23 增列限定拖移）。 | 使用者受控 Pilot 定案，2026-08-22；後續修正 2026-08-23 | **歷史狀態：部分符合** | 當日只有 CRUD 與數字排序；最新 P0-C 已要求儲物區排序及商品跨區加入／移動／移除／排序。 | **P0-C** | 「本輪不要求拖移」已被取代；不得用 local 區域資料驗收。 |
| 效期巡檢沿用盤點區域，只顯示風險／例外；正常資訊收起。 | `DECISIONS_2026-08-20` §5；`PRODUCT_VISION` §6 | **不符合** | 現有效期巡檢、風險重點、異常與處理畫面大多使用 localStorage／seed，未接正式 Supabase lot/event 查詢。 | **P1** | 封存 `V1_SCOPE` 的完整效期畫面不可當現行實作依據；現有 local 效期畫面不得標示正式。 |
| 原廠效期、解凍未開封、已開封與來源以不可覆蓋 lot/event 保存。 | `DECISION_LOG` 2026-08-22；`CONTROLLED_PILOT_2026-08-23` | **部分符合** | 正式 lot/event schema、收貨 trigger 與 ADMIN 追加事件入口存在；手機盤點尚未依區域＋批次／保存狀態輸入或保存數量，效期巡檢也未接此資料。 | **P1** | 不得以 local `expiryEvents` 或商品單一 `expiryDate` 作正式批次模型。 |
| 第一線多張貨單上傳成功並排程後立即離開，不等待 OCR。 | `DECISIONS_2026-08-20` §6；`DECISION_LOG` 2026-08-22 | **部分符合** | 正式 private Storage、batch routing、enqueue 與背景 worker 已實作；尚未有真實 STAFF 多張貨單跨裝置證據。 | **P0** | 不得引用舊 mock OCR 成功提示；封存 `V1_SCOPE` 的 mock/local 收貨敘述已失效。 |
| 每次 OCR run、原圖、AI 原值、人工修正與正式收貨分開、不可覆蓋；失敗可有限重試。 | `DECISIONS_2026-08-20` §7、§11；`DECISION_LOG` 2026-08-21/22 | **部分符合** | schema、私有 Storage、Gemini Edge Functions、queue／lease／retry 存在；尚未跑真實模糊貨單、重試與 correction 驗收。 | **P0** | OpenAI Vision provider 決策與 mock OCR 畫面均已被 Gemini 真實流程取代。 |
| 後勤以 Organization＋門市＋實際收貨日進入每日工作台；可依供應商／貨單分組。 | `DECISION_LOG` 2026-08-22；`RECEIPT_DAILY_WORKBENCH_DESIGN` | **部分符合** | 正式欄位、篩選、摘要、分組與右側 detail 已實作；沒有獨立 Store entity，`store_name` 是 snapshot 文字；登入與角色模型未定案落地。 | **P0** | 「逐批工作卡是主要入口」已被取代；舊 Demo 卡片不可再作正式 IA。 |
| 工作台預設只顯示辨識中、待核對、有疑問／異常；完成資料由「查看全部」追溯。 | `CURRENT_PRODUCT_STATE`；每日工作台定案，2026-08-22 | **符合** | 程式依 actionable 狀態預設過濾並提供查看全部；仍需真實資料驗收，但靜態邏輯與定案一致。 | **P1** | 不得恢復所有完成卡預設展開的舊畫面。 |
| 右側詳情顯示原圖、每次 OCR run、AI 原值、人工修正、商品編碼與正式收貨。 | 使用者每日工作台定案，2026-08-22 | **部分符合** | 正式 bundle 查詢與操作 UI 存在；尚無真實 ADMIN 端到端驗收。 | **P0** | 不得使用 hard-coded Demo OCR 列或本機修正作驗收。 |
| 正式收貨以原 batch／供應商為交易邊界，不混不同供應商、稅額或原圖。 | `DECISION_LOG` 2026-08-22 | **符合** | `goods_receipts.source_batch_id` 唯一，finalize RPC 以單一 batch 完成；呈現分組不改交易邊界。 | **P1** | 不得把每日工作台群組直接合併成一筆正式收貨。 |
| 未稅小計、稅額、含稅總額分離；完成後提醒待 ERP 驗收，PantryFlow 不取代 ERP。 | `DECISIONS_2026-08-20` §9、§12；`DECISION_LOG` 2026-08-22 | **部分符合** | schema、核對欄位、Excel 與 ERP 提示存在；尚未以真實貨單驗算三個金額與匯出。 | **P0** | 不得顯示「已完成 ERP」或要求 STAFF 判斷稅務。 |
| 900px 以上為左側主管工作列＋右側內容；手機保留底部快速操作；兩者是同一前端。 | 使用者定案，2026-08-22；`CURRENT_PRODUCT_STATE` | **部分符合** | CSS 在 900px 顯示左側 nav、隱藏 bottom nav；同一 build。左側標為管理導覽但只對 ADMIN 開放核心管理頁，店長／主管工作列權限尚未落地。 | **P0** | 不得另建第二個 Demo 前端；不得把 ADMIN-only nav 當成已完成的店長工作列。 |
| 主管先看異常；正常資料摘要化／收起，例外明細優先並附處理動作。 | `AGENTS` 核心原則與 UI；`PRODUCT_VISION` §10；使用者定案，2026-08-22 | **部分符合** | 差異與收貨頁採摘要＋actionable default；首頁的摘要數字及異常仍可能來自 local seed，部分庫存／效期正常資料畫面過度展開。 | **P0** | 不得引用 Demo 首頁假摘要、固定商品或固定異常作正式主管畫面。 |
| 手機端只保留現場快速盤點與快速貨單上傳，避免後勤核對負擔。 | `DECISIONS_2026-08-20` §4、§6；`CURRENT_PRODUCT_STATE` | **部分符合** | 行動版具快速盤點與上傳；同一 app 仍暴露多個 local／未正式功能入口，且員工快速登入未實作。 | **P0** | 不得用完整管理選單或 Email 自助註冊增加第一線步驟。 |
| 權限與 RLS 依 Organization／角色隔離；STAFF 不可進 ADMIN 核對與設定。 | `DECISIONS_2026-08-21` §5；`RELEASE_CHECKLIST` | **部分符合** | 多數正式表有 RLS，前端也擋 ADMIN 頁；角色只到 Organization、SUPERVISOR 幾乎未承接店長管理需求，且尚未用 STAFF 帳號實測。 | **P0** | 不得以隱藏按鈕代替 RLS 驗收；不得把 SUPERVISOR 名稱存在視為權限已完成。 |
| 後端失敗顯示清楚中文並提供重試，不直接暴露英文 DB／PostgREST 錯誤。 | P0 Bug 定案，2026-08-22 | **不符合** | Pages `224a119` 在初始化 catch 直接顯示 `error.message`；已實際出現 schema relationship 英文錯誤。 | **P0** | 不得只隱藏錯誤文字，也不得以未部署工作樹修正宣稱完成。 |
| 只有真實跨裝置證據可標示 Pilot 通過；未執行或失敗必須標未通過。 | `DECISION_LOG` 2026-08-22；`PILOT_ACCEPTANCE_2026-08-23` | **不符合（驗收狀態）** | Pages 已部署，但登入 P0 阻擋；ADMIN／STAFF、真實盤點、真實貨單、OCR、正式收貨與 Excel 七項尚未完整通過。 | **P0** | 不得以 7/7 repository 靜態測試、部署成功或畫面截圖宣稱可現場使用。 |
| 寄庫原排程只保留正式「下一輪」設計，不建立假功能（2026-08-23 已取代）。 | `DECISION_LOG` 2026-08-22；`CONTROLLED_PILOT_2026-08-23` | **歷史稽核結果；已取代** | 2026-08-23 已將正式寄庫升為封閉 Pilot P0-F；仍禁止假成功流程。 | **P0-F** | 不得再引用「寄庫下一輪」排程；以 `CLOSED_PILOT_SCOPE_2026-08-23.md` 為準。 |

## 文件本身的衝突

| 衝突 | 稽核判定 | 後續文件修正方向（本稽核不實作） |
|---|---|---|
| `DECISION_LOG` 與 `DECISIONS_2026-08-21` 仍把所有新使用者自助 Email 註冊列為有效。 | 已被 2026-08-22 最新登入定案部分取代。 | 新增最新登入決策並把舊決策標成「已取代／只保留管理建帳歷史背景」，不可刪除舊列。 |
| `AGENTS.md` 前段把叫貨、效期、廢棄、跨店借貸等列為 V1 核心／必要，後段又把正式 Pilot 收斂為盤點與進貨兩條。 | 產品願景與本輪 Pilot 範圍混在同一規則文件。 | 保留長期願景，但明確標示「不代表目前 Pilot 已實作」；CURRENT_PRODUCT_STATE 的兩條正式流程優先。 |
| `PRODUCT_VISION` 描述長期完整營運秘書；CURRENT_PRODUCT_STATE 只允許兩條正式流程。 | 不是真正互斥，但畫面若保留可操作入口會造成上線誤認。 | 長期功能只能標下一輪／未上線，不得讀寫 local seed 後呈現像正式成功。 |
| `CURRENT_PRODUCT_STATE` 曾寫「已完成驗收：語法、測試」但目前實際登入有 P0。 | 自動測試不是產品驗收，敘述容易誤導。 | 將「repository checks」與「真實驗收」永久分欄；P0 未解時頂部標不可現場使用。 |
| `PILOT_SETUP` 仍以建立三個 Email/Password 使用者為正式角色設定方式。 | 與最新員工 PIN 快速登入衝突。 | 只保留為舊部署歷史或管理／測試帳號程序；STAFF 正式入口不得照此文件。 |

## 不得再引用的舊依據

1. `docs/archive/V1_SCOPE.md` 全文只供歷史追溯；其中 mock/local 收貨、廣泛 Alpha Must Have 與舊畫面不能指揮目前 Pilot。
2. 2026-08-21「所有使用者自行 Email 註冊」已被最新角色分流登入取代；尤其不能再用來設計員工入口。
3. 目前 Email 自助註冊畫面、Demo 首頁摘要、固定商品／效期／異常、localStorage 盤點差異與 mock OCR 列均不得再當正式畫面或驗收證據。
4. 「逐批工作卡」不再是收貨主入口；正式入口是每日工作台，但原 batch／OCR run 仍須保存。
5. OpenAI Vision provider 舊決策已由 Gemini 取代。
6. repository 自動測試、GitHub Pages 部署成功、單機畫面可操作，都不能取代 ADMIN／STAFF 跨裝置實測。

## 稽核結論與停止線

- **P0 登入未定案落地**：正式門市／成員／PIN 模型與三種登入入口不存在；舊 Email 自助註冊仍在正式測試畫面。
- **P0 正式資料邊界未完全收斂**：Cloud mode 的首頁、庫存、效期與部分盤點差異仍可依賴 local／seed 資料。
- **P0 盤點讀取與差異可信度未通過**：已知 actor relationship 錯誤阻擋登入；差異基準也尚未收斂到正式資料來源。
- **P0 角色／門市權限未完成**：只有 Organization 層級 ADMIN／SUPERVISOR／STAFF，無「角色屬於門市」模型。
- **P0 真實驗收未完成**：七項跨裝置流程不得標示通過。

在上述 P0 經新一輪明確排序、實作、migration、部署與真實驗收前，PantryFlow 測試版狀態只能是：**內部整合中，不可現場使用**。
