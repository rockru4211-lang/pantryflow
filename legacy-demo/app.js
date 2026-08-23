const STORAGE_KEY = 'pantryflow-data-v3';
const LEGACY_STORAGE_KEY = 'pantryflow-data-v2';

const DEFAULT_PRODUCTS = [
  { id: '001', name: '牛菲力', area: '冷藏庫 A', unit: 'kg', baseUnit: 'kg', allowedUnits: [{ name: 'kg', ratio: 1 }, { name: '包', ratio: 2.5 }], qty: 2, safe: 5, expiryDate: '' },
  { id: '002', name: '鮮奶油', area: '冷藏庫 A', unit: '盒', baseUnit: '盒', allowedUnits: [{ name: '盒', ratio: 1 }, { name: '箱', ratio: 12 }], qty: 2, safe: 4, expiryDate: dateOffset(0), expirySource: '收貨' },
  { id: '003', name: '帕瑪森起司', area: '冷藏庫 B', unit: '包', baseUnit: '包', allowedUnits: [{ name: '包', ratio: 1 }, { name: '箱', ratio: 6 }], qty: 7, safe: 3, expiryDate: '' },
  { id: '004', name: '雞高湯', area: '冷藏庫 B', unit: '盒', baseUnit: '盒', allowedUnits: [{ name: '盒', ratio: 1 }, { name: '箱', ratio: 8 }], qty: 4, safe: 4, expiryDate: dateOffset(0), expirySource: '製作' },
  { id: '005', name: '法國奶油', area: '冷藏庫 A', unit: '塊', baseUnit: '塊', allowedUnits: [{ name: '塊', ratio: 1 }, { name: '箱', ratio: 20 }], qty: 3, safe: 5, expiryDate: '' },
  { id: '006', name: '紅酒醬', area: '工作冰箱', unit: '盒', baseUnit: '盒', allowedUnits: [{ name: '盒', ratio: 1 }, { name: '袋', ratio: 0.5 }], qty: 4, safe: 2, expiryDate: dateOffset(0), expirySource: '店內 SOP' },
  { id: '007', name: '蘑菇', area: '冷藏庫 A', unit: 'kg', baseUnit: 'kg', allowedUnits: [{ name: 'kg', ratio: 1 }, { name: '籃', ratio: 3 }], qty: 3, safe: 3, expiryDate: '' },
  { id: '008', name: '雞蛋', area: '冷藏庫 B', unit: '盒', baseUnit: '盒', allowedUnits: [{ name: '盒', ratio: 1 }, { name: '箱', ratio: 10 }], qty: 3, safe: 3, expiryDate: '' },
  { id: '009', name: '青醬', area: '冷藏庫 A', unit: '盒', baseUnit: '盒', allowedUnits: [{ name: '盒', ratio: 1 }], qty: 1, safe: 1, expiryDate: dateOffset(0), expirySource: '店內 SOP' },
  { id: '010', name: '奶油白醬', area: '冷藏庫 A', unit: '盒', baseUnit: '盒', allowedUnits: [{ name: '盒', ratio: 1 }], qty: 1, safe: 1, expiryDate: dateOffset(2), expirySource: '店內 SOP' },
  { id: '011', name: '綜合生菜', area: '冷藏庫 A', unit: '袋', baseUnit: '袋', allowedUnits: [{ name: '袋', ratio: 1 }], qty: 2, safe: 2, expiryDate: '', expirySource: '無正式期限資料' },
  { id: '012', name: '冷凍雞高湯', area: '冷凍庫', unit: '包', baseUnit: '包', allowedUnits: [{ name: '包', ratio: 1 }], qty: 3, safe: 2, expiryDate: dateOffset(1), expirySource: '原廠效期' },
  { id: '013', name: '香草鮮奶油', area: '工作冰箱', unit: '盒', baseUnit: '盒', allowedUnits: [{ name: '盒', ratio: 1 }], qty: 1, safe: 1, expiryDate: dateOffset(1), expirySource: '店內 SOP' },
  { id: '014', name: '全脂鮮奶', area: '工作冰箱', unit: '瓶', baseUnit: '瓶', allowedUnits: [{ name: '瓶', ratio: 1 }], qty: 4, safe: 3, expiryDate: dateOffset(3) },
  { id: '015', name: '松露醬', area: '工作冰箱', unit: '罐', baseUnit: '罐', allowedUnits: [{ name: '罐', ratio: 1 }], qty: 2, safe: 1, expiryDate: '' },
  { id: '016', name: '香草奶油', area: '工作冰箱', unit: '盒', baseUnit: '盒', allowedUnits: [{ name: '盒', ratio: 1 }], qty: 3, safe: 2, expiryDate: '' },
  { id: '017', name: '冷凍薯條', area: '冷凍庫', unit: '包', baseUnit: '包', allowedUnits: [{ name: '包', ratio: 1 }], qty: 5, safe: 3, expiryDate: '' },
  { id: '018', name: '冷凍干貝', area: '冷凍庫', unit: '包', baseUnit: '包', allowedUnits: [{ name: '包', ratio: 1 }], qty: 3, safe: 2, expiryDate: '' },
  { id: '019', name: '冷凍蝦仁', area: '冷凍庫', unit: '包', baseUnit: '包', allowedUnits: [{ name: '包', ratio: 1 }], qty: 4, safe: 2, expiryDate: '' },
  { id: '020', name: '香草冰淇淋', area: '冷凍庫', unit: '桶', baseUnit: '桶', allowedUnits: [{ name: '桶', ratio: 1 }], qty: 2, safe: 1, expiryDate: '' },
  { id: '021', name: '布里歐麵包胚', area: '冷凍庫', unit: '包', baseUnit: '包', allowedUnits: [{ name: '包', ratio: 1 }], qty: 6, safe: 3, expiryDate: '' }
];

const DEFAULT_ISSUES = [
  { id: 'demo-count-difference', type: '盤點異常', note: '分區盤點差異', createdAt: dateTimeOffset(0, 12, 0), status: 'pending', resolved: false, reporter: '小陳', nextAction: '查看分區差異並回覆原因' },
  { id: 'demo-issue', type: '設備故障', note: '洗碗機不能蓄水', createdAt: dateTimeOffset(0, 10, 30), status: 'waiting-external', resolved: false, reporter: '小陳', managerAware: true, externalContacted: true, nextAction: '14:00 前若無回覆，再聯絡維修商一次', expectedAt: dateTimeOffset(0, 14, 0) }
];

const DEFAULT_PURCHASE_ORDERS = [
  { id: 'po-cream', productId: '002', quantity: 3, unit: '盒', supplier: '北區乳品', eta: dateTimeOffset(1, 11, 0), status: 'ordered', source: 'manual', formalSystemConfirmed: true, updatedAt: new Date().toISOString() },
  { id: 'po-butter', productId: '005', quantity: 1, unit: '箱', supplier: '法食供應', eta: dateTimeOffset(2, 14, 0), status: 'ordered', source: 'manual', formalSystemConfirmed: true, updatedAt: new Date().toISOString() },
  { id: 'po-eggs', productId: '008', quantity: 5, unit: '盒', supplier: '安心蛋品', eta: dateTimeOffset(1, 8, 30), status: 'ordered', source: 'manual', formalSystemConfirmed: true, updatedAt: new Date().toISOString() }
];

const STORE_BORROW_OPTIONS = {
  '002': [
    { store: '松江店', possibleQuantity: 4, unit: '盒', confirmedAt: dateTimeOffset(0, 10, 20) },
    { store: '信義店', possibleQuantity: 2, unit: '盒', confirmedAt: dateTimeOffset(-1, 21, 10) }
  ],
  '004': [{ store: '中山店', possibleQuantity: 3, unit: '盒', confirmedAt: dateTimeOffset(0, 9, 5) }],
  '007': [{ store: '松江店', possibleQuantity: 1.2, unit: 'kg', confirmedAt: dateTimeOffset(-1, 18, 40) }]
};

const DAILY_USE_RANGES = {
  '001': [0.6, 1], '002': [1.2, 1.8], '003': [0.4, 0.7], '004': [0.8, 1.2],
  '005': [0.5, 0.9], '006': [0.5, 0.8], '007': [0.6, 1], '008': [0.8, 1.3]
};

const PRODUCT_SOPS = {
  '002': { trigger: '開封', shelfLifeDays: 3, storage: '冷藏', instruction: '不同效期批次請分開記錄。' },
  '004': { trigger: '製作', shelfLifeDays: 2, storage: '冷藏', instruction: '部分處理不代表完成，剩餘數量仍需處理。', eventDate: dateOffset(-2) },
  '009': { trigger: '開封', shelfLifeDays: 2, storage: '冷藏', instruction: '不同效期批次請分開記錄。' },
  '010': { trigger: '解凍', shelfLifeDays: 3, storage: '冷藏', instruction: '解凍貼紙沿用公司既有格式，不必重複抄寫。' },
  '013': { trigger: '開封', shelfLifeDays: 3, storage: '冷藏', instruction: '此商品開封後需記錄開封日期。' }
};

const ACTION_LEVEL_LABELS = {
  employee: '員工可直接執行',
  authorized: '主管已預先授權',
  supervisor: '需要主管決定'
};

const DEFAULT_ACTION_PLANS = {
  'low-stock': {
    label: '庫存不足',
    steps: [
      { text: '先查看可能可借門市', level: 'employee' },
      { text: '無法借貨時聯絡備援供應商', level: 'authorized' },
      { text: '仍無法取得時決定是否停售', level: 'supervisor' }
    ]
  },
  expiry: {
    label: '即期／到期',
    steps: [
      { text: '優先使用並記錄實際用量', level: 'employee' },
      { text: '未使用完依店內 SOP 記錄報廢', level: 'authorized' },
      { text: '效期資訊不符時由主管核對批次', level: 'supervisor' }
    ]
  },
  equipment: {
    label: '設備異常',
    steps: [
      { text: '先完成現場通報並記錄目前狀態', level: 'employee' },
      { text: '依預定時間追蹤維修商回覆', level: 'authorized' },
      { text: '營運調整或停用設備由主管決定', level: 'supervisor' }
    ]
  }
};

const COUNT_AREAS = [
  { id: 'cold-a', name: '冷藏庫 A', productIds: ['001', '002', '005', '007', '009', '010', '011'] },
  { id: 'cold-b', name: '冷藏庫 B', productIds: ['001', '003', '004', '008'] },
  { id: 'work-fridge', name: '工作冰箱', productIds: ['002', '006', '013', '014', '015', '016'] },
  { id: 'freezer', name: '冷凍庫', productIds: ['012', '017', '018', '019', '020', '021'] },
  { id: 'work-table', name: '工作台', productIds: [] }
];

const TRIAL_COUNT_AREA_IDS = ['cold-a', 'work-fridge', 'freezer'];

const EXPIRY_INSPECTION_AREA_IDS = ['cold-a', 'work-fridge', 'freezer'];

const DEFAULT_EXPIRY_INSPECTION_ITEMS = [
  { id: 'inspection-a005', code: 'A-005', productId: '009', areaId: 'cold-a', triggerLabel: '開封', triggerAt: dateTimeOffset(-2, 11, 0), expiresAt: dateTimeOffset(0, 21, 0), deadlineSource: 'sop', state: 'active' },
  { id: 'inspection-a009', code: 'A-009', productId: '002', areaId: 'cold-a', triggerLabel: '開封', triggerAt: dateTimeOffset(-1, 14, 0), expiresAt: dateTimeOffset(1, 14, 0), deadlineSource: 'sop', state: 'active' },
  { id: 'inspection-a012', code: 'A-012', productId: '010', areaId: 'cold-a', triggerLabel: '解凍', triggerAt: dateTimeOffset(-1, 11, 0), expiresAt: dateTimeOffset(2, 11, 0), deadlineSource: 'sop', state: 'needs-confirmation' },
  { id: 'inspection-v003', code: 'V-003', productId: '011', areaId: 'cold-a', triggerLabel: '進貨', triggerAt: dateTimeOffset(-3, 9, 20), expiresAt: '', deadlineSource: 'none', state: 'needs-confirmation' },
  { id: 'inspection-w004', code: 'W-004', productId: '006', areaId: 'work-fridge', triggerLabel: '製作', triggerAt: dateTimeOffset(-2, 9, 0), expiresAt: dateTimeOffset(0, 18, 0), deadlineSource: 'sop', state: 'active' },
  { id: 'inspection-w007', code: 'W-007', productId: '013', areaId: 'work-fridge', triggerLabel: '開封', triggerAt: dateTimeOffset(-1, 10, 30), expiresAt: dateTimeOffset(1, 10, 30), deadlineSource: 'sop', state: 'active' },
  { id: 'inspection-f002', code: 'F-002', productId: '012', areaId: 'freezer', triggerLabel: '原廠標示', triggerAt: dateTimeOffset(-20, 8, 0), expiresAt: dateTimeOffset(1, 23, 59), deadlineSource: 'manufacturer', state: 'active' }
];

const DEFAULT_RISK_FOCUSES = [
  { id: 'risk-work-drawer', name: '工作台抽屜最內側', note: '容易漏看半包開封品', source: '店家自訂', areaIds: ['work-fridge', 'work-table'], enabled: true, createdAt: dateTimeOffset(-8, 9, 0) },
  { id: 'risk-cold-vegetable', name: '冷藏庫最下層蔬菜籃', note: '容易漏放未登記蔬菜', source: '公版', areaIds: ['cold-a'], enabled: true, createdAt: dateTimeOffset(-30, 9, 0) }
];

const DEFAULT_RECEIVING_REVIEWS = [
  {
    id: 'receiving-demo-1', batchNumber: '#0820-03', status: 'question', supplierCode: 'SUP-001', supplier: '北區乳品', createdAt: dateTimeOffset(0, 10, 25), photoCount: 6,
    originalPhotos: Array.from({ length: 6 }, (_, index) => ({ name: `北區乳品貨單_${index + 1}.jpg`, immutable: true })),
    aiRows: [
      { id: 'r1', productId: '002', itemCode: 'DAI-002', product: '鮮奶油 1L', specification: '1L／盒', unit: '盒', quantity: 12, unitPrice: 95, subtotal: 1140, taxRate: 0.05, expiryBatch: '2026/08/24', storage: '冷藏庫 A', confidence: 0.98 },
      { id: 'r2', productId: '014', itemCode: 'DAI-014', product: '全脂鮮奶 936ml', specification: '936ml／瓶', unit: '瓶', quantity: 6, unitPrice: 72, subtotal: 432, taxRate: 0.05, expiryBatch: '2026/08/27', storage: '工作冰箱', confidence: 0.61, questionFields: ['quantity'] }
    ], corrections: []
  },
  {
    id: 'receiving-demo-2', batchNumber: '#0820-02', status: 'pending', supplierCode: 'SUP-CK', supplier: '中央廚房', createdAt: dateTimeOffset(0, 9, 10), photoCount: 3,
    originalPhotos: [{ name: '中央廚房配送單_1.jpg', immutable: true }, { name: '中央廚房配送單_2.jpg', immutable: true }, { name: '中央廚房配送單_3.jpg', immutable: true }],
    aiRows: [{ id: 'r1', productId: '004', itemCode: 'CK-004', product: '雞高湯', specification: '2L／包', unit: '包', quantity: 6, unitPrice: '', subtotal: '', taxRate: '', expiryBatch: '2026/08/22', storage: '冷藏庫 B', confidence: 0.96 }], corrections: []
  },
  {
    id: 'receiving-demo-3', batchNumber: '#0820-01', status: 'recognizing', supplierCode: '', supplier: '供應商辨識中', createdAt: dateTimeOffset(0, 8, 35), photoCount: 2,
    originalPhotos: [{ name: '貨單照片_1.jpg', immutable: true }, { name: '貨單照片_2.jpg', immutable: true }], aiRows: [], corrections: []
  },
  {
    id: 'receiving-demo-4', batchNumber: '#0819-04', status: 'completed', supplierCode: 'SUP-008', supplier: '安心蛋品', createdAt: dateTimeOffset(-1, 16, 20), photoCount: 1,
    originalPhotos: [{ name: '安心蛋品貨單.jpg', immutable: true }],
    aiRows: [{ id: 'r1', productId: '008', itemCode: 'EGG-008', product: '雞蛋 10 入', specification: '10 顆／盒', unit: '盒', quantity: 5, unitPrice: 210, subtotal: 1050, taxRate: 0.05, expiryBatch: '', storage: '冷藏庫 B', confidence: 0.99 }], corrections: []
  }
];

const RECEIVING_STATUS_LABELS = {
  recognizing: '辨識中', pending: '待核對', question: '有疑問', completed: '已完成'
};
const RECEIVING_STATUS_ORDER = ['question', 'pending', 'recognizing', 'completed'];

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
  staff: { canCount: true, canChooseAllowedUnit: false, canManageUnitConversion: false, canApproveExpiryCorrection: false },
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
  'input-error': '看錯／輸入錯誤',
  misplaced: '漏盤／盤錯區',
  discard: '廢棄未登記',
  transfer: '借貸未登記',
  receipt: '收貨未入帳',
  other: '其他原因'
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

const ISSUE_RESOLUTION_LABELS = {
  borrow: '跨店借貨', 'alternate-supplier': '其他供應商補叫', wait: '先等待', other: '其他處理'
};

const VALID_PAGES = ['home', 'count', 'expiry-inspection', 'receiving', 'receiving-review', 'count-discrepancies', 'inventory', 'summary', 'activity', 'notifications', 'more'];
const PAGE_TITLES = {
  home: 'BeApe', count: '快速盤點', 'expiry-inspection': '效期巡檢', receiving: '進貨',
  'receiving-review': '進貨管理', 'count-discrepancies': '盤點差異管理', inventory: '庫存狀態', summary: '盤點完成', activity: '作業紀錄', notifications: '通知', more: '我的'
};

let data = loadData();
const pilot = {
  cloud: false,
  profile: null,
  catalog: null,
  countSession: null,
  countSessionPromise: null,
  countDiscrepancies: [],
  countReport: { session: null, entries: [] },
  importSheetRows: [],
  importHeaders: [],
  importPreparedRows: [],
  draftTimers: new Map()
};
const ui = {
  filter: 'all',
  currentSummary: [],
  toastTimer: null,
  currentPage: '',
  countAreaId: TRIAL_COUNT_AREA_IDS.includes(data.countAreaId) ? data.countAreaId : TRIAL_COUNT_AREA_IDS[0],
  countView: 'areas',
  summaryStage: 'complete',
  scrollByPage: {},
  reviewCountKey: '',
  timelineReturnKey: '',
  timelineReturnLowId: '',
  expiryProductId: '',
  expiryAction: '',
  correctionProductId: '',
  lowProductId: '',
  lowStockStep: 'summary',
  lowDiscrepancyId: '',
  issueId: '',
  settingsProductId: '',
  settingsBaseConversion: 1,
  settingsPlanEvent: 'low-stock',
  expiryInspectionAreaId: data.expiryInspectionAreaId || EXPIRY_INSPECTION_AREA_IDS[0],
  expiryInspectionItemId: '',
  expiryReturnPage: '',
  receivingPhotos: [],
  receiptRoutingMode: 'separate',
  receivingStep: 'method',
  receivingCompleteBatch: null,
  receivingReviewId: '',
  showAllReceivingReviews: false,
  receiptFilters: { store: '', date: '', supplier: '', status: '' }
};
const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);

const PILOT_ZONE_IDS = {
  'cold-a': '30000000-0000-4000-8000-000000000001',
  'work-fridge': '30000000-0000-4000-8000-000000000002',
  freezer: '30000000-0000-4000-8000-000000000003',
  'dry-area': '30000000-0000-4000-8000-000000000004'
};

function pilotProductId(localProductId) {
  const number = Number(localProductId);
  return Number.isInteger(number) && number > 0
    ? `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`
    : localProductId;
}

function localProductId(cloudProductId) {
  const match = String(cloudProductId || '').match(/(\d{12})$/);
  return match ? String(Number(match[1])).padStart(3, '0') : cloudProductId;
}

function localZoneId(cloudZoneId) {
  return Object.entries(PILOT_ZONE_IDS).find(([, id]) => id === cloudZoneId)?.[0] || cloudZoneId;
}

function pilotActorName() {
  return pilot.profile?.display_name || MOCK_SESSION.name;
}

function pilotCanReview() {
  return !pilot.cloud || ['ADMIN', 'SUPERVISOR'].includes(pilot.profile?.role);
}

function renderPilotConnection() {
  const sync = $('#pilot-sync-status');
  const title = $('#pilot-account-title');
  const copy = $('#pilot-account-copy');
  const signOut = $('#pilot-sign-out');
  if (!sync) return;
  $$('[data-pilot-admin-only]').forEach(element => {
    element.hidden = Boolean(pilot.cloud && pilot.profile?.role !== 'ADMIN');
  });
  $$('[data-pilot-supervisor-only]').forEach(element => {
    element.hidden = Boolean(pilot.cloud && !['ADMIN', 'SUPERVISOR'].includes(pilot.profile?.role));
  });
  $$('[data-pilot-local-only]').forEach(element => {
    element.hidden = Boolean(pilot.cloud);
  });
  $$('.optional-home-section').forEach(element => { element.hidden = Boolean(pilot.cloud); });
  if (pilot.cloud && pilot.profile) {
    const store = window.PantryBackend.currentStore;
    sync.textContent = '雲端同步';
    sync.className = 'pilot-sync-status online';
    title.textContent = `${pilot.profile.display_name}・${pilot.profile.is_owner ? 'OWNER' : pilot.profile.role}`;
    copy.textContent = `${store?.name || '尚未選擇門市'} 共用資料・所有正式操作保留操作者與時間。`;
    $('#page-title').textContent = store?.name || 'PantryFlow';
    $('#count-area-overview .eyebrow').textContent = store?.name || '尚未選擇門市';
    signOut.hidden = false;
  } else {
    sync.textContent = '本機測試';
    sync.className = 'pilot-sync-status fallback';
    title.textContent = 'BeApe 本機測試模式';
    copy.textContent = '尚未填入 Supabase 設定；資料只保留在這台裝置，不代表正式跨裝置同步。';
    signOut.hidden = true;
  }
}

async function continueAfterCloudAuth(profile) {
  pilot.cloud = true;
  pilot.profile = profile || window.PantryBackend.profile;
  const stores = await window.PantryBackend.loadMyStores();
  if (window.PantryBackend.currentStore) return activateCloudPilot(profile);
  if (stores.length === 1) {
    await window.PantryBackend.selectStore(stores[0].id);
    return activateCloudPilot(profile);
  }
  renderPilotStorePicker(stores);
}

function renderPilotStorePicker(stores) {
  $('#pilot-login').hidden = true;
  $('#pilot-onboarding').hidden = true;
  $('.app-shell').hidden = true;
  $('#pilot-store-picker').hidden = false;
  const list = $('#pilot-store-picker-list');
  list.innerHTML = stores.map(store => `<button class="pilot-store-choice" type="button" data-pilot-store-id="${escapeHTML(store.id)}"><strong>${escapeHTML(store.name)}</strong><small>${escapeHTML(store.store_code)}・${escapeHTML(store.membership?.role || '')}</small></button>`).join('');
  $('#pilot-first-store-form').hidden = stores.length > 0 || pilot.profile?.role !== 'ADMIN';
  $('#pilot-store-picker-error').textContent = stores.length || pilot.profile?.role === 'ADMIN' ? '' : '此帳號尚未被指派到可用門市，請聯絡商家 ADMIN。';
}

async function choosePilotStore(storeId) {
  $('#pilot-store-picker-error').textContent = '';
  try {
    await window.PantryBackend.selectStore(storeId);
    $('#pilot-store-picker').hidden = true;
    await activateCloudPilot(window.PantryBackend.profile);
    go('home', { replace: true });
  } catch (error) {
    $('#pilot-store-picker-error').textContent = pilotBackendErrorMessage(error);
  }
}

async function initializePilotBackend() {
  try {
    const state = await window.PantryBackend.init();
    if (state.recoveryMode) {
      showAuthView('update');
      return;
    }
    if (state.mode === 'cloud' && !state.authenticated) {
      $('#pilot-login').hidden = false;
      $('.app-shell').hidden = true;
      return;
    }
    if (state.mode === 'cloud' && !state.profile?.organization_id) {
      showOnboarding();
      return;
    }
    if (state.mode === 'cloud') await continueAfterCloudAuth(state.profile);
    renderPilotConnection();
  } catch (error) {
    console.error('Pilot backend initialization failed.', error);
    $('#pilot-login-error').textContent = pilotBackendErrorMessage(error);
    $('#pilot-retry-load').hidden = false;
    $('#pilot-login').hidden = false;
    $('.app-shell').hidden = true;
  }
}

function pilotBackendErrorMessage(error) {
  const message = String(error?.message || '');
  if (/CLOUD_CONFIG_REQUIRED/i.test(message)) return '此版本只允許正式 Supabase 雲端模式；目前缺少公開連線設定，已停止載入。';
  if (/INVALID_STAFF_CREDENTIALS|INVALID_LOGIN_INPUT/i.test(message)) return '門市、員工識別或 PIN 不正確。';
  if (/PIN_LOCKED/i.test(message)) return 'PIN 已連續輸入錯誤 5 次，請等待 15 分鐘或請主管重設。';
  if (/STORE_ALREADY_EXISTS/i.test(message)) return '門市代碼已存在，請使用另一個代碼。';
  if (/OWNER_EMAIL_NOT_VERIFIED/i.test(message)) return '請先完成 Email 驗證，再建立商家。';
  if (/OWNER_ALREADY_ONBOARDED/i.test(message)) return '此 Owner 帳號已建立商家，請直接登入。';
  if (/OWNER_REGISTRATION_REQUIRED/i.test(message)) return '此帳號不是由「建立商家帳號」流程建立，無法註冊 Owner。';
  if (/OWNER_BUSINESS_NAME_REQUIRED|OWNER_BUSINESS_TYPE_INVALID|OWNER_STORE_CODE_INVALID|OWNER_LOGIN_MODE_INVALID/i.test(message)) return '請確認商家、門市與員工登入設定完整且格式正確。';
  if (/PILOT_STORE_REQUIRED|PILOT_STORE_ACCESS_DENIED/i.test(message)) return '此帳號尚未選擇或無權存取這間門市。';
  if (/EMPLOYEE_NUMBER_REQUIRED/i.test(message)) return '這間門市使用員工編號登入，請填寫員工編號。';
  if (/INVALID_STAFF_INPUT|INVALID_PIN_RESET_INPUT/i.test(message)) return '請確認員工資料完整，PIN 必須是 6 位數字。';
  if (/SUPERVISOR_REQUIRED|ADMIN_REQUIRED|ROLE_NOT_ALLOWED|STORE_MANAGER_REQUIRED/i.test(message)) return '目前帳號沒有管理這間門市的權限。';
  if (/relationship|schema cache|PGRST200/i.test(message)) return '盤點資料關聯尚未就緒，請按「重新載入資料」再試一次。';
  if (/failed to fetch|network|timeout/i.test(message)) return '目前無法連線到 PantryFlow，請確認網路後重新載入。';
  if (/jwt|session|unauthorized/i.test(message)) return '登入狀態已失效，請重新登入。';
  return 'PantryFlow 暫時無法載入正式資料，請稍後重新載入；若持續發生請聯絡管理員。';
}

