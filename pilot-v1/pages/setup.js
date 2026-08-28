import{backButton,emptyState,escapeHtml}from'../components/layout.js';

export function catalogPage({products=[]}){
  return `${backButton()}<h2 class="page-title">商品建檔</h2><p class="muted">資料直接寫入正式 Supabase catalog；期初數量建立後不可覆蓋。</p>
  <section class="card settings-card"><h3>手動建立商品</h3><form id="create-product" class="form-grid two">
    <label class="field">商品名稱<input name="name" required maxlength="80"></label>
    <label class="field">商品編碼<input name="productCode" required maxlength="40"></label>
    <label class="field">盤點單位<input name="countUnit" required placeholder="例如：公斤"></label>
    <label class="field">進貨單位<input name="purchaseUnit" required placeholder="例如：箱"></label>
    <label class="field">正式期初數量<input name="openingQuantity" type="number" min="0" step="0.001" required></label>
    <div><button class="primary" type="submit">建立正式商品</button></div><p class="error" data-error></p>
  </form></section>
  <section class="section"><div class="section-head"><h2>Excel／Google 試算表快速建檔</h2></div><article class="card settings-card count-import-card"><p class="muted">直接選擇既有 Excel（.xlsx）或 CSV；系統會自動找表頭，缺少商品編碼、單位或區域時也會先補齊並讓你預覽。</p><div class="button-row"><button class="secondary" type="button" data-download-catalog-template>下載簡易範本（選用）</button><label class="primary file-button">選擇 Excel／CSV<input data-count-import-file type="file" accept=".xlsx,.csv" hidden></label></div><div data-count-import-preview class="import-preview"><p class="count-import-empty">Google 試算表請先下載為 Excel（.xlsx）或 CSV。</p></div></article></section>
  <section class="section"><div class="section-head"><h2>正式商品</h2><span>${products.length} 項</span></div>${products.length?`<div class="list">${products.map(p=>`<article class="card setup-row" data-existing-product-code="${escapeHtml(p.product_code)}"><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.product_code)} · ${escapeHtml(p.count_unit)}／進貨 ${escapeHtml(p.base_unit)}</small></div><span class="status">已啟用</span></article>`).join('')}</div>`:emptyState('尚無商品','可直接匯入現有 Excel／CSV，或手動建立第一項商品。')}</section>`;
}
export function zonesPage({zones=[],products=[],assignments=[]}){
  return `${backButton()}<h2 class="page-title">盤點區域</h2><p class="muted">先建立現場區域，再進入區域加入、建立及排序品項。</p>
  <section class="card settings-card"><h3>建立區域</h3><form id="create-zone" class="form-grid"><label class="field">區域名稱<input name="name" required maxlength="60" placeholder="例如：冷藏庫"></label><button class="primary" type="submit">建立區域</button><p class="error" data-error></p></form></section>
  <section class="section"><div class="section-head"><h2>區域設定</h2><span>${zones.length} 區</span></div>${zones.length?`<div class="list">${zones.map((z,index)=>{const itemCount=assignments.filter(a=>a.zone_id===z.id).length;return `<article class="card setup-row zone-list-row"><button class="zone-enter-button" data-zone-detail="${z.id}" type="button"><span><strong>${escapeHtml(z.name)}</strong><small>${itemCount} 項・進入後新增或調整品項</small></span><b>›</b></button><div class="button-row compact"><button class="text-button" data-move-zone="${z.id}" data-direction="up" ${index===0?'disabled':''}>上移</button><button class="text-button" data-move-zone="${z.id}" data-direction="down" ${index===zones.length-1?'disabled':''}>下移</button></div></article>`}).join('')}</div>`:emptyState('尚無盤點區域','建立第一個區域後，點進區域加入品項。')}</section>`;
}

export function zoneDetailPage({zones=[],products=[],assignments=[]},zoneId){
  const zone=zones.find(item=>item.id===zoneId);
  if(!zone)return `${backButton()}${emptyState('找不到盤點區域','請返回區域列表重新選擇。')}`;
  const ids=assignments.filter(item=>item.zone_id===zone.id).map(item=>item.product_id),assigned=products.filter(item=>ids.includes(item.id)),available=products.filter(item=>!ids.includes(item.id));
  return `${backButton()}<h2 class="page-title">${escapeHtml(zone.name)}</h2><p class="muted">在這個區域直接加入既有品項或建立新品項；同一商品可加入多個區域，不會重複建立主檔。</p>
  <section class="card settings-card zone-add-card"><h3>加入既有品項</h3>${available.length?`<form data-assign-product="${zone.id}" class="inline-form"><select name="productId" required><option value="">選擇商品</option>${available.map(item=>`<option value="${item.id}">${escapeHtml(item.name)}・${escapeHtml(item.count_unit||'')}</option>`).join('')}</select><button class="primary">加入此區域</button><p class="error" data-error></p></form>`:'<p class="muted">所有既有品項都已加入此區域。</p>'}</section>
  <section class="card settings-card"><h3>直接建立新品項</h3><form id="create-zone-product" data-zone="${zone.id}" class="form-grid two"><label class="field">商品名稱<input name="name" required maxlength="80"></label><label class="field">商品編碼<input name="productCode" required maxlength="40"></label><label class="field">盤點單位<input name="countUnit" required placeholder="例如：公斤"></label><label class="field">進貨單位<input name="purchaseUnit" required placeholder="例如：箱"></label><label class="field">正式期初數量<input name="openingQuantity" type="number" min="0" step="0.001" required></label><div><button class="primary" type="submit">建立並加入此區域</button></div><p class="error" data-error></p></form></section>
  <section class="card settings-card zone-import-shortcut"><h3>大量建立品項</h3><p class="muted">Excel／CSV 可一次建立商品與區域。Google 試算表請先下載成 Excel 或 CSV，再使用相同驗證流程。</p><button class="secondary" data-feature="count" type="button">前往匯入整份盤點表</button></section>
  <section class="section"><div class="section-head"><h2>本區域品項</h2><span>${assigned.length} 項</span></div>${assigned.length?`<div class="list zone-product-list">${assigned.map(item=>`<article class="card setup-row"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.product_code)}・${escapeHtml(item.count_unit||'')}</small></div><button class="text-button danger" data-unassign-product="${item.id}" data-zone="${zone.id}" type="button">移除</button></article>`).join('')}</div>`:emptyState('此區域尚無品項','可從既有商品加入，或直接建立第一項。')}</section>
  <section class="card settings-card zone-maintenance"><form data-rename-zone="${zone.id}" class="inline-form"><input name="name" value="${escapeHtml(zone.name)}" maxlength="60" required><button class="secondary">重新命名</button><p class="error" data-error></p></form><button class="text-button danger zone-deactivate" data-deactivate-zone="${zone.id}" type="button">停用此區域</button></section>`;
}
