(function exposeOperationsUiV2(root) {
  const ROLES = ['STAFF', 'SUPERVISOR', 'ADMIN', 'OWNER'];

  function canonicalRole(value) {
    const role = String(value || '').toUpperCase();
    return ROLES.includes(role) ? role : 'STAFF';
  }

  function metric(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function roleHomeModel(roleValue, facts = {}) {
    const role = canonicalRole(roleValue);
    const shared = { role, store: facts.store || '尚無商家資料' };
    if (role === 'STAFF') return {
      ...shared,
      eyebrow: '現場工作',
      title: '今天先看什麼',
      description: facts.activeCount ? '有進行中的盤點，從尚未完成的區域繼續。' : '尚無進行中的盤點任務。',
      actions: [
        { label: '日常盤點', detail: facts.activeCount ? '繼續盤點' : '選擇盤點任務', page: 'count', tone: 'primary' },
        { label: '收貨上傳', detail: '拍照後即可繼續工作', page: 'receiving' },
        { label: '效期巡檢', detail: facts.expiryAvailable ? '查看今日需巡檢項目' : '尚無資料', page: 'expiry-inspection' }
      ]
    };
    if (role === 'SUPERVISOR') return {
      ...shared,
      eyebrow: '值班總覽', title: '先處理需要判斷的事', description: '正常資料已收起，只顯示真實可用的營運狀態。',
      metrics: [
        ['缺貨風險', metric(facts.shortageCount), 'inventory'],
        ['即期提醒', metric(facts.expiryCount), 'expiry-inspection'],
        ['待確認異常', metric(facts.anomalyCount), 'summary'],
        ['收貨待核對', metric(facts.receiptReviewCount), 'receiving-review'],
        ['盤點完成率', facts.countCompletion === null || facts.countCompletion === undefined ? null : `${facts.countCompletion}%`, 'count']
      ]
    };
    if (role === 'ADMIN') return {
      ...shared,
      eyebrow: '營運管理', title: '待核對事項與營運成果', description: '從正式資料追蹤盤點與收貨；缺資料時不產生推估數字。',
      metrics: [
        ['待核對事項', metric(facts.pendingReviewCount), 'receiving-review'],
        ['收貨待核對', metric(facts.receiptReviewCount), 'receiving-review'],
        ['盤點完成率', facts.countCompletion === null || facts.countCompletion === undefined ? null : `${facts.countCompletion}%`, 'count']
      ],
      actions: [{ label: '盤點設定', detail: '區域、走動順序與區域商品', action: 'catalog' }]
    };
    return {
      ...shared,
      eyebrow: '商家全局', title: '全局營運與治理', description: '管理商家、成員、權限與設定；未接上的營運資料維持尚無資料。',
      metrics: [
        ['待核對事項', metric(facts.pendingReviewCount), 'receiving-review'],
        ['盤點完成率', facts.countCompletion === null || facts.countCompletion === undefined ? null : `${facts.countCompletion}%`, 'count'],
        ['成員', metric(facts.memberCount), null]
      ],
      actions: [
        { label: '成員與權限', detail: '管理角色與存取範圍', action: 'members' },
        { label: '商家設定', detail: '門市與營運設定', action: 'settings' },
        { label: '盤點設定', detail: '區域與商品走動順序', action: 'catalog' }
      ]
    };
  }

  function countInputState(value) {
    if (value === '' || value === null || value === undefined) return 'UNCOUNTED';
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity < 0) return 'INVALID';
    return quantity === 0 ? 'COUNTED_ZERO' : 'COUNTED';
  }

  const previewRole = new URLSearchParams(root.location?.search || '').get('previewRole');
  const localPreview = ['localhost', '127.0.0.1'].includes(root.location?.hostname) && ROLES.includes(previewRole);
  if (localPreview) root.PANTRYFLOW_CONFIG = {};

  root.PantryOperationsUiV2 = { ROLES, canonicalRole, roleHomeModel, countInputState };
})(globalThis);