async function activateCloudPilot(profile) {
  pilot.cloud = true;
  pilot.profile = profile || window.PantryBackend.profile;
  pilot.catalog = await window.PantryBackend.loadCatalog();
  applyCloudCatalog();
  pilot.countSession = await window.PantryBackend.getActiveCountSession();
  data.receivingReviews = [];
  if (pilot.countSession) await hydrateCloudCountState();
  else {
    data.countDraft = {};
    data.countCompletedAreas = {};
  }
  await refreshCloudReceiptBatches();
  if (pilot.profile?.role === 'ADMIN') await refreshCountDiscrepancies();
  $('#pilot-login').hidden = true;
  $('#pilot-onboarding').hidden = true;
  $('#pilot-store-picker').hidden = true;
  $('.app-shell').hidden = false;
  saveAndRender();
  renderPilotConnection();
}

function applyCloudCatalog() {
  if (!pilot.catalog) return;
  const previousProducts = new Map(data.products.map(product => [product.id, product]));
  data.products = pilot.catalog.products.map(product => {
    const localId = localProductId(product.id);
    const previous = previousProducts.get(localId) || {};
    return normalizeProduct({
      ...previous,
      id: localId,
      cloudId: product.id,
      productCode: product.product_code,
      name: product.name,
      specification: product.specification || '',
      category: product.category,
      unit: product.count_unit,
      baseUnit: product.base_unit,
      allowedUnits: [{ name: product.count_unit, ratio: 1 }],
      isActive: product.is_active
    });
  });
  const zoneProducts = pilot.catalog.zoneProducts.reduce((map, item) => {
    const products = map.get(item.zone_id) || [];
    products.push({ id: localProductId(item.product_id), sortOrder: item.sort_order });
    map.set(item.zone_id, products);
    return map;
  }, new Map());
  const zones = pilot.catalog.zones.map(zone => {
    const localId = localZoneId(zone.id);
    PILOT_ZONE_IDS[localId] = zone.id;
    return {
      id: localId,
      name: zone.name,
      productIds: (zoneProducts.get(zone.id) || []).sort((a, b) => a.sortOrder - b.sortOrder).map(item => item.id)
    };
  });
  COUNT_AREAS.splice(0, COUNT_AREAS.length, ...zones);
  TRIAL_COUNT_AREA_IDS.splice(0, TRIAL_COUNT_AREA_IDS.length, ...zones.map(zone => zone.id));
  if (!TRIAL_COUNT_AREA_IDS.includes(ui.countAreaId)) ui.countAreaId = TRIAL_COUNT_AREA_IDS[0];
}

function showAuthView(view) {
  $('#pilot-login').hidden = false;
  $('#pilot-onboarding').hidden = true;
  $('.app-shell').hidden = true;
  $('#pilot-login-form').hidden = view !== 'login';
  $('#pilot-owner-signup-form').hidden = view !== 'owner-signup';
  $('#pilot-staff-login-form').hidden = view !== 'staff';
  $('#pilot-forgot-form').hidden = view !== 'forgot';
  $('#pilot-update-password-form').hidden = view !== 'update';
  $('#show-login').classList.toggle('active', view === 'login');
  $('#show-staff-login').classList.toggle('active', view === 'staff');
  $('.pilot-auth-tabs').hidden = ['forgot', 'update', 'owner-signup'].includes(view);
}

function showOnboarding() {
  $('#pilot-login').hidden = true;
  $('#pilot-onboarding').hidden = false;
  $('.app-shell').hidden = true;
}

async function refreshPilotCatalog() {
  pilot.catalog = await window.PantryBackend.loadCatalog();
  applyCloudCatalog();
  saveAndRender();
}

async function openPilotCatalog() {
  if (!pilot.cloud || pilot.profile?.role !== 'ADMIN') return;
  pilot.catalogSettings = await window.PantryBackend.loadCatalogSettings();
  renderPilotCatalog();
  $('#pilot-catalog-dialog').showModal();
}

async function openPilotAccess() {
  if (!pilot.cloud || !['ADMIN', 'SUPERVISOR'].includes(pilot.profile?.role)) return;
  const settings = await window.PantryBackend.loadAccessSettings();
  const storeSelect = $('#pilot-staff-store');
  storeSelect.innerHTML = settings.stores.filter(store => store.is_active).map(store =>
    `<option value="${store.id}" data-login-mode="${store.staff_login_mode}">${escapeHTML(store.name)}（${escapeHTML(store.store_code)}）</option>`
  ).join('');
  const identityMap = new Map(settings.identities.map(identity => [identity.user_id, identity]));
  $('#pilot-staff-list').innerHTML = settings.memberships.map(membership => {
    const identity = identityMap.get(membership.user_id);
    if (!identity) return '';
    return `<article><strong>${escapeHTML(identity.display_name)}</strong><small>${escapeHTML(identity.nickname || identity.employee_number || '')}・${membership.role}・${membership.is_active ? '啟用' : '停用'}</small>${membership.is_active ? `<input type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="新 6 位 PIN" data-reset-pin-input="${membership.user_id}"><button type="button" data-reset-staff-pin="${membership.user_id}">重設 PIN</button><button type="button" data-disable-staff="${membership.user_id}">停用</button>` : ''}</article>`;
  }).join('') || '<p>尚未建立員工。</p>';
  if (!$('#pilot-access-dialog').open) $('#pilot-access-dialog').showModal();
}

async function runAccessAction(action, successMessage) {
  const message = $('#pilot-access-message');
  message.textContent = '正在寫入正式 Supabase…';
  try {
    await action();
    message.textContent = successMessage;
    await openPilotAccess();
  } catch (error) {
    console.error('Pilot access action failed.', error);
    message.textContent = pilotBackendErrorMessage(error);
  }
}

function renderPilotCatalog() {
  const catalog = pilot.catalogSettings;
  if (!catalog) return;
  $('#pilot-zone-list').innerHTML = catalog.zones.map(zone => `<article data-zone-row="${zone.id}"><input value="${escapeHTML(zone.name)}" aria-label="區域名稱"><input type="number" value="${zone.sort_order}" aria-label="排序"><label><input type="checkbox" ${zone.is_active ? 'checked' : ''}>啟用</label><button type="button" data-save-zone="${zone.id}">儲存</button></article>`).join('') || '<p>尚未建立區域。</p>';
  $('#pilot-product-list').innerHTML = catalog.products.map(product => `<article><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.product_code)}・${escapeHTML(product.count_unit)}</small></article>`).join('') || '<p>尚未建立商品。</p>';
  $('#pilot-map-zone').innerHTML = catalog.zones.filter(zone => zone.is_active).map(zone => `<option value="${zone.id}">${escapeHTML(zone.name)}</option>`).join('');
  $('#pilot-product-supplier').innerHTML = '<option value="">未指定</option>' + catalog.suppliers.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
  const latestEventByLot = new Map();
  (catalog.lotEvents || []).forEach(event => { if (!latestEventByLot.has(event.lot_id)) latestEventByLot.set(event.lot_id, event); });
  const lots = catalog.lots || [];
  $('#pilot-lot-select').innerHTML = lots.map(lot => `<option value="${lot.id}">${escapeHTML(lot.products?.product_code || '')}・${escapeHTML(lot.products?.name || '')}・${escapeHTML(lot.lot_code || '未填批號')}</option>`).join('') || '<option value="">尚無正式收貨批次</option>';
  $('#pilot-lot-list').innerHTML = lots.map(lot => {
    const event = latestEventByLot.get(lot.id);
    const state = { ORIGINAL_EXPIRY: '原廠效期', THAWED_UNOPENED: '解凍未開封', OPENED: '已開封' }[event?.preservation_state] || '原廠效期';
    return `<article><strong>${escapeHTML(lot.products?.name || '')}・${escapeHTML(state)}</strong><small>${escapeHTML(lot.store_name)}・批號／效期 ${escapeHTML(lot.lot_code || lot.original_expiry_date || '未填')}・${escapeHTML(event?.occurred_on || '')}</small></article>`;
  }).join('') || '<p>完成正式收貨後會建立不可覆蓋的批次。</p>';
  $('#pilot-lot-date').value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  renderPilotProductChoices();
  $$('[data-save-zone]').forEach(button => button.addEventListener('click', async () => {
    const row = button.closest('[data-zone-row]');
    await runCatalogAction(() => window.PantryBackend.updateZone(button.dataset.saveZone, { name: row.querySelector('input').value, sortOrder: Number(row.querySelector('input[type="number"]').value), isActive: row.querySelector('input[type="checkbox"]').checked }));
  }));
}

const CATALOG_IMPORT_FIELDS = [
  ['name', '商品名稱 *', ['商品名稱', '品名', 'name']],
  ['product_code', '物料碼', ['物料碼', '商品編碼', 'sku', 'product_code']],
  ['specification', '規格', ['規格', 'specification']],
  ['category', '分類', ['分類', 'category']],
  ['base_unit', '基準單位 *', ['基準單位', '基本單位', 'base_unit']],
  ['count_unit', '盤點單位 *', ['盤點單位', '單位', 'count_unit']],
  ['supplier_code', '供應商編碼', ['供應商編碼', 'supplier_code']]
];

async function prepareCatalogImport(file) {
  if (!window.ExcelJS) throw new Error('Excel 元件尚未載入，請確認網路後重試');
  const workbook = new window.ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new Error('Excel 第一個工作表沒有可匯入資料');
  pilot.importHeaders = (sheet.getRow(1).values || []).slice(1).map(value => String(value ?? '').trim());
  pilot.importSheetRows = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const values = (row.values || []).slice(1).map(value => value?.text ?? value?.result ?? value ?? '');
    if (values.some(value => String(value).trim())) pilot.importSheetRows.push({ sourceRow: index, values });
  });
  const options = `<option value="">不匯入</option>${pilot.importHeaders.map((header, index) => `<option value="${index}">${escapeHTML(header || `欄 ${index + 1}`)}</option>`).join('')}`;
  $('#pilot-import-mapping').innerHTML = CATALOG_IMPORT_FIELDS.map(([field, label, aliases]) => {
    const guessed = pilot.importHeaders.findIndex(header => aliases.some(alias => header.toLowerCase() === alias.toLowerCase()));
    return `<label>${label}<select data-import-field="${field}">${options}</select></label>`;
  }).join('');
  CATALOG_IMPORT_FIELDS.forEach(([field, , aliases]) => {
    const select = document.querySelector(`[data-import-field="${field}"]`);
    const guessed = pilot.importHeaders.findIndex(header => aliases.some(alias => header.toLowerCase() === alias.toLowerCase()));
    select.value = guessed >= 0 ? String(guessed) : '';
  });
  $('#pilot-import-mapping').hidden = false;
  $$('[data-import-field]').forEach(select => select.addEventListener('change', renderCatalogImportPreview));
  renderCatalogImportPreview();
}

function renderCatalogImportPreview() {
  const mapping = Object.fromEntries([...$$('[data-import-field]')].map(select => [select.dataset.importField, select.value === '' ? null : Number(select.value)]));
  const existingCodes = new Set((pilot.catalogSettings?.products || []).map(product => String(product.product_code || '').trim().toLowerCase()).filter(Boolean));
  const existingNames = new Set((pilot.catalogSettings?.products || []).map(product => `${String(product.name).trim().toLowerCase()}::${String(product.specification || '').trim().toLowerCase()}`));
  const fileKeys = new Set();
  pilot.importPreparedRows = pilot.importSheetRows.map(source => {
    const row = Object.fromEntries(CATALOG_IMPORT_FIELDS.map(([field]) => [field, mapping[field] === null ? '' : String(source.values[mapping[field]] ?? '').trim()]));
    const errors = [];
    if (!row.name) errors.push('缺商品名稱');
    if (!row.base_unit) errors.push('缺基準單位');
    if (!row.count_unit) errors.push('缺盤點單位');
    const key = row.product_code ? `code:${row.product_code.toLowerCase()}` : `name:${row.name.toLowerCase()}::${row.specification.toLowerCase()}`;
    const duplicate = (row.product_code && existingCodes.has(row.product_code.toLowerCase())) || existingNames.has(`${row.name.toLowerCase()}::${row.specification.toLowerCase()}`) || fileKeys.has(key);
    if (duplicate) errors.push('重複資料');
    fileKeys.add(key);
    return { ...row, category: row.category || '其他', sourceRow: source.sourceRow, errors };
  });
  const valid = pilot.importPreparedRows.filter(row => !row.errors.length);
  $('#pilot-import-preview').innerHTML = `<p><strong>${pilot.importPreparedRows.length}</strong> 列・可匯入 <strong>${valid.length}</strong>・需處理 <strong>${pilot.importPreparedRows.length - valid.length}</strong></p>${pilot.importPreparedRows.slice(0, 50).map(row => `<article class="${row.errors.length ? 'import-error' : 'import-ready'}"><strong>第 ${row.sourceRow} 列・${escapeHTML(row.name || '未命名')}</strong><small>${escapeHTML(row.product_code || '自動編碼')}・${row.errors.length ? escapeHTML(row.errors.join('、')) : '通過預檢'}</small></article>`).join('')}`;
  $('#pilot-import-products').hidden = !valid.length;
}

async function commitCatalogImport() {
  const rows = pilot.importPreparedRows.filter(row => !row.errors.length).map(({ sourceRow, errors, ...row }) => row);
  if (!rows.length) return;
  const results = await window.PantryBackend.importCatalogProducts(rows);
  const counts = results.reduce((map, result) => ((map[result.status] = (map[result.status] || 0) + 1), map), {});
  pilot.importPreparedRows = [];
  pilot.importSheetRows = [];
  $('#pilot-import-mapping').hidden = true;
  $('#pilot-import-products').hidden = true;
  $('#pilot-import-preview').innerHTML = `<p>正式匯入：${counts.IMPORTED || 0}；重複略過：${counts.DUPLICATE || 0}；錯誤：${counts.ERROR || 0}</p>`;
  pilot.catalogSettings = await window.PantryBackend.loadCatalogSettings();
  renderPilotCatalog();
  await refreshPilotCatalog();
}

function renderPilotProductChoices() {
  const catalog = pilot.catalogSettings;
  const zoneId = $('#pilot-map-zone').value;
  const query = $('#pilot-map-search').value.trim().toLowerCase();
  const linked = new Set(catalog.zoneProducts.filter(item => item.zone_id === zoneId).map(item => item.product_id));
  $('#pilot-map-products').innerHTML = catalog.products.filter(product => product.is_active && !linked.has(product.id) && `${product.name} ${product.product_code}`.toLowerCase().includes(query)).map(product => `<label><input type="checkbox" name="pilot-map-product" value="${product.id}"><span><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.product_code)}・${escapeHTML(product.count_unit)}</small></span></label>`).join('') || '<p>沒有可加入的商品。</p>';
}

async function runCatalogAction(action) {
  const message = $('#pilot-catalog-message');
  message.textContent = '儲存中…';
  try {
    await action();
    pilot.catalogSettings = await window.PantryBackend.loadCatalogSettings();
    renderPilotCatalog();
    await refreshPilotCatalog();
    message.textContent = '已儲存至 Supabase';
  } catch (error) { message.textContent = error.message; }
}

async function ensurePilotCountSession() {
  if (!pilot.cloud) return null;
  if (pilot.countSession) return pilot.countSession;
  if (pilot.countSessionPromise) return pilot.countSessionPromise;
  const snapshot = {
    created_at: new Date().toISOString(),
    zones: COUNT_AREAS.filter(area => TRIAL_COUNT_AREA_IDS.includes(area.id)).map(area => ({
      id: PILOT_ZONE_IDS[area.id], local_id: area.id, name: area.name,
      products: area.productIds.map(productId => {
        const product = data.products.find(item => item.id === productId);
        return product ? { id: pilotProductId(product.id), local_id: product.id, name: product.name, unit: product.baseUnit } : null;
      }).filter(Boolean)
    }))
  };
  pilot.countSessionPromise = window.PantryBackend.createCountSession(snapshot).then(session => {
    pilot.countSession = session;
    return session;
  }).finally(() => { pilot.countSessionPromise = null; });
  return pilot.countSessionPromise;
}

async function hydrateCloudCountState() {
  const state = await window.PantryBackend.loadCountState(pilot.countSession.id);
  data.countDraft = {};
  data.countCompletedAreas = {};
  state.drafts.forEach(draft => {
    const zoneId = localZoneId(draft.zone_id);
    const productId = localProductId(draft.product_id);
    const key = countKey(zoneId, productId);
    const descriptor = getCountDescriptor(key);
    if (!descriptor) return;
    const entry = getOrCreateCountEntry(zoneId, productId);
    entry.value = draft.observation_state === 'BLANK' ? '' : String(draft.quantity);
    entry.touched = true;
    entry.unit = draft.unit;
    entry.baseValue = draft.observation_state === 'BLANK' ? null : Number(draft.quantity);
    entry.status = 'draft';
  });
  state.entries.forEach(cloudEntry => {
    const zoneId = localZoneId(cloudEntry.zone_id);
    const productId = localProductId(cloudEntry.product_id);
    const key = countKey(zoneId, productId);
    const descriptor = getCountDescriptor(key);
    if (!descriptor) return;
    const entry = getOrCreateCountEntry(zoneId, productId);
    if (cloudEntry.entry_type === 'INITIAL_COUNT') {
      entry.value = cloudEntry.observation_state === 'BLANK' ? '' : String(cloudEntry.quantity);
      entry.touched = true;
      entry.unit = cloudEntry.unit;
      entry.baseValue = cloudEntry.observation_state === 'BLANK' ? null : Number(cloudEntry.quantity);
      entry.firstValue = cloudEntry.observation_state === 'BLANK' ? null : Number(cloudEntry.quantity);
      entry.firstUnit = cloudEntry.unit;
      entry.firstBaseValue = cloudEntry.observation_state === 'BLANK' ? null : Number(cloudEntry.quantity);
      entry.firstRecordedAt = cloudEntry.entered_at;
      entry.cloudInitialEntryId = cloudEntry.id;
      const comparison = entry.firstBaseValue === null ? null : getCountComparison(key, entry.firstBaseValue);
      entry.status = !comparison || Math.abs(comparison.difference) > 0.0009 ? 'needs-reason' : 'confirmed';
    } else {
      entry.attempts.push({
        id: cloudEntry.id,
        type: cloudEntry.entry_type === 'RECOUNT' ? '複盤' : '更正實盤',
        value: Number(cloudEntry.quantity), unit: cloudEntry.unit,
        baseValue: Number(cloudEntry.quantity), actor: pilotActorName(), createdAt: cloudEntry.entered_at,
        area: descriptor.area.name
      });
      entry.status = 'confirmed';
      entry.cloudFinalEntryId = cloudEntry.id;
    }
  });
  state.progress.filter(item => item.status === 'COMPLETED').forEach(item => {
    data.countCompletedAreas[localZoneId(item.zone_id)] = item.completed_at;
  });
  data.countSessionStartedAt = pilot.countSession.started_at;
  ui.currentSummary = aggregateCountDraft();
}

function queueCloudCountDraft(key) {
  if (!pilot.cloud) return;
  window.clearTimeout(pilot.draftTimers.get(key));
  pilot.draftTimers.set(key, window.setTimeout(async () => {
    const descriptor = getCountDescriptor(key);
    const entry = data.countDraft[key];
    const observationState = entry?.value === '' ? 'BLANK' : 'COUNTED';
    const quantity = observationState === 'BLANK' ? null : Number(entry?.value);
    if (!descriptor || (observationState === 'COUNTED' && (!Number.isFinite(quantity) || quantity < 0)) || entry.firstRecordedAt) return;
    try {
      const session = await ensurePilotCountSession();
      await window.PantryBackend.saveCountDraft({
        sessionId: session.id,
        zoneId: PILOT_ZONE_IDS[descriptor.area.id],
        productId: pilotProductId(descriptor.product.id),
        quantity,
        unit: entry.unit,
        observationState
      });
      const card = document.querySelector(`[data-count-card="${CSS.escape(key)}"] .autosave-mark`);
      if (card) card.textContent = '已同步';
    } catch (error) {
      console.error('Count draft sync failed.', error);
      showToast('暫時無法同步，草稿仍保存在本機');
    }
  }, 450));
}

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
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY));
    if (saved && Array.isArray(saved.products)) {
      const products = mergeProductsWithDefaults(saved.products);
      return {
        products,
        issues: (Array.isArray(saved.issues) ? saved.issues : []).map(normalizeIssue),
        countDraft: normalizeCountDraft(saved.countDraft || {}, products),
        countAreaId: TRIAL_COUNT_AREA_IDS.includes(saved.countAreaId) ? saved.countAreaId : TRIAL_COUNT_AREA_IDS[0],
        countCompletedAreas: saved.countCompletedAreas && typeof saved.countCompletedAreas === 'object' ? saved.countCompletedAreas : {},
        countSessionStartedAt: saved.countSessionStartedAt || '',
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
        configurationRecords: Array.isArray(saved.configurationRecords) ? saved.configurationRecords : [],
        countEvents: Array.isArray(saved.countEvents) ? saved.countEvents : [],
        stockDiscrepancies: Array.isArray(saved.stockDiscrepancies) ? saved.stockDiscrepancies : [],
        actionPlans: normalizeActionPlans(saved.actionPlans),
        expiryInspectionItems: normalizeExpiryInspectionItems(saved.expiryInspectionItems),
        riskFocuses: normalizeRiskFocuses(saved.riskFocuses),
        expiryInspectionCompletions: saved.expiryInspectionCompletions && typeof saved.expiryInspectionCompletions === 'object' ? saved.expiryInspectionCompletions : {},
        expiryInspectionAreaId: EXPIRY_INSPECTION_AREA_IDS.includes(saved.expiryInspectionAreaId) ? saved.expiryInspectionAreaId : EXPIRY_INSPECTION_AREA_IDS[0],
        receivingReviews: normalizeReceivingReviews(saved.receivingReviews),
        receivingUploads: Array.isArray(saved.receivingUploads) ? saved.receivingUploads : []
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
    countAreaId: TRIAL_COUNT_AREA_IDS[0],
    countCompletedAreas: {},
    countSessionStartedAt: '',
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
    configurationRecords: [],
    countEvents: [],
    stockDiscrepancies: [],
    actionPlans: normalizeActionPlans(),
    expiryInspectionItems: normalizeExpiryInspectionItems(),
    riskFocuses: normalizeRiskFocuses(),
    expiryInspectionCompletions: {},
    expiryInspectionAreaId: EXPIRY_INSPECTION_AREA_IDS[0],
    receivingReviews: normalizeReceivingReviews(),
    receivingUploads: []
  };
}

function mergeProductsWithDefaults(savedProducts) {
  const savedById = new Map(savedProducts.map(product => [product.id, product]));
  const mergedDefaults = DEFAULT_PRODUCTS.map(defaultProduct => normalizeProduct({
    ...defaultProduct,
    ...(savedById.get(defaultProduct.id) || {})
  }));
  const extraProducts = savedProducts
    .filter(product => !DEFAULT_PRODUCTS.some(defaultProduct => defaultProduct.id === product.id))
    .map(normalizeProduct);
  return [...mergedDefaults, ...extraProducts];
}

function normalizeExpiryInspectionItems(savedItems) {
  const savedById = new Map((Array.isArray(savedItems) ? savedItems : []).map(item => [item.id, item]));
  return DEFAULT_EXPIRY_INSPECTION_ITEMS.map(defaultItem => {
    const saved = savedById.get(defaultItem.id) || {};
    return {
      ...defaultItem,
      ...saved,
      state: ['active', 'needs-confirmation', 'resolved'].includes(saved.state) ? saved.state : defaultItem.state,
      resolution: saved.resolution || '',
      resolvedAt: saved.resolvedAt || '',
      resolvedBy: saved.resolvedBy || ''
    };
  });
}

function normalizeRiskFocuses(savedFocuses) {
  const source = Array.isArray(savedFocuses) && savedFocuses.length ? savedFocuses : DEFAULT_RISK_FOCUSES;
  return source.map(focus => ({
    ...focus,
    id: focus.id || `risk-${Date.now()}`,
    name: String(focus.name || '').trim(),
    note: String(focus.note || '').trim(),
    source: focus.source || '店家自訂',
    areaIds: Array.isArray(focus.areaIds) ? focus.areaIds.filter(areaId => COUNT_AREAS.some(area => area.id === areaId)) : [],
    enabled: focus.enabled !== false,
    createdAt: focus.createdAt || new Date().toISOString()
  })).filter(focus => focus.name && focus.areaIds.length);
}

function normalizeReceivingReviews(savedReviews) {
  const saved = Array.isArray(savedReviews) ? savedReviews : [];
  const defaultIds = new Set(DEFAULT_RECEIVING_REVIEWS.map(review => review.id));
  const source = saved.filter(review => !defaultIds.has(review.id));
  DEFAULT_RECEIVING_REVIEWS.forEach(defaultReview => {
    const alreadyAvailable = source.some(review =>
      review.batchNumber === defaultReview.batchNumber
    );
    if (!alreadyAvailable) source.push(defaultReview);
  });
  const normalized = source.map(review => ({
    ...review,
    batchNumber: review.batchNumber || `#${new Date(review.createdAt || Date.now()).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }).replace(/\D/g, '')}-01`,
    status: RECEIVING_STATUS_LABELS[review.status] ? review.status : (review.status === 'recognized' ? 'pending' : 'question'),
    originalPhotos: (Array.isArray(review.originalPhotos) && review.originalPhotos.length
      ? review.originalPhotos
      : review.originalPhoto ? [review.originalPhoto] : [{ name: '原始貨單照片.jpg' }])
      .map(photo => ({ ...photo, immutable: true })),
    photoCount: Number(review.photoCount) || (Array.isArray(review.originalPhotos) ? review.originalPhotos.length : 1),
    aiRows: Array.isArray(review.aiRows) ? review.aiRows.map(row => ({ ...row, questionFields: Array.isArray(row.questionFields) ? [...row.questionFields] : [] })) : [],
    aiRawResult: review.aiRawResult || '尚未完成辨識',
    corrections: Array.isArray(review.corrections) ? review.corrections.map(correction => ({ ...correction })) : []
  }));
  const usedBatchNumbers = new Set();
  normalized.forEach(review => {
    const createdAt = new Date(review.createdAt || Date.now());
    const prefix = `${String(createdAt.getMonth() + 1).padStart(2, '0')}${String(createdAt.getDate()).padStart(2, '0')}`;
    let batchNumber = String(review.batchNumber || `#${prefix}-01`);
    if (usedBatchNumbers.has(batchNumber)) {
      let sequence = 1;
      while (usedBatchNumbers.has(`#${prefix}-${String(sequence).padStart(2, '0')}`)) sequence += 1;
      batchNumber = `#${prefix}-${String(sequence).padStart(2, '0')}`;
    }
    review.batchNumber = batchNumber;
    usedBatchNumbers.add(batchNumber);
  });
  return normalized;
}

