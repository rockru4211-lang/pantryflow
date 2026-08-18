const STORAGE_KEY = 'pantryflow-data-v2';

const DEFAULT_PRODUCTS = [
  { id: '001', name: '牛菲力', area: '冷藏庫 A', unit: 'kg', baseUnit: 'kg', allowedUnits: [{ name: 'kg', ratio: 1 }, { name: '包', ratio: 2.5 }], qty: 6.2, safe: 5, expiryDate: '' },
  { id: '002', name: '鮮奶油', area: '冷藏庫 A', unit: '盒', baseUnit: '盒', allowedUnits: [{ name: '盒', ratio: 1 }, { name: '箱', ratio: 12 }], qty: 2, safe: 4, expiryDate: dateOffset(1), expirySource: '收貨' },
  { id: '003', name: '帕瑪森起司', area: '冷藏庫 B', unit: '包', baseUnit: '包', allowedUnits: [{ name: '包', ratio: 1 }, { name: '箱', ratio: 6 }], qty: 7, safe: 3, expiryDate: '' },
  { id: '004', name: '雞高湯', area: '冷藏庫 B', unit: '盒', baseUnit: '盒', allowedUnits: [{ name: '盒', ratio: 1 }, { name: '箱', ratio: 8 }], qty: 2, safe: 4, expiryDate: dateOffset(0), expirySource: '製作' },
  { id: '005', name: '法國奶油', area: '冷藏庫 A', unit: '塊', baseUnit: '塊', allowedUnits: [{ name: '塊', ratio: 1 }, { name: '箱', ratio: 20 }], qty: 3, safe: 5, expiryDate: '' },
  { id: '006', name: '紅酒醬', area: '工作冰箱', unit: '盒', baseUnit: '盒', allowedUnits: [{ name: '盒', ratio: 1 }, { name: '袋', ratio: 0.5 }], qty: 4, safe: 2, expiryDate: '' },
  { id: '007', name: '蘑菇', area: '冷藏庫 A', unit: 'kg', baseUnit: 'kg', allowedUnits: [{ name: 'kg', ratio: 1 }, { name: '籃', ratio: 3 }], qty: 1.5, safe: 3, expiryDate: '' },
  { id: '008', name: '雞蛋', area: '冷藏庫 B', unit: '盒', baseUnit: '盒', allowedUnits: [{ name: '盒', ratio: 1 }, { name: '箱', ratio: 10 }], qty: 2, safe: 3, expiryDate: '' }
];

const DEFAULT_ISSUES = [
  { id: 'demo-issue', type: '收貨', note: '鮮奶油少到 2 盒', productId: '002', shortageQuantity: 2, createdAt: new Date().toISOString(), status: 'pending', resolved: false }
];

const DEFAULT_PURCHASE_ORDERS = [
  { id: 'po-cream', productId: '002', quantity: 3, unit: '盒', supplier: '北區乳品', eta: dateTimeOffset(1, 11, 0), status: 'ordered', updatedAt: new Date().toISOString() },
  { id: 'po-butter', productId: '005', quantity: 1, unit: '箱', supplier: '法食供應', eta: dateTimeOffset(2, 14, 0), status: 'ordered', updatedAt: new Date().toISOString() },
  { id: 'po-eggs', productId: '008', quantity: 5, unit: '盒', supplier: '安心蛋品', eta: dateTimeOffset(1, 8, 30), status: 'ordered', updatedAt: new Date().toISOString() }
];

const DAILY_USE_RANGES = {
  '001': [0.6, 1], '002': [1.2, 1.8], '003': [0.4, 0.7], '004': [0.8, 1.2],
  '005': [0.5, 0.9], '006': [0.5, 0.8], '007': [0.6, 1], '008': [0.8, 1.3]
};

const COUNT_AREAS = [
  { id: 'cold-a', name: '冷藏庫 A', productIds: ['001', '002', '005', '007'] },
  { id: 'cold-b', name: '冷藏庫 B', productIds: ['001', '003', '004', '008'] },
  { id: 'work-fridge', name: '工作冰箱', productIds: ['002', '006'] }
];

const MOCK_SESSION = {
  userId: 'staff-chen',
  name: '小陳',
  role: 'staff',
  roleLabel: '一般員工'
};

const MOCK_SUPERVISOR = {
  userId: 'supervisor-manager',
  name: '店長',
  role: 'supervisor',
  roleLabel: '主管'
};

const ROLE_PERMISSIONS = {
  staff: { canCount: true, canChooseAllowedUnit: true, canManageUnitConversion: false, canApproveExpiryCorrection: false },
  supervisor: { canCount: true, canChooseAllowedUnit: true, canManageUnitConversion: true, canApproveExpiryCorrection: true },
  admin: { canCount: true, canChooseAllowedUnit: true, canManageUnitConversion: true, canApproveExpiryCorrection: true }
};

const DEFAULT_COUNT_BASELINES = {
  'cold-a::001': { lastConfirmed: 4, receipts: 2, waste: 0.5, transfers: -1, adjustments: -0.3, estimated: 4.2 },
  'cold-b::001': { lastConfirmed: 2.2, receipts: 0, waste: 0, transfers: -0.2, adjustments: 0, estimated: 2 },
  'cold-a::002': { lastConfirmed: 1, receipts: 0, waste: 0, transfers: 0, adjustments: 0, estimated: 1 },
  'work-fridge::002': { lastConfirmed: 1, receipts: 1, waste: 0, transfers: -1, adjustments: 0, estimated: 1 },
  'cold-b::003': { lastConfirmed: 6, receipts: 2, waste: 1, transfers: 0, adjustments: 0, estimated: 7 },
  'cold-b::004': { lastConfirmed: 3, receipts: 0, waste: 1, transfers: 0, adjustments: 0, estimated: 2 },
  'cold-a::005': { lastConfirmed: 4, receipts: 0, waste: 1, transfers: 0, adjustments: 0, estimated: 3 },
  'work-fridge::006': { lastConfirmed: 3, receipts: 2, waste: 0, transfers: 0, adjustments: -1, estimated: 4 },
  'cold-a::007': { lastConfirmed: 2, receipts: 0, waste: 0.5, transfers: 0, adjustments: 0, estimated: 1.5 },
  'cold-b::008': { lastConfirmed: 2, receipts: 0, waste: 0, transfers: 0, adjustments: 0, estimated: 2 }
};

const DEFAULT_PRODUCT_HISTORY = {
  '001': [
    { id: 'mock-001-1', type: '盤點', quantity: 4, unit: 'kg', actor: '小陳', createdAt: dateTimeOffset(0, 15, 31), detail: '冷藏庫 A' },
    { id: 'mock-001-2', type: '跨店借出', quantity: 2, unit: 'kg', actor: '小王', createdAt: dateTimeOffset(0, 10, 20), detail: '借出 松江店' },
    { id: 'mock-001-3', type: '收貨', quantity: 8, unit: 'kg', actor: '阿明', createdAt: dateTimeOffset(-1, 16, 42), detail: '供應商到貨' },
    { id: 'mock-001-4', type: '報廢', quantity: 0.8, unit: 'kg', actor: '小李', createdAt: dateTimeOffset(-1, 14, 10), detail: '修整耗損' },
    { id: 'mock-001-5', type: '盤點', quantity: 6.2, unit: 'kg', actor: '店長', createdAt: dateTimeOffset(-1, 9, 30), detail: '全區確認' }
  ],
  '002': [
    { id: 'mock-002-1', type: '收貨', quantity: 1, unit: '箱', actor: '阿明', createdAt: dateTimeOffset(-1, 11, 15), detail: '12 盒' },
    { id: 'mock-002-2', type: '盤點', quantity: 2, unit: '盒', actor: '店長', createdAt: dateTimeOffset(-2, 9, 12), detail: '冷藏區確認' }
  ]
};

const COUNT_REASON_LABELS = {
  discard: '報廢／廢棄',
  transfer: '跨店借出／調撥',
  receipt: '收貨未入帳',
  misplaced: '放錯區域／其他區還有庫存',
  'input-error': '單位或輸入錯誤',
  other: '其他'
};

const EXPIRY_ACTION_LABELS = {
  'used-up': '已用完',
  partial: '部分使用',
  discard: '報廢／廢棄',
  mismatch: '數量不符'
};

const ISSUE_STATUS_LABELS = {
  pending: '待處理', processing: '處理中', 'waiting-external': '等待外部', resolved: '已解決'
};

const ISSUE_REASON_LABELS = {
  'supplier-shortage': '供應商缺貨', missing: '漏送', split: '分批配送', other: '其他'
};

const ISSUE_SUPPLEMENT_LABELS = { will: '會補送', wont: '不會補送', pending: '待確認' };

const ISSUE_RESOLUTION_LABELS = {
  borrow: '跨店借貨', 'alternate-supplier': '其他供應商補叫', wait: '先等待', other: '其他處理'
};

const VALID_PAGES = ['home', 'count', 'inventory', 'summary', 'more'];
const PAGE_TITLES = {
  home: '營運秘書', count: '快速盤點', inventory: '庫存狀態', summary: '盤點完成', more: '更多管理'
};

let data = loadData();
const ui = {
  filter: 'all',
  currentSummary: [],
  toastTimer: null,
  currentPage: '',
  countAreaId: data.countAreaId || COUNT_AREAS[0].id,
  scrollByPage: {},
  reviewCountKey: '',
  timelineReturnKey: '',
  timelineReturnLowId: '',
  expiryProductId: '',
  expiryAction: '',
  correctionProductId: '',
  lowProductId: '',
  lowStockStep: 'summary',
  issueId: '',
  settingsProductId: '',
  settingsBaseConversion: 1
};
const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);

function dateOffset(days) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateTimeOffset(days, hour, minute) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, minute, 0, 0);
  return value.toISOString();
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.products)) {
      const products = saved.products.map(normalizeProduct);
      return {
        products,
        issues: (Array.isArray(saved.issues) ? saved.issues : []).map(normalizeIssue),
        countDraft: normalizeCountDraft(saved.countDraft || {}, products),
        countAreaId: COUNT_AREAS.some(area => area.id === saved.countAreaId) ? saved.countAreaId : COUNT_AREAS[0].id,
        lastCountAt: saved.lastCountAt || '',
        lastCountSummary: Array.isArray(saved.lastCountSummary) ? saved.lastCountSummary : [],
        inventoryHistory: Array.isArray(saved.inventoryHistory) ? saved.inventoryHistory : [],
        countBaselines: { ...DEFAULT_COUNT_BASELINES, ...(saved.countBaselines || {}) },
        productHistory: normalizeProductHistory(saved.productHistory),
        wasteRecords: Array.isArray(saved.wasteRecords) ? saved.wasteRecords : [],
        transferRecords: Array.isArray(saved.transferRecords) ? saved.transferRecords : [],
        receiptRecords: Array.isArray(saved.receiptRecords) ? saved.receiptRecords : [],
        expiryEvents: normalizeExpiryEvents(saved.expiryEvents, products),
        expiryTreatments: Array.isArray(saved.expiryTreatments) ? saved.expiryTreatments : [],
        expiryCorrections: Array.isArray(saved.expiryCorrections) ? saved.expiryCorrections : [],
        purchaseOrders: (Array.isArray(saved.purchaseOrders) ? saved.purchaseOrders : DEFAULT_PURCHASE_ORDERS).map(normalizePurchaseOrder),
        configurationRecords: Array.isArray(saved.configurationRecords) ? saved.configurationRecords : []
      };
    }
  } catch (error) {
    console.warn('PantryFlow data could not be loaded.', error);
  }
  return freshData();
}

function freshData() {
  return {
    products: DEFAULT_PRODUCTS.map(product => normalizeProduct(product)),
    issues: DEFAULT_ISSUES.map(normalizeIssue),
    countDraft: {},
    countAreaId: COUNT_AREAS[0].id,
    lastCountAt: '',
    lastCountSummary: [],
    inventoryHistory: [],
    countBaselines: { ...DEFAULT_COUNT_BASELINES },
    productHistory: normalizeProductHistory(),
    wasteRecords: [],
    transferRecords: [],
    receiptRecords: [],
    expiryEvents: normalizeExpiryEvents([], DEFAULT_PRODUCTS),
    expiryTreatments: [],
    expiryCorrections: [],
    purchaseOrders: DEFAULT_PURCHASE_ORDERS.map(normalizePurchaseOrder),
    configurationRecords: []
  };
}

function normalizeIssue(issue) {
  const status = ISSUE_STATUS_LABELS[issue.status]
    ? issue.status
    : issue.resolved ? 'resolved' : 'pending';
  return {
    ...issue,
    status,
    resolved: status === 'resolved',
    productId: issue.productId || '',
    shortageQuantity: Number(issue.shortageQuantity) || 0,
    reason: issue.reason || '',
    supplementStatus: issue.supplementStatus || '',
    expectedAt: issue.expectedAt || '',
    resolutionAction: issue.resolutionAction || '',
    events: Array.isArray(issue.events) ? issue.events.map(event => ({ ...event })) : []
  };
}

function normalizePurchaseOrder(order) {
  return {
    id: order.id || `po-${Date.now()}`,
    productId: order.productId || '',
    quantity: Number(order.quantity) || 0,
    unit: order.unit || '',
    supplier: order.supplier || '供應商待確認',
    eta: order.eta || '',
    status: order.status || 'ordered',
    updatedAt: order.updatedAt || new Date().toISOString(),
    updatedBy: order.updatedBy || MOCK_SUPERVISOR.name
  };
}

