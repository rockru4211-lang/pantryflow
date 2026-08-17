const STORAGE_KEY = 'pantryflow-data-v2';

const DEFAULT_PRODUCTS = [
  { id: '001', name: '牛菲力', area: '冷藏庫 A', unit: 'kg', qty: 6.2, safe: 5, expiryDate: '' },
  { id: '002', name: '鮮奶油', area: '冷藏庫 A', unit: '盒', qty: 2, safe: 4, expiryDate: dateOffset(1) },
  { id: '003', name: '帕瑪森起司', area: '冷藏庫 B', unit: '包', qty: 7, safe: 3, expiryDate: '' },
  { id: '004', name: '雞高湯', area: '冷藏庫 B', unit: '盒', qty: 2, safe: 4, expiryDate: dateOffset(0) },
  { id: '005', name: '法國奶油', area: '冷藏庫 A', unit: '塊', qty: 3, safe: 5, expiryDate: '' },
  { id: '006', name: '紅酒醬', area: '工作冰箱', unit: '盒', qty: 4, safe: 2, expiryDate: '' },
  { id: '007', name: '蘑菇', area: '冷藏庫 A', unit: 'kg', qty: 1.5, safe: 3, expiryDate: '' },
  { id: '008', name: '雞蛋', area: '冷藏庫 B', unit: '盒', qty: 2, safe: 3, expiryDate: '' }
];

const DEFAULT_ISSUES = [
  { id: 'demo-issue', type: '收貨', note: '昨日鮮奶油少到 2 盒', createdAt: new Date().toISOString(), resolved: false }
];

let data = loadData();
const ui = { filter: 'all', currentSummary: [], toastTimer: null };
const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);

function dateOffset(days) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.products)) {
      return {
        products: saved.products,
        issues: Array.isArray(saved.issues) ? saved.issues : [],
        countDraft: saved.countDraft || {},
        lastCountAt: saved.lastCountAt || '',
        inventoryHistory: Array.isArray(saved.inventoryHistory) ? saved.inventoryHistory : []
      };
    }
  } catch (error) {
    console.warn('PantryFlow data could not be loaded.', error);
  }
  return freshData();
}

function freshData() {
  return {
    products: DEFAULT_PRODUCTS.map(product => ({ ...product })),
    issues: DEFAULT_ISSUES.map(issue => ({ ...issue })),
    countDraft: {},
    lastCountAt: '',
    inventoryHistory: []
  };
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function escapeHTML(value) {
  return String(value).replace(/[&<>'\"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function formatDate(value = new Date()) {
  return new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(value));
}

function formatTime(value) {
  if (!value) return '尚未完成';
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value));
}

function dayDifference(dateString) {
  if (!dateString) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateString}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

function productStatus(product) {
  const days = dayDifference(product.expiryDate);
  if (days !== null && days <= 1) return 'expiry';
  if (Number(product.qty) < Number(product.safe)) return 'low';
  return 'normal';
}

function expiryLabel(product) {
  const days = dayDifference(product.expiryDate);
  if (days === null) return product.area;
  if (days < 0) return `已過期 ${Math.abs(days)} 天`;
  if (days === 0) return '今日到期';
  if (days === 1) return '明日到期';
  return `${days} 天後到期`;
}

function isCountedToday() {
  return Boolean(data.lastCountAt && new Date(data.lastCountAt).toDateString() === new Date().toDateString());
}