function normalizeActionPlans(savedPlans) {
  const source = savedPlans && typeof savedPlans === 'object' ? savedPlans : {};
  return Object.fromEntries(Object.entries(DEFAULT_ACTION_PLANS).map(([key, plan]) => {
    const saved = source[key];
    const steps = Array.isArray(saved?.steps) && saved.steps.length
      ? saved.steps.slice(0, 3).map((step, index) => ({
        text: String(step.text || plan.steps[index]?.text || '').trim(),
        level: ACTION_LEVEL_LABELS[step.level] ? step.level : (plan.steps[index]?.level || 'employee')
      }))
      : plan.steps.map(step => ({ ...step }));
    return [key, { label: saved?.label || plan.label, steps }];
  }));
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
    reporter: issue.reporter || issue.actor || MOCK_SESSION.name,
    managerAware: Boolean(issue.managerAware),
    externalContacted: Boolean(issue.externalContacted),
    nextAction: issue.nextAction || '',
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
    updatedBy: order.updatedBy || MOCK_SUPERVISOR.name,
    source: order.source || 'manual',
    formalSystemConfirmed: order.formalSystemConfirmed !== false,
    receivedAt: order.receivedAt || ''
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
  return {
    ...fallback,
    ...product,
    unit: baseUnit,
    baseUnit,
    allowedUnits,
    confirmedAt: product.confirmedAt || fallback?.confirmedAt || dateTimeOffset(-2, 9, 0)
  };
}

function normalizeProductHistory(savedHistory) {
  const source = {
    ...DEFAULT_PRODUCT_HISTORY,
    ...(savedHistory && typeof savedHistory === 'object' ? savedHistory : {})
  };
  return Object.fromEntries(Object.entries(source).map(([productId, entries]) => [
    productId,
    Array.isArray(entries) ? entries.map(entry => ({
      ...entry,
      type: entry.type === ['人工', '調整'].join('') ? '庫存更正紀錄' : entry.type
    })) : []
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
      touched: Boolean(value.touched || value.firstRecordedAt),
      unit,
      baseValue: Number.isFinite(Number(value.baseValue)) ? Number(value.baseValue) : null,
      status: ['draft', 'needs-recount', 'needs-reason', 'confirmed'].includes(value.status) ? value.status : 'draft',
      attempts: Array.isArray(value.attempts) ? value.attempts.map(attempt => ({ ...attempt })) : [],
      reason: value.reason || '',
      resolution: value.resolution || '',
      confirmedAt: value.confirmedAt || '',
      firstValue: value.firstValue === undefined ? '' : String(value.firstValue),
      firstUnit: value.firstUnit || unit,
      firstBaseValue: value.firstBaseValue === null || value.firstBaseValue === undefined || value.firstBaseValue === '' ? null : (Number.isFinite(Number(value.firstBaseValue)) ? Number(value.firstBaseValue) : null),
      firstRecordedAt: value.firstRecordedAt || '',
      reviewBaseValue: Number.isFinite(Number(value.reviewBaseValue)) ? Number(value.reviewBaseValue) : null
    };
  }
  return {
    value: value === undefined || value === null ? '' : String(value),
    touched: value !== undefined && value !== null && value !== '',
    unit: product.baseUnit,
    baseValue: null,
    status: 'draft',
    attempts: [],
    reason: '',
    resolution: '',
    confirmedAt: '',
    firstValue: '',
    firstUnit: product.baseUnit,
    firstBaseValue: null,
    firstRecordedAt: '',
    reviewBaseValue: null
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
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value));
}

