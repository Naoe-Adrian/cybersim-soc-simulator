export function escapeHtml(input) {
  return String(input ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

export function formatTime(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  });
}

export function severityClass(severity) {
  const value = String(severity || '').toLowerCase();
  if (value === 'high') return 'severity-high';
  if (value === 'medium') return 'severity-medium';
  return 'severity-low';
}

export function statusPillClass(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('progress')) return 'in-progress';
  if (value.includes('closed')) return 'closed';
  if (value.includes('escalated')) return 'escalated';
  return 'new';
}

export function toTitle(value) {
  return String(value || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
