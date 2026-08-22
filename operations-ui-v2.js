(function exposeOperationsUiV2(root) {
  const domain = root.PantryWorkDomain;
  const ROLES = ['STAFF', 'SUPERVISOR', 'ADMIN'];

  function canonicalRole(value) {
    return domain ? domain.canonicalRole(value) : 'STAFF';
  }

  function metric(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function roleHomeModel(roleValue, facts = {}) {
    const role = canonicalRole(roleValue);
    const shared = { role, store: facts.store || '尚無商家資料' };
    if (role === 'STAFF') return {
      ...shared,
      eyebrow: '員工首頁',
      title: '今天先看',
      description: facts.activeCount ? '有進行中的盤點，從尚未完成的區域繼續。' : '尚無進行中的盤點任務。',
      mainHeading: '今天先看',
      metrics: [
        ['缺貨風險', metric(facts.shortageCount), 'inventory'],
        ['即期提醒', metric(facts.expiryCount), 'expiry-inspection'],
        ['待確認', metric(facts.anomalyCount), 'summary']
      ],
      actions: [
        { label: '盤點', detail: facts.activeCount ? '繼續' : '尚無任務', page: 'count', icon: '▣' },
        { label: '進貨', detail: '拍照上傳', page: 'receiving', icon: '▱' },
        { label: '效期巡檢', detail: facts.expiryAvailable ? '今日項目' : '尚無資料', page: 'expiry-inspection', icon: '◫' },
        { label: '其他作業', detail: '查看全部', page: '', icon: '•••' }
      ]
    };
    if (role === 'SUPERVISOR') return {
      ...shared,
      eyebrow: '店長／主管首頁', title: '今日重點', description: '現場工作與需要決定的異常；正常資料已收起。', mainHeading: '今日重點',
      metrics: [
        ['缺貨風險', metric(facts.shortageCount), 'inventory'],
        ['即期提醒', metric(facts.expiryCount), 'expiry-inspection'],
        ['待確認異常', metric(facts.anomalyCount), 'summary'],
        ['收貨待核對', metric(facts.receiptReviewCount), 'receiving-review'],
        ['盤點完成率', facts.countCompletion === null || facts.countCompletion === undefined ? null : `${facts.countCompletion}%`, 'count']
      ],
      actions: [
        { label: '盤點', detail: '現場作業', page: 'count', icon: '▣' },
        { label: '進貨', detail: '貨單上傳', page: 'receiving', icon: '▱' },
        { label: '效期巡檢', detail: '風險項目', page: 'expiry-inspection', icon: '◫' },
        { label: '其他作業', detail: '查看全部', page: '', icon: '•••' }
      ]
    };
    if (role === 'ADMIN') return {
      ...shared,
      eyebrow: '後勤／管理首頁', title: '今日待核對', description: '核對資料、掌握營運成果；缺資料時不產生推估數字。', mainHeading: '今日待核對',
      metrics: [
        ['待核對事項', metric(facts.pendingReviewCount), 'receiving-review'],
        ['收貨待核對', metric(facts.receiptReviewCount), 'receiving-review'],
        ['盤點完成率', facts.countCompletion === null || facts.countCompletion === undefined ? null : `${facts.countCompletion}%`, 'count']
      ],
      actions: [
        { label: '商品／編碼', detail: '管理主檔', action: 'catalog', icon: '▧' },
        { label: '供應商', detail: '尚無資料', action: '', icon: '♙' },
        { label: '盤點設定', detail: '區域與商品', action: 'catalog', icon: '⚙' }
      ]
    };
    return roleHomeModel('STAFF', facts);
  }

  function countInputState(value) {
    if (value === '' || value === null || value === undefined) return 'UNCOUNTED';
    return domain ? domain.countInputState(value) : 'UNCOUNTED';
  }

  const previewRole = new URLSearchParams(root.location?.search || '').get('previewRole');
  const localPreview = ['localhost', '127.0.0.1'].includes(root.location?.hostname) && ROLES.includes(previewRole);
  if (localPreview) root.PANTRYFLOW_CONFIG = {};

  root.PantryOperationsUiV2 = { ROLES, canonicalRole, roleHomeModel, countInputState };
})(globalThis);
