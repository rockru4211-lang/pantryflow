import{emptyState,escapeHtml}from'../components/layout.js';

export function catalogPage({products=[]}){
  return `<h2 class="page-title">商品建檔</h2><p class="muted">資料直接寫入正式 Supabase catalog；期初數量建立後不可覆蓋。</p>
  <section class="card settings-card"><h3>手動建立商品</h3><form id="create-product" class="form-grid two">
    <label class="field">商品名稱<input name="name" required maxlength="80"></label>
    <label class="field">商品編碼<input name="productCode" required maxlength="40"></label>
    <label class="field">盤點單位<input name="countUnit" required placeholder="例如：公斤"></label>
    <label class="field">進貨單位<input name="purchaseUnit" required placeholder="例如：箱"></label>
    <label class="field">正式期初數量<input name="openingQuantity" type="number" min="0" step="0.001" required></label>
    <div><button class="primary" type="submit">建立正式商品</button></div><p class="error" data-error></p>
  </form></section>
  <section class="section"><div class="section-head"><h2>Excel 固定範本</h2></div><article class="card settings-card"><p class="muted">下載 PantryFlow 固定欄位範本；上傳後先預覽與檢查，不會直接寫入。</p><div class="button-row"><button class="secondary" type="button" data-download-catalog-template>下載 CSV 相容範本</button><label class="secondary file-button">選擇 Excel／CSV<input data-catalog-file type="file" accept=".xlsx,.xls,.csv" hidden></label></div><div data-import-preview class="import-preview"></div></article></section>
  <section class="section"><div class="section-head"><h2>正式商品</h2><span>${products.length} 項</span></div>${products.length?`<div class="list">${products.map(p=>`<article class="card setup-row"><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.product_code)} · ${escapeHtml(p.count_unit)}／進貨 ${escapeHtml(p.base_unit)}</small></div><span class="status">已啟用</span></article>`).join('')}</div>`:emptyState('尚無商品','請先手動建立一項商品，或使用固定範本匯入。')}</section>`;
}
export function zonesPage({zones=[],products=[],assignments=[]}){
  return `<h2 class="page-title">區域與商品</h2><p class="muted">先建立現場盤點區域，再把正式商品加入區域。</p>
  <section class="card settings-card"><h3>建立區域</h3><form id="create-zone" class="form-grid"><label class="field">區域名稱<input name="name" required maxlength="60" placeholder="例如：冷藏庫"></label><button class="primary" type="submit">建立區域</button><p class="error" data-error></p></form></section>
  <section class="section"><div class="section-head"><h2>區域設定</h2><span>${zones.length} 區</span></div>${zones.length?`<div class="list">${zones.map(z=>{const ids=assignments.filter(a=>a.zone_id===z.id).map(a=>a.product_id);return `<article class="card settings-card"><h3>${escapeHtml(z.name)}</h3><p class="muted">${ids.length?products.filter(p=>ids.includes(p.id)).map(p=>escapeHtml(p.name)).join('、'):'尚未加入商品'}</p>${products.length?`<form data-assign-product="${z.id}" class="inline-form"><select name="productId" required><option value="">選擇商品</option>${products.filter(p=>!ids.includes(p.id)).map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select><button class="secondary">加入區域</button><p class="error" data-error></p></form>`:'<p class="error">請先建立商品。</p>'}</article>`}).join('')}</div>`:emptyState('尚無盤點區域','建立第一個區域後，再將商品加入。')}</section>`;
}