function formatActualDateTime(value) {
  if (!value) return '時間待確認';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '時間待確認';
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function formatActualDate(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.replaceAll('-', '/');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日期待確認';
  const parts = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}/${values.month}/${values.day}`;
}

function formatShortDateTime(value) {
  if (!value) return '日期待確認';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日期待確認';
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
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
  if (days < 0) return `已到期・${product.expiryDate}`;
  if (days === 0) return `今日到期・${product.expiryDate}`;
  if (days === 1) return `明日到期・${product.expiryDate}`;
  return `有效日期 ${product.expiryDate}`;
}

function inspectionItemProduct(item) {
  return data.products.find(product => product.id === item.productId) || null;
}

function calendarDayDifference(value) {
  if (!value) return null;
  const today = new Date();
  const target = new Date(value);
  if (!Number.isFinite(target.getTime())) return null;
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function formatInspectionDateTime(value) {
  if (!value) return '';
  return formatActualDateTime(value);
}

function inspectionItemStatus(item) {
  if (item.state === 'resolved') return 'resolved';
  if (item.deadlineSource === 'none') return 'quality-check';
  if (item.state === 'needs-confirmation') return 'needs-confirmation';
  const days = calendarDayDifference(item.expiresAt);
  if (days !== null && days < 0) return 'overdue';
  if (days === 0) return 'due-today';
  if (days === 1) return 'due-tomorrow';
  return 'needs-confirmation';
}

function inspectionStatusLabel(item) {
  return ({
    resolved: '已處理',
    'quality-check': '建議確認品質',
    'needs-confirmation': '請確認',
    overdue: '已到期未處理',
    'due-today': '今日到期',
    'due-tomorrow': '明日到期'
  })[inspectionItemStatus(item)] || '請確認';
}

function inspectionDeadlineText(item) {
  if (item.deadlineSource === 'none') {
    return `進貨：${formatActualDateTime(item.triggerAt)}｜建議確認品質`;
  }
  const days = calendarDayDifference(item.expiresAt);
  const status = days < 0 ? '已到期' : days === 0 ? '今天到期' : days === 1 ? '明天到期' : '到期';
  return `${status}：${formatActualDateTime(item.expiresAt)}`;
}

function inspectionSourceLabel(item) {
  if (item.deadlineSource === 'manufacturer') return '原廠效期';
  if (item.deadlineSource === 'sop') return '公司／店家 SOP';
  return '無正式期限資料';
}

function getExpiryInspectionSummary() {
  const visibleItems = data.expiryInspectionItems.filter(item => EXPIRY_INSPECTION_AREA_IDS.includes(item.areaId) && item.state !== 'resolved');
  const dueToday = visibleItems.filter(item => ['due-today', 'overdue'].includes(inspectionItemStatus(item))).length;
  const dueTomorrow = visibleItems.filter(item => inspectionItemStatus(item) === 'due-tomorrow').length;
  const riskAreas = new Set(data.riskFocuses
    .filter(focus => focus.enabled)
    .flatMap(focus => focus.areaIds)
    .filter(areaId => EXPIRY_INSPECTION_AREA_IDS.includes(areaId)));
  return { dueToday, dueTomorrow, riskAreaCount: riskAreas.size };
}

function renderExpiryInspection() {
  const areaContainer = $('#expiry-inspection-areas');
  if (!areaContainer) return;
  if (!EXPIRY_INSPECTION_AREA_IDS.includes(ui.expiryInspectionAreaId)) ui.expiryInspectionAreaId = EXPIRY_INSPECTION_AREA_IDS[0];
  const areas = EXPIRY_INSPECTION_AREA_IDS.map(areaId => COUNT_AREAS.find(area => area.id === areaId)).filter(Boolean);
  if (!areas.length) {
    areaContainer.innerHTML = '<p>正式 Pilot 尚未啟用效期巡檢。</p>';
    $('#inspection-due-today').textContent = '0';
    $('#inspection-due-tomorrow').textContent = '0';
    $('#inspection-risk-area-count').textContent = '0';
    $('#expiry-inspection-list').innerHTML = '';
    $('#risk-focus-list').innerHTML = '';
    return;
  }
  areaContainer.innerHTML = areas.map(area => {
    const openItems = data.expiryInspectionItems.filter(item => item.areaId === area.id && item.state !== 'resolved').length;
    const complete = Boolean(data.expiryInspectionCompletions[area.id]);
    return `<button type="button" class="${area.id === ui.expiryInspectionAreaId ? 'active' : ''} ${complete ? 'complete' : ''}" data-inspection-area="${area.id}">
      <strong>${escapeHTML(area.name)}</strong><small>${openItems ? `${openItems} 項要看` : '目前無需處理'}</small>
    </button>`;
  }).join('');
  areaContainer.querySelectorAll('[data-inspection-area]').forEach(button => button.addEventListener('click', () => {
    ui.expiryInspectionAreaId = button.dataset.inspectionArea;
    data.expiryInspectionAreaId = ui.expiryInspectionAreaId;
    saveData();
    renderExpiryInspection();
  }));

  const summary = getExpiryInspectionSummary();
  $('#inspection-due-today').textContent = summary.dueToday;
  $('#inspection-due-tomorrow').textContent = summary.dueTomorrow;
  $('#inspection-risk-area-count').textContent = summary.riskAreaCount;

  const selectedArea = COUNT_AREAS.find(area => area.id === ui.expiryInspectionAreaId) || areas[0];
  const items = data.expiryInspectionItems
    .filter(item => item.areaId === selectedArea.id && item.state !== 'resolved')
    .sort((a, b) => {
      const priority = { overdue: 0, 'due-today': 1, 'due-tomorrow': 2, 'needs-confirmation': 3, 'quality-check': 4 };
      return (priority[inspectionItemStatus(a)] ?? 5) - (priority[inspectionItemStatus(b)] ?? 5);
    });
  const completion = data.expiryInspectionCompletions[selectedArea.id];
  $('#inspection-area-status').textContent = completion ? `上次完成 ${formatTime(completion.completedAt)}` : `${items.length} 項`;
  $('#expiry-inspection-list').innerHTML = items.length ? items.map(item => {
    const product = inspectionItemProduct(item);
    const status = inspectionItemStatus(item);
    return `<button type="button" class="inspection-item ${status}" data-inspection-item="${item.id}">
      <span class="inspection-code">${escapeHTML(item.code)}</span>
      <span class="inspection-copy"><strong>${escapeHTML(product?.name || '商品待確認')}</strong>
        <small>${escapeHTML(item.triggerLabel)} ${escapeHTML(formatInspectionDateTime(item.triggerAt))}</small>
        <b>${escapeHTML(inspectionDeadlineText(item))}</b>
      </span>
      <span class="inspection-state">${escapeHTML(inspectionStatusLabel(item))}</span>
    </button>`;
  }).join('') : '<div class="empty-state"><span>✓</span><div><strong>本區目前無需處理</strong><small>正常品項不逐項顯示。</small></div></div>';
  $('#expiry-inspection-list').querySelectorAll('[data-inspection-item]').forEach(button => button.addEventListener('click', () => openInspectionItem(button.dataset.inspectionItem)));

  const focuses = data.riskFocuses.filter(focus => focus.enabled && focus.areaIds.includes(selectedArea.id));
  $('#risk-focus-list').innerHTML = focuses.length ? focuses.map(focus => `<article class="risk-focus-card">
    <span>${escapeHTML(focus.source)}</span><strong>${escapeHTML(focus.name)}</strong><p>${escapeHTML(focus.note)}</p>
  </article>`).join('') : '<p class="muted-copy">這個區域目前沒有額外風險重點。</p>';
  $('#complete-expiry-inspection').textContent = `完成 ${selectedArea.name} 巡檢`;
  $('#complete-expiry-inspection').setAttribute('aria-label', `完成 ${selectedArea.name} 巡檢`);
}

function openInspectionItem(itemId) {
  const item = data.expiryInspectionItems.find(entry => entry.id === itemId);
  const product = inspectionItemProduct(item);
  if (!item || !product) return;
  ui.expiryInspectionItemId = item.id;
  $('#inspection-item-name').textContent = product.name;
  $('#inspection-item-meta').textContent = `${item.code}・${COUNT_AREAS.find(area => area.id === item.areaId)?.name || product.area}`;
  $('#inspection-item-result').className = `action-result ${['overdue', 'due-today'].includes(inspectionItemStatus(item)) ? 'critical' : ''}`;
  $('#inspection-item-result').innerHTML = `<span>結果</span><h3>${escapeHTML(inspectionStatusLabel(item))}</h3><p>${escapeHTML(inspectionDeadlineText(item))}・剩餘 ${formatNumber(product.qty)} ${escapeHTML(product.baseUnit)}</p>`;
  $('#inspection-item-details').innerHTML = `<ul class="reason-summary">
    <li>${escapeHTML(inspectionSourceLabel(item))}</li>
    <li>${escapeHTML(item.triggerLabel)}紀錄：${escapeHTML(formatInspectionDateTime(item.triggerAt))}</li>
    <li>${item.deadlineSource === 'none' ? '沒有正式期限資料，因此只提示品質確認，不判定為過期。' : `期限紀錄：${escapeHTML(formatInspectionDateTime(item.expiresAt))}`}</li>
  </ul>`;
  const dialog = $('#inspection-item-dialog');
  if (!dialog.open) dialog.showModal();
}

function ensureInspectionExpiryEvent(item, product) {
  if (!item.expiresAt) return null;
  const expiryDate = new Date(item.expiresAt).toISOString().slice(0, 10);
  let event = data.expiryEvents.find(entry => entry.productId === product.id && entry.expiryDate === expiryDate && !['resolved', 'corrected'].includes(entry.status));
  if (!event) {
    const createdAt = new Date().toISOString();
    event = {
      id: `expiry-inspection-${item.id}-${Date.now()}`, productId: product.id, expiryDate,
      status: expiryStateForDate(expiryDate), milestones: [], createdAt, updatedAt: createdAt,
      source: inspectionSourceLabel(item)
    };
    data.expiryEvents.push(event);
  }
  product.expiryDate = expiryDate;
  product.expirySource = inspectionSourceLabel(item);
  return event;
}

function handleInspectionAction(action) {
  const item = data.expiryInspectionItems.find(entry => entry.id === ui.expiryInspectionItemId);
  const product = inspectionItemProduct(item);
  if (!item || !product) return;
  if (action === 'label-issue') {
    $('#inspection-item-dialog').close();
    ui.expiryReturnPage = 'expiry-inspection';
    if (product.expiryDate || item.expiresAt) {
      ensureInspectionExpiryEvent(item, product);
      openExpiryCorrectionDialog(product.id);
      return;
    }
    const createdAt = new Date().toISOString();
    item.state = 'needs-confirmation';
    data.issues.unshift(normalizeIssue({
      id: `issue-expiry-inspection-${Date.now()}`, type: '效期資訊', productId: product.id,
      note: `${product.name}標籤／日期有問題`, status: 'pending', reporter: MOCK_SESSION.name,
      nextAction: '主管核對新批次、收貨紀錄與批次混放狀況', createdAt,
      expiryInspectionAreaId: item.areaId
    }));
    appendProductHistory(product.id, { type: '效期資訊異常', actor: MOCK_SESSION.name, createdAt, detail: '巡檢發現標籤／日期有問題；原始紀錄未修改' });
    saveAndRender();
    showToast('已建立待確認異常，原始效期未修改');
    return;
  }
  if (!['used-up', 'discard', 'mismatch'].includes(action)) return;
  ensureInspectionExpiryEvent(item, product);
  ui.expiryReturnPage = 'expiry-inspection';
  $('#inspection-item-dialog').close();
  openExpiryActionDialog(product.id);
  selectExpiryAction(action);
}

function syncInspectionAfterExpiryAction(productId, action, after, createdAt) {
  const item = data.expiryInspectionItems.find(entry => entry.id === ui.expiryInspectionItemId && entry.productId === productId);
  if (!item) return;
  item.remainingQuantity = after;
  if (after <= 0 || action === 'used-up') {
    item.state = 'resolved';
    item.resolution = action;
    item.resolvedAt = createdAt;
    item.resolvedBy = MOCK_SESSION.name;
  } else if (action === 'mismatch') {
    item.state = 'needs-confirmation';
  }
}

function openRiskFocusDialog() {
  $('#risk-focus-area').innerHTML = COUNT_AREAS.map(area => `<option value="${area.id}" ${area.id === ui.expiryInspectionAreaId ? 'selected' : ''}>${escapeHTML(area.name)}</option>`).join('');
  $('#risk-focus-form').reset();
  $('#risk-focus-area').value = ui.expiryInspectionAreaId;
  $('#risk-focus-enabled').checked = true;
  $('#risk-focus-dialog').showModal();
}

function submitRiskFocus(event) {
  event.preventDefault();
  const name = $('#risk-focus-name').value.trim();
  const note = $('#risk-focus-note').value.trim();
  const areaId = $('#risk-focus-area').value;
  if (!name || !note || !COUNT_AREAS.some(area => area.id === areaId)) return;
  data.riskFocuses.unshift({
    id: `risk-custom-${Date.now()}`, name, note, source: '店家自訂', areaIds: [areaId],
    enabled: $('#risk-focus-enabled').checked, createdAt: new Date().toISOString(), createdBy: MOCK_SUPERVISOR.name
  });
  saveAndRender();
  $('#risk-focus-dialog').close();
  showToast('已新增風險重點');
}

function completeExpiryInspection() {
  const area = COUNT_AREAS.find(entry => entry.id === ui.expiryInspectionAreaId);
  if (!area) return;
  const areaItems = data.expiryInspectionItems.filter(item => item.areaId === area.id && item.state !== 'resolved');
  const dueToday = areaItems.filter(item => ['due-today', 'overdue'].includes(inspectionItemStatus(item))).length;
  const pending = areaItems.filter(item => ['needs-confirmation', 'quality-check'].includes(inspectionItemStatus(item))).length;
  const newIssues = data.issues.filter(issue => issue.expiryInspectionAreaId === area.id && isIssueOpen(issue)).length;
  const completedAt = new Date().toISOString();
  data.expiryInspectionCompletions[area.id] = { completedAt, completedBy: MOCK_SESSION.name, dueToday, pending, newIssues };
  saveAndRender();
  $('#inspection-complete-title').textContent = `${area.name} 巡檢完成`;
  $('#inspection-complete-time').textContent = `${MOCK_SESSION.name}・${formatTime(completedAt)}`;
  $('#inspection-complete-summary').innerHTML = (dueToday || pending || newIssues) ? `<h3>今日需處理</h3><ul>
    <li><span>今日到期</span><strong>${dueToday}</strong></li>
    <li><span>待確認</span><strong>${pending}</strong></li>
    <li><span>新增異常</span><strong>${newIssues}</strong></li>
  </ul>` : '<div class="empty-state"><span>✓</span><div><strong>本區目前無需處理</strong><small>不需要逐項確認正常商品。</small></div></div>';
  $('#inspection-complete-dialog').showModal();
}

function makePhotoPreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => resolve(String(reader.result || ''));
      image.onload = () => {
        const maxWidth = 640;
        const scale = Math.min(1, maxWidth / image.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.58));
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

async function handleReceivingPhotoChange(event) {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  try {
    const prepared = await Promise.all(files.map(async (file, index) => ({
      id: `receiving-photo-${Date.now()}-${index}`,
      name: file.name || `貨單照片-${Date.now()}-${index + 1}.jpg`,
      type: file.type || 'image/jpeg',
      size: file.size || 0,
      capturedAt: new Date().toISOString(),
      immutable: true,
      file,
      previewDataUrl: await makePhotoPreview(file)
    })));
    ui.receivingPhotos.push(...prepared);
    ui.receivingStep = 'preview';
    event.target.value = '';
    renderReceiving();
  } catch (error) {
    console.warn('Could not prepare receiving photo.', error);
    showToast('照片讀取失敗，請重新拍攝');
  }
}

function receivingBatchNumber(date = new Date()) {
  const prefix = `${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const used = [...(data.receivingReviews || []), ...DEFAULT_RECEIVING_REVIEWS]
    .map(review => String(review.batchNumber || '').match(new RegExp(`^#${prefix}-(\\d+)$`)))
    .filter(Boolean)
    .map(match => Number(match[1]));
  return `#${prefix}-${String(Math.max(0, ...used) + 1).padStart(2, '0')}`;
}

async function submitReceivingPhoto() {
  if (!ui.receivingPhotos.length) return showToast('請先拍攝或選擇貨單照片');
  const submitButton = $('#submit-receiving-photo');
  submitButton.disabled = true;
  submitButton.textContent = pilot.cloud ? '正在安全上傳…' : '正在保存…';
  if (pilot.cloud) {
    try {
      const selectedPhotos = [...ui.receivingPhotos];
      const uploadResult = await window.PantryBackend.uploadReceiptBatches(
        selectedPhotos.map(photo => photo.file),
        { sameReceiptMultiPage: ui.receiptRoutingMode === 'multi-page' }
      );
      const successful = uploadResult.successful;
      if (!successful.length) {
        throw uploadResult.failed[0]?.error || new Error('所有貨單都上傳失敗');
      }
      const successfulIndexes = new Set(successful.flatMap(result =>
        ui.receiptRoutingMode === 'multi-page'
          ? selectedPhotos.map((_, index) => index)
          : [result.groupIndex]
      ));
      selectedPhotos.forEach((photo, index) => {
        if (successfulIndexes.has(index)) URL.revokeObjectURL(photo.previewDataUrl);
      });
      ui.receivingPhotos = selectedPhotos.filter((_, index) => !successfulIndexes.has(index));
      ui.receivingCompleteBatch = {
        batchNumbers: successful.map(result => result.value.batch.batch_number),
        photoCount: successful.reduce((sum, result) => sum + result.value.documents.length, 0),
        batchCount: successful.length,
        failedCount: uploadResult.failed.length
      };
      let queueError = null;
      try {
        await window.PantryBackend.enqueueReceiptOcr(successful.map(result => result.value.batch.id));
      } catch (error) {
        queueError = error;
        console.error('Receipt OCR enqueue failed after originals were stored.', error);
      }
      ui.receivingStep = 'complete';
      await refreshCloudReceiptBatches();
      renderReceiving();
      showToast(queueError
        ? `${successful.length} 筆原圖已安全上傳；背景排程暫時失敗，可由後勤重新執行`
        : uploadResult.failed.length
        ? `${successful.length} 筆已上傳，${uploadResult.failed.length} 筆失敗可重新送出`
        : `${successful.length} 筆貨單原圖已安全上傳，可以繼續工作`);
    } catch (error) {
      console.error('Receipt upload failed.', error);
      showToast(`上傳失敗：${error.message}`);
    } finally {
      submitButton.textContent = '確認上傳';
      submitButton.disabled = !ui.receivingPhotos.length;
    }
    return;
  }
  const createdAt = new Date().toISOString();
  const reviewId = `receiving-${Date.now()}`;
  const batchNumber = receivingBatchNumber(new Date(createdAt));
  const originalPhotos = ui.receivingPhotos.map(photo => ({ ...photo, immutable: true }));
  data.receivingUploads.unshift({
    id: reviewId, batchNumber, originalPhotos: originalPhotos.map(photo => ({ ...photo })), photoCount: originalPhotos.length, uploadedAt: createdAt,
    uploadedBy: MOCK_SESSION.name, frontlineComplete: true
  });
  data.receivingReviews.unshift({
    id: reviewId, batchNumber, status: 'recognizing', supplier: '供應商辨識中', createdAt,
    originalPhotos, photoCount: originalPhotos.length, aiRows: [],
    aiRawResult: '已收到原始貨單照片，系統正在進行 mock 辨識。', corrections: [], uploadedBy: MOCK_SESSION.name
  });
  ui.receivingCompleteBatch = { batchNumber, photoCount: originalPhotos.length };
  ui.receivingPhotos = [];
  ui.receivingStep = 'complete';
  saveAndRender();
  showToast('收貨資料已送出');
  submitButton.textContent = '確認上傳';
}

function cloudBatchStatus(status) {
  return {
    UPLOADED: 'recognizing', PROCESSING: 'recognizing', READY_FOR_REVIEW: 'pending',
    REVIEWING: 'question', COMPLETED: 'completed'
  }[status] || 'pending';
}

async function refreshCloudReceiptBatches() {
  if (!pilot.cloud) return;
  const batches = await window.PantryBackend.listReceiptBatches();
  data.receivingReviews = batches.map(batch => {
    const latestRun = [...(batch.receipt_ocr_runs || [])].sort((a, b) => Number(b.version) - Number(a.version))[0];
    const latestJob = [...(batch.receipt_ocr_jobs || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    const supplierField = latestRun?.receipt_ocr_fields?.find(field => field.row_key === 'document' && field.field_name === 'supplier_name');
    const formalReceipt = batch.goods_receipts?.[0] || null;
    const failed = latestJob?.status === 'FAILED' || latestRun?.status === 'FAILED';
    const activeJob = ['QUEUED', 'RUNNING'].includes(latestJob?.status);
    return {
      id: batch.id,
      batchNumber: batch.batch_number,
      status: activeJob ? 'recognizing' : failed ? 'question' : cloudBatchStatus(batch.status),
      cloudStatus: batch.status,
      supplier: formalReceipt?.suppliers?.name || supplierField?.normalized_value || supplierField?.raw_value || (failed ? '辨識異常' : '供應商待核對'),
      store: batch.store_name || '未指定門市',
      workDate: batch.work_date || String(batch.uploaded_at).slice(0, 10),
      createdAt: batch.uploaded_at,
      photoCount: batch.receipt_documents?.length || 0,
      originalPhotos: (batch.receipt_documents || []).sort((a, b) => a.page_order - b.page_order).map(document => ({
        id: document.id, name: document.original_filename, storagePath: document.storage_path, immutable: true
      })),
      aiRows: [], corrections: [], cloud: true, latestJob, latestRun,
      goodsReceipt: formalReceipt
    };
  });
}

const COUNT_DISCREPANCY_REASON_LABELS = {
  INPUT_ERROR: '輸入錯誤', MISSED_OR_WRONG_ZONE: '漏盤／放錯區域',
  WASTE_NOT_RECORDED: '廢棄未記錄', TRANSFER_NOT_RECORDED: '調撥未記錄',
  RECEIPT_NOT_RECORDED: '收貨未記錄', OTHER: '其他原因'
};

async function refreshCountDiscrepancies() {
  if (!pilot.cloud || pilot.profile?.role !== 'ADMIN') return;
  [pilot.countDiscrepancies, pilot.countReport] = await Promise.all([
    window.PantryBackend.listCountDiscrepancies(),
    window.PantryBackend.getLatestCountReport()
  ]);
  renderCountDiscrepancies();
}

function renderCountDiscrepancies() {
  const summary = $('#count-discrepancy-summary');
  const list = $('#count-discrepancy-list');
  if (!summary || !list) return;
  const rows = pilot.countDiscrepancies || [];
  const pending = rows.filter(row => row.status === 'PENDING' || !row.reason);
  const answered = rows.filter(row => row.status === 'ANSWERED');
  const resolved = rows.filter(row => row.status === 'RESOLVED');
  const initialEntries = (pilot.countReport?.entries || []).filter(entry => entry.entry_type === 'INITIAL_COUNT');
  const discrepancyKeys = new Set(rows.map(row => `${row.zone_id}:${row.product_id}`));
  const matchedCount = initialEntries.filter(entry => !discrepancyKeys.has(`${entry.zone_id}:${entry.product_id}`)).length;
  summary.innerHTML = [
    [pending.length, '未回覆原因'], [answered.length + resolved.length, '已回覆／處理'], [rows.length, '差異品項'], [matchedCount, '相符（僅摘要）']
  ].map(([count, label]) => `<span><strong>${count}</strong>${label}</span>`).join('');
  const ordered = [...rows].sort((a, b) => {
    const priority = row => row.status === 'PENDING' || !row.reason ? 0 : row.status === 'ANSWERED' ? 1 : 2;
    return priority(a) - priority(b) || Math.abs(Number(b.difference || 0)) - Math.abs(Number(a.difference || 0));
  });
  list.innerHTML = ordered.length ? ordered.map(row => `<article class="count-discrepancy-card ${row.status === 'PENDING' || !row.reason ? 'pending' : ''}">
    <div><span class="receiving-status ${row.status === 'RESOLVED' ? 'completed' : row.status === 'ANSWERED' ? 'pending' : 'question'}">${row.status === 'PENDING' || !row.reason ? '未回覆原因' : row.status === 'ANSWERED' ? '已回覆' : '已處理'}</span><small>${escapeHTML(formatActualDateTime(row.updated_at || row.created_at))}</small></div>
    <h3>${escapeHTML(row.products?.name || '未知商品')} <small>${escapeHTML(row.products?.product_code || '')}</small></h3>
    <dl><div><dt>區域</dt><dd>${escapeHTML(row.count_zones?.name || '—')}</dd></div><div><dt>差異</dt><dd>${row.difference === null ? '未提供數量' : `${Number(row.difference || 0) > 0 ? '+' : ''}${formatNumber(row.difference || 0)} ${escapeHTML(row.products?.count_unit || '')}`}</dd></div><div><dt>原因</dt><dd>${escapeHTML(COUNT_DISCREPANCY_REASON_LABELS[row.reason] || '尚未回覆')}</dd></div><div><dt>盤點人／時間</dt><dd>${escapeHTML(row.count_entries?.actor?.display_name || '—')}・${escapeHTML(formatActualDateTime(row.count_entries?.entered_at))}</dd></div></dl>
  </article>`).join('') : '<p class="muted-copy">目前沒有盤點差異。相符品項只保留在摘要與 Excel。</p>';
}

async function exportCountManagementExcel() {
  const report = pilot.countReport || { session: null, entries: [] };
  const initial = report.entries.filter(entry => entry.entry_type === 'INITIAL_COUNT');
  const aggregate = [...initial.reduce((map, entry) => {
    const key = entry.product_id;
    const row = map.get(key) || { product: entry.products, quantity: 0, blank: 0, zones: [] };
    if (entry.observation_state === 'BLANK') row.blank += 1;
    else row.quantity += Number(entry.quantity || 0);
    row.zones.push(entry.count_zones?.name || '');
    map.set(key, row);
    return map;
  }, new Map()).values()];
  const rows = [
    ...aggregate.map(item => ['商品加總', report.session?.completed_at ? new Date(report.session.completed_at) : '', '', item.product?.product_code || '', item.product?.name || '', item.blank ? '' : item.quantity, item.product?.count_unit || '', item.zones.join('、'), item.blank ? `${item.blank} 區空白待確認` : '', '']),
    ...report.entries.map(entry => ['區域原始事件', new Date(entry.entered_at), entry.actor?.display_name || '', entry.products?.product_code || '', entry.products?.name || '', entry.observation_state === 'BLANK' ? '' : entry.quantity, entry.unit, entry.count_zones?.name || '', entry.observation_state === 'BLANK' ? '空白（非 0）' : entry.entry_type, entry.id])
  ];
  if (!rows.length) return showToast('目前沒有可匯出的正式盤點資料');
  try {
    await downloadPilotExcel({
      sheetName: '正式盤點', filename: `PantryFlow-盤點管理-${new Date().toISOString().slice(0, 10)}.xlsx`,
      headers: ['資料層級', '記錄時間', '操作者', '物料碼', '品名', '數量', '單位', '區域', '狀態／提醒', '事件 ID'],
      rows, widths: [16, 20, 16, 18, 26, 12, 10, 22, 20, 38], dateColumns: [2]
    });
    showToast('已匯出完整盤點資料，包含相符品項與不可覆蓋的更正事件');
  } catch (error) {
    console.error('Count management export failed.', error);
    showToast(`Excel 尚未匯出：${error.message}`);
  }
}

function normalizeCloudOcrReview(bundle) {
  const fieldNameMap = {
    product: 'product', specification: 'specification', unit: 'unit', quantity: 'quantity',
    unit_price_ex_tax: 'unitPrice', subtotal_ex_tax: 'subtotal'
  };
  const rows = new Map();
  bundle.fields.forEach(field => {
    if (!rows.has(field.row_key)) rows.set(field.row_key, {
      id: field.row_key, rowKey: field.row_key, productId: '', itemCode: '', product: '', specification: '',
      unit: '', quantity: '', unitPrice: '', subtotal: '', taxRate: 0.05, expiryBatch: '', storage: '',
      confidence: 1, questionFields: [], fieldIds: {}
    });
    const row = rows.get(field.row_key);
    const localField = fieldNameMap[field.field_name];
    if (!localField) return;
    row[localField] = field.normalized_value ?? field.raw_value ?? '';
    row.fieldIds[localField] = field.id;
    row.confidence = Math.min(row.confidence, Number(field.confidence ?? 1));
    if (field.review_status !== 'TRUSTED') row.questionFields.push(localField);
  });
  const currentFieldIds = new Set(bundle.fields.map(field => field.id));
  const corrections = bundle.corrections.filter(correction => currentFieldIds.has(correction.ocr_field_id)).map(correction => {
    const field = bundle.fields.find(item => item.id === correction.ocr_field_id);
    const localField = fieldNameMap[field?.field_name] || field?.field_name;
    return {
      id: correction.id,
      ocrFieldId: correction.ocr_field_id,
      rowId: field?.row_key,
      field: localField,
      fieldLabel: receivingFieldLabel(localField),
      originalValue: correction.old_value,
      correctedValue: correction.new_value,
      actor: '後勤核對人員',
      createdAt: correction.modified_at
    };
  });
  return { rows: [...rows.values()], corrections };
}

async function loadCloudReceiptReview(review) {
  const bundle = await window.PantryBackend.getReceiptReview(review.id);
  const normalized = normalizeCloudOcrReview(bundle);
  review.aiRows = normalized.rows;
  review.corrections = normalized.corrections;
  review.cloudBundle = bundle;
  const run = bundle.latestRun;
  review.aiRawResult = normalized.rows.length
    ? ''
    : run?.status === 'FAILED'
      ? `辨識失敗：${run.error_message || '請重新執行辨識。'}`
      : '真實辨識仍在處理中，請稍後重新開啟。';
  review.originalPhotos = await Promise.all(review.originalPhotos.map(async photo => ({
    ...photo,
    previewDataUrl: await window.PantryBackend.signedDocumentUrl(photo.storagePath)
  })));
  return review;
}

function renderReceiving() {
  const methodStep = $('#receiving-method-step');
  if (!methodStep) return;
  methodStep.hidden = ui.receivingStep !== 'method';
  $('#receiving-preview-step').hidden = ui.receivingStep !== 'preview';
  $('#receiving-complete-step').hidden = ui.receivingStep !== 'complete';
  $('#receiving-photo-count').textContent = ui.receivingPhotos.length;
  $('#submit-receiving-photo').disabled = !ui.receivingPhotos.length;
  $('#receiving-photo-preview').innerHTML = ui.receivingPhotos.map((photo, index) => `<article>
    <img src="${photo.previewDataUrl}" alt="貨單照片 ${index + 1}">
    <span><strong>照片 ${index + 1}</strong><small>${escapeHTML(photo.name)}</small></span>
    <button type="button" data-remove-receiving-photo="${photo.id}" aria-label="移除照片 ${index + 1}">移除</button>
  </article>`).join('');
  const routingInput = document.querySelector(`input[name="receipt-routing"][value="${ui.receiptRoutingMode}"]`);
  if (routingInput) routingInput.checked = true;
  const plannedBatchCount = ui.receiptRoutingMode === 'multi-page'
    ? Number(ui.receivingPhotos.length > 0)
    : ui.receivingPhotos.length;
  $('#receipt-routing-hint').innerHTML = ui.receiptRoutingMode === 'multi-page'
    ? `目前會建立 <strong>${plannedBatchCount} 筆</strong>待核對項目，共 ${ui.receivingPhotos.length} 頁。`
    : `目前會建立 <strong>${plannedBatchCount} 筆</strong>獨立待核對項目。`;
  $$('[data-remove-receiving-photo]').forEach(button => button.addEventListener('click', () => {
    ui.receivingPhotos = ui.receivingPhotos.filter(photo => photo.id !== button.dataset.removeReceivingPhoto);
    if (!ui.receivingPhotos.length) ui.receivingStep = 'method';
    renderReceiving();
  }));
  if (ui.receivingCompleteBatch) {
    $('#receiving-complete-batch').textContent = ui.receivingCompleteBatch.batchNumbers?.join('、') || ui.receivingCompleteBatch.batchNumber;
    $('#receiving-complete-count').textContent = `${ui.receivingCompleteBatch.photoCount} 張`;
    $('#receiving-complete-note').textContent = ui.receivingCompleteBatch.failedCount
      ? `${ui.receivingCompleteBatch.batchCount} 筆已送出；${ui.receivingCompleteBatch.failedCount} 筆未上傳，原照片仍保留可重試。`
      : `${ui.receivingCompleteBatch.batchCount || 1} 筆待核對項目將分別進行辨識。`;
  }

  const list = $('#receiving-review-list');
  if (!list) return;
  const allReviews = [...(data.receivingReviews || [])].sort((left, right) => {
    const statusDifference = RECEIVING_STATUS_ORDER.indexOf(left.status) - RECEIVING_STATUS_ORDER.indexOf(right.status);
    return statusDifference || new Date(right.createdAt) - new Date(left.createdAt);
  });
  const storeFilter = $('#receipt-filter-store');
  const supplierFilter = $('#receipt-filter-supplier');
  const stores = [...new Set(allReviews.map(review => review.store).filter(Boolean))].sort();
  const suppliers = [...new Set(allReviews.map(review => review.supplier).filter(value => value && !value.includes('待核對') && value !== '辨識異常'))].sort();
  storeFilter.innerHTML = `<option value="">全部門市</option>${stores.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('')}`;
  supplierFilter.innerHTML = `<option value="">全部供應商</option>${suppliers.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('')}`;
  storeFilter.value = ui.receiptFilters.store;
  supplierFilter.value = ui.receiptFilters.supplier;
  $('#receipt-filter-date').value = ui.receiptFilters.date;
  $('#receipt-filter-status').value = ui.receiptFilters.status;
  const reviews = allReviews.filter(review =>
    (!ui.receiptFilters.store || review.store === ui.receiptFilters.store) &&
    (!ui.receiptFilters.date || review.workDate === ui.receiptFilters.date) &&
    (!ui.receiptFilters.supplier || review.supplier === ui.receiptFilters.supplier) &&
    (!ui.receiptFilters.status || review.status === ui.receiptFilters.status)
  );
  const statusCounts = RECEIVING_STATUS_ORDER.map(status => ({ status, count: reviews.filter(review => review.status === status).length }));
  $('#receiving-review-summary').innerHTML = statusCounts.map(item => `<span><strong>${item.count}</strong>${RECEIVING_STATUS_LABELS[item.status]}</span>`).join('');
  const actionable = reviews.filter(review => review.status !== 'completed');
  const completed = reviews.filter(review => review.status === 'completed');
  const visibleReviews = ui.showAllReceivingReviews ? reviews : actionable;
  const groupedReviews = visibleReviews.reduce((groups, review) => {
    const key = review.supplier || '供應商待核對';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(review);
    return groups;
  }, new Map());
  list.innerHTML = visibleReviews.length ? [...groupedReviews].map(([supplier, group]) => `<section class="receipt-supplier-group"><h3>${escapeHTML(supplier)}<small>${group.length} 張貨單</small></h3>${group.map(review => `<button type="button" data-receiving-review="${review.id}">
    <span class="receiving-status ${review.status}">${escapeHTML(RECEIVING_STATUS_LABELS[review.status])}</span>
    <strong>${escapeHTML(review.batchNumber)}</strong>
    <small>${escapeHTML(formatActualDateTime(review.createdAt))}</small>
    <small>${escapeHTML(review.store)}・${escapeHTML(review.workDate)}・照片 ${review.photoCount} 張</small>
    <small>${escapeHTML(review.supplier || '供應商待確認')}${review.status === 'completed' ? '・已完成 PantryFlow 核對／待 ERP 驗收' : ''}${review.latestJob?.status === 'FAILED' ? `・重試 ${review.latestJob.attempt_count}/${review.latestJob.max_attempts}` : ''}</small>
  </button>`).join('')}</section>`).join('') : '<p class="muted-copy">目前沒有待核對收貨。</p>';
  const showAllButton = $('#show-all-receiving-reviews');
  showAllButton.hidden = !completed.length && !ui.showAllReceivingReviews;
  showAllButton.textContent = ui.showAllReceivingReviews ? '只顯示待處理' : `查看全部（含 ${completed.length} 筆已完成）`;
  list.querySelectorAll('[data-receiving-review]').forEach(button => button.addEventListener('click', () => openReceivingReview(button.dataset.receivingReview)));
}

function receivingFieldLabel(field) {
  return {
    product: '商品', specification: '規格', unit: '單位', quantity: '數量',
    unitPrice: '未稅單價', subtotal: '未稅小計', supplier_name: '供應商',
    document_number: '貨單編號', receipt_date: '收貨日期', subtotal_ex_tax: '表頭未稅小計',
    tax: '稅額', total_inc_tax: '含稅總額'
  }[field] || field;
}

function receivingRowValue(review, row, field) {
  const correction = review.corrections.find(entry => entry.rowId === row.id && entry.field === field);
  return correction ? correction.correctedValue : row[field];
}

function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function receivingMoneySummary(review) {
  let untaxedSubtotal = 0;
  let tax = 0;
  let hasSubtotal = false;
  let hasTax = false;
  review.aiRows.forEach(row => {
    const subtotal = optionalNumber(receivingRowValue(review, row, 'subtotal'));
    const taxRate = optionalNumber(row.taxRate);
    if (subtotal === null) return;
    hasSubtotal = true;
    untaxedSubtotal += subtotal;
    if (taxRate === null) return;
    hasTax = true;
    tax += subtotal * taxRate;
  });
  return {
    untaxedSubtotal: hasSubtotal ? untaxedSubtotal : null,
    tax: hasTax ? tax : null,
    taxInclusiveTotal: hasSubtotal && hasTax ? untaxedSubtotal + tax : null
  };
}

async function openReceivingReview(reviewId) {
  const review = data.receivingReviews.find(entry => entry.id === reviewId);
  if (!review) return;
  if (pilot.cloud) {
    try {
      await loadCloudReceiptReview(review);
    } catch (error) {
      console.error('Could not load receipt review.', error);
      return showToast(`無法讀取收貨資料：${error.message}`);
    }
  }
  ui.receivingReviewId = review.id;
  $('#receiving-review-id').value = review.id;
  $('#receiving-review-title').textContent = review.batchNumber;
  $('#receiving-review-status').textContent = `${RECEIVING_STATUS_LABELS[review.status]}・${formatActualDateTime(review.createdAt)}・照片 ${review.photoCount} 張`;
  $('#receiving-original-section').hidden = true;
  $('#toggle-receiving-original').textContent = '查看原圖';
  $('#receiving-original-photo').innerHTML = review.originalPhotos.map((photo, index) => photo.previewDataUrl
    ? `<figure><img src="${photo.previewDataUrl}" alt="原始貨單照片 ${index + 1}"><figcaption>${escapeHTML(photo.name || `照片 ${index + 1}`)}</figcaption></figure>`
    : `<div class="photo-placeholder">▧<small>${escapeHTML(photo.name || `原始貨單照片 ${index + 1}`)}</small></div>`).join('');
  const money = receivingMoneySummary(review);
  $('#receiving-ai-result').innerHTML = review.aiRows.length ? `<div class="ai-result-head"><span>商品</span><span>單位</span><span>數量</span><span>未稅單價</span><span>未稅小計</span></div>${review.aiRows.map(row => `<div class="ai-result-row">
    ${['product', 'unit', 'quantity', 'unitPrice', 'subtotal'].map(field => `<span class="${row.questionFields.includes(field) ? 'question-field' : ''}" title="${receivingFieldLabel(field)}">${escapeHTML(row[field] === '' ? '—' : row[field])}${row.questionFields.includes(field) ? '<b>有疑問</b>' : ''}</span>`).join('')}
  </div>`).join('')}<dl class="receiving-money-summary">
    <div><dt>未稅小計</dt><dd>${money.untaxedSubtotal === null ? '未提供' : formatNumber(money.untaxedSubtotal)}</dd></div>
    <div><dt>稅額</dt><dd>${money.tax === null ? '未提供' : formatNumber(money.tax)}</dd></div>
    <div><dt>含稅總額</dt><dd>${money.taxInclusiveTotal === null ? '未提供' : formatNumber(money.taxInclusiveTotal)}</dd></div>
  </dl>` : `<p class="muted-copy">${escapeHTML(review.aiRawResult)}</p>`;
  const runs = review.cloudBundle?.runs || [];
  $('#receiving-ocr-run-history').innerHTML = runs.length ? `<h3>OCR run 歷程</h3>${runs.map(run => {
    const runFields = review.cloudBundle?.fieldsByRun?.[run.id] || [];
    return `<details><summary><strong>v${run.version}・${escapeHTML(run.status)}</strong><small>${escapeHTML(formatActualDateTime(run.created_at))}${run.error_message ? `・${escapeHTML(run.error_message)}` : ''}</small></summary><div>${runFields.length ? runFields.map(field => `<p><b>${escapeHTML(field.row_key)}．${escapeHTML(receivingFieldLabel(field.field_name))}</b><span>AI 原值：${escapeHTML(field.raw_value ?? '—')}・標準值：${escapeHTML(field.normalized_value ?? '—')}・${escapeHTML(field.review_status || '')}</span></p>`).join('') : '<p class="muted-copy">本次 run 未產生欄位。</p>'}</div></details>`;
  }).join('')}` : '<p class="muted-copy">尚未建立 OCR run。</p>';
  const savedCorrectionFieldIds = new Set((review.corrections || []).map(item => item.ocrFieldId).filter(Boolean));
  const lineCorrectionFields = review.aiRows.flatMap(row => row.questionFields.map(field => ({
    row, field, ocrId: row.fieldIds?.[field] || '', originalValue: row[field]
  }))).filter(item => !savedCorrectionFieldIds.has(item.ocrId));
  const documentCorrectionFields = (review.cloudBundle?.fields || [])
    .filter(field => field.row_key === 'document' && field.review_status !== 'TRUSTED' && !savedCorrectionFieldIds.has(field.id))
    .map(field => ({
      row: { id: 'document', product: '貨單表頭' }, field: field.field_name,
      ocrId: field.id, originalValue: field.normalized_value ?? field.raw_value ?? ''
    }));
  const correctionFields = [...documentCorrectionFields, ...lineCorrectionFields];
  $('#receiving-correction-fields').innerHTML = correctionFields.length ? `<h3>只修正有疑問的欄位</h3>${correctionFields.map(({ row, field, ocrId, originalValue }) => `<label>${escapeHTML(row.product)}・${receivingFieldLabel(field)}
    <input data-receiving-correction data-row-id="${row.id}" data-field="${field}" data-ocr-id="${ocrId}" data-original="${escapeHTML(originalValue ?? '')}" value="${escapeHTML(originalValue ?? '')}" required>
  </label>`).join('')}` : '<p class="muted-copy">目前沒有需要人工修正的欄位。</p>';
  $('#save-receiving-correction').hidden = !correctionFields.length;
  $('#receiving-correction-history').innerHTML = review.corrections.length ? `<h3>人工修正紀錄</h3>${review.corrections.map(correction => `<article>
    <strong>${escapeHTML(correction.actor)}・${escapeHTML(formatActualDateTime(correction.createdAt))}</strong><p>${escapeHTML(correction.fieldLabel || correction.note)}：${escapeHTML(correction.originalValue ?? '—')} → ${escapeHTML(correction.correctedValue ?? correction.note)}</p>
  </article>`).join('')}` : '<p class="muted-copy">尚無人工修正。AI 原始結果會永久保留。</p>';
  renderPilotReceiptActions(review);
  const dialog = $('#receiving-review-dialog');
  if (!dialog.open) dialog.showModal();
}

async function submitReceivingCorrection(event) {
  event.preventDefault();
  const review = data.receivingReviews.find(entry => entry.id === $('#receiving-review-id').value);
  if (!review) return;
  const changes = [...document.querySelectorAll('[data-receiving-correction]')]
    .map(input => ({ input, correctedValue: input.value.trim(), originalValue: input.dataset.original }))
    .filter(change => change.correctedValue && change.correctedValue !== change.originalValue);
  if (!changes.length) return showToast('請先修正有疑問的欄位');
  if (pilot.cloud) {
    try {
      await Promise.all(changes.map(({ input, correctedValue, originalValue }) => window.PantryBackend.saveReceiptCorrection({
        batchId: review.id,
        ocrFieldId: input.dataset.ocrId,
        oldValue: originalValue,
        newValue: correctedValue
      })));
      await openReceivingReview(review.id);
      showToast('人工值已另存，AI 原值保持不變');
    } catch (error) {
      console.error('Receipt correction failed.', error);
      showToast(`修正未儲存：${error.message}`);
    }
    return;
  }
  const createdAt = new Date().toISOString();
  changes.forEach(({ input, correctedValue, originalValue }, index) => review.corrections.unshift({
    id: `receiving-correction-${Date.now()}-${index}`, rowId: input.dataset.rowId, field: input.dataset.field,
    fieldLabel: receivingFieldLabel(input.dataset.field), originalValue, correctedValue,
    actor: MOCK_SUPERVISOR.name, createdAt
  }));
  review.status = 'completed';
  saveAndRender();
  openReceivingReview(review.id);
  showToast('人工修正已另存，原始辨識結果未覆蓋');
}

function renderPilotReceiptActions(review) {
  const panel = $('#pilot-review-actions');
  if (!panel) return;
  panel.hidden = !pilot.cloud || pilot.profile?.role !== 'ADMIN';
  if (panel.hidden) return;
  $('#pilot-generate-ocr').hidden = review.status === 'completed';
  const correctedFieldIds = new Set((review.corrections || []).map(item => item.ocrFieldId).filter(Boolean));
  const unresolved = (review.cloudBundle?.fields || []).some(field => field.review_status !== 'TRUSTED' && !correctedFieldIds.has(field.id));
  $('#pilot-complete-receipt').disabled = !review.aiRows.length || unresolved || review.status === 'completed';
  const products = review.cloudBundle?.products || pilot.catalog?.products || [];
  const suppliers = review.cloudBundle?.suppliers || pilot.catalog?.suppliers || [];
  const mappings = new Map((review.cloudBundle?.mappings || []).map(mapping => [mapping.row_key, mapping.product_id]));
  $('#pilot-receipt-supplier').innerHTML = `<option value="">選擇供應商</option>${suppliers.map(supplier => `<option value="${supplier.id}">${escapeHTML(supplier.supplier_code)}・${escapeHTML(supplier.name)}</option>`).join('')}`;
  $('#pilot-receipt-date').value = String(review.createdAt || new Date().toISOString()).slice(0, 10);
  $('#pilot-receipt-number').value = review.batchNumber || '';
  $('#pilot-product-mapping').innerHTML = review.aiRows.length ? review.aiRows.map(row => `<div class="pilot-product-map-row">
    <label><span>${escapeHTML(row.product || row.rowKey)}</span>
      <select data-pilot-product-map="${escapeHTML(row.rowKey)}">
        <option value="">先搜尋既有編碼</option>
        ${products.map(product => `<option value="${product.id}" ${mappings.get(row.rowKey) === product.id ? 'selected' : ''}>${escapeHTML(product.product_code)}・${escapeHTML(product.name)} ${escapeHTML(product.specification || '')}</option>`).join('')}
      </select>
    </label>
    <label><span>批號／原廠效期</span><input type="text" data-pilot-lot-code="${escapeHTML(row.rowKey)}" value="${escapeHTML(row.expiryBatch || '')}" placeholder="YYYY-MM-DD 或原廠批號"></label>
    <label><span>儲位（選填）</span><input type="text" data-pilot-storage="${escapeHTML(row.rowKey)}" value="${escapeHTML(row.storage || '')}"></label>
    <button class="text-button" type="button" data-pilot-create-product="${escapeHTML(row.rowKey)}">找不到，建立新編碼</button>
  </div>`).join('') : '<p class="muted-copy">辨識完成後才需要確認商品編碼。</p>';
}

async function createPilotProductFromOcr(rowKey) {
  const review = data.receivingReviews.find(item => item.id === ui.receivingReviewId);
  const row = review?.aiRows.find(item => item.rowKey === rowKey);
  if (!review?.cloudBundle || !row) return;
  const name = String(receivingRowValue(review, row, 'product') || '').trim();
  try {
    const search = await window.PantryBackend.createProduct({ name, confirmCreate: false });
    if (search.candidates.length) {
      const candidates = search.candidates.map(item => `${item.product_code}・${item.name} ${item.specification || ''}`).join('\n');
      window.alert(`可能是同一商品，請先從既有編碼選擇：\n\n${candidates}\n\n若都不是，再由管理員確認建立新商品。`);
      return;
    }
    const productCode = window.prompt('未找到相似商品。請輸入新的物料碼：', 'NEW-');
    if (!productCode) return;
    const specification = window.prompt('請輸入規格（可以留空）：', row.specification || '') ?? '';
    const unit = window.prompt('請輸入盤點單位：', receivingRowValue(review, row, 'unit') || '包');
    if (!unit) return;
    const supplierId = $('#pilot-receipt-supplier').value || null;
    const result = await window.PantryBackend.createProduct({
      confirmCreate: true, productCode: productCode.trim(), name,
      specification: specification.trim(), unit: unit.trim(), category: '其他', supplierId
    });
    pilot.catalog = await window.PantryBackend.loadCatalog();
    await openReceivingReview(review.id);
    const select = document.querySelector(`[data-pilot-product-map="${CSS.escape(rowKey)}"]`);
    if (select) select.value = result.product.id;
    showToast('新商品已建立，Product ID 永久保留');
  } catch (error) {
    console.error('Create product failed.', error);
    showToast(`商品尚未建立：${error.message}`);
  }
}

async function generatePilotOcr() {
  if (!ui.receivingReviewId) return;
  const button = $('#pilot-generate-ocr');
  button.disabled = true;
  button.textContent = '真實辨識中…';
  try {
    await window.PantryBackend.processReceiptOcr(ui.receivingReviewId);
    await refreshCloudReceiptBatches();
    await openReceivingReview(ui.receivingReviewId);
    showToast('已排入背景辨識；完成後會新增 OCR run，原圖與舊版本均保留');
  } catch (error) {
    showToast(`真實辨識失敗：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = '重新執行真實辨識';
  }
}

async function completePilotReceipt() {
  const review = data.receivingReviews.find(item => item.id === ui.receivingReviewId);
  if (!review?.cloudBundle) return;
  const selects = [...document.querySelectorAll('[data-pilot-product-map]')];
  if (!selects.length || selects.some(select => !select.value)) return showToast('請先為每個辨識品項選擇既有商品編碼');
  const supplierId = $('#pilot-receipt-supplier').value;
  const receiptDate = $('#pilot-receipt-date').value;
  const documentNumber = $('#pilot-receipt-number').value.trim();
  if (!supplierId || !receiptDate) return showToast('請先選擇供應商與收貨日期');
  try {
    await Promise.all(selects.map(select => window.PantryBackend.mapReceiptProduct({
      batchId: review.id, rowKey: select.dataset.pilotProductMap, productId: select.value
    })));
    const money = receivingMoneySummary(review);
    const lines = review.aiRows.map(row => {
      const productId = selects.find(select => select.dataset.pilotProductMap === row.rowKey).value;
      const quantity = Number(receivingRowValue(review, row, 'quantity'));
      const unitPrice = Number(receivingRowValue(review, row, 'unitPrice'));
      const subtotal = Number(receivingRowValue(review, row, 'subtotal'));
      const taxRate = Number(row.taxRate || 0.05);
      const tax = Number((subtotal * taxRate).toFixed(2));
      return {
        product_id: productId,
        supplier_id: supplierId,
        specification: row.specification || '',
        quantity,
        unit: receivingRowValue(review, row, 'unit'),
        unit_price_ex_tax: unitPrice,
        line_subtotal_ex_tax: subtotal,
        tax_rate: taxRate,
        tax,
        line_total_inc_tax: Number((subtotal + tax).toFixed(2)),
        batch_or_expiry: document.querySelector(`[data-pilot-lot-code="${CSS.escape(row.rowKey)}"]`)?.value.trim() || '',
        storage_location: document.querySelector(`[data-pilot-storage="${CSS.escape(row.rowKey)}"]`)?.value.trim() || ''
      };
    });
    await window.PantryBackend.finalizeReceipt({
      batchId: review.id,
      supplierId,
      receiptDate,
      documentNumber: documentNumber || review.batchNumber,
      totals: { subtotal: money.untaxedSubtotal || 0, tax: money.tax || 0, total: money.taxInclusiveTotal || 0 },
      lines
    });
    $('#receiving-review-dialog').close();
    await refreshCloudReceiptBatches();
    renderReceiving();
    showToast('已完成 PantryFlow 核對／待 ERP 驗收；原圖、OCR、人工修正與批次均保留');
  } catch (error) {
    console.error('Finalize receipt failed.', error);
    showToast(`收貨尚未完成：${error.message}`);
  }
}

function isCountedToday() {
  return Boolean(data.lastCountAt && new Date(data.lastCountAt).toDateString() === new Date().toDateString());
}

function getCountEntries() {
  return COUNT_AREAS.filter(area => TRIAL_COUNT_AREA_IDS.includes(area.id)).flatMap(area => area.productIds
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
    estimated: Number(baseline.estimated ?? fallbackEstimate),
    confirmedAt: baseline.confirmedAt || product.confirmedAt || dateTimeOffset(-2, 9, 0)
  };
}

function ageInDays(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
}

function freshnessLabel(value) {
  const days = ageInDays(value);
  if (days === null) return '無確認時間・資料不足';
  const timestamp = formatShortDateTime(value);
  if (days === 0) return `${timestamp} 確認・新鮮度高`;
  if (days <= 3) return `${timestamp} 確認・新鮮度中`;
  return `${timestamp} 確認・新鮮度低`;
}

function getCountComparison(key, baseValue) {
  const descriptor = getCountDescriptor(key);
  if (!descriptor) return null;
  const baseline = getCountBaseline(key, descriptor.product);
  const difference = Number((Number(baseValue) - baseline.lastConfirmed).toFixed(3));
  const threshold = Math.max(0.5, Math.abs(baseline.lastConfirmed) * 0.2);
  return { ...baseline, actual: Number(baseValue), difference, threshold, significant: Math.abs(difference) >= threshold };
}

function getCountProgress() {
  const entries = getCountEntries();
  const filled = entries.filter(({ area, product }) => isCountEntryFilled(data.countDraft[countKey(area.id, product.id)], product)).length;
  return { filled, total: entries.length };
}

function getAreaProgress(area) {
  const validProductIds = area.productIds.filter(productId => data.products.some(product => product.id === productId));
  const filled = validProductIds.filter(productId => {
    const product = data.products.find(item => item.id === productId);
    return isCountEntryFilled(data.countDraft[countKey(area.id, productId)], product);
  }).length;
  return { filled, total: validProductIds.length };
}

function isCountEntryFilled(entry, product) {
  if (!entry || !product) return false;
  if (entry.value === '') return Boolean(entry.touched);
  const baseValue = convertToBase(product, entry.value, entry.unit || product.baseUnit);
  return baseValue !== null && baseValue >= 0;
}

function renderTasks() {
  const low = data.products.filter(product => Number(product.qty) < Number(product.safe));
  const prioritizedLow = ['001', '002', '005']
    .map(productId => low.find(product => product.id === productId))
    .filter(Boolean);
  const shortage = [...prioritizedLow, ...low.filter(product => !prioritizedLow.includes(product))].slice(0, 3);
  const expiry = ['004', '002']
    .map(productId => data.products.find(product => product.id === productId))
    .filter(product => product && getActiveExpiryEvent(product));
  const anomalyIssues = data.issues.filter(issue => issue.type === '盤點異常' && isIssueOpen(issue));
  const latestAnomaly = anomalyIssues.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))[0];

  $('#home-shortage-count').textContent = shortage.length;
  $('#home-shortage-copy').textContent = shortage.length
    ? `${shortage.slice(0, 2).map(product => product.name).join('、')}${shortage.length > 2 ? `等 ${shortage.length} 項` : ''}`
    : '目前沒有缺貨風險';
  $('#home-expiry-count').textContent = expiry.length;
  $('#home-expiry-copy').textContent = expiry.length ? expiry.map(product => product.name).join('、') : '目前沒有即期提醒';
  $('#home-expiry-date').textContent = expiry.length
    ? `到期：${formatActualDate(expiry.map(product => product.expiryDate).sort()[0])}`
    : `檢查日：${formatActualDate()}`;
  $('#home-anomaly-count').textContent = anomalyIssues.length;
  $('#home-anomaly-copy').textContent = latestAnomaly?.note || '目前沒有待確認盤點差異';
  $('#home-anomaly-date').textContent = `盤點日：${formatActualDate(latestAnomaly?.createdAt || data.lastCountAt || new Date())}`;
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
  if (entry.firstRecordedAt) return '第一次實盤已保存';
  if (entry.value !== '') return '已自動保存';
  return '未盤';
}

function countLocationCode(areaId, productId) {
  const prefixes = { 'cold-a': 'A', 'work-fridge': 'W', freezer: 'F' };
  return `${prefixes[areaId] || 'I'}-${String(productId).padStart(3, '0')}`;
}

function renderCount() {
  const trialAreas = COUNT_AREAS.filter(item => TRIAL_COUNT_AREA_IDS.includes(item.id));
  $('#count-empty-state').hidden = trialAreas.length > 0;
  $('#count-area-list').hidden = trialAreas.length === 0;
  if (!trialAreas.length) {
    $('#count-area-overview').hidden = false;
    $('#count-area-work').hidden = true;
    $('#count-progress').textContent = '0';
    $('#count-total').textContent = '0';
    return;
  }
  const area = trialAreas.find(item => item.id === ui.countAreaId) || trialAreas[0];
  ui.countAreaId = area.id;
  data.countAreaId = area.id;
  $('#count-area-overview').hidden = ui.countView !== 'areas';
  $('#count-area-work').hidden = ui.countView !== 'area';
  const products = area.productIds.map(productId => data.products.find(product => product.id === productId)).filter(Boolean);
  $('#count-area-empty').hidden = products.length > 0 || pilot.profile?.role !== 'ADMIN';
  $('#count-area-name').textContent = area.name;
  $('#count-role').textContent = pilot.cloud
    ? `${pilot.profile.display_name}・${pilot.profile.role}`
    : `${MOCK_SESSION.name}・${MOCK_SESSION.roleLabel}`;
  $('#count-list').innerHTML = products.map(product => {
    const key = countKey(area.id, product.id);
    const entry = getOrCreateCountEntry(area.id, product.id);
    const locked = Boolean(entry.firstRecordedAt);
    return `
      <article class="count-item count-entry ${locked ? 'recorded' : 'draft'}" data-count-card="${key}">
        <div class="count-product">
          <span><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.productCode || '')}</small></span>
          <span class="count-state">${countStatusLabel(entry)}</span>
        </div>
        <div class="count-entry-row">
          <label class="sr-only" for="count-${key}">${escapeHTML(product.name)}盤點數量</label>
          <input id="count-${key}" type="number" min="0" step="0.01" inputmode="decimal" data-count-value="${key}"
            value="${escapeHTML(entry.value)}" ${locked ? 'disabled' : ''}
            aria-label="${escapeHTML(area.name)} ${escapeHTML(product.name)}數量">
          <b class="count-readonly-unit">${escapeHTML(entry.unit || product.baseUnit)}</b>
          <button class="count-blank-button" type="button" data-count-blank="${key}" ${locked ? 'disabled' : ''}>留白</button>
          <span class="autosave-mark">${locked ? '已保存' : '自動保存'}</span>
        </div>
      </article>`;
  }).join('');

  $$('[data-count-value]').forEach(input => input.addEventListener('input', event => {
    const key = event.currentTarget.dataset.countValue;
    const entry = data.countDraft[key];
    const descriptor = getCountDescriptor(key);
    if (!entry || !descriptor || entry.firstRecordedAt) return;
    entry.value = event.currentTarget.value;
    entry.touched = true;
    entry.baseValue = convertToBase(descriptor.product, entry.value, entry.unit);
    entry.status = 'draft';
    if (!data.countSessionStartedAt) data.countSessionStartedAt = new Date().toISOString();
    saveData();
    queueCloudCountDraft(key);
    updateProgress();
  }));
  $$('[data-count-blank]').forEach(button => button.addEventListener('click', event => {
    const key = event.currentTarget.dataset.countBlank;
    const entry = data.countDraft[key];
    if (!entry || entry.firstRecordedAt) return;
    entry.value = '';
    entry.baseValue = null;
    entry.touched = true;
    entry.status = 'draft';
    const input = document.querySelector(`[data-count-value="${CSS.escape(key)}"]`);
    if (input) input.value = '';
    saveData();
    queueCloudCountDraft(key);
    updateProgress();
  }));
  updateProgress();
}

function renderCountAreaList() {
  const trialAreas = COUNT_AREAS.filter(area => TRIAL_COUNT_AREA_IDS.includes(area.id));
  $('#count-area-list').innerHTML = trialAreas.map((area, index) => {
    const progress = getAreaProgress(area);
    const complete = Boolean(data.countCompletedAreas[area.id]);
    return `
      <button type="button" class="count-area-button ${complete ? 'complete' : ''}" data-count-area="${area.id}">
        <span class="area-order">${complete ? '✓' : index + 1}</span>
        <span class="area-card-copy"><strong>${escapeHTML(area.name)}</strong><small>${progress.total} 項商品・${complete ? '已完成' : `已輸入 ${progress.filled}/${progress.total}`}</small></span>
        <b>›</b>
      </button>`;
  }).join('');
  $$('[data-count-area]').forEach(button => button.addEventListener('click', () => {
    ui.countAreaId = button.dataset.countArea;
    ui.countView = 'area';
    data.countAreaId = ui.countAreaId;
    saveData();
    renderCount();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }));
}

function updateProgress() {
  const progress = getCountProgress();
  const area = COUNT_AREAS.find(item => item.id === ui.countAreaId) || COUNT_AREAS.find(item => TRIAL_COUNT_AREA_IDS.includes(item.id));
  if (!area) return;
  const areaProgress = getAreaProgress(area);
  $('#count-progress').textContent = progress.filled;
  $('#count-total').textContent = progress.total;
  $('#count-area-progress').textContent = `${areaProgress.filled} / ${areaProgress.total} 項`;
  $('#finish-area').textContent = `完成${area.name} 盤點`;
  $('#finish-area').disabled = areaProgress.total === 0 || areaProgress.filled !== areaProgress.total;
  renderCountAreaList();
}

function appendProductHistory(productId, event) {
  if (!Array.isArray(data.productHistory[productId])) data.productHistory[productId] = [];
  data.productHistory[productId].unshift({
    id: event.id || `activity-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: event.createdAt || new Date().toISOString(),
    actor: event.actor || pilotActorName(),
    ...event
  });
}

function recordCountAttempt(key, entry, descriptor, type, snapshot = {}) {
  const createdAt = new Date().toISOString();
  const snapshotValue = snapshot.value !== undefined ? snapshot.value : entry.value;
  const snapshotBaseValue = snapshot.baseValue !== undefined ? snapshot.baseValue : entry.baseValue;
  const attempt = {
    id: `count-${Date.now()}-${entry.attempts.length + 1}`,
    type,
    value: snapshotValue === '' || snapshotValue === null ? null : Number(snapshotValue),
    unit: snapshot.unit || entry.unit,
    baseValue: snapshotBaseValue === null ? null : Number(snapshotBaseValue),
    actor: pilotActorName(),
    actorId: pilot.profile?.id || MOCK_SESSION.userId,
    createdAt,
    area: descriptor.area.name
  };
  entry.attempts.push(attempt);
  data.countEvents.unshift({ ...attempt, countKey: key, productId: descriptor.product.id });
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

function latestCountBaseValue(entry) {
  const latestRecount = [...(entry.attempts || [])].reverse().find(attempt => ['複盤', '更正實盤'].includes(attempt.type));
  if (latestRecount && latestRecount.baseValue !== null && Number.isFinite(Number(latestRecount.baseValue))) return Number(latestRecount.baseValue);
  if (entry.firstBaseValue !== null && Number.isFinite(Number(entry.firstBaseValue))) return Number(entry.firstBaseValue);
  return entry.baseValue !== null && Number.isFinite(Number(entry.baseValue)) ? Number(entry.baseValue) : null;
}

function captureFirstCount(key) {
  const descriptor = getCountDescriptor(key);
  const entry = data.countDraft[key];
  if (!descriptor || !entry || entry.firstRecordedAt) return true;
  if (!entry.touched) return false;
  const blank = entry.value === '';
  const baseValue = blank ? null : convertToBase(descriptor.product, entry.value, entry.unit);
  if (!blank && (baseValue === null || baseValue < 0)) return false;
  entry.baseValue = baseValue;
  entry.firstValue = entry.value;
  entry.firstUnit = entry.unit;
  entry.firstBaseValue = baseValue;
  entry.firstRecordedAt = new Date().toISOString();
  recordCountAttempt(key, entry, descriptor, '第一次實盤', { value: blank ? null : entry.firstValue, unit: entry.firstUnit, baseValue });
  const comparison = blank ? null : getCountComparison(key, baseValue);
  entry.status = !comparison || Math.abs(comparison.difference) > 0.0009 ? 'needs-reason' : 'confirmed';
  if (entry.status === 'confirmed') markEntryConfirmed(entry, '', '本次數量與系統推估一致');
  return true;
}

async function finalizeCountArea(areaId) {
  const area = COUNT_AREAS.find(item => item.id === areaId);
  if (!area) return false;
  const keys = area.productIds
    .filter(productId => data.products.some(product => product.id === productId))
    .map(productId => countKey(area.id, productId));
  if (!keys.every(key => {
    const descriptor = getCountDescriptor(key);
    const entry = data.countDraft[key];
    return descriptor && entry?.touched && (entry.value === '' || convertToBase(descriptor.product, entry.value, entry.unit) !== null);
  })) return false;
  if (!keys.every(key => captureFirstCount(key))) return false;
  if (pilot.cloud) {
    try {
      const session = await ensurePilotCountSession();
      const saved = await window.PantryBackend.completeCountZone({
        sessionId: session.id,
        zoneId: PILOT_ZONE_IDS[area.id],
        entries: keys.map(key => {
          const descriptor = getCountDescriptor(key);
          const entry = data.countDraft[key];
          return {
            productId: pilotProductId(descriptor.product.id),
            quantity: entry.firstBaseValue === null ? null : Number(entry.firstBaseValue),
            unit: entry.firstUnit,
            observationState: entry.firstBaseValue === null ? 'BLANK' : 'COUNTED',
            enteredAt: entry.firstRecordedAt
          };
        })
      });
      saved.forEach(cloudEntry => {
        const entry = data.countDraft[countKey(area.id, localProductId(cloudEntry.product_id))];
        if (entry) entry.cloudInitialEntryId = cloudEntry.id;
      });
    } catch (error) {
      console.error('Count zone completion failed.', error);
      showToast(`尚未完成雲端保存：${error.message}`);
      return false;
    }
  }
  data.countCompletedAreas[area.id] = new Date().toISOString();
  saveAndRender();
  return true;
}

async function finishCurrentArea() {
  const area = COUNT_AREAS.find(item => item.id === ui.countAreaId);
  if (!area || !(await finalizeCountArea(area.id))) return showToast('請先完成這個區域的所有數量');
  const nextArea = COUNT_AREAS.find(item => TRIAL_COUNT_AREA_IDS.includes(item.id) && !data.countCompletedAreas[item.id]);
  if (nextArea) {
    ui.countAreaId = nextArea.id;
    ui.countView = 'area';
    data.countAreaId = nextArea.id;
    saveData();
    renderCount();
    window.scrollTo({ top: 0, behavior: 'auto' });
    showToast(`${area.name}已完成，接著盤${nextArea.name}`);
    return;
  }
  ui.currentSummary = aggregateCountDraft();
  data.lastCountSummary = ui.currentSummary.map(item => ({ ...item }));
  ui.summaryStage = 'complete';
  if (pilot.cloud && pilot.countSession) {
    pilot.countSession = await window.PantryBackend.setCountSessionStatus(pilot.countSession.id, 'COMPLETED');
  }
  saveData();
  renderSummary(ui.currentSummary);
  go('summary');
  showToast('所有區域已完成，現在統一整理差異');
}

function markEntryConfirmed(entry, reason = '', resolution = '') {
  entry.status = 'confirmed';
  entry.reason = reason;
  entry.resolution = resolution;
  entry.confirmedAt = new Date().toISOString();
}

function focusNextCountEntry(currentKey) {
  const entries = getCountEntries();
  const currentIndex = Math.max(0, entries.findIndex(({ area, product }) => countKey(area.id, product.id) === currentKey));
  const ordered = [...entries.slice(currentIndex + 1), ...entries.slice(0, currentIndex + 1)];
  const next = ordered.find(({ area, product }) => !data.countDraft[countKey(area.id, product.id)]?.firstRecordedAt);
  if (!next) {
    renderCount();
    showToast('所有品項都已輸入，可以查看差異摘要');
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
  return [
    [formatShortDateTime(comparison.confirmedAt), `${formatNumber(comparison.lastConfirmed)} ${unit}`],
    [formatShortDateTime(entry.firstRecordedAt), `${formatNumber(comparison.actual)} ${unit}`],
    ['差異', signed(comparison.difference)]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function openCountReview(key) {
  const descriptor = getCountDescriptor(key);
  const entry = data.countDraft[key];
  if (!descriptor || !entry?.firstRecordedAt) return;
  ui.reviewCountKey = key;
  const actual = latestCountBaseValue(entry);
  const comparison = actual === null ? null : getCountComparison(key, actual);
  $('#review-stage').textContent = '差異整理';
  $('#review-product-name').textContent = descriptor.product.name;
  $('#review-product-area').textContent = `${descriptor.area.name}・${descriptor.product.baseUnit}`;
  $('#review-lead').textContent = comparison ? '原始實盤已保存。請選擇原因，系統會新增記錄，不會覆蓋第一次實盤。' : '本次保存的是空白，不等於 0。請使用「輸入錯誤／重新輸入」追加正確數量。';
  $('#review-comparison').innerHTML = comparison ? comparisonRows(comparison, descriptor.product, entry) : `<div><span>${escapeHTML(formatShortDateTime(entry.firstRecordedAt))}</span><strong>空白（非 0）</strong></div>`;
  $('#recount-form').hidden = true;
  $('#reason-step').hidden = false;
  $('#recount-value').value = '';
  $('#recount-unit').textContent = descriptor.product.baseUnit;
  $('#recount-ratio').textContent = `單位（唯讀）：${descriptor.product.baseUnit}・原始實盤不會被覆蓋`;
  const dialog = $('#count-review-dialog');
  if (!dialog.open) dialog.showModal();
}

async function submitRecount(event) {
  event.preventDefault();
  const key = ui.reviewCountKey;
  const descriptor = getCountDescriptor(key);
  const entry = data.countDraft[key];
  if (!descriptor || !entry) return;
  const value = $('#recount-value').value;
  const unit = descriptor.product.baseUnit;
  const baseValue = convertToBase(descriptor.product, value, unit);
  if (baseValue === null || baseValue < 0) {
    showToast('請輸入正確的複盤數量');
    return;
  }
  if (pilot.cloud) {
    try {
      const cloudEntry = await window.PantryBackend.appendCountCorrection({
        sessionId: pilot.countSession.id,
        zoneId: PILOT_ZONE_IDS[descriptor.area.id],
        productId: pilotProductId(descriptor.product.id),
        quantity: baseValue,
        unit,
        parentEntryId: entry.cloudInitialEntryId,
        entryType: 'CORRECTION'
      });
      entry.cloudFinalEntryId = cloudEntry.id;
      const baseline = getCountBaseline(key, descriptor.product);
      await window.PantryBackend.saveDiscrepancy({
        session_id: pilot.countSession.id,
        zone_id: PILOT_ZONE_IDS[descriptor.area.id],
        product_id: pilotProductId(descriptor.product.id),
        initial_entry_id: entry.cloudInitialEntryId,
        final_entry_id: cloudEntry.id,
        previous_quantity: baseline.lastConfirmed,
        previous_confirmed_at: baseline.confirmedAt || null,
        estimated_quantity: baseline.estimated,
        difference: Number((baseValue - baseline.lastConfirmed).toFixed(3)),
        reason: 'INPUT_ERROR', status: 'ANSWERED',
        answered_by: pilot.profile.id, answered_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Count correction failed.', error);
      return showToast(`更正尚未保存：${error.message}`);
    }
  }
  entry.reviewBaseValue = baseValue;
  recordCountAttempt(key, entry, descriptor, '更正實盤', { value, unit, baseValue });
  markEntryConfirmed(entry, 'input-error', '已新增更正記錄，原始實盤保留');
  saveAndRender();
  $('#count-review-dialog').close();
  renderSummary(ui.currentSummary.length ? ui.currentSummary : aggregateCountDraft());
  showToast(`${descriptor.product.name}更正紀錄已另存`);
}

function applyConfirmedProductFromCount(productId, detail) {
  const product = data.products.find(item => item.id === productId);
  const entries = getCountEntries().filter(item => item.product.id === productId);
  if (!product || !entries.length || entries.some(item => data.countDraft[countKey(item.area.id, productId)]?.status !== 'confirmed')) return false;
  const total = entries.reduce((sum, item) => sum + (latestCountBaseValue(data.countDraft[countKey(item.area.id, productId)]) || 0), 0);
  const before = Number(product.qty);
  const after = Number(total.toFixed(3));
  const createdAt = new Date().toISOString();
  product.qty = after;
  product.confirmedAt = createdAt;
  data.inventoryHistory.unshift({ id: `count-confirm-${Date.now()}-${product.id}`, productId, before, after, reason: detail, actor: pilotActorName(), createdAt });
  appendProductHistory(productId, { type: '庫存確認', quantity: after, unit: product.baseUnit, actor: pilotActorName(), createdAt, detail: `${detail}・原始實盤與複盤事件均保留` });
  return true;
}

function findOtherCountArea(productId, currentAreaId) {
  return COUNT_AREAS.find(area => area.id !== currentAreaId
    && area.productIds.includes(productId)
    && data.countDraft[countKey(area.id, productId)]?.status !== 'confirmed');
}

async function chooseCountReason(reason) {
  const key = ui.reviewCountKey;
  const descriptor = getCountDescriptor(key);
  const entry = data.countDraft[key];
  if (!descriptor || !entry) return;
  if (latestCountBaseValue(entry) === null && reason !== 'input-error') return showToast('空白不等於數量，請選擇輸入錯誤並追加正確數量');
  if (reason === 'input-error') {
    $('#reason-step').hidden = true;
    $('#recount-form').hidden = false;
    $('#review-lead').textContent = '請輸入正確數量。系統會新增更正記錄，第一次實盤仍完整保留。';
    window.requestAnimationFrame(() => $('#recount-value')?.focus());
    return;
  }
  const createdAt = new Date().toISOString();
  const reasonLabel = COUNT_REASON_LABELS[reason] || COUNT_REASON_LABELS.other;
  if (pilot.cloud) {
    const reasonMap = {
      misplaced: 'MISSED_OR_WRONG_ZONE', discard: 'WASTE_NOT_RECORDED',
      transfer: 'TRANSFER_NOT_RECORDED', receipt: 'RECEIPT_NOT_RECORDED', other: 'OTHER'
    };
    const baseline = getCountBaseline(key, descriptor.product);
    const finalValue = latestCountBaseValue(entry);
    try {
      await window.PantryBackend.saveDiscrepancy({
        session_id: pilot.countSession.id,
        zone_id: PILOT_ZONE_IDS[descriptor.area.id],
        product_id: pilotProductId(descriptor.product.id),
        initial_entry_id: entry.cloudInitialEntryId,
        final_entry_id: entry.cloudFinalEntryId || null,
        previous_quantity: baseline.lastConfirmed,
        previous_confirmed_at: baseline.confirmedAt || null,
        estimated_quantity: baseline.estimated,
        difference: Number((finalValue - baseline.lastConfirmed).toFixed(3)),
        reason: reasonMap[reason] || 'OTHER', status: 'ANSWERED',
        answered_by: pilot.profile.id, answered_at: createdAt
      });
    } catch (error) {
      console.error('Count discrepancy failed.', error);
      return showToast(`差異原因尚未保存：${error.message}`);
    }
  }
  markEntryConfirmed(entry, reason, `${reasonLabel}已記錄`);
  const eventType = reason === 'discard' ? '待補廢棄紀錄'
    : reason === 'transfer' ? '待補借貸紀錄'
      : reason === 'receipt' ? '待補收貨紀錄'
        : reason === 'misplaced' ? '待確認其他區域'
          : '盤點差異原因';
  const event = {
    id: `count-reason-${Date.now()}`, type: eventType,
    value: Number(entry.firstValue), unit: entry.firstUnit,
    baseValue: Number(entry.firstBaseValue), actor: pilotActorName(),
    createdAt, area: descriptor.area.name, countKey: key, productId: descriptor.product.id,
    reason: reasonLabel
  };
  data.countEvents.unshift(event);
  appendProductHistory(descriptor.product.id, {
    id: event.id, type: eventType, quantity: event.value, unit: event.unit,
    actor: event.actor, createdAt, detail: `${descriptor.area.name}・${reasonLabel}`
  });
  saveAndRender();
  $('#count-review-dialog').close();
  renderSummary(ui.currentSummary.length ? ui.currentSummary : aggregateCountDraft());
  showToast(`${descriptor.product.name}已記錄：${reasonLabel}`);
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
  const latestConfirmedAt = product.confirmedAt || (data.productHistory[product.id] || [])
    .filter(entry => /盤點|庫存確認/.test(String(entry.type || '')))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]?.createdAt;
  if (!latestConfirmedAt) return { label: '偏低', detail: '尚無確認時間', ageDays: null };
  const ageDays = Math.max(0, (Date.now() - new Date(latestConfirmedAt).getTime()) / 86400000);
  if (ageDays <= 1) return { label: '高', detail: '24 小時內曾確認', ageDays };
  if (ageDays <= 3) return { label: '中', detail: '3 天內曾確認', ageDays };
  return { label: '偏低', detail: '資料較舊，建議先快速確認', ageDays };
}

function getOpenPurchaseOrders(productId) {
  return data.purchaseOrders
    .filter(order => order.productId === productId && !['received', 'cancelled'].includes(order.status))
    .sort((a, b) => new Date(a.eta || 8640000000000000) - new Date(b.eta || 8640000000000000));
}

function formatEta(value) {
  if (!value) return '時間待確認';
  return formatActualDateTime(value);
}

function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function getLowStockAnalysis(product) {
  const confirmed = Number(product.qty) || 0;
  const safety = Number(product.safe) || 0;
  const gap = Math.max(0, safety - confirmed);
  const [dailyMin, dailyMax] = DAILY_USE_RANGES[product.id] || [0.5, 1];
  const daysMin = dailyMax > 0 ? confirmed / dailyMax : 0;
  const daysMax = dailyMin > 0 ? confirmed / dailyMin : daysMin;
  const orders = getOpenPurchaseOrders(product.id);
  const inbound = orders.reduce((total, order) => {
    const converted = convertToBase(product, order.quantity, order.unit || product.baseUnit);
    return total + (converted === null ? 0 : converted);
  }, 0);
  const earliest = orders[0] || null;
  const daysUntilEta = earliest?.eta
    ? Math.max(0, (new Date(earliest.eta).getTime() - Date.now()) / 86400000)
    : null;
  const beforeArrival = daysUntilEta === null ? confirmed : confirmed - dailyMax * daysUntilEta;
  const afterArrival = beforeArrival + inbound;
  const risk = confirmed < safety && (
    !earliest || beforeArrival <= 0 || afterArrival < safety
  );
  const reliability = getInventoryReliability(product);
  const conclusion = reliability.label === '偏低'
    ? '資料不足，無法判斷'
    : earliest && !risk
      ? '已有補貨，暫時不用處理'
      : earliest && beforeArrival > 0
        ? '已有補貨，但建議確認'
        : '到貨前可能不足，需要處理';
  const riskText = earliest
    ? (beforeArrival <= 0 ? '預計到貨前可能用完' : afterArrival < safety ? '到貨後仍可能偏低' : '已叫貨可降低缺貨風險')
    : '沒有已叫貨紀錄，無法確認到貨支援';
  const daysText = reliability.label === '偏低'
    ? '資料不足，無法可靠估算'
    : `約 ${Math.max(0, Math.floor(daysMin))}～${Math.max(1, Math.ceil(daysMax))} 天`;
  return {
    current: confirmed, confirmed, safety, gap, dailyMin, dailyMax, daysMin, daysMax, daysText,
    orders, inbound, earliest, beforeArrival, afterArrival, risk, riskText,
    reliability, conclusion
  };
}

function receivingState(analysis) {
  if (!analysis.orders.length) return '無叫貨資料，無法判斷';
  const today = new Date().toDateString();
  const todayOrders = analysis.orders.filter(order => order.eta && new Date(order.eta).toDateString() === today);
  if (!todayOrders.length) return '今日無預定到貨';
  if (todayOrders.some(order => order.status === 'received' || order.receivedAt)) return '今日預定已確認收貨';
  if (todayOrders.some(order => new Date(order.eta).getTime() < Date.now())) return '預定時間已過仍未收到';
  return '今日有預定但尚未確認收貨';
}

function getActionPlan(eventType) {
  return data.actionPlans?.[eventType] || normalizeActionPlans()[eventType];
}

function actionPlanMarkup(eventType) {
  const plan = getActionPlan(eventType);
  if (!plan) return '';
  return `<div class="action-plan"><span>主管已設定處理方案</span><ol>${plan.steps.map(step => `
    <li class="${escapeHTML(step.level)}"><b>${escapeHTML(step.text)}</b><small>${escapeHTML(ACTION_LEVEL_LABELS[step.level])}</small></li>
  `).join('')}</ol></div>`;
}

function lowStockSummaryMarkup(product) {
  const analysis = getLowStockAnalysis(product);
  const borrowOptions = analysis.risk ? (STORE_BORROW_OPTIONS[product.id] || []) : [];
  const expiryNote = product.expiryDate
    ? `<div class="low-expiry-note"><span>效期提醒</span><strong>${escapeHTML(expiryLabel(product))}</strong><small>效期僅作附屬提示，請先處理庫存風險。</small></div>`
    : '';
  const result = analysis.risk
    ? (analysis.earliest ? `${product.name}可能在下次到貨前用完` : `${product.name}庫存不足，尚無補貨資料`)
    : `${product.name}：${analysis.conclusion}`;
  return `
    <section class="action-result ${analysis.risk ? 'critical' : ''}">
      <span>結果</span>
      <h3>${escapeHTML(result)}</h3>
      <p>${escapeHTML(analysis.riskText)}</p>
    </section>
    <section class="action-layer"><h3>原因</h3><ul class="reason-summary">
      <li>已確認庫存 ${formatNumber(analysis.confirmed)} ${escapeHTML(product.baseUnit)}，安全庫存 ${formatNumber(analysis.safety)} ${escapeHTML(product.baseUnit)}</li>
      <li>${analysis.earliest ? `下一批預計 ${escapeHTML(formatEta(analysis.earliest.eta))}` : '目前沒有可用的正式叫貨紀錄'}</li>
      <li>${escapeHTML(analysis.reliability.detail)}</li>
    </ul></section>
    <section class="action-layer"><h3>你現在可以</h3>
      ${actionPlanMarkup('low-stock')}
      <div class="primary-actions">
        ${borrowOptions.length ? '<button type="button" class="full-button" data-low-action="borrow">查看可能可借門市</button>' : ''}
        <button type="button" class="${borrowOptions.length ? 'outline-button' : 'full-button'}" data-low-action="confirm">確認其他庫位／現場數量</button>
        ${analysis.risk ? '<button type="button" class="outline-button" data-low-action="order-guidance">查看備援叫貨流程</button>' : ''}
      </div>
    </section>
    <details class="action-details"><summary>查看判斷依據與異動紀錄</summary>
      <dl class="low-detail-list">
        <div><dt>已確認庫存</dt><dd>${formatNumber(analysis.confirmed)} ${escapeHTML(product.baseUnit)}</dd></div>
        <div><dt>安全庫存（唯讀）</dt><dd>${formatNumber(analysis.safety)} ${escapeHTML(product.baseUnit)}</dd></div>
        <div><dt>差距</dt><dd>${analysis.gap ? `少 ${formatNumber(analysis.gap)}` : '已達標'} ${escapeHTML(product.baseUnit)}</dd></div>
        <div><dt>預估可撐</dt><dd>${escapeHTML(analysis.daysText)}</dd></div>
        <div><dt>已叫貨</dt><dd>${analysis.inbound ? `${formatNumber(analysis.inbound)} ${escapeHTML(product.baseUnit)}` : '沒有人工紀錄'}</dd></div>
        <div><dt>收貨狀態</dt><dd>${escapeHTML(receivingState(analysis))}</dd></div>
      </dl>
      ${expiryNote}
      <div class="detail-actions"><button type="button" data-low-action="orders">查看已叫貨紀錄</button><button type="button" data-low-action="history">查看近期異動</button></div>
    </details>`;
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
      <h3>盲式快速確認</h3><p>輸入前不顯示舊數字。提交後才比較上次確認與系統推估。</p>
      <label>現場數量<span class="count-entry-control"><input id="low-confirm-qty" type="number" min="0" step="0.01" inputmode="decimal" required autocomplete="off"><b class="readonly-unit">${escapeHTML(product.baseUnit)}</b></span></label>
      <button class="full-button" type="submit">提交並比較</button>
    </form>`;
    return;
  }
  if (step === 'borrow') {
    const options = STORE_BORROW_OPTIONS[product.id] || [];
    $('#low-stock-content').innerHTML = `${back}<section class="progressive-step"><p class="step-kicker">先聯絡門市確認</p><h3>可能可借門市</h3>
      ${options.length ? `<div class="borrow-options">${options.map(option => `<div><strong>${escapeHTML(option.store)}・可能 ${formatNumber(option.possibleQuantity)} ${escapeHTML(option.unit)}</strong><small>最近確認 ${escapeHTML(formatTime(option.confirmedAt))}</small></div>`).join('')}<small>這不是即時絕對庫存，借貨前仍需與對方門市確認。</small></div>` : '<div class="notice">目前沒有可用的其他門市確認資料</div>'}
      <button type="button" class="outline-button" data-low-action="order-guidance">無法借貨，查看備援流程</button></section>`;
    return;
  }
  if (step === 'confirm-review') {
    const discrepancy = data.stockDiscrepancies.find(item => item.id === ui.lowDiscrepancyId);
    if (!discrepancy) return renderLowStockContent('summary');
    $('#low-stock-content').innerHTML = `${back}<section class="progressive-step">
      <p class="step-kicker">提交後才揭露</p><h3>庫存數量有差異</h3>
      <div class="comparison-grid">
        <div><span>本次現場確認</span><strong>${formatNumber(discrepancy.actual)} ${escapeHTML(product.baseUnit)}</strong></div>
        <div><span>上次確認庫存</span><strong>${formatNumber(discrepancy.before)} ${escapeHTML(product.baseUnit)}</strong></div>
        <div><span>推估庫存</span><strong>${formatNumber(discrepancy.estimated)} ${escapeHTML(product.baseUnit)}</strong></div>
        <div><span>差異</span><strong>${discrepancy.difference > 0 ? '+' : ''}${formatNumber(discrepancy.difference)} ${escapeHTML(product.baseUnit)}</strong></div>
      </div>
      <form id="low-discrepancy-form" class="progressive-form">
        <label>確認原因<select id="low-discrepancy-reason" required><option value="">請選擇</option><option>現場重新確認後數量</option><option>報廢／使用未登錄</option><option>收貨／跨店異動未登錄</option><option>放錯區域</option><option>其他，交主管追蹤</option></select></label>
        <button class="full-button" type="submit">建立更正事件並更新已確認庫存</button>
      </form>
      <button type="button" class="timeline-link" data-low-action="history">先查看近期異動 ›</button>
    </section>`;
    return;
  }
  if (step === 'orders') {
    const orders = getOpenPurchaseOrders(product.id);
    $('#low-stock-content').innerHTML = `${back}<section class="progressive-step"><h3>已叫貨（人工紀錄）</h3>
      <p class="manual-data-warning">人工紀錄，非 ERP 即時同步資料。</p>
      ${orders.length ? `<div class="order-list">${orders.map(order => `<article><strong>${formatNumber(order.quantity)} ${escapeHTML(order.unit || product.baseUnit)}・${escapeHTML(order.supplier)}</strong><small>預計 ${escapeHTML(formatEta(order.eta))}・${escapeHTML(receivingState({ orders: [order] }))}</small></article>`).join('')}</div>` : '<div class="notice">沒有叫貨資料，無法判斷是否已正式叫貨</div>'}
      <button type="button" class="full-button" data-low-action="order-guidance">查看叫貨建議</button></section>`;
    return;
  }
  if (step === 'order-guidance') {
    $('#low-stock-content').innerHTML = `${back}<section class="progressive-step order-guidance">
      <p class="step-kicker">PantryFlow 只提醒與追蹤</p><h3>建議進行叫貨</h3>
      <p>請於公司指定系統完成正式叫貨。PantryFlow 不會代替 ERP 或公司叫貨系統送單。</p>
      <button type="button" class="full-button" data-low-action="manual-order">我已完成正式叫貨</button>
    </section>`;
    return;
  }
  if (step === 'manual-order') {
    $('#low-stock-content').innerHTML = `${back}<form id="low-order-form" class="progressive-form">
      <h3>人工登錄正式叫貨結果</h3><p class="manual-data-warning">人工紀錄，非 ERP 即時同步資料。</p>
      <label>實際叫貨數量<span class="count-entry-control"><input id="low-order-qty" type="number" min="0.01" step="0.01" inputmode="decimal" required><b class="readonly-unit">${escapeHTML(product.baseUnit)}</b></span></label>
      <label>供應商／公司系統備註<input id="low-order-supplier" placeholder="例如：公司叫貨系統" required></label>
      <label>預計到貨時間<input id="low-order-eta" type="datetime-local" required></label>
      <button class="full-button" type="submit">儲存人工叫貨紀錄</button>
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
  if (['summary', 'confirm', 'borrow', 'orders', 'order-guidance', 'manual-order'].includes(action)) {
    renderLowStockContent(action);
    return;
  }
  if (action === 'history') {
    ui.timelineReturnLowId = ui.lowProductId;
    $('#low-stock-dialog').close();
    openTimeline(ui.lowProductId);
    return;
  }
}

function submitLowStockStep(event) {
  event.preventDefault();
  const product = data.products.find(item => item.id === ui.lowProductId);
  if (!product) return;
  if (event.target.id === 'low-confirm-form') {
    const value = Number($('#low-confirm-qty').value);
    const unit = product.baseUnit;
    const after = convertToBase(product, value, unit);
    if (after === null || after < 0) return showToast('請輸入正確的現場數量');
    const before = Number(product.qty);
    const estimated = Number(getCountEntries()
      .filter(item => item.product.id === product.id)
      .reduce((sum, item) => sum + getCountBaseline(countKey(item.area.id, product.id), product).estimated, 0).toFixed(3));
    const difference = Number((after - estimated).toFixed(3));
    const significant = Math.abs(difference) >= Math.max(0.5, Math.abs(estimated) * 0.2);
    const createdAt = new Date().toISOString();
    const discrepancy = {
      id: `stock-check-${Date.now()}`, productId: product.id, before, estimated, actual: after,
      difference, status: significant ? 'awaiting-reason' : 'confirmed', actor: MOCK_SESSION.name, createdAt,
      originalPreserved: true, reason: significant ? '' : '差異在容許範圍內'
    };
    data.stockDiscrepancies.unshift(discrepancy);
    appendProductHistory(product.id, { type: '快速確認提交', quantity: value, unit, actor: MOCK_SESSION.name, createdAt, detail: '盲式輸入；原始數字已保留' });
    if (significant) {
      ui.lowDiscrepancyId = discrepancy.id;
      saveData();
      renderLowStockContent('confirm-review');
      showToast('已保存現場數量，請選擇差異原因');
      return;
    }
    product.qty = after;
    product.confirmedAt = createdAt;
    data.inventoryHistory.unshift({ id: discrepancy.id, productId: product.id, before, after, reason: '快速確認庫存', actor: MOCK_SESSION.name, createdAt });
    appendProductHistory(product.id, { type: '庫存確認', quantity: value, unit, actor: MOCK_SESSION.name, createdAt, detail: `上次確認 ${formatNumber(before)} → 本次確認 ${formatNumber(after)} ${product.baseUnit}` });
    saveAndRender();
    renderLowStockContent('summary');
    showToast(`${product.name}已確認庫存已更新`);
    return;
  }
  if (event.target.id === 'low-discrepancy-form') {
    const discrepancy = data.stockDiscrepancies.find(item => item.id === ui.lowDiscrepancyId && item.productId === product.id);
    const reason = $('#low-discrepancy-reason').value;
    if (!discrepancy || !reason) return showToast('請先選擇差異原因');
    const createdAt = new Date().toISOString();
    discrepancy.status = reason === '其他，交主管追蹤' ? 'follow-up' : 'confirmed';
    discrepancy.reason = reason;
    discrepancy.resolvedBy = MOCK_SESSION.name;
    discrepancy.resolvedAt = createdAt;
    product.qty = discrepancy.actual;
    product.confirmedAt = createdAt;
    data.inventoryHistory.unshift({ id: `stock-correction-${Date.now()}`, productId: product.id, before: discrepancy.before, after: discrepancy.actual, reason: `庫存更正事件：${reason}`, actor: MOCK_SESSION.name, createdAt, sourceId: discrepancy.id });
    appendProductHistory(product.id, { type: '庫存更正事件', quantity: discrepancy.actual, unit: product.baseUnit, actor: MOCK_SESSION.name, createdAt, detail: `${reason}・上次確認 ${formatNumber(discrepancy.before)} 保留` });
    if (discrepancy.status === 'follow-up') {
      data.issues.unshift(normalizeIssue({ id: `stock-followup-${Date.now()}`, type: '商品／庫存', note: `${product.name}庫存差異需主管追蹤`, productId: product.id, status: 'pending', nextAction: '核對近期異動與現場區域', createdAt }));
    }
    saveAndRender();
    renderLowStockContent('summary');
    showToast('已建立更正事件；原始數字保留');
    return;
  }
  if (event.target.id === 'low-order-form') {
    const quantity = Number($('#low-order-qty').value);
    const unit = product.baseUnit;
    const eta = $('#low-order-eta').value;
    const supplier = $('#low-order-supplier').value.trim();
    if (!Number.isFinite(quantity) || quantity <= 0 || !eta || !supplier) return showToast('請完成叫貨資料');
    const createdAt = new Date().toISOString();
    const order = normalizePurchaseOrder({ id: `po-${Date.now()}`, productId: product.id, quantity, unit, eta: new Date(eta).toISOString(), supplier, updatedAt: createdAt, updatedBy: MOCK_SESSION.name, source: 'manual', formalSystemConfirmed: true });
    data.purchaseOrders.unshift(order);
    appendProductHistory(product.id, { type: '正式叫貨完成（人工登錄）', quantity, unit, actor: MOCK_SESSION.name, createdAt, detail: `${supplier}・預計 ${formatEta(order.eta)}・非 ERP 即時同步` });
    saveAndRender();
    renderLowStockContent('summary');
    showToast(`${product.name}人工叫貨紀錄已保存`);
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
      ? `${product.area}・安全庫存 ${formatNumber(product.safe)} ${product.unit}`
      : `${product.area}・${expiryLabel(product)}`;
    return `
      <button class="inventory-item ${status}" data-product-id="${product.id}">
        <i class="item-status"></i>
        <span class="inventory-copy"><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(secondary)}</small></span>
        <span class="inventory-qty"><strong>${formatNumber(product.qty)}</strong> <span>${escapeHTML(product.unit)}</span><small>已確認庫存・${status === 'expiry' ? '處理效期' : status === 'low' ? '查看風險' : '查看'} ›</small></span>
      </button>
    `;
  }).join('') || '<div class="notice">找不到符合的商品</div>';

  $$('#inventory-list [data-product-id]').forEach(button => button.addEventListener('click', () => {
    const product = data.products.find(item => item.id === button.dataset.productId);
    if (productStatus(product) === 'low') openLowStockDialog(product.id);
    else openProductDialog(product.id);
  }));
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

function issuePlanKey(issue) {
  if (issue.type === '設備故障') return 'equipment';
  if (issue.type === '效期資訊') return 'expiry';
  if (['收貨／供應商', '商品／庫存'].includes(issue.type)) return 'low-stock';
  return '';
}

function issueTrackingFormMarkup(issue, status) {
  const equipment = issue.type === '設備故障';
  const formId = equipment ? 'issue-equipment-form' : 'issue-generic-form';
  const statusId = equipment ? 'equipment-status' : 'generic-issue-status';
  const nextId = equipment ? 'equipment-next-action' : 'generic-next-action';
  const expectedId = equipment ? 'equipment-expected-at' : 'generic-expected-at';
  return `<details class="inline-update">
    <summary>更新處理進度</summary>
    <form id="${formId}" class="progressive-form">
      <p class="manual-data-warning">現場先溝通與處理；PantryFlow 只記住未完成事項、待辦與交接。</p>
      ${equipment ? `<div class="issue-facts">
        <label><input id="equipment-manager-aware" type="checkbox" ${issue.managerAware ? 'checked' : ''}> 主管已知悉</label>
        <label><input id="equipment-external-contacted" type="checkbox" ${issue.externalContacted ? 'checked' : ''}> 已聯絡維修商／外部單位</label>
      </div>` : ''}
      <label>現在狀態<select id="${statusId}">
        <option value="processing" ${status === 'processing' ? 'selected' : ''}>處理中</option>
        <option value="waiting-external" ${status === 'waiting-external' ? 'selected' : ''}>等待外部</option>
        <option value="resolved">已解決</option>
      </select></label>
      <label>下一個待辦<input id="${nextId}" value="${escapeHTML(issue.nextAction || '')}" required></label>
      <label>預計處理時間<input id="${expectedId}" type="datetime-local" value="${escapeHTML(toDateTimeLocal(issue.expectedAt))}"></label>
      <button class="full-button" type="submit">保存追蹤與交接</button>
    </form>
  </details>`;
}

function issueTimelineMarkup(issue) {
  const entries = [...(issue.events || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return entries.length
    ? `<div class="issue-event-list">${entries.slice(0, 8).map(item => `<p><strong>${escapeHTML(item.detail)}</strong><small>${escapeHTML(item.actor)}・${escapeHTML(formatTime(item.createdAt))}</small></p>`).join('')}</div>`
    : '<p class="muted-copy">尚無更新紀錄。</p>';
}

function renderIssueWorkflow() {
  const issue = data.issues.find(item => item.id === ui.issueId);
  if (!issue) return;
  const product = getIssueProduct(issue);
  const status = issue.status || 'pending';
  $('#issue-workflow-title').textContent = issue.note;
  $('#issue-workflow-status').textContent = `${ISSUE_STATUS_LABELS[status]}・${issue.type}・${formatTime(issue.createdAt)}`;
  const reporter = issue.reporter || MOCK_SESSION.name;
  const planKey = issuePlanKey(issue);
  const reasonItems = [
    `${reporter}・${formatTime(issue.createdAt)}`,
    issue.type === '設備故障'
      ? `${issue.managerAware ? '主管已知悉' : '主管尚未確認知悉'}・${issue.externalContacted ? '已聯絡維修商' : '尚未記錄外部聯絡'}`
      : (product ? `關聯商品：${product.name}` : '尚未連結商品'),
    issue.expectedAt ? `預計處理：${formatEta(issue.expectedAt)}` : ''
  ].filter(Boolean);
  const resultCopy = status === 'resolved'
    ? '這件事已完成並保留處理紀錄'
    : status === 'waiting-external'
      ? `${issue.note}｜目前等待外部`
      : `${issue.note}｜仍需追蹤`;
  $('#issue-workflow-content').innerHTML = `
    <section class="action-result ${status === 'resolved' ? 'resolved' : ''}">
      <span>結果</span><h3>${escapeHTML(resultCopy)}</h3>
      <p>${status === 'resolved' ? `${escapeHTML(issue.resolvedBy || reporter)}・${escapeHTML(formatTime(issue.resolvedAt))}` : escapeHTML(ISSUE_STATUS_LABELS[status])}</p>
    </section>
    <section class="action-layer">
      <h3>原因</h3>
      <ul class="reason-summary">${reasonItems.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
    </section>
    <section class="action-layer solution-layer">
      <h3>${status === 'resolved' ? '處理結果' : '你現在可以'}</h3>
      ${status === 'resolved'
        ? `<p>${escapeHTML(issue.nextAction || ISSUE_RESOLUTION_LABELS[issue.resolutionAction] || '已完成現場處理')}</p>`
        : `${planKey ? actionPlanMarkup(planKey) : ''}
          <div class="current-next"><span>目前</span><strong>${escapeHTML(ISSUE_STATUS_LABELS[status])}</strong><small>下一步：${escapeHTML(issue.nextAction || '確認現場下一個待辦')}</small></div>
          ${issueTrackingFormMarkup(issue, status)}`}
    </section>
    <details class="action-details">
      <summary>查看追蹤紀錄與詳細資料</summary>
      ${product ? `<p>已確認庫存 ${formatNumber(product.qty)} ${escapeHTML(product.baseUnit)}・${escapeHTML(freshnessLabel(product.confirmedAt))}</p>` : ''}
      ${issueTimelineMarkup(issue)}
    </details>`;
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
  const status = event.target.closest('[data-issue-status]')?.dataset.issueStatus;
  if (!status) return;
  setIssueStatus(issue, status, '現場確認異常已解決');
  saveAndRender();
  renderIssueWorkflow();
}

function submitIssueWorkflow(event) {
  if (event.target.id === 'issue-equipment-form') {
    event.preventDefault();
    const issue = data.issues.find(item => item.id === ui.issueId);
    if (!issue) return;
    issue.managerAware = $('#equipment-manager-aware').checked;
    issue.externalContacted = $('#equipment-external-contacted').checked;
    issue.nextAction = $('#equipment-next-action').value.trim();
    issue.expectedAt = $('#equipment-expected-at').value ? new Date($('#equipment-expected-at').value).toISOString() : '';
    setIssueStatus(issue, $('#equipment-status').value, `追蹤更新：${issue.nextAction}`);
    saveAndRender();
    renderIssueWorkflow();
    showToast('設備異常追蹤已更新');
    return;
  }
  if (event.target.id === 'issue-generic-form') {
    event.preventDefault();
    const issue = data.issues.find(item => item.id === ui.issueId);
    if (!issue) return;
    issue.nextAction = $('#generic-next-action').value.trim();
    issue.expectedAt = $('#generic-expected-at').value ? new Date($('#generic-expected-at').value).toISOString() : '';
    setIssueStatus(issue, $('#generic-issue-status').value, `交接更新：${issue.nextAction}`);
    saveAndRender();
    renderIssueWorkflow();
    showToast('異常待辦已更新');
    return;
  }
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
}

async function refreshPilotOperations() {
  if (!pilot.cloud || !window.PantryBackend.currentStore) return;
  const activityNode = $('#pilot-activity-list');
  const notificationNode = $('#pilot-notification-list');
  try {
    const operations = await window.PantryBackend.loadStoreOperations();
    const rows = [
      ...operations.sessions.map(item => ({ type: '盤點', id: item.id, status: item.status, at: item.started_at })),
      ...operations.batches.map(item => ({ type: '進貨', id: item.batch_number, status: item.status, at: item.uploaded_at }))
    ].sort((a, b) => new Date(b.at) - new Date(a.at));
    activityNode.innerHTML = rows.length ? rows.map(item => `<article class="task"><span class="task-icon">${item.type === '盤點' ? '✓' : '⇩'}</span><span class="task-copy"><strong>${escapeHTML(item.type)}・${escapeHTML(item.id)}</strong><small>${escapeHTML(item.status)}・${formatTime(item.at)}</small></span></article>`).join('') : '<div class="formal-empty-state">目前門市尚無正式作業紀錄。</div>';
    const pendingCounts = operations.sessions.filter(item => !['CLOSED'].includes(item.status)).length;
    const pendingReceipts = operations.batches.filter(item => !['COMPLETED'].includes(item.status)).length;
    const notices = [];
    if (pendingCounts) notices.push(`<article class="task"><span class="task-icon">!</span><span class="task-copy"><strong>${pendingCounts} 筆盤點尚未結案</strong><small>進入作業紀錄查看正式狀態</small></span></article>`);
    if (pendingReceipts) notices.push(`<article class="task"><span class="task-icon">!</span><span class="task-copy"><strong>${pendingReceipts} 筆進貨尚待處理</strong><small>原始收據與 OCR 紀錄仍保留</small></span></article>`);
    notificationNode.innerHTML = notices.join('') || '<div class="formal-empty-state">目前門市沒有待處理的正式盤點或進貨通知。</div>';
  } catch (error) {
    const message = `<div class="formal-empty-state">${escapeHTML(pilotBackendErrorMessage(error))}</div>`;
    activityNode.innerHTML = message;
    notificationNode.innerHTML = message;
  }
}

function saveAndRender() {
  refreshExpiryEvents();
  saveData();
  renderTasks();
  renderCount();
  renderInventory();
  renderIssues();
  renderExpiryInspection();
  renderReceiving();
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
  $$('.desktop-admin-nav button[data-go]').forEach(button => button.classList.toggle('active', button.dataset.go === page));
  $('#page-title').textContent = page === 'home' && pilot.cloud ? window.PantryBackend.currentStore?.name || 'PantryFlow' : PAGE_TITLES[page];
  $('#page-back').hidden = page === 'home';
  if (page === 'summary') {
    const items = ui.currentSummary.length ? ui.currentSummary
      : data.lastCountSummary.length ? data.lastCountSummary
        : data.products;
    renderSummary(items);
  }
  if (pilot.cloud && ['activity', 'notifications'].includes(page)) refreshPilotOperations();
  ui.currentPage = page;
  const top = restoreScroll ? (ui.scrollByPage[page] || 0) : 0;
  window.requestAnimationFrame(() => window.scrollTo({ top, behavior: 'auto' }));
}

function go(page, { replace = false, fromHistory = false, restoreScroll = false } = {}) {
  let destination = VALID_PAGES.includes(page) ? page : 'home';
  if (pilot.cloud && destination === 'receiving-review' && pilot.profile?.role !== 'ADMIN') {
    showToast('只有 ADMIN 可以進入收貨待核對');
    destination = 'home';
  }
  if (pilot.cloud && destination === 'count-discrepancies' && pilot.profile?.role !== 'ADMIN') {
    showToast('只有 ADMIN 可以進入盤點差異管理');
    destination = 'home';
  }
  if (ui.currentPage) ui.scrollByPage[ui.currentPage] = window.scrollY;
  if (!fromHistory && destination === 'count' && ui.currentPage !== 'count') ui.countView = 'areas';

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
  if (ui.currentPage === 'count' && ui.countView === 'area') {
    ui.countView = 'areas';
    renderCount();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
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

function aggregateCountDraft(productIds = data.products.map(product => product.id), areaId = '') {
  return [...new Set(productIds)].map(productId => {
    const product = data.products.find(item => item.id === productId);
    if (!product) return null;
    const descriptors = getCountEntries().filter(item => item.product.id === product.id && (!areaId || item.area.id === areaId));
    const entries = descriptors.map(item => ({
      descriptor: item,
      entry: data.countDraft[countKey(item.area.id, product.id)],
      baseline: getCountBaseline(countKey(item.area.id, product.id), product)
    })).filter(item => item.entry?.firstRecordedAt);
    if (!entries.length) return null;
    const countedEntries = entries.filter(item => latestCountBaseValue(item.entry) !== null);
    const blankEntries = entries.filter(item => latestCountBaseValue(item.entry) === null);
    const lastConfirmed = Number(countedEntries.reduce((sum, item) => sum + item.baseline.lastConfirmed, 0).toFixed(3));
    const estimatedQty = Number(countedEntries.reduce((sum, item) => sum + item.baseline.estimated, 0).toFixed(3));
    const countedQty = Number(countedEntries.reduce((sum, item) => sum + latestCountBaseValue(item.entry), 0).toFixed(3));
    const difference = Number((countedQty - estimatedQty).toFixed(3));
    const attentionThreshold = Math.max(0.5, Math.abs(estimatedQty) * 0.2);
    const seriousThreshold = Math.max(1, Math.abs(estimatedQty) * 0.5);
    const needsReview = entries.find(item => ['needs-recount', 'needs-reason'].includes(item.entry.status));
    const result = Math.abs(difference) >= seriousThreshold
      ? 'serious'
      : (needsReview || Math.abs(difference) >= attentionThreshold ? 'attention' : 'normal');
    const confirmedAt = entries.map(item => item.baseline.confirmedAt).filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0] || product.confirmedAt || '';
    return {
      ...product,
      before: lastConfirmed,
      qty: countedQty,
      countedQty,
      estimatedQty,
      difference,
      confirmedAt,
      countedAreas: countedEntries.map(item => item.descriptor.area.name),
      blankAreas: blankEntries.map(item => item.descriptor.area.name),
      reviewKey: needsReview ? countKey(needsReview.descriptor.area.id, product.id) : '',
      result,
      partialArea: areaId ? COUNT_AREAS.find(area => area.id === areaId)?.name || '' : ''
    };
  }).filter(Boolean);
}

function buildCountDifferenceRows() {
  return getCountEntries().map(({ area, product }) => {
    const key = countKey(area.id, product.id);
    const entry = data.countDraft[key];
    if (!entry?.firstRecordedAt) return null;
    const baseline = getCountBaseline(key, product);
    const actual = latestCountBaseValue(entry);
    if (actual === null) return { key, area, product, entry, baseline, actual: null, difference: null, blank: true, pending: true };
    const difference = Number((Number(actual) - Number(baseline.lastConfirmed)).toFixed(3));
    if (Math.abs(difference) <= 0.0009) return null;
    return { key, area, product, entry, baseline, actual, difference, pending: !entry.reason };
  }).filter(Boolean).sort((a, b) => Number(b.pending) - Number(a.pending) || Number(b.blank) - Number(a.blank) || Math.abs(b.difference || 0) - Math.abs(a.difference || 0));
}

async function finishCount() {
  const rows = buildCountDifferenceRows();
  if (rows.some(row => row.pending)) return showToast('請先回覆所有差異原因');
  const completedAt = new Date().toISOString();
  data.products.forEach(product => applyConfirmedProductFromCount(product.id, '本次盤點完成'));
  getCountEntries().forEach(({ area, product }) => {
    const key = countKey(area.id, product.id);
    const entry = data.countDraft[key];
    if (!entry?.firstRecordedAt) return;
    const confirmedValue = latestCountBaseValue(entry);
    data.countBaselines[key] = {
      lastConfirmed: confirmedValue, receipts: 0, waste: 0,
      transfers: 0, adjustments: 0, estimated: confirmedValue,
      confirmedAt: entry.confirmedAt || completedAt
    };
  });
  data.lastCountAt = completedAt;
  data.lastCountSummary = aggregateCountDraft().map(item => ({ ...item }));
  ui.currentSummary = data.lastCountSummary;
  if (pilot.cloud && pilot.countSession) {
    try {
      pilot.countSession = await window.PantryBackend.setCountSessionStatus(pilot.countSession.id, 'CLOSED');
    } catch (error) {
      console.error('Count close failed.', error);
      return showToast(`盤點尚未關閉：${error.message}`);
    }
  }
  saveAndRender();
  go('home');
  showToast('本次盤點已完成');
}

function renderSummary() {
  const entries = getCountEntries().filter(({ area, product }) => data.countDraft[countKey(area.id, product.id)]?.firstRecordedAt);
  const rows = buildCountDifferenceRows();
  const pending = rows.filter(row => row.pending).length;
  const completedAreas = TRIAL_COUNT_AREA_IDS.filter(areaId => data.countCompletedAreas[areaId]).length;
  const recordedAt = entries.map(({ area, product }) => data.countDraft[countKey(area.id, product.id)]?.firstRecordedAt)
    .filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
  $('#summary-areas').textContent = completedAreas;
  $('#summary-items').textContent = entries.length;
  $('#summary-differences').textContent = rows.length;
  $('#summary-pending').textContent = pending;
  $('#summary-time').textContent = recordedAt ? formatActualDateTime(recordedAt) : '本次盤點';
  $('#count-summary-start').hidden = ui.summaryStage !== 'complete';
  $('#start-count-review').hidden = ui.summaryStage !== 'complete' || !pilotCanReview();
  $('#export-count-excel').hidden = pilot.cloud && !pilotCanReview();
  $('#count-summary-differences').hidden = ui.summaryStage !== 'differences';
  $('#complete-count-review').disabled = pending > 0;
  $('#complete-count-review').textContent = pending ? `還有 ${pending} 項待回覆` : '完成本次盤點';
  $('#summary-table').innerHTML = rows.length ? rows.map(row => {
    const unit = escapeHTML(row.product.baseUnit);
    const signed = row.blank ? '未提供數量' : `${row.difference > 0 ? '多 ' : '少 '}${formatNumber(Math.abs(row.difference))} ${unit}`;
    return `<article class="trial-difference-row ${row.pending ? 'pending' : 'answered'}">
      <div class="difference-heading"><span><strong>${escapeHTML(row.product.name)}</strong><small>${escapeHTML(row.area.name)}</small></span><b>${signed}</b></div>
      <div class="difference-pair">
        <span><time>${escapeHTML(formatShortDateTime(row.baseline.confirmedAt))}</time><strong>${formatNumber(row.baseline.lastConfirmed)} ${unit}</strong></span>
        <span><time>${escapeHTML(formatShortDateTime(row.entry.firstRecordedAt))}</time><strong>${row.blank ? '空白（非 0）' : `${formatNumber(row.actual)} ${unit}`}</strong></span>
      </div>
      <button type="button" data-summary-review="${escapeHTML(row.key)}">${row.pending ? '回覆原因' : `已回覆：${escapeHTML(COUNT_REASON_LABELS[row.entry.reason] || row.entry.reason)}`} ›</button>
    </article>`;
  }).join('') : '<div class="empty-state"><span>✓</span><div><strong>本次沒有數量差異</strong><small>可以直接完成盤點。</small></div></div>';
  $$('[data-summary-review]').forEach(button => button.addEventListener('click', () => openCountReview(button.dataset.summaryReview)));
}

function formatTimelineTime(value) {
  return formatActualDateTime(value);
}

function openTimeline(productId) {
  const product = data.products.find(item => item.id === productId);
  if (!product) return;
  const entries = [...(data.productHistory[productId] || [])]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 12);
  $('#timeline-product-name').textContent = `${product.name}｜近期紀錄`;
  $('#timeline-product-meta').textContent = `基準單位 ${product.baseUnit}・由新到舊`;
  $('#timeline-list').innerHTML = entries.length ? entries.map(entry => {
    const eventType = entry.type || '未分類紀錄';
    const quantity = entry.quantity === undefined
      ? '數量：未提供'
      : `數量：${formatNumber(entry.quantity)} ${escapeHTML(entry.unit || product.baseUnit)}`;
    return `
    <article class="timeline-item">
      <time>${escapeHTML(formatTimelineTime(entry.createdAt))}</time>
      <div><strong>${escapeHTML(entry.actor || '系統')}｜${escapeHTML(eventType)}</strong>
      <small>${quantity}</small>
      <small>${escapeHTML(entry.detail || '原因／去向未提供')}</small></div>
    </article>
  `;
  }).join('') : '<div class="notice">目前沒有近期異動紀錄</div>';
  const dialog = $('#timeline-dialog');
  if (!dialog.open) dialog.showModal();
}

function openProductDialog(productId) {
  const product = data.products.find(item => item.id === productId);
  if (!product) return;
  ui.expiryReturnPage = '';
  ui.expiryInspectionItemId = '';
  refreshExpiryEvents();
  const expiryEvent = getCurrentExpiryEvent(product);
  const needsExpiryAction = isExpiryAttention(product);
  const pendingCorrection = getPendingExpiryCorrection(product.id);
  const sop = PRODUCT_SOPS[product.id];
  const activeBatches = data.expiryEvents
    .filter(event => event.productId === product.id && !['resolved', 'corrected'].includes(event.status))
    .sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)));
  const result = expiryEvent?.status === 'overdue-supervisor'
    ? `${product.name}已到期，仍有 ${formatNumber(product.qty)} ${product.baseUnit} 未處理`
    : expiryEvent?.status === 'due-today'
      ? `${product.name}今天到期`
      : expiryEvent?.status === 'near-expiry'
        ? `${product.name}明天到期`
        : `${product.name}目前沒有需要處理的效期事件`;
  const reasonItems = needsExpiryAction
    ? [
      `剩餘 ${formatNumber(product.qty)} ${product.baseUnit}`,
      `有效日期 ${formatActualDate(product.expiryDate)}・建立於${expiryEvent?.source || product.expirySource || '現場紀錄'}`,
      sop ? `${sop.trigger}後 ${sop.shelfLifeDays} 天・${sop.storage}` : ''
    ].filter(Boolean)
    : [product.expiryDate ? `有效日期 ${formatActualDate(product.expiryDate)}` : '目前尚未建立有效日期', sop ? `${sop.trigger}後 ${sop.shelfLifeDays} 天・${sop.storage}` : '沒有需要立即處理的效期提醒'].filter(Boolean);
  ui.expiryProductId = product.id;
  $('#product-id').value = product.id;
  $('#product-name').textContent = product.name;
  $('#product-meta').textContent = `${product.area}・效期資訊唯讀`;
  $('#product-action-result').className = `action-result ${expiryEvent?.status === 'overdue-supervisor' ? 'critical' : ''}`;
  $('#product-action-result').innerHTML = `<span>結果</span><h3>${escapeHTML(result)}</h3><p>${needsExpiryAction ? '先完成現場處理，再由系統保留效期紀錄。' : '正常資料已弱化，詳細紀錄可按需展開。'}</p>`;
  $('#product-reason-list').innerHTML = `<ul class="reason-summary">${reasonItems.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>`;
  $('#product-action-plan').innerHTML = needsExpiryAction ? actionPlanMarkup('expiry') : '';
  $('#product-confirmed-qty').textContent = formatNumber(product.qty);
  $('#product-unit').textContent = product.unit;
  $('#product-confirmed-meta').textContent = `${freshnessLabel(product.confirmedAt)}・舊資料不代表即時庫存`;
  $('#product-expiry-readonly').textContent = product.expiryDate || '未設定';
  $('#product-expiry-state').textContent = `${expiryStateLabel(product)}${expiryEvent?.source ? `・建立於${expiryEvent.source}` : ''}`;
  $('#product-expiry-card').className = `expiry-readonly-card ${expiryEvent?.status || 'none'}`;
  $('#product-expiry-actions').hidden = !needsExpiryAction && !sop;
  $('#record-expiry-use').hidden = !needsExpiryAction;
  $('#record-expiry-discard').hidden = !needsExpiryAction;
  $('#record-opened-today').hidden = sop?.trigger !== '開封';
  $('#open-expiry-action').hidden = !needsExpiryAction;
  $('#product-context-tip').hidden = !sop;
  $('#product-tip-summary').textContent = sop?.instruction || '現場提示';
  $('#product-tip-detail').textContent = sop
    ? `店內 SOP：${product.name}${sop.trigger}後 ${sop.shelfLifeDays} 天，保存方式為${sop.storage}。系統會在記錄${sop.trigger}後自動建立到期提醒。`
    : '';
  $('#product-expiry-batches').innerHTML = activeBatches.length
    ? `<h3>未完成效期批次</h3>${activeBatches.map(event => `<article><strong>${escapeHTML(event.expiryDate)}</strong><small>${escapeHTML(event.source || '現場紀錄')}・${escapeHTML(expiryStateForDate(event.expiryDate) === 'scheduled' ? '尚未進入提醒' : expiryStateLabel({ ...product, expiryDate: event.expiryDate }))}</small></article>`).join('')}`
    : '<p class="muted-copy">目前沒有未完成的效期批次。</p>';
  $('#report-expiry-error').hidden = !product.expiryDate;
  $('#expiry-correction-status').textContent = pendingCorrection
    ? `已由${pendingCorrection.requestedBy}回報，等待主管確認`
    : '有效日期不可由一般人員直接修改。';
  const dialog = $('#product-dialog');
  if (!dialog.open) dialog.showModal();
}

function recordOpenedToday(productId) {
  const product = data.products.find(item => item.id === productId);
  const sop = PRODUCT_SOPS[productId];
  if (!product || sop?.trigger !== '開封') return showToast('這項商品沒有設定開封效期 SOP');
  const duplicate = data.expiryEvents.find(event => event.productId === product.id
    && event.source === '開封' && event.createdAt
    && new Date(event.createdAt).toDateString() === new Date().toDateString()
    && !['resolved', 'corrected'].includes(event.status));
  if (duplicate) return showToast('今天已建立開封效期批次');
  const createdAt = new Date().toISOString();
  const expiryDate = dateOffset(sop.shelfLifeDays);
  const event = {
    id: `expiry-opened-${Date.now()}`, productId: product.id, expiryDate, source: '開封',
    status: expiryStateForDate(expiryDate), milestones: [], createdAt, updatedAt: createdAt
  };
  data.expiryEvents.push(event);
  if (!getActiveExpiryEvent(product)) {
    product.expiryDate = expiryDate;
    product.expirySource = '開封';
  }
  appendProductHistory(product.id, {
    id: event.id, type: '開封紀錄', actor: MOCK_SESSION.name, createdAt,
    detail: `自動建立效期 ${expiryDate}・${sop.storage}・原有批次紀錄未覆蓋`
  });
  saveAndRender();
  openProductDialog(product.id);
  showToast(`已建立 ${expiryDate} 到期提醒`);
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
  if (ui.expiryReturnPage === 'expiry-inspection') {
    ui.expiryReturnPage = '';
    ui.expiryInspectionItemId = '';
    renderExpiryInspection();
    return;
  }
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
    mismatch: { title: '現場實際剩餘量', hint: '只先建立差異紀錄，不會直接覆蓋已確認庫存。' }
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
  const createdAt = new Date().toISOString();
  if (action === 'mismatch') {
    const discrepancy = {
      id: `expiry-stock-discrepancy-${Date.now()}`,
      productId: product.id,
      source: '效期處理',
      originalConfirmedQuantity: before,
      observedQuantity: entered,
      difference: Number((entered - before).toFixed(3)),
      unit: product.baseUnit,
      status: 'pending',
      actor: MOCK_SESSION.name,
      createdAt
    };
    data.stockDiscrepancies.unshift(discrepancy);
    data.issues.unshift(normalizeIssue({
      id: `issue-${discrepancy.id}`,
      type: '商品／庫存',
      note: `${product.name}效期批次數量不符：現場 ${formatNumber(entered)} ${product.baseUnit}，已確認紀錄 ${formatNumber(before)} ${product.baseUnit}`,
      productId: product.id,
      status: 'pending',
      reporter: MOCK_SESSION.name,
      nextAction: '現場確認差異原因，建立對應事件後才更新已確認庫存',
      createdAt
    }));
    appendProductHistory(product.id, {
      id: discrepancy.id,
      type: '效期批次數量差異',
      quantity: entered,
      unit: product.baseUnit,
      actor: MOCK_SESSION.name,
      createdAt,
      detail: `已確認紀錄 ${formatNumber(before)}，差異 ${formatNumber(discrepancy.difference)}・待核對`
    });
    syncInspectionAfterExpiryAction(product.id, action, before, createdAt);
    saveAndRender();
    $('#expiry-action-dialog').close();
    ui.expiryReturnPage = '';
    ui.expiryInspectionItemId = '';
    showToast('已建立數量差異，原庫存紀錄未被覆蓋');
    return;
  }
  const after = action === 'mismatch'
    ? entered
    : Number(Math.max(0, before - entered).toFixed(3));
  const affectedQuantity = action === 'mismatch' ? Math.abs(after - before) : entered;
  const reason = action === 'discard' ? $('#expiry-action-reason').value : '';
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
  product.confirmedAt = createdAt;
  const historyType = action === 'discard' ? '效期報廢'
    : action === 'partial' ? '效期部分使用'
      : '效期已用完';
  appendProductHistory(product.id, {
    id: record.id, type: historyType,
    quantity: action === 'mismatch' ? after : affectedQuantity, unit: product.baseUnit,
    actor: MOCK_SESSION.name, createdAt,
    detail: action === 'mismatch'
      ? `${formatNumber(before)} → ${formatNumber(after)} ${product.baseUnit}`
      : `${expiryEvent.expiryDate}${reason ? `・${reason}` : ''}`
  });
  if (after <= 0) resolveExpiryEvent(expiryEvent, action, createdAt, reason);
  syncInspectionAfterExpiryAction(product.id, action, after, createdAt);
  saveAndRender();
  $('#expiry-action-dialog').close();
  ui.expiryReturnPage = '';
  ui.expiryInspectionItemId = '';
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
  const form = $('#expiry-correction-form');
  form.hidden = Boolean(pending);
  const pendingPanel = $('#expiry-correction-pending');
  pendingPanel.hidden = !pending;
  if (!pending) {
    form.reset();
    $('#correction-product-id').value = product.id;
    return;
  }
  pendingPanel.innerHTML = `
    <strong>已建立效期資訊異常</strong>
    <small>原有效日期：${escapeHTML(pending.originalDate)}</small>
    <small>現場狀況：${escapeHTML(pending.reason)}</small>
    <small>回報人／時間：${escapeHTML(pending.requestedBy)}・${escapeHTML(formatTime(pending.requestedAt))}</small>
    <small>主管需先核對批次，不會直接把舊批次日期改成新日期。</small>
  `;
}

function submitExpiryCorrection(event) {
  event.preventDefault();
  const product = data.products.find(item => item.id === $('#correction-product-id').value);
  if (!product?.expiryDate || getPendingExpiryCorrection(product.id)) return;
  const reason = $('#correction-reason').value;
  const note = $('#correction-note').value.trim();
  if (!reason || !note) return;
  const requestedAt = new Date().toISOString();
  const correctionId = `expiry-correction-${Date.now()}`;
  const inspectionItem = data.expiryInspectionItems.find(item => item.id === ui.expiryInspectionItemId);
  if (inspectionItem) inspectionItem.state = 'needs-confirmation';
  data.expiryCorrections.unshift({
    id: correctionId, productId: product.id,
    originalDate: product.expiryDate, reason, note,
    status: 'pending', requestedBy: MOCK_SESSION.name, requestedAt
  });
  data.issues.unshift(normalizeIssue({
    id: `issue-${correctionId}`,
    type: '效期資訊',
    note: `${product.name}：${reason}・${note}`,
    productId: product.id,
    status: 'pending',
    reporter: MOCK_SESSION.name,
    nextAction: '主管核對新批次、收貨紀錄與批次混放狀況',
    createdAt: requestedAt,
    expiryInspectionAreaId: inspectionItem?.areaId || ''
  }));
  appendProductHistory(product.id, {
    id: correctionId,
    type: '效期資訊異常',
    actor: MOCK_SESSION.name,
    createdAt: requestedAt,
    detail: `${product.expiryDate}・${reason}・${note}`
  });
  saveAndRender();
  $('#expiry-correction-dialog').close();
  if (ui.expiryReturnPage === 'expiry-inspection') {
    ui.expiryReturnPage = '';
    ui.expiryInspectionItemId = '';
    renderExpiryInspection();
  } else {
    openProductDialog(product.id);
  }
  showToast('已建立效期資訊異常，舊批次日期未改變');
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

function actionPlanRowsMarkup(plan) {
  return plan.steps.map((step, index) => `
    <div class="settings-plan-row" data-settings-plan-row>
      <span>${index + 1}</span>
      <label>現場下一步<input class="settings-plan-text" value="${escapeHTML(step.text)}" required></label>
      <label>執行權限<select class="settings-plan-level">
        ${Object.entries(ACTION_LEVEL_LABELS).map(([value, label]) => `<option value="${value}" ${step.level === value ? 'selected' : ''}>${escapeHTML(label)}</option>`).join('')}
      </select></label>
    </div>`).join('');
}

function loadActionPlanForm(eventType) {
  const plan = getActionPlan(eventType);
  if (!plan) return;
  ui.settingsPlanEvent = eventType;
  $('#settings-plan-event').value = eventType;
  $('#settings-plan-rows').innerHTML = actionPlanRowsMarkup(plan);
}

function readActionPlanRows() {
  return [...document.querySelectorAll('[data-settings-plan-row]')].map(row => ({
    text: row.querySelector('.settings-plan-text').value.trim(),
    level: row.querySelector('.settings-plan-level').value
  }));
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
  $('#settings-change-reason').value = '';
  loadActionPlanForm(ui.settingsPlanEvent || 'low-stock');
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
  const planEvent = $('#settings-plan-event').value;
  const planSteps = readActionPlanRows();
  const changeReason = $('#settings-change-reason').value.trim();
  if (!baseUnit || !Number.isFinite(safe) || safe < 0 || units.some(unit => !unit.name || !Number.isFinite(unit.ratio) || unit.ratio <= 0)) {
    showToast('請確認安全庫存與換算比例');
    return;
  }
  if (new Set(units.map(unit => unit.name)).size !== units.length) {
    showToast('盤點單位不能重複');
    return;
  }
  if (!DEFAULT_ACTION_PLANS[planEvent] || planSteps.length !== 3
    || planSteps.some(step => !step.text || !ACTION_LEVEL_LABELS[step.level])) {
    showToast('請完成三個現場處理步驟與執行權限');
    return;
  }
  if (!changeReason) {
    showToast('請填寫這次變更的原因');
    return;
  }
  const normalizedUnits = units.map(unit => ({ ...unit, ratio: unit.name === baseUnit ? 1 : unit.ratio }));
  if (!normalizedUnits.some(unit => unit.name === baseUnit)) normalizedUnits.unshift({ name: baseUnit, ratio: 1 });
  const beforePlan = getActionPlan(planEvent);
  const before = {
    baseUnit: product.baseUnit,
    safe: product.safe,
    allowedUnits: getAllowedUnits(product).map(unit => ({ ...unit })),
    actionPlan: { eventType: planEvent, steps: beforePlan.steps.map(step => ({ ...step })) }
  };
  const hasRecordedCount = Object.entries(data.countDraft).some(([key, entry]) => key.endsWith(`::${product.id}`) && entry.firstRecordedAt);
  if (baseUnit !== product.baseUnit && hasRecordedCount) {
    showToast('這個商品已有不可覆蓋的實盤紀錄，請完成本次盤點後再變更基準單位');
    return;
  }
  if (ui.settingsBaseConversion !== 1) {
    const conversion = ui.settingsBaseConversion;
    product.qty = Number((Number(product.qty) / conversion).toFixed(3));
    Object.entries(data.countBaselines).forEach(([key, baseline]) => {
      if (!key.endsWith(`::${product.id}`)) return;
      ['lastConfirmed', 'receipts', 'waste', 'transfers', 'adjustments', 'estimated'].forEach(field => {
        if (Number.isFinite(Number(baseline[field]))) baseline[field] = Number((Number(baseline[field]) / conversion).toFixed(3));
      });
    });
  }
  product.baseUnit = baseUnit;
  product.unit = baseUnit;
  product.safe = safe;
  product.allowedUnits = normalizedUnits;
  data.actionPlans[planEvent] = {
    label: DEFAULT_ACTION_PLANS[planEvent].label,
    steps: planSteps.map(step => ({ ...step }))
  };
  Object.entries(data.countDraft).forEach(([key, entry]) => {
    if (!key.endsWith(`::${product.id}`) || entry.value === '' || entry.firstRecordedAt) return;
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
    after: {
      baseUnit,
      safe,
      allowedUnits: normalizedUnits.map(unit => ({ ...unit })),
      actionPlan: { eventType: planEvent, steps: planSteps.map(step => ({ ...step })) }
    },
    reason: changeReason,
    actor: MOCK_SUPERVISOR.name, role: MOCK_SUPERVISOR.roleLabel, createdAt
  });
  appendProductHistory(product.id, {
    type: '主管商品設定', actor: MOCK_SUPERVISOR.name, createdAt,
    detail: `原基準 ${before.baseUnit}／安全庫存 ${formatNumber(before.safe)} → 基準 ${baseUnit}／安全庫存 ${formatNumber(safe)}・原因：${changeReason}`
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

async function downloadPilotExcel({ sheetName, filename, headers, rows, widths, moneyColumns = [], percentColumns = [], dateColumns = [] }) {
  if (!window.ExcelJS) throw new Error('Excel 匯出元件尚未載入，請確認網路後重試');
  const workbook = new window.ExcelJS.Workbook();
  workbook.creator = 'PantryFlow Pilot v0.1';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }]
  });
  worksheet.columns = headers.map((header, index) => ({
    header,
    key: `column-${index + 1}`,
    width: widths[index] || 14
  }));
  rows.forEach(row => worksheet.addRow(row));
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: headers.length } };
  const headerRow = worksheet.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173F35' } };
    cell.alignment = { vertical: 'middle' };
  });
  moneyColumns.forEach(column => { worksheet.getColumn(column).numFmt = '#,##0.00'; });
  percentColumns.forEach(column => { worksheet.getColumn(column).numFmt = '0.00%'; });
  dateColumns.forEach(column => { worksheet.getColumn(column).numFmt = 'yyyy/mm/dd hh:mm'; });
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: 'top', wrapText: false };
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function localReceiptExportRows() {
  return data.receivingReviews.flatMap(review => review.aiRows.map(row => {
    const subtotal = optionalNumber(receivingRowValue(review, row, 'subtotal'));
    const taxRate = optionalNumber(row.taxRate);
    const tax = subtotal !== null && taxRate !== null ? subtotal * taxRate : '';
    return {
      receipt_date: review.createdAt, document_number: review.batchNumber,
      supplier_code: review.supplierCode || '', supplier_name: review.supplier || '',
      product_code: row.itemCode || row.productId || '', product_name: receivingRowValue(review, row, 'product') || '',
      specification: row.specification || '', unit: receivingRowValue(review, row, 'unit'),
      quantity: optionalNumber(receivingRowValue(review, row, 'quantity')) ?? '',
      unit_price_ex_tax: optionalNumber(receivingRowValue(review, row, 'unitPrice')) ?? '',
      line_subtotal_ex_tax: subtotal ?? '', tax_rate: taxRate ?? '', tax,
      line_total_inc_tax: tax === '' ? '' : subtotal + tax,
      batch_or_expiry: row.expiryBatch || '', storage_location: row.storage || '',
      original_documents: review.originalPhotos.map(photo => photo.name || '原始照片').join('；')
    };
  }));
}

async function exportReceivingExcel() {
  try {
    const records = pilot.cloud ? await window.PantryBackend.loadReceiptExportRows() : localReceiptExportRows();
    if (!records.length) return showToast('目前沒有已完成的進貨明細可匯出');
    const rows = records.map(record => [
      record.receipt_date ? new Date(record.receipt_date) : '', record.erp_status || '待 ERP 驗收／已完成 PantryFlow 核對', record.document_number,
      record.supplier_code, record.supplier_name, record.product_code, record.product_name,
      record.specification, record.unit, record.quantity, record.unit_price_ex_tax,
      record.line_subtotal_ex_tax, record.tax_rate, record.tax, record.line_total_inc_tax,
      record.batch_or_expiry, record.storage_location, record.original_documents
    ]);
    await downloadPilotExcel({
      sheetName: '進貨明細', filename: `PantryFlow-進貨成果-${new Date().toISOString().slice(0, 10)}.xlsx`,
      headers: ['進貨日期', 'ERP 狀態', '貨單編號', '供應商編碼', '供應商名稱', '品項編碼', '品名', '規格', '單位', '數量', '未稅單價', '未稅金額', '稅率', '稅額', '含稅金額', '批次／效期', '儲位', '原始照片對應資訊'],
      rows, widths: [18, 28, 16, 14, 20, 16, 24, 18, 10, 10, 14, 14, 10, 14, 14, 16, 14, 42],
      moneyColumns: [11, 12, 14, 15], percentColumns: [13], dateColumns: [1]
    });
    showToast('進貨 Excel 已匯出；原始資料仍在 PantryFlow，可隨時重新匯出');
  } catch (error) {
    console.error('Receipt Excel export failed.', error);
    showToast(`Excel 尚未匯出：${error.message}`);
  }
}

async function exportCountExcel() {
  const records = getCountEntries().map(({ area, product }) => {
    const key = countKey(area.id, product.id);
    const entry = data.countDraft[key];
    if (!entry?.firstRecordedAt) return null;
    const first = Number(entry.firstBaseValue);
    const finalValue = latestCountBaseValue(entry);
    const baseline = data.countBaselines[key] || {};
    const previous = optionalNumber(baseline.lastConfirmed ?? baseline.estimated);
    return [
      new Date(entry.firstRecordedAt), area.name, product.productCode || product.id, product.name,
      product.baseUnit, first, finalValue, previous === null ? '' : finalValue - previous,
      entry.reason || '', entry.attempts?.[0]?.actor || pilotActorName(),
      new Date(entry.confirmedAt || data.countCompletedAreas[area.id] || entry.firstRecordedAt)
    ];
  }).filter(Boolean);
  if (!records.length) return showToast('目前沒有完成的盤點可匯出');
  try {
    await downloadPilotExcel({
      sheetName: '本次盤點', filename: `PantryFlow-盤點-${new Date().toISOString().slice(0, 10)}.xlsx`,
      headers: ['盤點日期', '區域', '物料碼', '品名', '單位', '第一次實盤', '最終確認數量', '差異', '差異原因', '操作者', '完成時間'],
      rows: records, widths: [18, 16, 16, 24, 10, 14, 16, 12, 20, 14, 18], dateColumns: [1, 11]
    });
    showToast('盤點 Excel 已匯出；第一次實盤與更正紀錄仍保留在 PantryFlow');
  } catch (error) {
    console.error('Count Excel export failed.', error);
    showToast(`Excel 尚未匯出：${error.message}`);
  }
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
  saveAndRender();
  $$('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));
  $('#notification-button').addEventListener('click', () => showToast('目前沒有新的通知；重要事項會保留在今日重點'));
  $('#home-shortage-focus').addEventListener('click', () => {
    selectFilter('low');
    go('inventory');
  });
  $('#home-expiry-focus').addEventListener('click', () => go('expiry-inspection'));
  $('#home-anomaly-focus').addEventListener('click', () => {
    const issue = data.issues.find(item => item.type === '盤點異常' && isIssueOpen(item));
    if (!issue) {
      go(TRIAL_COUNT_AREA_IDS.every(areaId => data.countCompletedAreas[areaId]) ? 'summary' : 'count');
      return;
    }
    go('more');
    window.setTimeout(() => openIssueWorkflow(issue.id), 0);
  });
  $('#finish-area').addEventListener('click', finishCurrentArea);
  $('#count-area-back').addEventListener('click', () => {
    ui.countView = 'areas';
    renderCount();
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
  $('#start-count-review').addEventListener('click', async () => {
    if (!pilotCanReview()) return showToast('盤點結果由主管或管理員整理');
    if (pilot.cloud && pilot.countSession) {
      try {
        pilot.countSession = await window.PantryBackend.setCountSessionStatus(pilot.countSession.id, 'REVIEWING');
      } catch (error) {
        return showToast(`暫時無法開始整理：${error.message}`);
      }
    }
    ui.summaryStage = 'differences';
    renderSummary();
  });
  $('#complete-count-review').addEventListener('click', finishCount);
  $('#inventory-search').addEventListener('input', renderInventory);
  $$('[data-filter]').forEach(button => button.addEventListener('click', () => selectFilter(button.dataset.filter)));
  $('#page-back').addEventListener('click', goBack);
  $$('[data-pilot-coming-soon]').forEach(button => button.addEventListener('click', () => {
    showToast('Pilot v0.1 先開放盤點與進貨');
  }));
  $('#add-risk-focus').addEventListener('click', openRiskFocusDialog);
  $('#risk-focus-form').addEventListener('submit', submitRiskFocus);
  $('#complete-expiry-inspection').addEventListener('click', completeExpiryInspection);
  $('#future-inspection-photo').addEventListener('click', () => showToast('拍攝巡檢表會在後續版本開放，本次巡檢可直接繼續'));
  $$('[data-inspection-action]').forEach(button => button.addEventListener('click', () => handleInspectionAction(button.dataset.inspectionAction)));
  ['#receiving-camera', '#receiving-album', '#receiving-add-camera', '#receiving-add-album']
    .forEach(selector => $(selector).addEventListener('change', handleReceivingPhotoChange));
  $('#receiving-preview-back').addEventListener('click', () => {
    ui.receivingPhotos = [];
    ui.receivingStep = 'method';
    renderReceiving();
  });
  $('#submit-receiving-photo').addEventListener('click', submitReceivingPhoto);
  $$('input[name="receipt-routing"]').forEach(input => input.addEventListener('change', event => {
    ui.receiptRoutingMode = event.target.value;
    renderReceiving();
  }));
  $('#receiving-complete-home').addEventListener('click', () => {
    ui.receivingStep = 'method';
    ui.receivingCompleteBatch = null;
    renderReceiving();
    go('home');
  });
  $('#toggle-receiving-original').addEventListener('click', () => {
    const section = $('#receiving-original-section');
    section.hidden = !section.hidden;
    $('#toggle-receiving-original').textContent = section.hidden ? '查看原圖' : '收起原圖';
  });
  $('#receiving-correction-form').addEventListener('submit', submitReceivingCorrection);
  $('#pilot-generate-ocr').addEventListener('click', generatePilotOcr);
  $('#pilot-complete-receipt').addEventListener('click', completePilotReceipt);
  $('#refresh-receiving-review').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '整理中…';
    try {
      await refreshCloudReceiptBatches();
      renderReceiving();
      showToast('已重新整理正式收貨與 OCR 資料');
    } catch (error) {
      console.error('Receipt refresh failed.', error);
      showToast(pilotBackendErrorMessage(error));
    } finally {
      button.disabled = false;
      button.textContent = '重新整理';
    }
  });
  $('#show-all-receiving-reviews').addEventListener('click', () => {
    ui.showAllReceivingReviews = !ui.showAllReceivingReviews;
    renderReceiving();
  });
  ['store', 'date', 'supplier', 'status'].forEach(field => {
    $(`#receipt-filter-${field}`).addEventListener('change', event => {
      ui.receiptFilters[field] = event.target.value;
      renderReceiving();
    });
  });
  $('#clear-receipt-filters').addEventListener('click', () => {
    ui.receiptFilters = { store: '', date: '', supplier: '', status: '' };
    renderReceiving();
  });
  $('#refresh-count-discrepancies').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '整理中…';
    try {
      await refreshCountDiscrepancies();
      showToast('已重新整理 Supabase 盤點差異');
    } catch (error) {
      console.error('Count discrepancy refresh failed.', error);
      showToast(pilotBackendErrorMessage(error));
    } finally {
      button.disabled = false;
      button.textContent = '重新整理';
    }
  });
  $('#export-discrepancy-excel').addEventListener('click', exportCountManagementExcel);
  $('#pilot-product-mapping').addEventListener('click', event => {
    const button = event.target.closest('[data-pilot-create-product]');
    if (button) createPilotProductFromOcr(button.dataset.pilotCreateProduct);
  });
  $('#more-issue').addEventListener('click', () => $('#issue-dialog').showModal());
  $('#issue-form').addEventListener('submit', submitIssue);
  $('#issue-workflow-content').addEventListener('click', handleIssueWorkflowClick);
  $('#issue-workflow-content').addEventListener('submit', submitIssueWorkflow);
  $('#low-stock-content').addEventListener('click', handleLowStockClick);
  $('#low-stock-content').addEventListener('submit', submitLowStockStep);
  $('#open-expiry-action').addEventListener('click', () => openExpiryActionDialog($('#product-id').value));
  $('#record-expiry-use').addEventListener('click', () => {
    openExpiryActionDialog($('#product-id').value);
    selectExpiryAction('partial');
  });
  $('#record-expiry-discard').addEventListener('click', () => {
    openExpiryActionDialog($('#product-id').value);
    selectExpiryAction('discard');
  });
  $('#record-opened-today').addEventListener('click', () => recordOpenedToday($('#product-id').value));
  $('#report-expiry-error').addEventListener('click', () => openExpiryCorrectionDialog($('#product-id').value));
  $('#quick-confirm-product').addEventListener('click', () => {
    const productId = $('#product-id').value;
    closeProductDialog();
    openLowStockDialog(productId);
    renderLowStockContent('confirm');
  });
  $('#product-timeline').addEventListener('click', () => {
    const productId = $('#product-id').value;
    ui.timelineReturnKey = `product:${productId}`;
    closeProductDialog();
    openTimeline(productId);
  });
  $$('[data-expiry-action]').forEach(button => button.addEventListener('click', () => selectExpiryAction(button.dataset.expiryAction)));
  $('#expiry-action-form').addEventListener('submit', submitExpiryAction);
  $('#back-expiry-action').addEventListener('click', () => {
    ui.expiryAction = '';
    $('#expiry-action-list').hidden = false;
    $('#expiry-action-form').hidden = true;
  });
  $('#expiry-correction-form').addEventListener('submit', submitExpiryCorrection);
  $('#recount-form').addEventListener('submit', submitRecount);
  $('#followup-form').addEventListener('submit', submitFollowup);
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
  $('#export-receiving-excel').addEventListener('click', exportReceivingExcel);
  $('#export-count-excel').addEventListener('click', exportCountExcel);
  $('#manage-product-settings').addEventListener('click', () => openProductSettings());
  $('#product-settings-form').addEventListener('submit', submitProductSettings);
  $('#settings-product-select').addEventListener('change', event => loadProductSettingsForm(event.target.value));
  $('#settings-plan-event').addEventListener('change', event => loadActionPlanForm(event.target.value));
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
  $('#close-inspection-item').addEventListener('click', () => $('#inspection-item-dialog').close());
  $('#close-risk-focus').addEventListener('click', () => $('#risk-focus-dialog').close());
  $('#close-inspection-complete').addEventListener('click', () => $('#inspection-complete-dialog').close());
  $('#inspection-complete-home').addEventListener('click', () => $('#inspection-complete-dialog').close());
  $('#close-receiving-review').addEventListener('click', () => $('#receiving-review-dialog').close());
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
      return;
    }
    if (ui.timelineReturnKey.startsWith('product:')) {
      const productId = ui.timelineReturnKey.slice('product:'.length);
      ui.timelineReturnKey = '';
      openProductDialog(productId);
    }
  });
  initNavigation();
}