function normalizeExpiryEvents(savedEvents, products) {
  const source = Array.isArray(savedEvents) ? savedEvents : [];
  const productById = new Map(products.map(product => [product.id, product]));
  const normalized = source.map(event => ({
    id: event.id || `expiry-${event.productId}-${event.expiryDate}`,
    productId: event.productId,
    expiryDate: event.expiryDate,
    status: event.status || 'scheduled',
    milestones: Array.isArray(event.milestones) ? [...new Set(event.milestones)] : [],
    createdAt: event.createdAt || new Date().toISOString(),
    updatedAt: event.updatedAt || event.createdAt || new Date().toISOString(),
    resolvedAt: event.resolvedAt || '',
    resolvedBy: event.resolvedBy || '',
    resolution: event.resolution || '',
    resolutionDetail: event.resolutionDetail || '',
    correctionId: event.correctionId || '',
    correctedTo: event.correctedTo || '',
    source: event.source || productById.get(event.productId)?.expirySource || '收貨／開封事件'
  })).filter(event => event.productId && event.expiryDate);
  products.forEach(product => {
    if (!product.expiryDate) return;
    if (!normalized.some(event => event.productId === product.id && event.expiryDate === product.expiryDate)) {
      normalized.push({
        id: `expiry-${product.id}-${product.expiryDate}`,
        productId: product.id,
        expiryDate: product.expiryDate,
        status: 'scheduled',
        milestones: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        resolvedAt: '',
        resolvedBy: '',
        resolution: '',
        source: product.expirySource || '收貨／開封事件'
      });
    }
  });
  return normalized;
}

function normalizeProduct(product) {
  const fallback = DEFAULT_PRODUCTS.find(item => item.id === product.id);
  const baseUnit = product.baseUnit || product.unit || fallback?.baseUnit || '件';
  const suppliedUnits = Array.isArray(product.allowedUnits) && product.allowedUnits.length
    ? product.allowedUnits
    : fallback?.allowedUnits || [{ name: baseUnit, ratio: 1 }];
  const allowedUnits = suppliedUnits
    .map(unit => ({ name: String(unit.name || baseUnit), ratio: Number(unit.ratio) || 1 }))
    .filter((unit, index, units) => unit.ratio > 0 && units.findIndex(item => item.name === unit.name) === index);
  if (!allowedUnits.some(unit => unit.name === baseUnit)) allowedUnits.unshift({ name: baseUnit, ratio: 1 });
  return { ...fallback, ...product, unit: baseUnit, baseUnit, allowedUnits };
}

function normalizeProductHistory(savedHistory) {
  const source = {
    ...DEFAULT_PRODUCT_HISTORY,
    ...(savedHistory && typeof savedHistory === 'object' ? savedHistory : {})
  };
  return Object.fromEntries(Object.entries(source).map(([productId, entries]) => [
    productId,
    Array.isArray(entries) ? entries.map(entry => ({ ...entry })) : []
  ]));
}

function countKey(areaId, productId) {
  return `${areaId}::${productId}`;
}

function normalizeCountDraft(draft, products) {
  const normalized = {};
  Object.entries(draft).forEach(([key, value]) => {
    const productId = key.includes('::') ? key.split('::')[1] : key;
    const product = products.find(item => item.id === productId);
    if (!product) return;
    if (key.includes('::')) {
      normalized[key] = normalizeCountEntry(value, product);
      return;
    }
    const area = COUNT_AREAS.find(item => item.name === product?.area && item.productIds.includes(key))
      || COUNT_AREAS.find(item => item.productIds.includes(key));
    if (area) normalized[countKey(area.id, key)] = normalizeCountEntry(value, product);
  });
  return normalized;
}

function normalizeCountEntry(value, product) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const allowed = getAllowedUnits(product);
    const unit = allowed.some(item => item.name === value.unit) ? value.unit : product.baseUnit;
    return {
      value: value.value === undefined || value.value === null ? '' : String(value.value),
      unit,
      baseValue: Number.isFinite(Number(value.baseValue)) ? Number(value.baseValue) : null,
      status: ['draft', 'needs-recount', 'needs-reason', 'confirmed'].includes(value.status) ? value.status : 'draft',
      attempts: Array.isArray(value.attempts) ? value.attempts.map(attempt => ({ ...attempt })) : [],
      reason: value.reason || '',
      resolution: value.resolution || '',
      confirmedAt: value.confirmedAt || ''
    };
  }
  return {
    value: value === undefined || value === null ? '' : String(value),
    unit: product.baseUnit,
    baseValue: null,
    status: 'draft',
    attempts: [],
    reason: '',
    resolution: '',
    confirmedAt: ''
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

function expiryStateForDate(dateString) {
  const days = dayDifference(dateString);
  if (days === null || days > 1) return 'scheduled';
  if (days === 1) return 'near-expiry';
  if (days === 0) return 'due-today';
  return 'overdue-supervisor';
}

function refreshExpiryEvents() {
  if (!Array.isArray(data.expiryEvents)) data.expiryEvents = [];
  data.products.forEach(product => {
    if (!product.expiryDate) return;
    let event = data.expiryEvents.find(item => item.productId === product.id && item.expiryDate === product.expiryDate);
    if (!event) {
      event = normalizeExpiryEvents([], [product])[0];
      data.expiryEvents.push(event);
    }
    if (['resolved', 'corrected'].includes(event.status)) return;
    if (Number(product.qty) <= 0) {
      event.status = 'resolved';
      event.resolution = event.resolution || 'no-remaining-stock';
      event.resolvedAt = event.resolvedAt || new Date().toISOString();
      event.resolvedBy = event.resolvedBy || '系統';
      event.updatedAt = event.resolvedAt;
      return;
    }
    const nextStatus = expiryStateForDate(event.expiryDate);
    if (event.status !== nextStatus) {
      event.status = nextStatus;
      event.updatedAt = new Date().toISOString();
    }
    if (['near-expiry', 'due-today', 'overdue-supervisor'].includes(nextStatus)
      && !event.milestones.includes(nextStatus)) {
      event.milestones.push(nextStatus);
      event.updatedAt = new Date().toISOString();
    }
  });
}

function getCurrentExpiryEvent(product) {
  if (!product?.expiryDate) return null;
  return data.expiryEvents.find(event => event.productId === product.id && event.expiryDate === product.expiryDate) || null;
}

function getActiveExpiryEvent(product) {
  const event = getCurrentExpiryEvent(product);
  return event && !['resolved', 'corrected'].includes(event.status) ? event : null;
}

function isExpiryAttention(product) {
  const event = getActiveExpiryEvent(product);
  return Boolean(event && ['near-expiry', 'due-today', 'overdue-supervisor'].includes(event.status));
}

function expiryStateLabel(product) {
  const event = getCurrentExpiryEvent(product);
  if (!product.expiryDate) return '未設定效期';
  if (event?.status === 'resolved') return `效期事件已處理・${product.expiryDate}`;
  if (event?.status === 'corrected') return `效期已更正・原 ${event.expiryDate}`;
  if (event?.status === 'overdue-supervisor') return `已到期未處理・${product.expiryDate}`;
  if (event?.status === 'due-today') return `今日到期・${product.expiryDate}`;
  if (event?.status === 'near-expiry') return `明日到期・${product.expiryDate}`;
  return `有效日期 ${product.expiryDate}`;
}

function productStatus(product) {
  if (isExpiryAttention(product)) return 'expiry';
  if (Number(product.qty) < Number(product.safe)) return 'low';
  return 'normal';
}

function expiryLabel(product) {
  const event = getCurrentExpiryEvent(product);
  if (event?.status === 'resolved') return '效期事件已處理';
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

function getCountEntries() {
  return COUNT_AREAS.flatMap(area => area.productIds
    .map(productId => ({ area, product: data.products.find(item => item.id === productId) }))
    .filter(entry => entry.product));
}

function getAllowedUnits(product) {
  return Array.isArray(product.allowedUnits) && product.allowedUnits.length
    ? product.allowedUnits
    : [{ name: product.baseUnit || product.unit, ratio: 1 }];
}

function getUnitDefinition(product, unitName) {
  return getAllowedUnits(product).find(unit => unit.name === unitName) || getAllowedUnits(product)[0];
}

function convertToBase(product, value, unitName) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return null;
  return Number((quantity * getUnitDefinition(product, unitName).ratio).toFixed(3));
}

function convertFromBase(product, baseValue, unitName) {
  const ratio = getUnitDefinition(product, unitName).ratio;
  return Number((Number(baseValue) / ratio).toFixed(3));
}

function unitRatioText(product, unitName) {
  const unit = getUnitDefinition(product, unitName);
  return unit.ratio === 1
    ? `基準單位：${product.baseUnit}`
    : `固定換算：1 ${unit.name} = ${unit.ratio} ${product.baseUnit}`;
}

function getCountDescriptor(key) {
  const [areaId, productId] = String(key).split('::');
  const area = COUNT_AREAS.find(item => item.id === areaId);
  const product = data.products.find(item => item.id === productId);
  return area && product ? { key, area, product } : null;
}

function getOrCreateCountEntry(areaId, productId) {
  const key = countKey(areaId, productId);
  const product = data.products.find(item => item.id === productId);
  if (!product) return null;
  if (!data.countDraft[key] || typeof data.countDraft[key] !== 'object') {
    data.countDraft[key] = normalizeCountEntry(data.countDraft[key], product);
  }
  return data.countDraft[key];
}

function getCountBaseline(key, product) {
  const baseline = data.countBaselines[key] || {};
  const locations = getCountEntries().filter(entry => entry.product.id === product.id).length || 1;
  const fallbackEstimate = Number(product.qty) / locations;
  return {
    lastConfirmed: Number(baseline.lastConfirmed ?? fallbackEstimate),
    receipts: Number(baseline.receipts || 0),
    waste: Number(baseline.waste || 0),
    transfers: Number(baseline.transfers || 0),
    adjustments: Number(baseline.adjustments || 0),
    estimated: Number(baseline.estimated ?? fallbackEstimate)
  };
}

function getCountComparison(key, baseValue) {
  const descriptor = getCountDescriptor(key);
  if (!descriptor) return null;
  const baseline = getCountBaseline(key, descriptor.product);
  const difference = Number((Number(baseValue) - baseline.estimated).toFixed(3));
  const threshold = Math.max(0.5, Math.abs(baseline.estimated) * 0.2);
  return { ...baseline, actual: Number(baseValue), difference, threshold, significant: Math.abs(difference) >= threshold };
}

function getCountProgress() {
  const entries = getCountEntries();
  const filled = entries.filter(({ area, product }) => data.countDraft[countKey(area.id, product.id)]?.status === 'confirmed').length;
  return { filled, total: entries.length };
}

function getAreaProgress(area) {
  const validProductIds = area.productIds.filter(productId => data.products.some(product => product.id === productId));
  const filled = validProductIds.filter(productId => data.countDraft[countKey(area.id, productId)]?.status === 'confirmed').length;
  return { filled, total: validProductIds.length };
}

function buildHomeSections() {
  const overdue = data.products.filter(product => getActiveExpiryEvent(product)?.status === 'overdue-supervisor');
  const dueToday = data.products.filter(product => getActiveExpiryEvent(product)?.status === 'due-today');
  const nearExpiry = data.products.filter(product => getActiveExpiryEvent(product)?.status === 'near-expiry');
  const expiry = [...overdue, ...dueToday, ...nearExpiry];
  const low = data.products.filter(product => productStatus(product) === 'low');
  const pendingIssues = data.issues.filter(isIssueOpen);
  const upcomingExpiry = data.products.filter(product => {
    const days = dayDifference(product.expiryDate);
    return Boolean(getActiveExpiryEvent(product)) && days !== null && days >= 2 && days <= 3;
  });
  const nearLow = data.products.filter(product => productStatus(product) === 'normal'
    && Number(product.safe) > 0
    && Number(product.qty) <= Number(product.safe) * 1.25);
  const progress = getCountProgress();
  const countTask = isCountedToday()
    ? { tone: 'green', icon: '✓', title: '今日分區盤點已完成', detail: formatTime(data.lastCountAt), go: 'summary', action: '看摘要' }
    : {
      tone: '', icon: '✓', title: progress.filled ? '繼續完成分區盤點' : '今日分區盤點尚未完成',
      detail: `${progress.filled} / ${progress.total} 筆已確認`, go: 'count', action: progress.filled ? '繼續' : '開始'
    };

  const urgent = [];
  if (overdue.length) urgent.push({
    tone: 'red', icon: '!', title: `${overdue.length} 項已到期尚未處理`,
    detail: `${overdue.slice(0, 3).map(product => product.name).join('、')}・需主管關注`,
    go: 'inventory', filter: 'expiry', productId: overdue[0].id, action: '立即處理'
  });
  if (dueToday.length) urgent.push({
    tone: 'red', icon: '⌛', title: `${dueToday.length} 項今日到期`,
    detail: dueToday.slice(0, 3).map(product => product.name).join('、'),
    go: 'inventory', filter: 'expiry', productId: dueToday[0].id, action: '立即處理'
  });
  if (nearExpiry.length) urgent.push({
    tone: 'purple', icon: '⌛', title: `${nearExpiry.length} 項明日到期`,
    detail: nearExpiry.slice(0, 3).map(product => product.name).join('、'),
    go: 'inventory', filter: 'expiry', productId: nearExpiry[0].id, action: '處理'
  });
  if (low.length) urgent.push({
    tone: '', icon: '↓', title: `${low.length} 項低於安全庫存`,
    detail: low.slice(0, 3).map(product => product.name).join('、'), go: 'inventory', filter: 'low', productId: low[0].id, action: '確認風險'
  });
  if (pendingIssues.length) urgent.push({
    tone: 'red', icon: '!', title: `${pendingIssues.length} 件異常等待處理`,
    detail: pendingIssues[0].note, go: 'more', issueId: pendingIssues[0].id, action: '處理'
  });

  const upcoming = [];
  if (upcomingExpiry.length) upcoming.push({
    tone: 'purple', icon: '⌛', title: `${upcomingExpiry.length} 項將在 2～3 天內到期`,
    detail: upcomingExpiry.map(product => product.name).join('、'), go: 'inventory', productId: upcomingExpiry[0].id, action: '查看'
  });
  if (nearLow.length) upcoming.push({
    tone: '', icon: '↘', title: `${nearLow.length} 項接近安全庫存`,
    detail: nearLow.slice(0, 3).map(product => product.name).join('、'), go: 'inventory', action: '查看'
  });

  return {
    urgent: urgent.length ? urgent : [{ normal: true, title: '目前沒有需要立即處理的異常', detail: '正常項目已收起' }],
    today: [countTask],
    upcoming: upcoming.length ? upcoming : [{ normal: true, title: '未來 3 天沒有新增風險', detail: '持續依現場狀況更新' }],
    urgentCount: expiry.length + low.length + pendingIssues.length,
    progress,
    pendingIssues: pendingIssues.length
  };
}

function renderTaskList(selector, tasks) {
  const container = $(selector);
  container.innerHTML = tasks.map((task, index) => task.normal ? `
    <div class="empty-state">
      <span aria-hidden="true">✓</span>
      <div><strong>${escapeHTML(task.title)}</strong><small>${escapeHTML(task.detail)}</small></div>
    </div>
  ` : `
    <button class="task ${task.tone}" data-task-index="${index}">
      <span class="task-icon">${task.icon}</span>
      <span class="task-copy"><strong>${escapeHTML(task.title)}</strong><small>${escapeHTML(task.detail)}</small></span>
      <span class="task-action">${escapeHTML(task.action || '查看')} ›</span>
    </button>
  `).join('');
  container.querySelectorAll('[data-task-index]').forEach(button => button.addEventListener('click', () => {
    const task = tasks[Number(button.dataset.taskIndex)];
    if (task.filter) selectFilter(task.filter);
    go(task.go);
    if (task.productId) window.setTimeout(() => {
      const product = data.products.find(item => item.id === task.productId);
      if (productStatus(product) === 'low') openLowStockDialog(task.productId);
      else openProductDialog(task.productId);
    }, 0);
    if (task.issueId) window.setTimeout(() => openIssueWorkflow(task.issueId), 0);
  }));
}

function renderTasks() {
  const sections = buildHomeSections();
  renderTaskList('#urgent-list', sections.urgent);
  renderTaskList('#today-list', sections.today);
  renderTaskList('#upcoming-list', sections.upcoming);
  $('#attention-count').textContent = sections.urgentCount;
  $('#operation-status').textContent = sections.urgentCount
    ? '松露小館・有事項待處理'
    : '松露小館・營運正常';
  $('#today-progress-label').textContent = `${sections.progress.filled}/${sections.progress.total}`;
  $('#quick-count-label').textContent = sections.progress.filled
    ? `已確認 ${sections.progress.filled}/${sections.progress.total}`
    : '依區域開始';
  $('#welcome-copy').textContent = sections.pendingIssues
    ? '異常已進入待辦，可直接從下方處理。'
    : '只展開異常與今天需要完成的工作。';
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 3 }).format(number);
}

