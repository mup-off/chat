const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

/** "14:05" */
export const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Sidebar timestamp: time today, "Yesterday", weekday this week, else a date. */
export function formatListTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return formatTime(iso);
  if (sameDay(d, yesterday())) return 'Yesterday';
  if (now - d < 6 * 24 * 60 * 60 * 1000) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString();
}

/** Day separator in a thread: "Today", "Yesterday", or a full date. */
export function formatDayLabel(iso) {
  const d = new Date(iso);
  if (sameDay(d, new Date())) return 'Today';
  if (sameDay(d, yesterday())) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export const dayKey = (iso) => new Date(iso).toDateString();

/** "last seen today at 14:05" / "yesterday at …" / "Nov 18 at …" */
export function formatLastSeen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const time = formatTime(iso);
  if (sameDay(d, new Date())) return `last seen today at ${time}`;
  if (sameDay(d, yesterday())) return `last seen yesterday at ${time}`;
  return `last seen ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}

/** Sidebar / notification preview text for a message. */
export function previewText(message) {
  if (!message) return '';
  if (message.deleted) return '🚫 This message was deleted';
  if (message.type === 'image') return `📷 ${message.body || 'Photo'}`;
  if (message.type === 'document') return `📄 ${message.mediaName || 'Document'}`;
  if (message.type === 'contact') return `👤 ${message.contact?.displayName ?? 'Contact'}`;
  return message.body;
}

/** One-line description of a quoted message. */
export function quoteText(q) {
  if (!q) return '';
  if (q.deleted) return '🚫 This message was deleted';
  if (q.type === 'image') return `📷 ${q.body || 'Photo'}`;
  if (q.type === 'document') return `📄 ${q.mediaName || 'Document'}`;
  if (q.type === 'contact') return `👤 ${q.contactName || 'Contact'}`;
  return q.body ?? '';
}