function buildTasks() {
  const expiry = data.products.filter(product => productStatus(product) === 'expiry');
  const low = data.products.filter(product => productStatus(product) === 'low');
  const pendingIssues = data.issues.filter(issue => !issue.resolved);
  const draftCount = Object.keys(data.countDraft).length;
  const countTask = isCountedToday()
    ? { tone: 'green', icon: '✓', title: '今日冷藏區盤點已完成', detail: formatTime(data.lastCountAt), go: 'summary' }
    : { tone: '', icon: '✓', title: draftCount ? '繼續完成冷藏區盤點' : '冷藏區盤點尚未完成', detail: `${draftCount} / ${data.products.length} 項已填寫`, go: 'count' };

  return [
    expiry.length ? {
      tone: 'purple', icon: '⌛',
      title: `${expiry[0].name}${expiry.length > 1 ? `等 ${expiry.length} 項` : ''}即將到期`,
      detail: '請優先使用或登記報廢', go: 'inventory', filter: 'expiry'
    } : { tone: 'green', icon: '✓', title: '目前沒有即期品', detail: '效期狀態正常', go: 'inventory' },
    low.length ? {
      tone: '', icon: '↓', title: `${low.length} 項低於安全庫存`,
      detail: low.slice(0, 3).map(product => product.name).join('、'), go: 'inventory', filter: 'low'
    } : { tone: 'green', icon: '✓', title: '庫存量充足', detail: '沒有低於安全庫存的品項', go: 'inventory' },
    countTask,
    pendingIssues.length ? {
      tone: 'red', icon: '!', title: `${pendingIssues.length} 件異常等待處理`,
      detail: pendingIssues[0].note, go: 'more'
    } : { tone: 'green', icon: '✓', title: '異常事項已處理完畢', detail: '目前沒有待處理異常', go: 'more' }
  ];
}

function renderTasks() {
  const tasks = buildTasks();
  $('#task-list').innerHTML = tasks.map((task, index) => `
    <button class="task ${task.tone}" data-task-index="${index}">
      <span class="task-icon">${task.icon}</span>
      <span class="task-copy"><strong>${escapeHTML(task.title)}</strong><small>${escapeHTML(task.detail)}</small></span>
      <span class="task-arrow">›</span>
    </button>
  `).join('');
  $$('#task-list [data-task-index]').forEach(button => button.addEventListener('click', () => {
    const task = tasks[Number(button.dataset.taskIndex)];
    if (task.filter) selectFilter(task.filter);
    go(task.go);
  }));
  const pending = data.issues.filter(issue => !issue.resolved).length;
  $('#attention-count').textContent = tasks.filter(task => !task.tone.includes('green')).length;
  $('#welcome-copy').textContent = pending ? '異常回報已保存，可在「更多」中追蹤處理。' : '盤點完成後，庫存與提醒會自動更新。';
}

function renderCount() {
  $('#count-total').textContent = data.products.length;
  $('#count-list').innerHTML = data.products.map(product => `
    <label class="count-item">
      <span><strong>${escapeHTML(product.name)}</strong><small>${product.id}・${escapeHTML(product.area)}</small></span>
      <span class="quantity">
        <input type="number" min="0" step="0.1" inputmode="decimal" data-id="${product.id}"
          value="${data.countDraft[product.id] ?? ''}" aria-label="${escapeHTML(product.name)}數量">
        <span>${escapeHTML(product.unit)}</span>
      </span>
    </label>
  `).join('');
  $$('#count-list input').forEach(input => input.addEventListener('input', event => {
    const value = event.currentTarget.value;
    if (value === '') delete data.countDraft[event.currentTarget.dataset.id];
    else data.countDraft[event.currentTarget.dataset.id] = value;
    saveData();
    updateProgress();
    renderTasks();
  }));
  updateProgress();
}

function updateProgress() {
  const filled = Object.keys(data.countDraft).filter(id => data.countDraft[id] !== '').length;
  const percentage = Math.round(filled / data.products.length * 100);
  $('#count-progress').textContent = filled;
  $('#progress-ring').textContent = `${percentage}%`;
  $('#progress-ring').style.background = `conic-gradient(#4f9678 ${percentage}%, #dcece5 0)`;
  $('#finish-count').disabled = filled !== data.products.length;
}

