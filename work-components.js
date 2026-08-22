(function exposeWorkComponents(root) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const statusLabel = status => ({ OPEN: '待處理', IN_PROGRESS: '進行中', WAITING_REVIEW: '待核對', DONE: '已完成' }[status] || '尚無資料');
  function statusTag(status) { return `<span class="work-status work-status-${escape(status).toLowerCase()}">${statusLabel(status)}</span>`; }
  function taskCard(task) { return `<button type="button" class="task-card" data-work-item="${escape(task.id)}"><span><strong>${escape(task.title)}</strong><small>${escape(task.progress ? `${task.progress.completed}/${task.progress.total} 區域` : '')}</small></span>${statusTag(task.status)}</button>`; }
  function emptyState(title, nextStep) { return `<section class="workflow-state workflow-empty"><strong>${escape(title)}</strong><p>${escape(nextStep)}</p></section>`; }
  function errorState(message) { return `<section class="workflow-state workflow-error" role="alert"><strong>資料讀取失敗</strong><p>${escape(message)}</p></section>`; }
  function offlineState() { return '<section class="workflow-state workflow-offline"><strong>目前離線</strong><p>尚未同步的輸入會清楚標示，請恢復網路後再完成區域。</p></section>'; }
  function fixedAction(label, disabled = false) { return `<div class="fixed-primary-action"><button type="button" ${disabled ? 'disabled' : ''}>${escape(label)}</button></div>`; }
  root.PantryWorkComponents = { statusTag, taskCard, emptyState, errorState, offlineState, fixedAction };
})(globalThis);