init();

$('#show-login').addEventListener('click', () => showAuthView('login'));
$('#show-staff-login').addEventListener('click', () => showAuthView('staff'));
$('#show-forgot-password').addEventListener('click', () => showAuthView('forgot'));
$('#show-owner-signup').addEventListener('click', () => showAuthView('owner-signup'));
$('#back-from-owner-signup').addEventListener('click', () => showAuthView('login'));
$('#back-to-login').addEventListener('click', () => showAuthView('login'));
$('#pilot-retry-load').addEventListener('click', () => {
  $('#pilot-retry-load').hidden = true;
  $('#pilot-login-error').textContent = '正在重新載入正式資料…';
  initializePilotBackend();
});
$('#pilot-refresh-activity').addEventListener('click', refreshPilotOperations);
$('#pilot-refresh-notifications').addEventListener('click', refreshPilotOperations);

$('#pilot-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorNode = $('#pilot-login-error');
  errorNode.textContent = '';
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = '登入中…';
  try {
    const profile = await window.PantryBackend.signIn($('#pilot-login-email').value.trim(), $('#pilot-login-password').value);
    if (!profile.organization_id) showOnboarding();
    else {
      await continueAfterCloudAuth(profile);
      go('home', { replace: true });
    }
  } catch (error) {
    console.error('Pilot sign-in failed.', error);
    const raw = String(error?.message || '');
    errorNode.textContent = /invalid login credentials/i.test(raw) ? 'Email 或密碼不正確。' : pilotBackendErrorMessage(error);
    if (!/invalid login credentials/i.test(raw)) $('#pilot-retry-load').hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = '登入';
  }
});