function unitOptions(product, selectedUnit) {
  return getAllowedUnits(product).map(unit => `
    <option value="${escapeHTML(unit.name)}" ${unit.name === selectedUnit ? 'selected' : ''}>${escapeHTML(unit.name)}</option>
  `).join('');
}

function countStatusLabel(entry) {
  if (entry.status === 'confirmed') return '已確認';
  if (entry.status === 'needs-recount') return '等待複盤';
  if (entry.status === 'needs-reason') return '選擇原因';
  if (entry.value !== '') return '尚未確認';
  return '未盤';
}

function renderCount() {
  const area = COUNT_AREAS.find(item => item.id === ui.countAreaId) || COUNT_AREAS[0];
  ui.countAreaId = area.id;
  data.countAreaId = area.id;
  const products = area.productIds.map(productId => data.products.find(product => product.id === productId)).filter(Boolean);
  const permissions = ROLE_PERMISSIONS[MOCK_SESSION.role] || ROLE_PERMISSIONS.staff;
  $('#count-area-name').textContent = area.name;
  $('#count-role').textContent = `${MOCK_SESSION.name}・${MOCK_SESSION.roleLabel}`;
  $('#count-list').innerHTML = products.map(product => {
    const key = countKey(area.id, product.id);
    const entry = getOrCreateCountEntry(area.id, product.id);
    const locked = entry.status === 'confirmed';
    const needsReview = entry.status === 'needs-recount' || entry.status === 'needs-reason';
    return `
    <article class="count-item count-entry ${entry.status}" data-count-card="${key}">
      <div class="count-product">
        <span><strong>${escapeHTML(product.name)}</strong><small>${product.id}・${escapeHTML(area.name)}</small></span>
        <span class="count-state">${countStatusLabel(entry)}</span>
      </div>
      <div class="count-entry-row">
        <label class="sr-only" for="count-${key}">${escapeHTML(product.name)}盤點數量</label>
        <input id="count-${key}" type="number" min="0" step="0.01" inputmode="decimal" data-count-value="${key}"
          value="${escapeHTML(entry.value)}" ${locked || needsReview ? 'disabled' : ''}
          aria-label="${escapeHTML(area.name)} ${escapeHTML(product.name)}數量">
        <select data-count-unit="${key}" ${locked || needsReview || !permissions.canChooseAllowedUnit ? 'disabled' : ''}
          aria-label="${escapeHTML(product.name)}盤點單位">${unitOptions(product, entry.unit)}</select>
        ${locked
          ? `<button type="button" class="count-secondary" data-edit-count="${key}">修改</button>`
          : needsReview
            ? `<button type="button" class="count-primary" data-open-review="${key}">繼續核對</button>`
            : `<button type="button" class="count-primary" data-confirm-count="${key}" ${entry.value === '' ? 'disabled' : ''}>確認</button>`}
      </div>
      <div class="count-entry-meta">
        <small data-unit-ratio="${key}">${escapeHTML(unitRatioText(product, entry.unit))}</small>
        ${locked ? `<small>已確認 ${formatNumber(entry.baseValue)} ${escapeHTML(product.baseUnit)}${entry.reason ? `・${escapeHTML(COUNT_REASON_LABELS[entry.reason] || entry.reason)}` : ''}</small>` : ''}
        ${needsReview ? '<small class="review-needed">已完成輸入，請核對差異</small>' : ''}
      </div>
    </article>
  `;
  }).join('');

  $$('[data-count-value]').forEach(input => input.addEventListener('input', event => {
    const key = event.currentTarget.dataset.countValue;
    const entry = data.countDraft[key];
    if (!entry || entry.status !== 'draft') return;
    entry.value = event.currentTarget.value;
    entry.baseValue = null;
    saveData();
    const button = document.querySelector(`[data-confirm-count="${CSS.escape(key)}"]`);
    if (button) button.disabled = entry.value === '';
  }));
  $$('[data-count-unit]').forEach(select => select.addEventListener('change', event => {
    const key = event.currentTarget.dataset.countUnit;
    const descriptor = getCountDescriptor(key);
    const entry = data.countDraft[key];
    if (!descriptor || !entry || entry.status !== 'draft') return;
    entry.unit = event.currentTarget.value;
    entry.baseValue = null;
    const ratio = document.querySelector(`[data-unit-ratio="${CSS.escape(key)}"]`);
    if (ratio) ratio.textContent = unitRatioText(descriptor.product, entry.unit);
    saveData();
  }));
  $$('[data-confirm-count]').forEach(button => button.addEventListener('click', () => confirmCountEntry(button.dataset.confirmCount)));
  $$('[data-open-review]').forEach(button => button.addEventListener('click', () => openCountReview(button.dataset.openReview)));
  $$('[data-edit-count]').forEach(button => button.addEventListener('click', () => resetCountEntry(button.dataset.editCount)));
  updateProgress();
}

function renderCountAreaList() {
  $('#count-area-list').innerHTML = COUNT_AREAS.map((area, index) => {
    const progress = getAreaProgress(area);
    const complete = progress.total > 0 && progress.filled === progress.total;
    return `
      <button type="button" class="count-area-button ${area.id === ui.countAreaId ? 'active' : ''} ${complete ? 'complete' : ''}"
        data-count-area="${area.id}" aria-current="${area.id === ui.countAreaId ? 'step' : 'false'}">
        <span>${complete ? '✓' : index + 1}</span>
        <strong>${escapeHTML(area.name)}</strong>
        <small>${progress.filled}/${progress.total}</small>
      </button>
    `;
  }).join('');
  $$('[data-count-area]').forEach(button => button.addEventListener('click', () => {
    ui.countAreaId = button.dataset.countArea;
    data.countAreaId = ui.countAreaId;
    saveData();
    renderCount();
  }));
}

function updateProgress() {
  const progress = getCountProgress();
  const area = COUNT_AREAS.find(item => item.id === ui.countAreaId) || COUNT_AREAS[0];
  const areaProgress = getAreaProgress(area);
  const percentage = progress.total ? Math.round(progress.filled / progress.total * 100) : 0;
  $('#count-progress').textContent = progress.filled;
  $('#count-total').textContent = progress.total;
  $('#count-area-progress').textContent = `${areaProgress.filled} / ${areaProgress.total} 筆`;
  $('#progress-ring').textContent = `${percentage}%`;
  $('#progress-ring').style.background = `conic-gradient(#4f9678 ${percentage}%, #dcece5 0)`;
  $('#finish-count').disabled = progress.total === 0 || progress.filled !== progress.total;
  renderCountAreaList();
}

