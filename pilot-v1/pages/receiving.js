import{emptyState,escapeHtml}from'../components/layout.js';

const fieldLabels={subtotal_ex_tax:'未稅小計',tax:'稅額',total_inc_tax:'含稅總額',supplier_name:'供應商',invoice_number:'貨單號碼'};
const statusLabels={PROCESSING:'識別中',REVIEWING:'待後勤核對',PUBLISHED:'已發布',FAILED:'識別失敗'};

function businessMode(businessType){return businessType==='CHAIN_RESTAURANT'?'chain':'small'}
function roleKind(role){if(role==='LOGISTICS')return'logistics';if(role==='OWNER')return'owner';if(role==='ADMIN'||role==='SUPERVISOR')return'manager';return'staff'}
function roleIntro(label,copy){return `<div class="count-role-intro receiving-role-intro"><span>${escapeHtml(label)}</span><small>${escapeHtml(copy)}</small></div>`}
function statusLabel(value){return statusLabels[value]||value||'等待處理'}
function statusCount(batches,status){return batches.filter(item=>item.status===status).length}
function receiptRows(batches,{emptyTitle='尚無進貨紀錄',emptyCopy='拍攝或上傳貨單後，處理狀態會顯示在這裡。'}={}){
  if(!batches.length)return emptyState(emptyTitle,emptyCopy);
  return `<div class="list receiving-batch-list">${batches.map(batch=>`<button class="card receipt-row" data-open-receipt="${escapeHtml(batch.id)}" type="button"><span><strong>${escapeHtml(batch.batch_number)}</strong><small>${escapeHtml(batch.work_date||'')}・${batch.receipt_documents?.length||0} 張原圖</small></span><span class="status receipt-status status-${escapeHtml(String(batch.status||'').toLowerCase())}">${escapeHtml(statusLabel(batch.status))}</span></button>`).join('')}</div>`;
}
function receivingStats(batches){return `<div class="count-stat-grid receiving-stats"><div><strong>${batches.length}</strong><small>今日到貨</small></div><div><strong>${statusCount(batches,'REVIEWING')}</strong><small>待核對</small></div><div><strong>${statusCount(batches,'FAILED')}</strong><small>異常待確認</small></div></div>`}
function captureCard({businessType}){
  const chain=businessMode(businessType)==='chain';
  return `<section class="card receiving-capture-card"><div class="receiving-card-heading"><span>▤</span><div><h2>拍攝到貨單</h2><p>${chain?'ERP 為公司正式帳；App 保存現場證據並協助點貨。':'辨識後由後勤核對，發布後才納入正式進貨統計。'}</p></div></div><form id="receipt-upload"><fieldset class="receipt-group-mode"><legend>這批照片屬於</legend><label><input type="radio" name="documentMode" value="SAME_RECEIPT" checked><span><strong>同一張貨單</strong><small>多頁或多角度</small></span></label><label><input type="radio" name="documentMode" value="SEPARATE_RECEIPTS"><span><strong>不同貨單</strong><small>每張各自辨識</small></span></label></fieldset><label class="secondary file-button receiving-file-button">拍攝／選擇多張照片<input name="files" data-receipt-files type="file" accept="image/*,application/pdf" multiple required hidden></label><p class="receiving-upload-limit">最多 10 張，可連續拍攝或從相簿多選。</p><div class="receipt-photo-preview" data-receipt-photo-preview></div><div class="duplicate-warning" data-receipt-duplicate-warning hidden></div><button class="primary" type="submit">上傳並開始辨識</button><p class="error" data-error></p></form></section>`;
}
function modeNotice({businessType,role}){
  const chain=businessMode(businessType)==='chain';
  if(chain)return `<section class="receiving-mode-notice"><strong>連鎖餐飲模式</strong><p>ERP 統整公司貨單；PantryFlow 用於現場點貨、理貨、少送／多送回報與門市驗收提醒。提醒時間由主管在設定管理。</p>${role==='ADMIN'||role==='SUPERVISOR'?'<button class="text-button" data-feature="profile" type="button">前往驗收提醒設定</button>':''}</section>`;
  return `<section class="receiving-mode-notice"><strong>中小餐廳模式</strong><p>進貨數據是營運分析主資料；可查看供應商、品項、分類、最新／平均單價與異常，但不作為報稅或會計帳。</p></section>`;
}
function capturePage({batches,detail,businessType,role}){
  const manager=role==='ADMIN'||role==='SUPERVISOR';
  return `${roleIntro(manager?'店長／主管':'員工',manager?'現場驗收、異常確認與提醒':'拍貨單、點貨與即時回報')}<div class="count-heading"><div><h1 class="page-title">今日到貨驗收</h1><p>識別速度與精確度優先，原圖永遠保留</p></div><span class="count-icon">▤</span></div>${receivingStats(batches)}${modeNotice({businessType,role})}${detail?receiptDetail(detail):captureCard({businessType})}<section class="section"><div class="section-head"><h2>今日進度</h2><span>識別中 → 核對 → 發布</span></div>${receiptRows(batches)}</section>`;
}
function reviewField(field,corrections,batchId){
  const corrected=corrections.find(item=>item.ocr_field_id===field.id),shown=corrected?.new_value??field.normalized_value??field.raw_value??'',oldValue=field.normalized_value??field.raw_value??null;
  return `<form data-correct-receipt-field="${escapeHtml(field.id)}" data-batch="${escapeHtml(batchId)}" class="review-field"><label class="field">${escapeHtml(fieldLabels[field.field_name]||field.field_name)}<input name="value" value="${escapeHtml(typeof shown==='object'?JSON.stringify(shown):shown)}"><input name="oldValue" type="hidden" value="${escapeHtml(JSON.stringify(oldValue))}"></label><small>AI 原值：${escapeHtml(JSON.stringify(field.raw_value??null))}・${escapeHtml(field.review_status||'待判定')}</small><button class="secondary">保存人工修正</button><p class="error" data-error></p></form>`;
}
function receiptDetail({batch,documents=[],runs=[],fields=[],corrections=[]},{canCorrect=false}={}){
  const latest=runs[0],latestFields=latest?fields.filter(field=>field.ocr_run_id===latest.id):[],priority=['supplier_name','invoice_number','subtotal_ex_tax','tax','total_inc_tax'],reviewFields=priority.map(name=>latestFields.find(field=>field.field_name===name)).filter(Boolean);
  return `<section class="section receipt-detail"><div class="section-head"><h2>${canCorrect?'後勤核對':'進貨憑證'}｜${escapeHtml(batch.batch_number)}</h2><span>${escapeHtml(statusLabel(batch.status||latest?.status))}</span></div><div class="receipt-evidence-note"><strong>完整證據鏈</strong><p>保留原始照片、AI 原值、人工修正、操作人與時間；原始辨識結果不可覆蓋。</p></div><div class="receipt-review-grid"><div class="card receipt-images">${documents.map(document=>document.signedUrl&&document.mime_type.startsWith('image/')?`<figure><img src="${escapeHtml(document.signedUrl)}" alt="${escapeHtml(document.original_filename)}"><figcaption>原始第 ${document.page_order} 頁｜${escapeHtml(document.original_filename)}</figcaption></figure>`:`<a class="secondary" href="${escapeHtml(document.signedUrl||'#')}" target="_blank" rel="noreferrer">開啟原始檔 ${document.page_order}</a>`).join('')}</div><div class="card settings-card receipt-fields"><h3>辨識結果 ${latest?`v${latest.version}`:'尚未建立'}</h3>${latest?`<p class="muted">${escapeHtml(latest.provider)}／${escapeHtml(latest.model)}・${escapeHtml(statusLabel(latest.status))}</p>`:''}${reviewFields.length?reviewFields.map(field=>canCorrect?reviewField(field,corrections,batch.id):`<div class="receipt-readonly-field"><span>${escapeHtml(fieldLabels[field.field_name]||field.field_name)}</span><strong>${escapeHtml(field.normalized_value??field.raw_value??'—')}</strong></div>`).join(''):`<div class="helper">${latest?.status==='FAILED'?'辨識失敗，原圖與失敗紀錄已保留。':'正在背景辨識，可稍後重新整理。'}</div>`}<p class="receipt-tax-note">未稅小計、稅額、含稅總額分開保存；用途為營運分析，不取代會計或報稅。</p>${canCorrect&&batch.status==='REVIEWING'?`<button class="primary" data-publish-receipt="${escapeHtml(batch.id)}" type="button">核對完成並發布</button><p class="error" data-publish-error></p>`:''}</div></div></section>`;
}
function logisticsPage({batches,detail,businessType}){
  const pending=batches.filter(batch=>batch.status!=='PUBLISHED');
  return `${roleIntro('後勤','整理、修正與發布正式進貨資料')}<div class="count-heading"><div><h1 class="page-title">進貨資料核對</h1><p>只有已發布資料會進入正式統計</p></div><span class="count-icon count-icon-blue">▥</span></div><div class="count-stat-grid receiving-stats"><div><strong>${statusCount(batches,'PROCESSING')}</strong><small>識別中</small></div><div><strong>${statusCount(batches,'REVIEWING')}</strong><small>待核對</small></div><div><strong>${statusCount(batches,'PUBLISHED')}</strong><small>已發布</small></div></div>${modeNotice({businessType,role:'LOGISTICS'})}${detail?receiptDetail(detail,{canCorrect:true}):`<section class="section"><div class="section-head"><h2>待核對資料</h2><span>${pending.length} 批</span></div>${receiptRows(pending,{emptyTitle:'目前沒有待核對資料',emptyCopy:'現場上傳並完成辨識後會出現在這裡。'})}</section>`}<section class="receiving-policy-note"><strong>單位規則</strong><p>保留貨單原始單位；只有商品或供應商已有明確換算規則時，才產生標準化數量。</p></section>`;
}
function ownerPage({batches,businessType}){
  const published=batches.filter(batch=>batch.status==='PUBLISHED');
  return `${roleIntro('Owner／營運主管','看發布後的總結、重大異常與稽查')}<div class="count-heading"><div><h1 class="page-title">進貨管理摘要</h1><p>不進入後勤逐張修整工作台</p></div><span class="count-icon">▥</span></div><div class="count-stat-grid receiving-stats"><div><strong>${published.length}</strong><small>已發布批次</small></div><div><strong>${statusCount(batches,'FAILED')}</strong><small>重大異常</small></div><div><strong>${batches.length-published.length}</strong><small>尚未發布</small></div></div>${modeNotice({businessType,role:'OWNER'})}<section class="section"><div class="section-head"><h2>主管查看範圍</h2><span>已發布資料</span></div><div class="card count-work-list"><button type="button"><span class="count-row-icon purple">▥</span><span><strong>供應商與品項趨勢</strong><small>最新／平均單價、分類與進貨總額</small></span><b>›</b></button><button type="button"><span class="count-row-icon purple">!</span><span><strong>少送／多送與重大異常</strong><small>門市確認結果與後勤整理結論</small></span><b>›</b></button><button type="button"><span class="count-row-icon purple">✓</span><span><strong>驗收稽查</strong><small>原圖、修正紀錄、發布人與時間</small></span><b>›</b></button></div></section>`;
}
export function receivingPage({batches=[],detail=null},{role='STAFF',businessType='SINGLE_RESTAURANT'}={}){
  const kind=roleKind(role);
  if(kind==='logistics')return logisticsPage({batches,detail,businessType});
  if(kind==='owner')return ownerPage({batches,businessType});
  return capturePage({batches,detail,businessType,role});
}