$('#pilot-owner-signup-form').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('#pilot-owner-signup-message');
  const password = $('#pilot-owner-password').value;
  if (password !== $('#pilot-owner-password-confirm').value) return void (message.textContent = '兩次輸入的密碼不一致。');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  message.textContent = '';
  try {
    const result = await window.PantryBackend.signUpOwner({
      displayName: $('#pilot-owner-name').value.trim(),
      email: $('#pilot-owner-email').value.trim(),
      password
    });
    message.textContent = result.needsEmailVerification
      ? '驗證信已寄出。請完成 Email 驗證後回到 PantryFlow 建立商家與第一間門市。'
      : 'Email 已驗證，正在進入商家建立流程。';
    if (!result.needsEmailVerification) {
      await window.PantryBackend.loadProfile();
      showOnboarding();
    }
  } catch (error) {
    console.error('Owner signup failed.', error);
    message.textContent = /already registered|user already/i.test(String(error?.message || ''))
      ? '此 Email 已存在，請返回登入或使用忘記密碼。'
      : pilotBackendErrorMessage(error);
  } finally {
    button.disabled = false;
  }
});

$('#pilot-staff-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorNode = $('#pilot-staff-login-error');
  errorNode.textContent = '';
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = '登入中…';
  try {
    const profile = await window.PantryBackend.signInWithStaffPin({
      storeCode: $('#pilot-staff-store-code').value.trim(),
      identifier: $('#pilot-staff-identifier').value.trim(),
      pin: $('#pilot-staff-pin').value
    });
    await continueAfterCloudAuth(profile);
    go('home', { replace: true });
  } catch (error) {
    console.error('Staff PIN sign-in failed.', error);
    errorNode.textContent = pilotBackendErrorMessage(error);
  } finally {
    button.disabled = false;
    button.textContent = '員工登入';
  }
});