function renderInventory() {
  const query = $('#inventory-search').value.trim().toLowerCase();
  const filtered = data.products.filter(product => {
    const matchesFilter = ui.filter === 'all' || productStatus(product) === ui.filter;
    return matchesFilter && `${product.name}${product.id}${product.area}`.toLowerCase().includes(query);
  });

  $('#inventory-list').innerHTML = filtered.map(product => {
    const status = productStatus(product);
    const secondary = status === 'low'
      ? `${product.area}・安全庫存 ${product.safe}${product.unit}`
      : expiryLabel(product);
    return `
      <button class="inventory-item ${status}" data-product-id="${product.id}">
        <i class="item-status"></i>
        <span class="inventory-copy"><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(secondary)}</small></span>
        <span class="inventory-qty"><strong>${product.qty}</strong> <span>${escapeHTML(product.unit)}</span><small>調整 ›</small></span>
      </button>
    `;
  }).join('') || '<div class="notice">找不到符合的商品</div>';

  $$('#inventory-list [data-product-id]').forEach(button => button.addEventListener('click', () => openProductDialog(button.dataset.productId)));
  const low = data.products.filter(product => productStatus(product) === 'low').length;
  const expiry = data.products.filter(product => productStatus(product) === 'expiry').length;
  $('#inventory-total').textContent = data.products.length;
  $('#low-total').textContent = low;
  $('#expiry-total').textContent = expiry;
}

function renderHealth() {
  const normal = data.products.filter(product => productStatus(product) === 'normal').length;
  const low = data.products.filter(product => productStatus(product) === 'low').length;
  const expiry = data.products.filter(product => productStatus(product) === 'expiry').length;
  const total = data.products.length || 1;
  const score = Math.max(0, Math.round(100 - low * 7 - expiry * 9));
  $('#health-score').textContent = score;
  $('#health-label').textContent = score >= 80 ? '整體良好' : score >= 60 ? '需要留意' : '優先處理';
  $('#normal-count').textContent = normal;
  $('#low-count').textContent = low;
  $('#expiry-count').textContent = expiry;
  $('#normal-bar').style.setProperty('--width', `${normal / total * 100}%`);
  $('#low-bar').style.setProperty('--width', `${low / total * 100}%`);
  $('#expiry-bar').style.setProperty('--width', `${expiry / total * 100}%`);
}

function renderIssues() {
  const ordered = [...data.issues].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $('#issue-list').innerHTML = ordered.length ? ordered.map(issue => `
    <article class="issue-item ${issue.resolved ? 'resolved' : ''}">
      <span class="issue-state">${issue.resolved ? '✓' : '!'}</span>
      <span class="issue-copy">
        <strong>${escapeHTML(issue.note)}</strong>
        <small>${escapeHTML(issue.type)}・${formatTime(issue.createdAt)}</small>
      </span>
      ${issue.resolved ? '<span class="resolved-label">已處理</span>' : `<button data-resolve-id="${issue.id}">標記完成</button>`}
    </article>
  `).join('') : '<div class="notice">目前沒有異常紀錄</div>';
  $$('[data-resolve-id]').forEach(button => button.addEventListener('click', () => {
    const issue = data.issues.find(item => item.id === button.dataset.resolveId);
    if (issue) issue.resolved = true;
    saveAndRender();
    showToast('異常已標記為完成');
  }));
  $('#last-count-time').textContent = formatTime(data.lastCountAt);
  $('#history-count').textContent = data.inventoryHistory.length;
}

function saveAndRender() {
  saveData();
  renderTasks();
  renderCount();
  renderInventory();
  renderHealth();
  renderIssues();
}

