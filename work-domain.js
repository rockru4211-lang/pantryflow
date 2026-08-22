(function exposeWorkDomain(root) {
  const ROLE = Object.freeze({ STAFF: 'STAFF', SUPERVISOR: 'SUPERVISOR', ADMIN: 'ADMIN' });
  const TASK_STATUS = Object.freeze({ OPEN: 'OPEN', IN_PROGRESS: 'IN_PROGRESS', WAITING_REVIEW: 'WAITING_REVIEW', DONE: 'DONE' });
  const EXCEPTION_STATUS = Object.freeze({ OPEN: 'OPEN', ACKNOWLEDGED: 'ACKNOWLEDGED', RESOLVED: 'RESOLVED' });
  const SEVERITY = Object.freeze({ INFO: 'INFO', WARNING: 'WARNING', CRITICAL: 'CRITICAL' });

  function canonicalRole(value) {
    const role = String(value || '').toUpperCase();
    return Object.values(ROLE).includes(role) ? role : ROLE.STAFF;
  }

  function countInputState(value) {
    if (value === '' || value === null || value === undefined) return 'UNCOUNTED';
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity < 0) return 'INVALID';
    return quantity === 0 ? 'COUNTED_ZERO' : 'COUNTED';
  }

  function normalizeException(source, input) {
    const raw = input || {};
    const sourceStatus = String(raw.review_status || raw.status || '').toUpperCase();
    const status = ['RESOLVED', 'CLOSED', 'TRUSTED'].includes(sourceStatus)
      ? EXCEPTION_STATUS.RESOLVED
      : sourceStatus === 'ANSWERED' ? EXCEPTION_STATUS.ACKNOWLEDGED : EXCEPTION_STATUS.OPEN;
    const severity = ['UNREADABLE', 'CRITICAL'].includes(sourceStatus)
      ? SEVERITY.CRITICAL : ['REVIEW', 'PENDING'].includes(sourceStatus) ? SEVERITY.WARNING : SEVERITY.INFO;
    return Object.freeze({
      id: `${source}:${raw.id}`,
      source,
      sourceId: raw.id,
      status,
      severity,
      reason: raw.reason_code || raw.validation_notes || raw.error_message || null,
      actorId: raw.resolved_by || raw.answered_by || null,
      createdAt: raw.created_at || raw.detected_at || null,
      resolvedAt: raw.resolved_at || null,
      raw
    });
  }

  function countTask(session, progress = [], discrepancies = []) {
    const zones = progress.filter(item => item.session_id === session.id);
    const completed = zones.filter(item => item.status === 'COMPLETED').length;
    const allComplete = zones.length > 0 && completed === zones.length;
    const taskStatus = ['CLOSED'].includes(session.status) ? TASK_STATUS.DONE
      : allComplete ? TASK_STATUS.WAITING_REVIEW
      : ['IN_PROGRESS'].includes(session.status) ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.OPEN;
    return Object.freeze({
      id: `count:${session.id}`,
      type: 'COUNT',
      status: taskStatus,
      title: '日常盤點',
      assignedTo: session.assigned_to || null,
      createdAt: session.started_at || session.created_at,
      sourceId: session.id,
      progress: { completed, total: zones.length },
      exceptions: discrepancies.filter(item => item.session_id === session.id).map(item => normalizeException('COUNT', item)),
      raw: session
    });
  }

  function receiptTask(batch, ocrRuns = []) {
    const run = ocrRuns.find(item => item.batch_id === batch.id) || null;
    return Object.freeze({
      id: `receipt:${batch.id}`,
      type: 'RECEIPT_REVIEW',
      status: ['RECEIVED', 'FINALIZED'].includes(batch.status) ? TASK_STATUS.DONE : TASK_STATUS.WAITING_REVIEW,
      title: '收貨待核對',
      assignedTo: batch.assigned_to || null,
      createdAt: batch.created_at,
      sourceId: batch.id,
      exceptions: run && ['FAILED', 'REVIEW', 'UNREADABLE'].includes(String(run.status).toUpperCase())
        ? [normalizeException('OCR', run)] : [],
      raw: batch
    });
  }

  function buildWorkItems(context = {}) {
    return [
      ...(context.sessions || []).map(session => countTask(session, context.progress, context.discrepancies)),
      ...(context.receiptBatches || []).map(batch => receiptTask(batch, context.ocrRuns))
    ].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  function selectVisibleTasks(items, roleValue, userId) {
    const role = canonicalRole(roleValue);
    if (role === ROLE.STAFF) return items.filter(item => item.type === 'COUNT' && (!item.assignedTo || item.assignedTo === userId));
    if (role === ROLE.SUPERVISOR) return items.filter(item => item.status === TASK_STATUS.WAITING_REVIEW || item.exceptions.some(exception => exception.status !== EXCEPTION_STATUS.RESOLVED));
    return items;
  }

  function canTransitionCount({ session, zones }, event) {
    const allZonesComplete = zones.length > 0 && zones.every(zone => zone.status === 'COMPLETED');
    if (event === 'COMPLETE_ZONE') return session.status === 'IN_PROGRESS';
    if (event === 'COMPLETE_SESSION') return session.status === 'IN_PROGRESS' && allZonesComplete;
    if (event === 'OPEN_DIFFERENCES') return allZonesComplete && ['COMPLETED', 'REVIEWING'].includes(session.status);
    return false;
  }

  function inventoryEvent(type, record) {
    return Object.freeze({
      id: record.id,
      type,
      organizationId: record.organization_id,
      productId: record.product_id,
      quantity: Number(record.quantity),
      unit: record.unit,
      actorId: record.entered_by || record.created_by || record.actor_id,
      occurredAt: record.entered_at || record.created_at || record.occurred_at,
      sourceId: record.session_id || record.receipt_id || record.transfer_id || record.id,
      raw: record
    });
  }

  root.PantryWorkDomain = { ROLE, TASK_STATUS, EXCEPTION_STATUS, SEVERITY, canonicalRole, countInputState, normalizeException, countTask, receiptTask, buildWorkItems, selectVisibleTasks, canTransitionCount, inventoryEvent };
})(globalThis);