$('#pilot-forgot-form').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('#pilot-forgot-message');
  try { await window.PantryBackend.sendPasswordReset($('#pilot-forgot-email').value.trim()); message.textContent = '已寄出重設密碼郵件'; }
  catch (error) { message.textContent = error.message; }
});

$('#pilot-update-password-form').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('#pilot-new-password').value;
  const errorNode = $('#pilot-update-password-error');
  if (password !== $('#pilot-new-password-confirm').value) return void (errorNode.textContent = '兩次輸入的密碼不一致');
  try { await window.PantryBackend.updatePassword(password); await window.PantryBackend.signOut(); showAuthView('login'); $('#pilot-login-error').textContent = '密碼更新成功，請使用新密碼登入。'; }
  catch (error) { errorNode.textContent = error.message; }
});

$('#pilot-owner-business-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorNode = $('#pilot-organization-error');
  errorNode.textContent = '';
  try {
    const result = await window.PantryBackend.createOwnerBusiness({
      organizationName: $('#pilot-organization-name').value.trim(),
      businessType: $('#pilot-business-type').value,
      storeName: $('#pilot-onboarding-store-name').value.trim(),
      storeCode: $('#pilot-onboarding-store-code').value.trim(),
      staffLoginMode: $('#pilot-onboarding-login-mode').value
    });
    await activateCloudPilot(result.profile);
    go('home', { replace: true });
  } catch (error) {
    console.error('Owner business onboarding failed.', error);
    errorNode.textContent = pilotBackendErrorMessage(error);
  }
});