function go(page) {
  $$('.page').forEach(section => section.classList.toggle('active', section.dataset.page === page));
  $$('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.go === page));
  const titles = { home: '今日秘書', count: '快速盤點', inventory: '庫存狀態', summary: '盤點完成', more: '更多管理' };
  $('#page-title').textContent = titles[page];
  if (page === 'summary') renderSummary(ui.currentSummary.length ? ui.currentSummary : data.products);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function selectFilter(filter) {
  ui.filter = filter;
  $$('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
  renderInventory();
}

function showToast(message) {
  const toast = $('#toast');
  clearTimeout(ui.toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  ui.toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function finishCount() {
  ui.currentSummary = data.products.map(product => {
    const before = Number(product.qty);
    const after = Number(data.countDraft[product.id]);
    product.qty = after;
    data.inventoryHistory.unshift({
      id: `${Date.now()}-${product.id}`, productId: product.id, before, after,
      reason: '冷藏區盤點', createdAt: new Date().toISOString()
    });
    return { ...product, before };
  });
  data.lastCountAt = new Date().toISOString();
  data.countDraft = {};
  saveData();
  renderSummary(ui.currentSummary);
  saveAndRender();
  go('summary');
}

function renderSummary(items) {
  $('#summary-time').textContent = data.lastCountAt ? formatTime(data.lastCountAt) : '尚未完成盤點';
  $('#summary-table').innerHTML = items.map(product => {
    const changed = typeof product.before === 'number' && product.before !== Number(product.qty);
    const changeText = changed ? `<small>${product.before} → ${product.qty}</small>` : '';
    return `<div class="summary-row"><span>${product.id}</span><b>${escapeHTML(product.name)}${changeText}</b><strong>${product.qty} ${escapeHTML(product.unit)}</strong></div>`;
  }).join('');
}

function openProductDialog(productId) {
  const product = data.products.find(item => item.id === productId);
  if (!product) return;
  $('#product-id').value = product.id;
  $('#product-name').textContent = product.name;
  $('#product-meta').textContent = `${product.area}・安全庫存 ${product.safe}${product.unit}`;
  $('#product-qty').value = product.qty;
  $('#product-unit').textContent = product.unit;
  $('#product-expiry').value = product.expiryDate || '';
  $('#product-dialog').showModal();
}

function submitProduct(event) {
  event.preventDefault();
  const product = data.products.find(item => item.id === $('#product-id').value);
  if (!product) return;
  const before = Number(product.qty);
  const after = Number($('#product-qty').value);
  product.qty = after;
  product.expiryDate = $('#product-expiry').value;
  data.inventoryHistory.unshift({
    id: `${Date.now()}-${product.id}`, productId: product.id, before, after,
    reason: '手動調整', createdAt: new Date().toISOString()
  });
  saveAndRender();
  $('#product-dialog').close();
  showToast(`${product.name}庫存已更新`);
}

function submitIssue(event) {
  event.preventDefault();
  const note = $('#issue-note').value.trim();
  if (!note) return;
  data.issues.unshift({
    id: `issue-${Date.now()}`, type: $('#issue-type').value, note,
    createdAt: new Date().toISOString(), resolved: false
  });
  $('#issue-form').reset();
  $('#issue-dialog').close();
  saveAndRender();
  showToast('異常已記錄，並加入待辦');
}

function exportInventory() {
  const header = ['品號', '商品', '區域', '數量', '單位', '安全庫存', '效期', '狀態'];
  const rows = data.products.map(product => [
    product.id, product.name, product.area, product.qty, product.unit, product.safe,
    product.expiryDate || '', productStatus(product)
  ]);
  const csv = [header, ...rows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `PantryFlow-庫存-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('庫存報表已下載');
}

function resetDemo() {
  if (!window.confirm('確定要清除盤點與異常紀錄，恢復示範資料嗎？')) return;
  data = freshData();
  ui.currentSummary = [];
  saveAndRender();
  go('home');
  showToast('已恢復示範資料');
}

function init() {
  $('#today-date').textContent = formatDate();
  saveAndRender();
  $$('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));
  $('#finish-count').addEventListener('click', finishCount);
  $('#inventory-search').addEventListener('input', renderInventory);
  $$('[data-filter]').forEach(button => button.addEventListener('click', () => selectFilter(button.dataset.filter)));
  $('#quick-issue').addEventListener('click', () => $('#issue-dialog').showModal());
  $('#more-issue').addEventListener('click', () => $('#issue-dialog').showModal());
  $('#issue-form').addEventListener('submit', submitIssue);
  $('#product-form').addEventListener('submit', submitProduct);
  $('#copy-summary').addEventListener('click', async () => {
    const text = data.products.map(product => `${product.id}\t${product.name}\t${product.qty} ${product.unit}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast('總表已複製');
    } catch {
      showToast('瀏覽器未允許複製');
    }
  });
  $('#clear-count').addEventListener('click', () => {
    data.countDraft = {};
    saveAndRender();
    showToast('盤點草稿已清除');
  });
  $('#export-inventory').addEventListener('click', exportInventory);
  $('#reset-demo').addEventListener('click', resetDemo);
  $('#close-issue').addEventListener('click', () => $('#issue-dialog').close());
  $('#close-product').addEventListener('click', () => $('#product-dialog').close());
}

init();