function appendProductHistory(productId, event) {
  if (!Array.isArray(data.productHistory[productId])) data.productHistory[productId] = [];
  data.productHistory[productId].unshift({
    id: event.id || `activity-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: event.createdAt || new Date().toISOString(),
    actor: event.actor || MOCK_SESSION.name,
    ...event
  });
}

function recordCountAttempt(key, entry, descriptor, type) {
  const createdAt = new Date().toISOString();
  const attempt = {
    id: `count-${Date.now()}-${entry.attempts.length + 1}`,
    type,
    value: Number(entry.value),
    unit: entry.unit,
    baseValue: entry.baseValue,
    actor: MOCK_SESSION.name,
    createdAt,
    area: descriptor.area.name
  };
  entry.attempts.push(attempt);
  appendProductHistory(descriptor.product.id, {
    id: attempt.id,
    type,
    quantity: attempt.value,
    unit: attempt.unit,
    actor: attempt.actor,
    createdAt,
    detail: descriptor.area.name
  });
}

function markEntryConfirmed(entry, reason = '', resolution = '') {
  entry.status = 'confirmed';
  entry.reason = reason;
  entry.resolution = resolution;
  entry.confirmedAt = new Date().toISOString();
}

function confirmCountEntry(key) {
  const descriptor = getCountDescriptor(key);
  const entry = data.countDraft[key];
  if (!descriptor || !entry) return;
  const baseValue = convertToBase(descriptor.product, entry.value, entry.unit);
  if (baseValue === null || baseValue < 0) {
    showToast('請輸入正確的盤點數量');
    return;
  }
  entry.baseValue = baseValue;
  recordCountAttempt(key, entry, descriptor, '初盤');
  const comparison = getCountComparison(key, baseValue);
  if (comparison.significant) {
    entry.status = 'needs-recount';
    saveData();
    renderCount();
    openCountReview(key);
    return;
  }
  markEntryConfirmed(entry, '', '差異在容許範圍內');
  saveAndRender();
  focusNextCountEntry(key);
  showToast(`${descriptor.product.name}已確認`);
}

function resetCountEntry(key) {
  const descriptor = getCountDescriptor(key);
  const entry = data.countDraft[key];
  if (!descriptor || !entry) return;
  entry.status = 'draft';
  entry.baseValue = null;
  entry.reason = '';
  entry.resolution = '';
  entry.confirmedAt = '';
  saveData();
  renderCount();
  window.requestAnimationFrame(() => {
    const input = document.querySelector(`[data-count-value="${CSS.escape(key)}"]`);
    input?.focus();
  });
}

function focusNextCountEntry(currentKey) {
  const entries = getCountEntries();
  const currentIndex = Math.max(0, entries.findIndex(({ area, product }) => countKey(area.id, product.id) === currentKey));
  const ordered = [...entries.slice(currentIndex + 1), ...entries.slice(0, currentIndex + 1)];
  const next = ordered.find(({ area, product }) => data.countDraft[countKey(area.id, product.id)]?.status !== 'confirmed');
  if (!next) {
    renderCount();
    showToast('所有品項已確認，可以完成盤點');
    return;
  }
  ui.countAreaId = next.area.id;
  data.countAreaId = next.area.id;
  saveData();
  renderCount();
  const nextKey = countKey(next.area.id, next.product.id);
  window.requestAnimationFrame(() => {
    const input = document.querySelector(`[data-count-value="${CSS.escape(nextKey)}"]`);
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus();
  });
}

function comparisonRows(comparison, product, entry) {
  const unit = escapeHTML(product.baseUnit);
  const signed = value => `${Number(value) > 0 ? '+' : ''}${formatNumber(value)} ${unit}`;
  const attempt = entry.attempts[entry.attempts.length - 1];
  return [
    ['本次實盤', `${formatNumber(comparison.actual)} ${unit}`],
    ['上次確認庫存', `${formatNumber(comparison.lastConfirmed)} ${unit}`],
    ['近期收貨', signed(comparison.receipts)],
    ['近期廢棄', `-${formatNumber(Math.abs(comparison.waste))} ${unit}`],
    ['跨店借貸／調撥', signed(comparison.transfers)],
    ['人工調整', signed(comparison.adjustments)],
    ['推估庫存', `${formatNumber(comparison.estimated)} ${unit}`],
    ['差異', signed(comparison.difference)],
    ['操作者與時間', `${escapeHTML(attempt?.actor || MOCK_SESSION.name)}・${escapeHTML(formatTime(attempt?.createdAt || new Date()))}`]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function openCountReview(key) {
  const descriptor = getCountDescriptor(key);
  const entry = data.countDraft[key];
  if (!descriptor || !entry || !['needs-recount', 'needs-reason'].includes(entry.status)) return;
  ui.reviewCountKey = key;
  const comparison = getCountComparison(key, entry.baseValue);
  $('#review-stage').textContent = entry.status === 'needs-recount' ? '第一次差異明顯' : '第二次仍有差異';
  $('#review-product-name').textContent = descriptor.product.name;
  $('#review-product-area').textContent = `${descriptor.area.name}・基準單位 ${descriptor.product.baseUnit}`;
  $('#review-lead').textContent = entry.status === 'needs-recount'
    ? '已完成初盤，現在才揭露核對資訊。請重新盤一次。'
    : '複盤後差異仍明顯，請選擇可能原因並直接處理。';
  $('#review-comparison').innerHTML = comparisonRows(comparison, descriptor.product, entry);
  $('#recount-form').hidden = entry.status !== 'needs-recount';
  $('#reason-step').hidden = entry.status !== 'needs-reason';
  $('#recount-value').value = '';
  $('#recount-unit').innerHTML = unitOptions(descriptor.product, entry.unit);
  $('#recount-unit').value = entry.unit;
  $('#recount-ratio').textContent = unitRatioText(descriptor.product, entry.unit);
  const dialog = $('#count-review-dialog');
  if (!dialog.open) dialog.showModal();
}

function submitRecount(event) {
  event.preventDefault();
  const key = ui.reviewCountKey;
  const descriptor = getCountDescriptor(key);
  const entry = data.countDraft[key];
  if (!descriptor || !entry) return;
  const value = $('#recount-value').value;
  const unit = $('#recount-unit').value;
  const baseValue = convertToBase(descriptor.product, value, unit);
  if (baseValue === null || baseValue < 0) {
    showToast('請輸入正確的複盤數量');
    return;
  }
  entry.value = value;
  entry.unit = unit;
  entry.baseValue = baseValue;
  recordCountAttempt(key, entry, descriptor, '複盤');
  const comparison = getCountComparison(key, baseValue);
  if (comparison.significant) {
    entry.status = 'needs-reason';
    saveData();
    renderCount();
    openCountReview(key);
    return;
  }
  markEntryConfirmed(entry, '', '複盤後差異在容許範圍內');
  saveAndRender();
  $('#count-review-dialog').close();
  focusNextCountEntry(key);
  showToast(`${descriptor.product.name}複盤完成`);
}

function findOtherCountArea(productId, currentAreaId) {
  return COUNT_AREAS.find(area => area.id !== currentAreaId
    && area.productIds.includes(productId)
    && data.countDraft[countKey(area.id, productId)]?.status !== 'confirmed');
}

function chooseCountReason(reason) {
  const key = ui.reviewCountKey;
  const descriptor = getCountDescriptor(key);
  const entry = data.countDraft[key];
  if (!descriptor || !entry) return;
  if (reason === 'input-error') {
    entry.status = 'draft';
    entry.baseValue = null;
    entry.reason = reason;
    entry.resolution = '返回重新輸入';
    saveData();
    $('#count-review-dialog').close();
    renderCount();
    window.requestAnimationFrame(() => document.querySelector(`[data-count-value="${CSS.escape(key)}"]`)?.focus());
    showToast('已保留原數字，請修正後再確認');
    return;
  }
  if (reason === 'misplaced') {
    markEntryConfirmed(entry, reason, '前往其他區域確認剩餘庫存');
    appendProductHistory(descriptor.product.id, {
      type: '區域核對', quantity: Number(entry.value), unit: entry.unit,
      detail: `${descriptor.area.name}發現差異，前往其他區域確認`
    });
    const otherArea = findOtherCountArea(descriptor.product.id, descriptor.area.id);
    saveAndRender();
    $('#count-review-dialog').close();
    if (otherArea) {
      ui.countAreaId = otherArea.id;
      data.countAreaId = otherArea.id;
      saveData();
      renderCount();
      const otherKey = countKey(otherArea.id, descriptor.product.id);
      window.requestAnimationFrame(() => document.querySelector(`[data-count-value="${CSS.escape(otherKey)}"]`)?.focus());
      showToast(`請到${otherArea.name}確認${descriptor.product.name}`);
    } else {
      focusNextCountEntry(key);
      showToast('其他區域已盤完，已保留為區域核對紀錄');
    }
    return;
  }
  if (reason === 'other') {
    markEntryConfirmed(entry, reason, '已建立待辦交接');
    data.issues.unshift(normalizeIssue({
      id: `count-issue-${Date.now()}`, type: '盤點',
      note: `${descriptor.product.name}複盤仍有差異，需主管後續核對`,
      createdAt: new Date().toISOString(), resolved: false, sourceKey: key,
      actor: MOCK_SESSION.name, productId: descriptor.product.id
    }));
    appendProductHistory(descriptor.product.id, {
      type: '異常待辦', quantity: Number(entry.value), unit: entry.unit,
      detail: '複盤仍有差異，已建立交接'
    });
    saveAndRender();
    $('#count-review-dialog').close();
    focusNextCountEntry(key);
    showToast('異常已加入待辦／交接');
    return;
  }
  openFollowupDialog(reason, key);
}

const FOLLOWUP_CONFIG = {
  discard: {
    title: '建立廢棄紀錄', hint: '已自動帶入盤點差異，可修改後一次完成庫存與歷史更新。', detailTitle: '廢棄原因',
    options: ['正常修整／製程耗損', '保存異常', '過度備料', '人為錯誤', '設備問題', '掉落', '供應商責任', '其他']
  },
  transfer: {
    title: '建立跨店異動', hint: '已帶入商品與差異數量，確認後會留下跨店待確認紀錄。', detailTitle: '目的店／類型',
    options: ['借出 松江店', '調撥 信義店', '借出 中山店']
  },
  receipt: {
    title: '補登收貨', hint: '已帶入商品與差異數量，確認後會建立收貨紀錄並更新庫存。', detailTitle: '補登方式',
    options: ['補登今日到貨', '無叫貨單收貨', '供應商補送']
  }
};

function openFollowupDialog(type, key) {
  const descriptor = getCountDescriptor(key);
  const entry = data.countDraft[key];
  const config = FOLLOWUP_CONFIG[type];
  if (!descriptor || !entry || !config) return;
  const comparison = getCountComparison(key, entry.baseValue);
  const recommendedBase = Math.abs(comparison.difference);
  $('#followup-type').value = type;
  $('#followup-count-key').value = key;
  $('#followup-title').textContent = config.title;
  $('#followup-product').textContent = `${descriptor.product.name}・${descriptor.area.name}`;
  $('#followup-hint').textContent = config.hint;
  $('#followup-unit').innerHTML = unitOptions(descriptor.product, entry.unit);
  $('#followup-unit').value = entry.unit;
  $('#followup-value').value = String(convertFromBase(descriptor.product, recommendedBase, entry.unit));
  $('#followup-unit').dataset.previousUnit = entry.unit;
  $('#followup-ratio').textContent = unitRatioText(descriptor.product, entry.unit);
  $('#followup-detail-title').textContent = config.detailTitle;
  $('#followup-detail').innerHTML = config.options.map(option => `<option>${escapeHTML(option)}</option>`).join('');
  const dialog = $('#followup-dialog');
  if (!dialog.open) dialog.showModal();
}

function submitFollowup(event) {
  event.preventDefault();
  const type = $('#followup-type').value;
  const key = $('#followup-count-key').value;
  const descriptor = getCountDescriptor(key);
  const entry = data.countDraft[key];
  if (!descriptor || !entry || !FOLLOWUP_CONFIG[type]) return;
  const value = Number($('#followup-value').value);
  const unit = $('#followup-unit').value;
  const baseQuantity = convertToBase(descriptor.product, value, unit);
  if (baseQuantity === null || baseQuantity < 0) {
    showToast('請輸入正確的處理數量');
    return;
  }
  const detail = $('#followup-detail').value;
  const createdAt = new Date().toISOString();
  const record = {
    id: `${type}-${Date.now()}`, productId: descriptor.product.id, countKey: key,
    quantity: value, unit, baseQuantity, detail,
    actor: MOCK_SESSION.name, createdAt
  };
  const before = Number(descriptor.product.qty);
  const direction = type === 'receipt' ? 1 : -1;
  const after = Number(Math.max(0, before + direction * baseQuantity).toFixed(3));
  descriptor.product.qty = after;
  if (type === 'discard') data.wasteRecords.unshift(record);
  if (type === 'transfer') data.transferRecords.unshift(record);
  if (type === 'receipt') data.receiptRecords.unshift(record);
  data.inventoryHistory.unshift({
    id: record.id, productId: descriptor.product.id, before, after,
    reason: COUNT_REASON_LABELS[type], detail, actor: MOCK_SESSION.name,
    createdAt, countKey: key
  });
  const historyType = type === 'discard' ? '報廢' : type === 'transfer' ? '跨店異動' : '補登收貨';
  appendProductHistory(descriptor.product.id, {
    id: record.id, type: historyType, quantity: value, unit,
    actor: MOCK_SESSION.name, createdAt, detail
  });
  markEntryConfirmed(entry, type, `${FOLLOWUP_CONFIG[type].title}：${detail}`);
  if (type === 'transfer') {
    data.issues.unshift(normalizeIssue({
      id: `transfer-task-${Date.now()}`, type: '跨店',
      note: `${descriptor.product.name} ${detail}待對方確認`,
      createdAt, resolved: false, sourceKey: key, actor: MOCK_SESSION.name,
      productId: descriptor.product.id, status: 'waiting-external'
    }));
  }
  if (after < Number(descriptor.product.safe)
    && !data.issues.some(issue => isIssueOpen(issue) && issue.sourceKey === `${key}-low`)) {
    data.issues.unshift(normalizeIssue({
      id: `low-task-${Date.now()}`, type: '缺貨／叫貨提醒',
      note: `${descriptor.product.name}目前 ${formatNumber(after)} ${descriptor.product.baseUnit}，低於安全庫存`,
      createdAt, resolved: false, sourceKey: `${key}-low`, actor: MOCK_SESSION.name,
      productId: descriptor.product.id
    }));
  }
  saveAndRender();
  $('#followup-dialog').close();
  $('#count-review-dialog').close();
  focusNextCountEntry(key);
  showToast(`${FOLLOWUP_CONFIG[type].title}已完成，相關紀錄已更新`);
}

function getInventoryReliability(product) {
  const latestCount = (data.productHistory[product.id] || [])
    .filter(entry => String(entry.type || '').includes('盤點'))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (!latestCount) return { label: '偏低', detail: '尚無近期盤點確認' };
  const ageDays = Math.max(0, (Date.now() - new Date(latestCount.createdAt).getTime()) / 86400000);
  if (ageDays <= 1) return { label: '高', detail: '24 小時內曾盤點確認' };
  if (ageDays <= 3) return { label: '中', detail: '3 天內曾盤點確認' };
  return { label: '偏低', detail: '建議先快速確認現場庫存' };
}

function getOpenPurchaseOrders(productId) {
  return data.purchaseOrders
    .filter(order => order.productId === productId && !['received', 'cancelled'].includes(order.status))
    .sort((a, b) => new Date(a.eta || 8640000000000000) - new Date(b.eta || 8640000000000000));
}

function formatEta(value) {
  if (!value) return '時間待確認';
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value));
}

function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function getLowStockAnalysis(product) {
  const current = Number(product.qty) || 0;
  const safety = Number(product.safe) || 0;
  const gap = Math.max(0, safety - current);
  const [dailyMin, dailyMax] = DAILY_USE_RANGES[product.id] || [0.5, 1];
  const daysMin = dailyMax > 0 ? current / dailyMax : 0;
  const daysMax = dailyMin > 0 ? current / dailyMin : daysMin;
  const orders = getOpenPurchaseOrders(product.id);
  const inbound = orders.reduce((total, order) => {
    const converted = convertToBase(product, order.quantity, order.unit || product.baseUnit);
    return total + (converted === null ? 0 : converted);
  }, 0);
  const earliest = orders[0] || null;
  const daysUntilEta = earliest?.eta
    ? Math.max(0, (new Date(earliest.eta).getTime() - Date.now()) / 86400000)
    : null;
  const beforeArrival = daysUntilEta === null ? current : current - dailyMax * daysUntilEta;
  const afterArrival = beforeArrival + inbound;
  const risk = current < safety && (
    !earliest || beforeArrival <= 0 || afterArrival < safety
  );
  const riskText = !earliest
    ? '目前沒有在途庫存，需確認叫貨'
    : beforeArrival <= 0
      ? '預估到貨前可能用完'
      : afterArrival < safety
        ? '到貨後仍可能低於安全庫存'
        : '在途可降低缺貨風險';
  return {
    current, safety, gap, dailyMin, dailyMax, daysMin, daysMax,
    orders, inbound, earliest, beforeArrival, afterArrival, risk, riskText,
    reliability: getInventoryReliability(product)
  };
}

function lowStockSummaryMarkup(product) {
  const analysis = getLowStockAnalysis(product);
  const expiryNote = product.expiryDate
    ? `<div class="low-expiry-note"><span>效期提醒</span><strong>${escapeHTML(expiryLabel(product))}</strong><small>效期僅作附屬提示，請先處理庫存風險。</small></div>`
    : '';
  return `
    <section class="low-risk-hero ${analysis.risk ? 'risk' : 'covered'}">
      <span>${analysis.risk ? '到貨前有風險' : '已有在途支援'}</span>
      <strong>${escapeHTML(analysis.riskText)}</strong>
      <small>系統依目前庫存、日用量區間與在途時間估算</small>
    </section>
    <div class="low-metric-grid">
      <div><span>目前庫存</span><strong>${formatNumber(analysis.current)} ${escapeHTML(product.baseUnit)}</strong></div>
      <div><span>安全庫存</span><strong>${formatNumber(analysis.safety)} ${escapeHTML(product.baseUnit)}</strong></div>
      <div><span>差距</span><strong>${analysis.gap ? `少 ${formatNumber(analysis.gap)}` : '已達標'} ${escapeHTML(product.baseUnit)}</strong></div>
      <div><span>預估可撐</span><strong>約 ${formatNumber(analysis.daysMin)}～${formatNumber(analysis.daysMax)} 天</strong></div>
    </div>
    <dl class="low-detail-list">
      <div><dt>資料可靠度</dt><dd>${escapeHTML(analysis.reliability.label)}<small>${escapeHTML(analysis.reliability.detail)}</small></dd></div>
      <div><dt>在途庫存</dt><dd>${analysis.inbound ? `${formatNumber(analysis.inbound)} ${escapeHTML(product.baseUnit)}` : '目前沒有'}</dd></div>
      <div><dt>預計到貨</dt><dd>${analysis.earliest ? escapeHTML(formatEta(analysis.earliest.eta)) : '尚未建立叫貨'}</dd></div>
      <div><dt>到貨前風險</dt><dd class="${analysis.risk ? 'danger-text' : 'green-text'}">${escapeHTML(analysis.riskText)}</dd></div>
    </dl>
    ${expiryNote}
    <div class="low-action-grid">
      <button type="button" data-low-action="confirm">快速確認庫存<span>只輸入現場數量</span></button>
      <button type="button" data-low-action="orders">查看叫貨<span>${analysis.orders.length ? `${analysis.orders.length} 筆在途` : '目前沒有在途'}</span></button>
      <button type="button" data-low-action="order-form">建立／調整叫貨<span>明確操作後才開表單</span></button>
      <button type="button" data-low-action="history">查看異動紀錄<span>核對近期發生什麼</span></button>
      <button type="button" class="manager-action" data-low-action="settings">主管設定<span>安全庫存與核准單位</span></button>
    </div>`;
}

function renderLowStockContent(step = ui.lowStockStep) {
  const product = data.products.find(item => item.id === ui.lowProductId);
  if (!product) return;
  ui.lowStockStep = step;
  $('#low-stock-product').textContent = product.name;
  $('#low-stock-meta').textContent = `${product.area}・基準單位 ${product.baseUnit}`;
  if (step === 'summary') {
    $('#low-stock-content').innerHTML = lowStockSummaryMarkup(product);
    return;
  }
  const back = '<button type="button" class="step-back" data-low-action="summary">‹ 返回庫存風險摘要</button>';
  if (step === 'confirm') {
    $('#low-stock-content').innerHTML = `${back}<form id="low-confirm-form" class="progressive-form">
      <h3>快速確認現場庫存</h3><p>只問這次需要的數量；核准換算由系統處理。</p>
      <label>現場數量<span class="count-entry-control"><input id="low-confirm-qty" type="number" min="0" step="0.01" inputmode="decimal" required><select id="low-confirm-unit">${unitOptions(product, product.baseUnit)}</select></span></label>
      <small class="unit-ratio" id="low-confirm-ratio">${escapeHTML(unitRatioText(product, product.baseUnit))}</small>
      <button class="full-button" type="submit">確認並更新庫存</button>
    </form>`;
    return;
  }
  if (step === 'orders') {
    const orders = getOpenPurchaseOrders(product.id);
    $('#low-stock-content').innerHTML = `${back}<section class="progressive-step"><h3>目前叫貨／在途</h3>
      ${orders.length ? `<div class="order-list">${orders.map(order => `<article><strong>${formatNumber(order.quantity)} ${escapeHTML(order.unit || product.baseUnit)}・${escapeHTML(order.supplier)}</strong><small>預計 ${escapeHTML(formatEta(order.eta))}</small></article>`).join('')}</div>` : '<div class="notice">目前沒有在途叫貨</div>'}
      <button type="button" class="full-button" data-low-action="order-form">建立／調整叫貨</button></section>`;
    return;
  }
  if (step === 'order-form') {
    const order = getOpenPurchaseOrders(product.id)[0];
    $('#low-stock-content').innerHTML = `${back}<form id="low-order-form" class="progressive-form">
      <h3>${order ? '調整目前叫貨' : '建立叫貨'}</h3><p>現場資料先確認，主管仍保留最後決定。</p>
      <label>叫貨數量<span class="count-entry-control"><input id="low-order-qty" type="number" min="0.01" step="0.01" inputmode="decimal" value="${order ? escapeHTML(order.quantity) : ''}" required><select id="low-order-unit">${unitOptions(product, order?.unit || product.baseUnit)}</select></span></label>
      <label>供應商<input id="low-order-supplier" value="${escapeHTML(order?.supplier || '')}" required></label>
      <label>預計到貨時間<input id="low-order-eta" type="datetime-local" value="${escapeHTML(toDateTimeLocal(order?.eta))}" required></label>
      <button class="full-button" type="submit">${order ? '儲存調整' : '建立叫貨'}</button>
    </form>`;
  }
}

function openLowStockDialog(productId) {
  const product = data.products.find(item => item.id === productId);
  if (!product) return;
  ui.lowProductId = product.id;
  ui.lowStockStep = 'summary';
  renderLowStockContent();
  const dialog = $('#low-stock-dialog');
  if (!dialog.open) dialog.showModal();
}

function handleLowStockClick(event) {
  const button = event.target.closest('[data-low-action]');
  if (!button) return;
  const action = button.dataset.lowAction;
  if (['summary', 'confirm', 'orders', 'order-form'].includes(action)) {
    renderLowStockContent(action);
    return;
  }
  if (action === 'history') {
    ui.timelineReturnLowId = ui.lowProductId;
    $('#low-stock-dialog').close();
    openTimeline(ui.lowProductId);
    return;
  }
  if (action === 'settings') {
    const productId = ui.lowProductId;
    $('#low-stock-dialog').close();
    openProductSettings(productId);
  }
}

function submitLowStockStep(event) {
  event.preventDefault();
  const product = data.products.find(item => item.id === ui.lowProductId);
  if (!product) return;
  if (event.target.id === 'low-confirm-form') {
    const value = Number($('#low-confirm-qty').value);
    const unit = $('#low-confirm-unit').value;
    const after = convertToBase(product, value, unit);
    if (after === null || after < 0) return showToast('請輸入正確的現場數量');
    const before = Number(product.qty);
    const createdAt = new Date().toISOString();
    product.qty = after;
    data.inventoryHistory.unshift({ id: `quick-confirm-${Date.now()}`, productId: product.id, before, after, reason: '快速確認庫存', actor: MOCK_SESSION.name, createdAt });
    appendProductHistory(product.id, { type: '快速盤點確認', quantity: value, unit, actor: MOCK_SESSION.name, createdAt, detail: `${formatNumber(before)} → ${formatNumber(after)} ${product.baseUnit}` });
    saveAndRender();
    renderLowStockContent('summary');
    showToast(`${product.name}現場庫存已確認`);
    return;
  }
  if (event.target.id === 'low-order-form') {
    const quantity = Number($('#low-order-qty').value);
    const unit = $('#low-order-unit').value;
    const eta = $('#low-order-eta').value;
    const supplier = $('#low-order-supplier').value.trim();
    if (!Number.isFinite(quantity) || quantity <= 0 || !eta || !supplier) return showToast('請完成叫貨資料');
    let order = getOpenPurchaseOrders(product.id)[0];
    const createdAt = new Date().toISOString();
    if (order) Object.assign(order, { quantity, unit, eta: new Date(eta).toISOString(), supplier, updatedAt: createdAt, updatedBy: MOCK_SUPERVISOR.name });
    else {
      order = normalizePurchaseOrder({ id: `po-${Date.now()}`, productId: product.id, quantity, unit, eta: new Date(eta).toISOString(), supplier, updatedAt: createdAt, updatedBy: MOCK_SUPERVISOR.name });
      data.purchaseOrders.unshift(order);
    }
    appendProductHistory(product.id, { type: '叫貨調整', quantity, unit, actor: MOCK_SUPERVISOR.name, createdAt, detail: `${supplier}・預計 ${formatEta(order.eta)}` });
    saveAndRender();
    renderLowStockContent('summary');
    showToast(`${product.name}叫貨資料已更新`);
  }
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
        <span class="inventory-qty"><strong>${product.qty}</strong> <span>${escapeHTML(product.unit)}</span><small>${status === 'expiry' ? '處理效期' : status === 'low' ? '查看風險' : '調整'} ›</small></span>
      </button>
    `;
  }).join('') || '<div class="notice">找不到符合的商品</div>';

  $$('#inventory-list [data-product-id]').forEach(button => button.addEventListener('click', () => {
    const product = data.products.find(item => item.id === button.dataset.productId);
    if (productStatus(product) === 'low') openLowStockDialog(product.id);
    else openProductDialog(product.id);
  }));
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

function isIssueOpen(issue) {
  return (issue.status || (issue.resolved ? 'resolved' : 'pending')) !== 'resolved';
}

function getIssueProduct(issue) {
  return data.products.find(product => product.id === issue.productId)
    || data.products.find(product => String(issue.note || '').includes(product.name))
    || null;
}

function recordIssueEvent(issue, detail, actor = MOCK_SESSION.name) {
  if (!Array.isArray(issue.events)) issue.events = [];
  issue.events.unshift({ id: `issue-event-${Date.now()}-${issue.events.length}`, detail, actor, createdAt: new Date().toISOString() });
}

function setIssueStatus(issue, status, detail = '') {
  if (!ISSUE_STATUS_LABELS[status]) return;
  issue.status = status;
  issue.resolved = status === 'resolved';
  if (status === 'resolved') {
    issue.resolvedAt = new Date().toISOString();
    issue.resolvedBy = MOCK_SESSION.name;
  }
  recordIssueEvent(issue, detail || `狀態更新為${ISSUE_STATUS_LABELS[status]}`);
}

function getIssueRiskAnalysis(issue, product) {
  if (!product) return { risk: true };
  const analysis = getLowStockAnalysis(product);
  if (issue.supplementStatus !== 'will' || !issue.expectedAt) return analysis;
  const supplementQuantity = Number(issue.shortageQuantity) || analysis.gap || 1;
  const supplementBase = convertToBase(product, supplementQuantity, product.baseUnit) || supplementQuantity;
  const expectedTime = new Date(issue.expectedAt).getTime();
  const currentEta = analysis.earliest?.eta ? new Date(analysis.earliest.eta).getTime() : Infinity;
  const earliestTime = Math.min(expectedTime, currentEta);
  const daysUntilEta = Math.max(0, (earliestTime - Date.now()) / 86400000);
  const inbound = analysis.inbound + supplementBase;
  const beforeArrival = analysis.current - analysis.dailyMax * daysUntilEta;
  const afterArrival = beforeArrival + inbound;
  const risk = beforeArrival <= 0 || afterArrival < analysis.safety;
  return {
    ...analysis, inbound, beforeArrival, afterArrival, risk,
    earliest: expectedTime <= currentEta ? { eta: issue.expectedAt } : analysis.earliest,
    riskText: beforeArrival <= 0 ? '預估補送前可能用完' : afterArrival < analysis.safety ? '補送後仍可能低於安全庫存' : '補送可降低缺貨風險'
  };
}

function issueRiskMarkup(issue, product) {
  if (!product) return `<section class="issue-risk-card"><span>風險判斷</span><strong>尚未連結商品</strong><small>請由主管依現場資訊處理。</small></section>`;
  const analysis = getIssueRiskAnalysis(issue, product);
  return `<section class="issue-risk-card ${analysis.risk ? 'risk' : 'covered'}">
    <span>系統風險判斷</span><strong>${analysis.risk ? '需要介入' : '暫時可等待'}</strong>
    <small>目前 ${formatNumber(analysis.current)}／安全 ${formatNumber(analysis.safety)} ${escapeHTML(product.baseUnit)}・可撐約 ${formatNumber(analysis.daysMin)}～${formatNumber(analysis.daysMax)} 天</small>
    <small>在途 ${formatNumber(analysis.inbound)} ${escapeHTML(product.baseUnit)}・${escapeHTML(analysis.earliest ? formatEta(analysis.earliest.eta) : '尚無到貨時間')}</small>
    <em>${escapeHTML(analysis.riskText)}</em>
  </section>`;
}

function renderIssueWorkflow() {
  const issue = data.issues.find(item => item.id === ui.issueId);
  if (!issue) return;
  const product = getIssueProduct(issue);
  const status = issue.status || 'pending';
  $('#issue-workflow-title').textContent = issue.note;
  $('#issue-workflow-status').textContent = `${ISSUE_STATUS_LABELS[status]}・${issue.type}・${formatTime(issue.createdAt)}`;
  const summary = `<section class="issue-summary-card"><span>${escapeHTML(issue.type)}</span><strong>${escapeHTML(issue.note)}</strong>${product ? `<small>${escapeHTML(product.name)}・目前 ${formatNumber(product.qty)} ${escapeHTML(product.baseUnit)}</small>` : ''}</section>`;
  if (status === 'resolved') {
    $('#issue-workflow-content').innerHTML = `${summary}<section class="workflow-result"><span class="status-pill resolved">已解決</span><h3>${escapeHTML(ISSUE_RESOLUTION_LABELS[issue.resolutionAction] || '處理完成')}</h3><p>${escapeHTML(issue.resolvedBy || MOCK_SESSION.name)}・${escapeHTML(formatTime(issue.resolvedAt))}</p></section>`;
    return;
  }
  if (!issue.reason) {
    $('#issue-workflow-content').innerHTML = `${summary}<section class="progressive-step"><p class="step-kicker">只問下一個必要問題</p><h3>為什麼少到？</h3><div class="answer-list">
      ${Object.entries(ISSUE_REASON_LABELS).map(([value, label]) => `<button type="button" data-issue-reason="${value}">${label}</button>`).join('')}
    </div></section>`;
    return;
  }
  const answered = `<div class="answer-recap"><span>原因</span><strong>${escapeHTML(ISSUE_REASON_LABELS[issue.reason])}</strong><button type="button" data-issue-reset="reason">修改</button></div>`;
  if (issue.reason === 'supplier-shortage' && !issue.supplementStatus) {
    $('#issue-workflow-content').innerHTML = `${summary}${answered}<section class="progressive-step"><p class="step-kicker">依剛才答案繼續</p><h3>供應商是否補送？</h3><div class="answer-list">
      <button type="button" data-issue-supplement="will">會</button><button type="button" data-issue-supplement="wont">不會</button><button type="button" data-issue-supplement="pending">待確認</button>
    </div></section>`;
    return;
  }
  const supplement = issue.supplementStatus
    ? `<div class="answer-recap"><span>補送</span><strong>${escapeHTML(ISSUE_SUPPLEMENT_LABELS[issue.supplementStatus])}</strong><button type="button" data-issue-reset="supplement">修改</button></div>` : '';
  if (issue.supplementStatus === 'will' && !issue.expectedAt) {
    $('#issue-workflow-content').innerHTML = `${summary}${answered}${supplement}<form id="issue-eta-form" class="progressive-form"><p class="step-kicker">最後一個必要問題</p><h3>預計何時補到？</h3><label>預計到貨時間<input id="issue-expected-at" type="datetime-local" required></label><button class="full-button" type="submit">儲存並判斷風險</button></form>`;
    return;
  }
  const analysis = getIssueRiskAnalysis(issue, product);
  const expected = issue.expectedAt ? `<div class="answer-recap"><span>預計補到</span><strong>${escapeHTML(formatEta(issue.expectedAt))}</strong></div>` : '';
  if (analysis.risk && !issue.resolutionAction) {
    $('#issue-workflow-content').innerHTML = `${summary}${answered}${supplement}${expected}${issueRiskMarkup(issue, product)}<section class="progressive-step risk-actions"><p class="step-kicker">只有目前有風險才需要選</p><h3>下一步怎麼處理？</h3><div class="answer-list">
      ${Object.entries(ISSUE_RESOLUTION_LABELS).map(([value, label]) => `<button type="button" data-issue-resolution="${value}">${label}</button>`).join('')}
    </div></section>`;
    return;
  }
  const resolution = issue.resolutionAction
    ? `<div class="answer-recap"><span>處理方式</span><strong>${escapeHTML(ISSUE_RESOLUTION_LABELS[issue.resolutionAction])}</strong></div>` : '';
  const waiting = issue.status === 'waiting-external';
  $('#issue-workflow-content').innerHTML = `${summary}${answered}${supplement}${expected}${issueRiskMarkup(issue, product)}${resolution}<section class="workflow-result">
    <span class="status-pill">${escapeHTML(ISSUE_STATUS_LABELS[issue.status])}</span>
    <h3>${waiting ? '等待外部回覆或到貨' : analysis.risk ? '已建立處理方式' : '現有條件暫時可支撐'}</h3>
    <p>${waiting ? '事件會持續留在待辦，不會因重新整理重複推播。' : '確認現場已完成後再結案。'}</p>
    <button type="button" class="full-button" data-issue-status="resolved">${waiting ? '外部處理已完成' : '確認已解決'}</button>
  </section>`;
}

function openIssueWorkflow(issueId) {
  const issue = data.issues.find(item => item.id === issueId);
  if (!issue) return;
  ui.issueId = issue.id;
  if ((issue.status || 'pending') === 'pending') setIssueStatus(issue, 'processing', '開始處理異常');
  saveAndRender();
  renderIssueWorkflow();
  const dialog = $('#issue-workflow-dialog');
  if (!dialog.open) dialog.showModal();
}

function handleIssueWorkflowClick(event) {
  const issue = data.issues.find(item => item.id === ui.issueId);
  if (!issue) return;
  const reason = event.target.closest('[data-issue-reason]')?.dataset.issueReason;
  const supplement = event.target.closest('[data-issue-supplement]')?.dataset.issueSupplement;
  const resolution = event.target.closest('[data-issue-resolution]')?.dataset.issueResolution;
  const reset = event.target.closest('[data-issue-reset]')?.dataset.issueReset;
  const status = event.target.closest('[data-issue-status]')?.dataset.issueStatus;
  if (reason) {
    issue.reason = reason;
    issue.supplementStatus = '';
    issue.expectedAt = '';
    issue.resolutionAction = '';
    recordIssueEvent(issue, `原因：${ISSUE_REASON_LABELS[reason]}`);
  } else if (supplement) {
    issue.supplementStatus = supplement;
    issue.expectedAt = '';
    issue.status = supplement === 'wont' ? 'processing' : 'waiting-external';
    recordIssueEvent(issue, `補送狀態：${ISSUE_SUPPLEMENT_LABELS[supplement]}`);
  } else if (resolution) {
    issue.resolutionAction = resolution;
    issue.status = resolution === 'wait' ? 'waiting-external' : 'processing';
    recordIssueEvent(issue, `處理方式：${ISSUE_RESOLUTION_LABELS[resolution]}`);
  } else if (reset === 'reason') {
    issue.reason = '';
    issue.supplementStatus = '';
    issue.expectedAt = '';
    issue.resolutionAction = '';
    issue.status = 'processing';
  } else if (reset === 'supplement') {
    issue.supplementStatus = '';
    issue.expectedAt = '';
    issue.resolutionAction = '';
    issue.status = 'processing';
  } else if (status) {
    setIssueStatus(issue, status, '現場確認異常已解決');
  } else return;
  saveAndRender();
  renderIssueWorkflow();
}

function submitIssueWorkflow(event) {
  if (event.target.id !== 'issue-eta-form') return;
  event.preventDefault();
  const issue = data.issues.find(item => item.id === ui.issueId);
  const expectedAt = $('#issue-expected-at').value;
  if (!issue || !expectedAt) return;
  issue.expectedAt = new Date(expectedAt).toISOString();
  issue.status = 'waiting-external';
  recordIssueEvent(issue, `預計補送：${formatEta(issue.expectedAt)}`);
  saveAndRender();
  renderIssueWorkflow();
}

function renderIssues() {
  data.issues = data.issues.map(normalizeIssue);
  const ordered = [...data.issues].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $('#issue-list').innerHTML = ordered.length ? ordered.map(issue => {
    const status = issue.status || 'pending';
    const action = status === 'pending' ? '處理' : status === 'processing' ? '繼續' : status === 'waiting-external' ? '更新' : '查看';
    return `<article class="issue-item ${status === 'resolved' ? 'resolved' : ''}">
      <span class="issue-state">${status === 'resolved' ? '✓' : '!'}</span>
      <span class="issue-copy"><strong>${escapeHTML(issue.note)}</strong><small>${escapeHTML(issue.type)}・${formatTime(issue.createdAt)}</small></span>
      <span class="issue-status ${status}">${escapeHTML(ISSUE_STATUS_LABELS[status])}</span>
      <button data-issue-id="${issue.id}">${action}</button>
    </article>`;
  }).join('') : '<div class="notice">目前沒有異常紀錄</div>';
  $$('[data-issue-id]').forEach(button => button.addEventListener('click', () => openIssueWorkflow(button.dataset.issueId)));
  $('#last-count-time').textContent = formatTime(data.lastCountAt);
  $('#history-count').textContent = data.inventoryHistory.length;
}

function saveAndRender() {
  refreshExpiryEvents();
  saveData();
  renderTasks();
  renderCount();
  renderInventory();
  renderHealth();
  renderIssues();
}

function pageFromLocation() {
  const page = window.location.hash.replace('#', '');
  return VALID_PAGES.includes(page) ? page : 'home';
}

function pageUrl(page) {
  const url = new URL(window.location.href);
  url.hash = page;
  return url;
}

function applyPage(page, { restoreScroll = false } = {}) {
  $$('.page').forEach(section => section.classList.toggle('active', section.dataset.page === page));
  $$('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.go === page));
  $('#page-title').textContent = PAGE_TITLES[page];
  $('#page-back').hidden = page === 'home';
  if (page === 'summary') {
    const items = ui.currentSummary.length ? ui.currentSummary
      : data.lastCountSummary.length ? data.lastCountSummary
        : data.products;
    renderSummary(items);
  }
  ui.currentPage = page;
  const top = restoreScroll ? (ui.scrollByPage[page] || 0) : 0;
  window.requestAnimationFrame(() => window.scrollTo({ top, behavior: 'auto' }));
}

function go(page, { replace = false, fromHistory = false, restoreScroll = false } = {}) {
  const destination = VALID_PAGES.includes(page) ? page : 'home';
  if (ui.currentPage) ui.scrollByPage[ui.currentPage] = window.scrollY;

  if (!fromHistory) {
    if (destination === ui.currentPage && !replace) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const currentDepth = Number(history.state?.pantryflowDepth || 0);
    const state = {
      pantryflow: true,
      pantryflowPage: destination,
      pantryflowDepth: replace ? currentDepth : currentDepth + 1
    };
    history[replace ? 'replaceState' : 'pushState'](state, '', pageUrl(destination));
  }

  applyPage(destination, { restoreScroll });
}

function initNavigation() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const initialPage = pageFromLocation();
  history.replaceState({ pantryflow: true, pantryflowPage: initialPage, pantryflowDepth: 0 }, '', pageUrl(initialPage));
  applyPage(initialPage);
  window.addEventListener('popstate', event => {
    const page = VALID_PAGES.includes(event.state?.pantryflowPage)
      ? event.state.pantryflowPage
      : pageFromLocation();
    go(page, { fromHistory: true, restoreScroll: true });
  });
}

function goBack() {
  if (ui.currentPage === 'home') return;
  if (Number(history.state?.pantryflowDepth || 0) > 0) {
    history.back();
    return;
  }
  go('home', { replace: true });
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

function classifyCountResult(product, before, after) {
  const safe = Number(product.safe) || 0;
  const differenceRatio = before > 0 ? Math.abs(after - before) / before : (after > 0 ? 1 : 0);
  if ((safe > 0 && after < safe * 0.5) || differenceRatio >= 0.5) return 'serious';
  if ((safe > 0 && after < safe) || differenceRatio >= 0.2 || productStatus({ ...product, qty: after }) === 'expiry') {
    return 'attention';
  }
  return 'normal';
}

function aggregateCountDraft() {
  return data.products.map(product => {
    const entries = getCountEntries().filter(entry => entry.product.id === product.id);
    const before = Number(product.qty);
    const after = entries.length
      ? entries.reduce((total, item) => {
        const entry = data.countDraft[countKey(item.area.id, product.id)];
        const baseValue = Number.isFinite(Number(entry?.baseValue))
          ? Number(entry.baseValue)
          : convertToBase(product, entry?.value, entry?.unit);
        return total + (Number.isFinite(baseValue) ? baseValue : 0);
      }, 0)
      : before;
    return {
      ...product,
      before,
      qty: Number(after.toFixed(2)),
      countedAreas: entries.map(entry => entry.area.name),
      countReasons: entries.map(item => data.countDraft[countKey(item.area.id, product.id)]?.reason).filter(Boolean),
      result: classifyCountResult(product, before, after)
    };
  });
}

function finishCount() {
  const progress = getCountProgress();
  if (!progress.total || progress.filled !== progress.total) return;
  const completedAt = new Date().toISOString();
  ui.currentSummary = aggregateCountDraft();
  ui.currentSummary.forEach(result => {
    const product = data.products.find(item => item.id === result.id);
    if (!product) return;
    product.qty = result.qty;
    data.inventoryHistory.unshift({
      id: `${Date.now()}-${product.id}`, productId: product.id, before: result.before, after: result.qty,
      reason: '分區盤點', createdAt: completedAt, actor: MOCK_SESSION.name
    });
    appendProductHistory(product.id, {
      type: '盤點確認', quantity: result.qty, unit: product.baseUnit,
      actor: MOCK_SESSION.name, createdAt: completedAt,
      detail: result.countedAreas.join('＋')
    });
  });
  getCountEntries().forEach(({ area, product }) => {
    const key = countKey(area.id, product.id);
    const entry = data.countDraft[key];
    if (!entry || entry.status !== 'confirmed') return;
    data.countBaselines[key] = {
      lastConfirmed: Number(entry.baseValue), receipts: 0, waste: 0,
      transfers: 0, adjustments: 0, estimated: Number(entry.baseValue)
    };
  });
  data.lastCountAt = completedAt;
  data.lastCountSummary = ui.currentSummary.map(item => ({ ...item }));
  saveData();
  renderSummary(ui.currentSummary);
  saveAndRender();
  go('summary');
}

function renderSummary(items) {
  const labels = { normal: '正常', attention: '需注意', serious: '嚴重異常' };
  const rank = { serious: 0, attention: 1, normal: 2 };
  const prepared = items.map(product => {
    const before = typeof product.before === 'number' ? product.before : Number(product.qty);
    const result = product.result || classifyCountResult(product, before, Number(product.qty));
    return { ...product, before, result };
  }).sort((a, b) => rank[a.result] - rank[b.result]);
  const counts = prepared.reduce((total, product) => {
    total[product.result] += 1;
    return total;
  }, { normal: 0, attention: 0, serious: 0 });

  $('#summary-time').textContent = data.lastCountAt ? formatTime(data.lastCountAt) : '尚未完成盤點';
  $('#summary-normal').textContent = counts.normal;
  $('#summary-attention').textContent = counts.attention;
  $('#summary-serious').textContent = counts.serious;
  $('#summary-table').innerHTML = prepared.map(product => {
    const changed = product.before !== Number(product.qty);
    const changeText = changed ? `<small>${product.before} → ${product.qty}</small>` : '';
    const areaText = Array.isArray(product.countedAreas) && product.countedAreas.length
      ? `<small class="summary-areas">${escapeHTML(product.countedAreas.join('＋'))}</small>`
      : '';
    return `<button type="button" class="summary-row ${product.result}" data-timeline-id="${product.id}">
      <span>${product.id}</span>
      <b>${escapeHTML(product.name)} <em class="result-badge ${product.result}">${labels[product.result]}</em>${areaText}${changeText}</b>
      <strong>${product.qty} ${escapeHTML(product.baseUnit || product.unit)}<small>查看紀錄 ›</small></strong>
    </button>`;
  }).join('');
  $$('[data-timeline-id]').forEach(button => button.addEventListener('click', () => openTimeline(button.dataset.timelineId)));
}

function formatTimelineTime(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const time = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  if (date.toDateString() === today.toDateString()) return `今天 ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  return new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function openTimeline(productId) {
  const product = data.products.find(item => item.id === productId);
  if (!product) return;
  const entries = [...(data.productHistory[productId] || [])]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 12);
  $('#timeline-product-name').textContent = `${product.name}｜近期紀錄`;
  $('#timeline-product-meta').textContent = `基準單位 ${product.baseUnit}・由新到舊`;
  $('#timeline-list').innerHTML = entries.length ? entries.map(entry => `
    <article class="timeline-item">
      <time>${escapeHTML(formatTimelineTime(entry.createdAt))}</time>
      <div><strong>${escapeHTML(entry.actor || '系統')}｜${escapeHTML(entry.type || '異動')} ${entry.quantity === undefined ? '' : `${formatNumber(entry.quantity)} ${escapeHTML(entry.unit || product.baseUnit)}`}</strong>
      ${entry.detail ? `<small>${escapeHTML(entry.detail)}</small>` : ''}</div>
    </article>
  `).join('') : '<div class="notice">目前沒有近期異動紀錄</div>';
  const dialog = $('#timeline-dialog');
  if (!dialog.open) dialog.showModal();
}

function openProductDialog(productId) {
  const product = data.products.find(item => item.id === productId);
  if (!product) return;
  refreshExpiryEvents();
  const expiryEvent = getCurrentExpiryEvent(product);
  const needsExpiryAction = isExpiryAttention(product);
  const pendingCorrection = getPendingExpiryCorrection(product.id);
  ui.expiryProductId = product.id;
  $('#product-id').value = product.id;
  $('#product-name').textContent = product.name;
  $('#product-meta').textContent = `${product.area}・安全庫存 ${product.safe}${product.unit}`;
  $('#product-qty').value = product.qty;
  $('#product-unit').textContent = product.unit;
  $('#product-expiry-readonly').textContent = product.expiryDate || '未設定';
  $('#product-expiry-state').textContent = `${expiryStateLabel(product)}${expiryEvent?.source ? `・建立於${expiryEvent.source}` : ''}`;
  $('#product-expiry-card').className = `expiry-readonly-card ${expiryEvent?.status || 'none'}`;
  $('#product-quantity-editor').hidden = needsExpiryAction;
  $('#save-product').hidden = needsExpiryAction;
  $('#product-expiry-actions').hidden = !product.expiryDate;
  $('#open-expiry-action').hidden = !needsExpiryAction;
  $('#expiry-correction-status').textContent = pendingCorrection
    ? `已由${pendingCorrection.requestedBy}回報，等待主管確認`
    : '有效日期不可由一般人員直接修改。';
  const dialog = $('#product-dialog');
  if (!dialog.open) dialog.showModal();
}

function submitProduct(event) {
  event.preventDefault();
  const product = data.products.find(item => item.id === $('#product-id').value);
  if (!product) return;
  if (isExpiryAttention(product)) {
    showToast('請使用效期處理動作更新這批庫存');
    return;
  }
  const before = Number(product.qty);
  const after = Number($('#product-qty').value);
  if (!Number.isFinite(after) || after < 0) {
    showToast('請輸入正確的庫存數量');
    return;
  }
  product.qty = after;
  data.inventoryHistory.unshift({
    id: `${Date.now()}-${product.id}`, productId: product.id, before, after,
    reason: '手動調整', createdAt: new Date().toISOString(), actor: MOCK_SESSION.name
  });
  appendProductHistory(product.id, {
    type: '人工調整', quantity: after, unit: product.baseUnit,
    detail: `${formatNumber(before)} → ${formatNumber(after)} ${product.baseUnit}`
  });
  saveAndRender();
  $('#product-dialog').close();
  showToast(`${product.name}庫存已更新`);
}

function getPendingExpiryCorrection(productId) {
  return data.expiryCorrections.find(item => item.productId === productId && item.status === 'pending') || null;
}

function closeProductDialog() {
  const dialog = $('#product-dialog');
  if (dialog.open) dialog.close();
}

function returnToExpiryProduct(dialogSelector) {
  const dialog = $(dialogSelector);
  if (dialog.open) dialog.close();
  if (ui.expiryProductId) openProductDialog(ui.expiryProductId);
}

function openExpiryActionDialog(productId) {
  const product = data.products.find(item => item.id === productId);
  const expiryEvent = getActiveExpiryEvent(product);
  if (!product || !expiryEvent || !isExpiryAttention(product)) {
    showToast('這項效期事件目前不需要處理');
    return;
  }
  ui.expiryProductId = product.id;
  ui.expiryAction = '';
  $('#expiry-action-product').textContent = product.name;
  $('#expiry-action-meta').textContent = `${expiryStateLabel(product)}・剩餘 ${formatNumber(product.qty)} ${product.baseUnit}`;
  $('#expiry-action-product-id').value = product.id;
  $('#expiry-action-list').hidden = false;
  $('#expiry-action-form').hidden = true;
  closeProductDialog();
  const dialog = $('#expiry-action-dialog');
  if (!dialog.open) dialog.showModal();
}

function selectExpiryAction(action) {
  const product = data.products.find(item => item.id === $('#expiry-action-product-id').value);
  if (!product || !EXPIRY_ACTION_LABELS[action]) return;
  ui.expiryAction = action;
  $('#expiry-action-type').value = action;
  $('#expiry-action-title').textContent = EXPIRY_ACTION_LABELS[action];
  $('#expiry-action-unit').textContent = product.baseUnit;
  $('#expiry-action-list').hidden = true;
  $('#expiry-action-form').hidden = false;
  const quantityField = $('#expiry-quantity-field');
  const quantityInput = $('#expiry-action-quantity');
  const reasonField = $('#expiry-reason-field');
  quantityField.hidden = action === 'used-up';
  reasonField.hidden = action !== 'discard';
  quantityInput.required = action !== 'used-up';
  quantityInput.max = action === 'partial' || action === 'discard' ? String(product.qty) : '';
  quantityInput.value = action === 'discard' ? String(product.qty) : action === 'mismatch' ? String(product.qty) : '';
  const copy = {
    'used-up': { title: '數量', hint: '確認後剩餘數量歸零，本批效期提醒會解除。' },
    partial: { title: '本次使用數量', hint: '系統會扣除本次用量，若還有剩餘就繼續提醒。' },
    discard: { title: '實際報廢數量', hint: '已帶入目前剩餘量，可依現場修改。' },
    mismatch: { title: '現場實際剩餘量', hint: '請輸入重新確認後的剩餘數量。' }
  }[action];
  $('#expiry-quantity-title').textContent = copy.title;
  $('#expiry-action-hint').textContent = copy.hint;
  if (action !== 'used-up') window.setTimeout(() => quantityInput.focus(), 0);
}

function resolveExpiryEvent(event, action, createdAt, detail = '') {
  event.status = 'resolved';
  event.resolution = action;
  event.resolutionDetail = detail;
  event.resolvedAt = createdAt;
  event.resolvedBy = MOCK_SESSION.name;
  event.updatedAt = createdAt;
}

function submitExpiryAction(event) {
  event.preventDefault();
  const product = data.products.find(item => item.id === $('#expiry-action-product-id').value);
  const action = $('#expiry-action-type').value;
  const expiryEvent = getActiveExpiryEvent(product);
  if (!product || !expiryEvent || !EXPIRY_ACTION_LABELS[action]) return;
  const before = Number(product.qty);
  const entered = action === 'used-up' ? before : Number($('#expiry-action-quantity').value);
  if (!Number.isFinite(entered) || entered < 0) {
    showToast('請輸入正確的數量');
    return;
  }
  if (['partial', 'discard'].includes(action) && (entered <= 0 || entered > before)) {
    showToast(`數量需大於 0 且不超過 ${formatNumber(before)} ${product.baseUnit}`);
    return;
  }
  if (action === 'mismatch' && entered === before) {
    showToast('重新確認的數量與目前一致，無需更新');
    return;
  }
  const after = action === 'mismatch'
    ? entered
    : Number(Math.max(0, before - entered).toFixed(3));
  const affectedQuantity = action === 'mismatch' ? Math.abs(after - before) : entered;
  const reason = action === 'discard' ? $('#expiry-action-reason').value : '';
  const createdAt = new Date().toISOString();
  const record = {
    id: `expiry-treatment-${Date.now()}`, productId: product.id, expiryEventId: expiryEvent.id,
    expiryDate: expiryEvent.expiryDate, action, actionLabel: EXPIRY_ACTION_LABELS[action],
    quantity: affectedQuantity, unit: product.baseUnit, before, after, reason,
    actor: MOCK_SESSION.name, createdAt
  };
  product.qty = after;
  data.expiryTreatments.unshift(record);
  if (action === 'discard') {
    data.wasteRecords.unshift({
      id: record.id, productId: product.id, expiryEventId: expiryEvent.id, source: '效期處理',
      quantity: entered, unit: product.baseUnit, baseQuantity: entered, detail: reason,
      actor: MOCK_SESSION.name, createdAt
    });
  }
  data.inventoryHistory.unshift({
    id: record.id, productId: product.id, before, after,
    reason: EXPIRY_ACTION_LABELS[action], detail: reason || `效期 ${expiryEvent.expiryDate}`,
    actor: MOCK_SESSION.name, createdAt, expiryEventId: expiryEvent.id
  });
  const historyType = action === 'discard' ? '效期報廢'
    : action === 'partial' ? '效期部分使用'
      : action === 'used-up' ? '效期已用完' : '效期數量更正';
  appendProductHistory(product.id, {
    id: record.id, type: historyType,
    quantity: action === 'mismatch' ? after : affectedQuantity, unit: product.baseUnit,
    actor: MOCK_SESSION.name, createdAt,
    detail: action === 'mismatch'
      ? `${formatNumber(before)} → ${formatNumber(after)} ${product.baseUnit}`
      : `${expiryEvent.expiryDate}${reason ? `・${reason}` : ''}`
  });
  if (after <= 0) resolveExpiryEvent(expiryEvent, action, createdAt, reason);
  saveAndRender();
  $('#expiry-action-dialog').close();
  showToast(`${product.name}「${EXPIRY_ACTION_LABELS[action]}」已完成`);
}

function openExpiryCorrectionDialog(productId) {
  const product = data.products.find(item => item.id === productId);
  if (!product?.expiryDate) {
    showToast('這項商品尚未建立效期');
    return;
  }
  ui.expiryProductId = product.id;
  ui.correctionProductId = product.id;
  $('#correction-product-id').value = product.id;
  $('#correction-product-name').textContent = product.name;
  $('#correction-current-date').textContent = `目前有效日期（唯讀） ${product.expiryDate}`;
  renderExpiryCorrectionState(product);
  closeProductDialog();
  const dialog = $('#expiry-correction-dialog');
  if (!dialog.open) dialog.showModal();
}

function renderExpiryCorrectionState(product) {
  const pending = getPendingExpiryCorrection(product.id);
  $('#expiry-correction-form').hidden = Boolean(pending);
  $('#expiry-correction-pending').hidden = !pending;
  if (!pending) {
    $('#expiry-correction-form').reset();
    $('#correction-product-id').value = product.id;
    return;
  }
  $('#expiry-correction-audit').innerHTML = `
    <dl>
      <div><dt>原有效日期</dt><dd>${escapeHTML(pending.originalDate)}</dd></div>
      <div><dt>建議新日期</dt><dd>${escapeHTML(pending.proposedDate)}</dd></div>
      <div><dt>更正原因</dt><dd>${escapeHTML(pending.reason)}</dd></div>
      <div><dt>回報人／時間</dt><dd>${escapeHTML(pending.requestedBy)}・${escapeHTML(formatTime(pending.requestedAt))}</dd></div>
    </dl>`;
}

function submitExpiryCorrection(event) {
  event.preventDefault();
  const product = data.products.find(item => item.id === $('#correction-product-id').value);
  if (!product?.expiryDate || getPendingExpiryCorrection(product.id)) return;
  const proposedDate = $('#correction-new-date').value;
  const reason = $('#correction-reason').value.trim();
  if (!proposedDate || !reason) return;
  if (proposedDate === product.expiryDate) {
    showToast('新日期與原日期相同，無需更正');
    return;
  }
  data.expiryCorrections.unshift({
    id: `expiry-correction-${Date.now()}`, productId: product.id,
    originalDate: product.expiryDate, proposedDate, reason,
    status: 'pending', requestedBy: MOCK_SESSION.name, requestedAt: new Date().toISOString(),
    approvedBy: '', approvedAt: ''
  });
  saveAndRender();
  renderExpiryCorrectionState(product);
  showToast('效期更正已送主管確認，目前日期未改變');
}

function approveExpiryCorrection() {
  const product = data.products.find(item => item.id === ui.correctionProductId);
  const correction = product && getPendingExpiryCorrection(product.id);
  if (!product || !correction) return;
  if (!ROLE_PERMISSIONS[MOCK_SUPERVISOR.role]?.canApproveExpiryCorrection) {
    showToast('只有主管／管理員可確認效期更正');
    return;
  }
  const correctedAt = new Date().toISOString();
  const oldEvent = getCurrentExpiryEvent(product);
  if (oldEvent) {
    oldEvent.status = 'corrected';
    oldEvent.updatedAt = correctedAt;
    oldEvent.correctionId = correction.id;
    oldEvent.correctedTo = correction.proposedDate;
  }
  product.expiryDate = correction.proposedDate;
  correction.status = 'approved';
  correction.approvedBy = MOCK_SUPERVISOR.name;
  correction.approvedAt = correctedAt;
  appendProductHistory(product.id, {
    id: correction.id, type: '效期更正', actor: MOCK_SUPERVISOR.name, createdAt: correctedAt,
    detail: `${correction.originalDate} → ${correction.proposedDate}・${correction.reason}`
  });
  saveAndRender();
  $('#expiry-correction-dialog').close();
  openProductDialog(product.id);
  showToast(`主管已確認，${product.name}效期已更正`);
}

function settingsUnitRowsMarkup(units, baseUnit) {
  return units.map(unit => `
    <div class="settings-unit-row" data-settings-unit-row>
      <label>單位<input class="settings-unit-name" value="${escapeHTML(unit.name)}" ${unit.name === baseUnit ? 'readonly' : ''} required></label>
      <label>1 單位 = 基準量<input class="settings-unit-ratio" type="number" min="0.001" step="0.001" value="${escapeHTML(unit.ratio)}" ${unit.name === baseUnit ? 'readonly' : ''} required></label>
      <button type="button" data-remove-settings-unit ${unit.name === baseUnit ? 'disabled' : ''} aria-label="移除${escapeHTML(unit.name)}">×</button>
    </div>`).join('');
}

function readSettingsUnits() {
  return [...document.querySelectorAll('[data-settings-unit-row]')].map(row => ({
    name: row.querySelector('.settings-unit-name').value.trim(),
    ratio: Number(row.querySelector('.settings-unit-ratio').value)
  })).filter(unit => unit.name);
}

function loadProductSettingsForm(productId) {
  const product = data.products.find(item => item.id === productId) || data.products[0];
  if (!product) return;
  ui.settingsProductId = product.id;
  ui.settingsBaseConversion = 1;
  $('#settings-product-select').value = product.id;
  const units = getAllowedUnits(product).map(unit => ({ ...unit }));
  $('#settings-base-unit').innerHTML = units.map(unit => `<option value="${escapeHTML(unit.name)}" ${unit.name === product.baseUnit ? 'selected' : ''}>${escapeHTML(unit.name)}</option>`).join('');
  $('#settings-safe-stock').value = product.safe;
  $('#settings-unit-rows').innerHTML = settingsUnitRowsMarkup(units, product.baseUnit);
}

function openProductSettings(productId = '') {
  if (!ROLE_PERMISSIONS[MOCK_SUPERVISOR.role]?.canManageUnitConversion) {
    showToast('只有主管／管理員可修改商品設定');
    return;
  }
  $('#settings-product-select').innerHTML = data.products.map(product => `<option value="${product.id}">${escapeHTML(product.name)}</option>`).join('');
  loadProductSettingsForm(productId || data.products[0]?.id);
  const dialog = $('#product-settings-dialog');
  if (!dialog.open) dialog.showModal();
}

function changeSettingsBase(nextBase) {
  const currentBase = document.querySelector('[data-settings-unit-row] .settings-unit-name[readonly]')?.value;
  if (!currentBase || nextBase === currentBase) return;
  const units = readSettingsUnits();
  const nextDefinition = units.find(unit => unit.name === nextBase);
  if (!nextDefinition || !Number.isFinite(nextDefinition.ratio) || nextDefinition.ratio <= 0) return;
  const conversion = nextDefinition.ratio;
  const transformed = units.map(unit => ({ name: unit.name, ratio: Number((unit.ratio / conversion).toFixed(4)) }));
  const safe = Number($('#settings-safe-stock').value);
  if (Number.isFinite(safe)) $('#settings-safe-stock').value = String(Number((safe / conversion).toFixed(3)));
  ui.settingsBaseConversion *= conversion;
  $('#settings-unit-rows').innerHTML = settingsUnitRowsMarkup(transformed, nextBase);
}

function addSettingsUnitRow() {
  $('#settings-unit-rows').insertAdjacentHTML('beforeend', `
    <div class="settings-unit-row" data-settings-unit-row>
      <label>單位<input class="settings-unit-name" placeholder="例如：袋" required></label>
      <label>1 單位 = 基準量<input class="settings-unit-ratio" type="number" min="0.001" step="0.001" placeholder="例如：2.5" required></label>
      <button type="button" data-remove-settings-unit aria-label="移除單位">×</button>
    </div>`);
  document.querySelector('#settings-unit-rows [data-settings-unit-row]:last-child .settings-unit-name')?.focus();
}

function submitProductSettings(event) {
  event.preventDefault();
  if (!ROLE_PERMISSIONS[MOCK_SUPERVISOR.role]?.canManageUnitConversion) return showToast('只有主管／管理員可修改商品設定');
  const product = data.products.find(item => item.id === ui.settingsProductId);
  if (!product) return;
  const baseUnit = $('#settings-base-unit').value;
  const safe = Number($('#settings-safe-stock').value);
  const units = readSettingsUnits();
  if (!baseUnit || !Number.isFinite(safe) || safe < 0 || units.some(unit => !unit.name || !Number.isFinite(unit.ratio) || unit.ratio <= 0)) {
    showToast('請確認安全庫存與換算比例');
    return;
  }
  if (new Set(units.map(unit => unit.name)).size !== units.length) {
    showToast('盤點單位不能重複');
    return;
  }
  const normalizedUnits = units.map(unit => ({ ...unit, ratio: unit.name === baseUnit ? 1 : unit.ratio }));
  if (!normalizedUnits.some(unit => unit.name === baseUnit)) normalizedUnits.unshift({ name: baseUnit, ratio: 1 });
  const before = { baseUnit: product.baseUnit, safe: product.safe, allowedUnits: getAllowedUnits(product).map(unit => ({ ...unit })) };
  if (ui.settingsBaseConversion !== 1) {
    const conversion = ui.settingsBaseConversion;
    product.qty = Number((Number(product.qty) / conversion).toFixed(3));
    Object.entries(data.countBaselines).forEach(([key, baseline]) => {
      if (!key.endsWith(`::${product.id}`)) return;
      ['lastConfirmed', 'receipts', 'waste', 'transfers', 'adjustments', 'estimated'].forEach(field => {
        if (Number.isFinite(Number(baseline[field]))) baseline[field] = Number((Number(baseline[field]) / conversion).toFixed(3));
      });
    });
    Object.entries(data.countDraft).forEach(([key, entry]) => {
      if (!key.endsWith(`::${product.id}`)) return;
      if (Array.isArray(entry.attempts)) entry.attempts.forEach(attempt => {
        if (Number.isFinite(Number(attempt.baseValue))) attempt.baseValue = Number((Number(attempt.baseValue) / conversion).toFixed(3));
      });
    });
  }
  product.baseUnit = baseUnit;
  product.unit = baseUnit;
  product.safe = safe;
  product.allowedUnits = normalizedUnits;
  Object.entries(data.countDraft).forEach(([key, entry]) => {
    if (!key.endsWith(`::${product.id}`) || entry.value === '') return;
    if (!normalizedUnits.some(unit => unit.name === entry.unit)) {
      const oldRatio = before.allowedUnits.find(unit => unit.name === entry.unit)?.ratio || 1;
      entry.value = String(Number((Number(entry.value) * oldRatio / ui.settingsBaseConversion).toFixed(3)));
      entry.unit = baseUnit;
    }
    entry.baseValue = convertToBase(product, entry.value, entry.unit);
  });
  const createdAt = new Date().toISOString();
  data.configurationRecords.unshift({
    id: `product-config-${Date.now()}`, productId: product.id, before,
    after: { baseUnit, safe, allowedUnits: normalizedUnits.map(unit => ({ ...unit })) },
    actor: MOCK_SUPERVISOR.name, role: MOCK_SUPERVISOR.roleLabel, createdAt
  });
  appendProductHistory(product.id, {
    type: '主管商品設定', actor: MOCK_SUPERVISOR.name, createdAt,
    detail: `基準 ${baseUnit}・安全庫存 ${formatNumber(safe)}・核准 ${normalizedUnits.map(unit => unit.name).join('、')}`
  });
  saveAndRender();
  $('#product-settings-dialog').close();
  showToast(`${product.name}主管設定已儲存`);
}

function submitIssue(event) {
  event.preventDefault();
  const note = $('#issue-note').value.trim();
  if (!note) return;
  const matchingProduct = data.products.find(product => note.includes(product.name));
  data.issues.unshift(normalizeIssue({
    id: `issue-${Date.now()}`, type: $('#issue-type').value, note,
    createdAt: new Date().toISOString(), resolved: false,
    productId: matchingProduct?.id || '', status: 'pending'
  }));
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
  ui.countAreaId = data.countAreaId;
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
  $('#page-back').addEventListener('click', goBack);
  $('#quick-issue').addEventListener('click', () => $('#issue-dialog').showModal());
  $('#quick-order').addEventListener('click', () => {
    selectFilter('low');
    go('inventory');
    showToast('已列出低庫存品項，請先確認現場數量');
  });
  $('#quick-receive').addEventListener('click', () => showToast('收貨流程將在後續 Sprint 開放'));
  $('#more-issue').addEventListener('click', () => $('#issue-dialog').showModal());
  $('#issue-form').addEventListener('submit', submitIssue);
  $('#issue-workflow-content').addEventListener('click', handleIssueWorkflowClick);
  $('#issue-workflow-content').addEventListener('submit', submitIssueWorkflow);
  $('#low-stock-content').addEventListener('click', handleLowStockClick);
  $('#low-stock-content').addEventListener('submit', submitLowStockStep);
  $('#low-stock-content').addEventListener('change', event => {
    if (event.target.id !== 'low-confirm-unit') return;
    const product = data.products.find(item => item.id === ui.lowProductId);
    if (product) $('#low-confirm-ratio').textContent = unitRatioText(product, event.target.value);
  });
  $('#product-form').addEventListener('submit', submitProduct);
  $('#open-expiry-action').addEventListener('click', () => openExpiryActionDialog($('#product-id').value));
  $('#report-expiry-error').addEventListener('click', () => openExpiryCorrectionDialog($('#product-id').value));
  $$('[data-expiry-action]').forEach(button => button.addEventListener('click', () => selectExpiryAction(button.dataset.expiryAction)));
  $('#expiry-action-form').addEventListener('submit', submitExpiryAction);
  $('#back-expiry-action').addEventListener('click', () => {
    ui.expiryAction = '';
    $('#expiry-action-list').hidden = false;
    $('#expiry-action-form').hidden = true;
  });
  $('#expiry-correction-form').addEventListener('submit', submitExpiryCorrection);
  $('#approve-expiry-correction').addEventListener('click', approveExpiryCorrection);
  $('#recount-form').addEventListener('submit', submitRecount);
  $('#followup-form').addEventListener('submit', submitFollowup);
  $('#recount-unit').addEventListener('change', event => {
    const descriptor = getCountDescriptor(ui.reviewCountKey);
    if (descriptor) $('#recount-ratio').textContent = unitRatioText(descriptor.product, event.currentTarget.value);
  });
  $('#followup-unit').addEventListener('change', event => {
    const descriptor = getCountDescriptor($('#followup-count-key').value);
    if (!descriptor) return;
    const previousUnit = event.currentTarget.dataset.previousUnit || descriptor.product.baseUnit;
    const baseValue = convertToBase(descriptor.product, $('#followup-value').value, previousUnit);
    if (baseValue !== null) $('#followup-value').value = String(convertFromBase(descriptor.product, baseValue, event.currentTarget.value));
    event.currentTarget.dataset.previousUnit = event.currentTarget.value;
    $('#followup-ratio').textContent = unitRatioText(descriptor.product, event.currentTarget.value);
  });
  $$('[data-count-reason]').forEach(button => button.addEventListener('click', () => chooseCountReason(button.dataset.countReason)));
  $('#review-timeline').addEventListener('click', () => {
    const descriptor = getCountDescriptor(ui.reviewCountKey);
    if (descriptor) openTimeline(descriptor.product.id);
  });
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
    if (!Object.keys(data.countDraft).length) {
      showToast('目前沒有盤點草稿');
      return;
    }
    if (!window.confirm('確定要清除所有區域已輸入的盤點數量嗎？')) return;
    data.countDraft = {};
    saveAndRender();
    showToast('盤點草稿已清除');
  });
  $('#export-inventory').addEventListener('click', exportInventory);
  $('#manage-product-settings').addEventListener('click', () => openProductSettings());
  $('#product-settings-form').addEventListener('submit', submitProductSettings);
  $('#settings-product-select').addEventListener('change', event => loadProductSettingsForm(event.target.value));
  $('#settings-base-unit').addEventListener('change', event => changeSettingsBase(event.target.value));
  $('#add-settings-unit').addEventListener('click', addSettingsUnitRow);
  $('#settings-unit-rows').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-settings-unit]');
    if (remove && !remove.disabled) remove.closest('[data-settings-unit-row]')?.remove();
  });
  $('#reset-demo').addEventListener('click', resetDemo);
  $('#close-issue').addEventListener('click', () => $('#issue-dialog').close());
  $('#close-issue-workflow').addEventListener('click', () => $('#issue-workflow-dialog').close());
  $('#close-low-stock').addEventListener('click', () => $('#low-stock-dialog').close());
  $('#close-product-settings').addEventListener('click', () => $('#product-settings-dialog').close());
  $('#close-product').addEventListener('click', () => $('#product-dialog').close());
  $('#close-expiry-action').addEventListener('click', () => returnToExpiryProduct('#expiry-action-dialog'));
  $('#close-expiry-correction').addEventListener('click', () => returnToExpiryProduct('#expiry-correction-dialog'));
  $('#close-review').addEventListener('click', () => $('#count-review-dialog').close());
  $('#close-followup').addEventListener('click', () => $('#followup-dialog').close());
  $('#close-timeline').addEventListener('click', () => {
    $('#timeline-dialog').close();
    if (ui.timelineReturnLowId) {
      const productId = ui.timelineReturnLowId;
      ui.timelineReturnLowId = '';
      openLowStockDialog(productId);
    }
  });
  initNavigation();
}

init();