$('#pilot-store-picker-list').addEventListener('click', event => {
  const button = event.target.closest('[data-pilot-store-id]');
  if (button) choosePilotStore(button.dataset.pilotStoreId);
});

$('#pilot-store-picker-sign-out').addEventListener('click', async () => {
  await window.PantryBackend.signOut();
  $('#pilot-store-picker').hidden = true;
  showAuthView('login');
});

$('#pilot-first-store-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorNode = $('#pilot-store-picker-error');
  errorNode.textContent = '';
  try {
    const created = await window.PantryBackend.manageStaff({
      action: 'create_store',
      name: $('#pilot-first-store-name').value.trim(),
      storeCode: $('#pilot-first-store-code').value.trim(),
      loginMode: $('#pilot-first-store-login-mode').value,
      isPilotStore: true
    });
    const stores = await window.PantryBackend.loadMyStores();
    await choosePilotStore(created.storeId || stores[0]?.id);
  } catch (error) {
    errorNode.textContent = pilotBackendErrorMessage(error);
  }
});

$('#manage-pilot-catalog').addEventListener('click', () => openPilotCatalog().catch(error => showToast(error.message)));
$('#manage-pilot-access').addEventListener('click', () => openPilotAccess().catch(error => showToast(pilotBackendErrorMessage(error))));
$('#close-pilot-access').addEventListener('click', () => $('#pilot-access-dialog').close());
$('#pilot-store-form').addEventListener('submit', event => {
  event.preventDefault();
  runAccessAction(() => window.PantryBackend.manageStaff({
    action: 'create_store',
    name: $('#pilot-store-name').value.trim(),
    storeCode: $('#pilot-store-code').value.trim(),
    loginMode: $('#pilot-store-login-mode').value,
    isPilotStore: $('#pilot-store-is-pilot').checked
  }), '正式門市已建立。');
});
$('#pilot-staff-form').addEventListener('submit', event => {
  event.preventDefault();
  runAccessAction(() => window.PantryBackend.manageStaff({
    action: 'create',
    storeId: $('#pilot-staff-store').value,
    displayName: $('#pilot-staff-name').value.trim(),
    nickname: $('#pilot-staff-nickname').value.trim(),
    jobTitle: $('#pilot-staff-title').value.trim(),
    employeeNumber: $('#pilot-staff-number').value.trim(),
    pin: $('#pilot-staff-new-pin').value,
    role: 'STAFF'
  }), '個別員工身份已建立。');
});
$('#pilot-staff-list').addEventListener('click', event => {
  const resetButton = event.target.closest('[data-reset-staff-pin]');
  if (resetButton) {
    const staffId = resetButton.dataset.resetStaffPin;
    const pin = $(`[data-reset-pin-input="${staffId}"]`).value;
    return void runAccessAction(() => window.PantryBackend.manageStaff({ action: 'reset_pin', staffId, pin }), 'PIN 已安全重設。');
  }
  const disableButton = event.target.closest('[data-disable-staff]');
  if (disableButton) runAccessAction(() => window.PantryBackend.manageStaff({ action: 'disable', staffId: disableButton.dataset.disableStaff }), '員工已停用，歷史紀錄仍完整保留。');
});
$('#create-first-zone').addEventListener('click', () => openPilotCatalog().catch(error => showToast(error.message)));
$('#add-products-from-count').addEventListener('click', () => openPilotCatalog().catch(error => showToast(error.message)));
$('#close-pilot-catalog').addEventListener('click', () => $('#pilot-catalog-dialog').close());
$('#pilot-zone-form').addEventListener('submit', event => { event.preventDefault(); runCatalogAction(() => window.PantryBackend.createZone($('#pilot-zone-name').value)); event.currentTarget.reset(); });
$('#pilot-product-form').addEventListener('submit', event => {
  event.preventDefault();
  runCatalogAction(() => window.PantryBackend.createCatalogProduct({ name: $('#pilot-product-name').value, productCode: $('#pilot-product-code').value, category: $('#pilot-product-category').value, baseUnit: $('#pilot-product-base-unit').value, countUnit: $('#pilot-product-count-unit').value, supplierId: $('#pilot-product-supplier').value }));
  event.currentTarget.reset();
});
$('#pilot-map-zone').addEventListener('change', renderPilotProductChoices);
$('#pilot-map-search').addEventListener('input', renderPilotProductChoices);
$('#pilot-map-form').addEventListener('submit', event => { event.preventDefault(); const ids = Array.from($$('input[name="pilot-map-product"]:checked')).map(input => input.value); if (ids.length) runCatalogAction(() => window.PantryBackend.addProductsToZone($('#pilot-map-zone').value, ids)); });
$('#pilot-product-import-file').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (file) prepareCatalogImport(file).catch(error => { $('#pilot-import-preview').textContent = error.message; });
});
$('#pilot-import-products').addEventListener('click', () => runCatalogAction(commitCatalogImport));
$('#pilot-lot-event-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!$('#pilot-lot-select').value) return;
  runCatalogAction(() => window.PantryBackend.appendLotEvent({ lotId: $('#pilot-lot-select').value, state: $('#pilot-lot-state').value, occurredOn: $('#pilot-lot-date').value }));
});

$('#pilot-sign-out').addEventListener('click', async () => {
  await window.PantryBackend.signOut();
  window.location.reload();
});

void initializePilotBackend();
