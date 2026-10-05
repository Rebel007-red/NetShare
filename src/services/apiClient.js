/** Extracts the server's JSON `message` so the UI can show a real reason. */
async function readError(response) {
  try {
    const payload = await response.clone().json();
    const message = payload?.message ?? payload?.detail;
    if (message) return String(message);
  } catch {
    // Not JSON; fall through to the text body.
  }
  try {
    const text = (await response.text()).trim();
    if (text && !text.startsWith('<')) return text;
  } catch {
    // Body already consumed or unreadable.
  }
  return `Request failed (${response.status})`;
}

export async function request(path, options = {}) {
  const { json, ...rest } = options;
  const init = { ...rest };

  if (json !== undefined) {
    init.headers = { 'Content-Type': 'application/json', ...(rest.headers ?? {}) };
    init.body = JSON.stringify(json);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return response.json();
  return response.text();
}

export function formatBytes(value) {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size < 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Shared "2h 14m left" / "Never expires" label for workspaces and notes. */
export function getRemainingLabel(record) {
  if (!record) return '';
  if (record.isPersistent) return 'Never expires';
  if (!record.expiresAt) return 'No expiry';

  const diff = new Date(record.expiresAt).getTime() - Date.now();
  if (Number.isNaN(diff)) return 'No expiry';
  if (diff <= 0) return 'Expired';

  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  if (days >= 1) return `${days}d left`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m left` : `${Math.max(minutes, 1)}m left`;
}

/**
 * Human label for a configured lifetime, e.g. "7 days" or "2 hours". Used so
 * UI copy follows NETFILESHARE_LIFETIME_HOURS instead of hard-coding a number.
 */
export function formatDuration(ms) {
  const hours = Math.round(Number(ms ?? 0) / 3600000);
  if (!Number.isFinite(hours) || hours <= 0) return 'a short while';
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? '1 day' : `${days} days`;
  }
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export async function copyToClipboard(value) {
  const text = String(value ?? '');
  if (!text) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API is unavailable or was blocked; try the legacy path.
  }

  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

let limitsPromise = null;

/**
 * Upload ceilings differ between the Netlify build and a self-hosted one, so
 * the UI reads them from /api/health instead of hard-coding a number.
 */
export function getServerLimits() {
  limitsPromise ??= request('/api/health').catch(() => null);
  return limitsPromise;
}
