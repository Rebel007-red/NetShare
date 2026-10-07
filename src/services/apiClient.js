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

const ACCESS_KEY_STORAGE = 'netfileshare-access-key';

function readAccessKey() {
  try {
    return localStorage.getItem(ACCESS_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

function storeAccessKey(value) {
  try {
    localStorage.setItem(ACCESS_KEY_STORAGE, value);
  } catch {
    // Without storage the passphrase is simply asked for again next time.
  }
}

/** Which workspace or note, if any, an API path is about. */
function itemTarget(path) {
  const match = /^\/api\/(workspaces|notes)\/([A-Za-z0-9]{6})(?:[/?]|$)/.exec(path);
  if (!match) return null;
  return {
    kind: match[1] === 'notes' ? 'note' : 'workspace',
    base: `/api/${match[1]}/${match[2].toUpperCase()}`,
  };
}

async function errorCode(response) {
  try {
    return (await response.clone().json())?.code;
  } catch {
    return undefined;
  }
}

/**
 * Asks for the team passphrase once, checks it against the server, and keeps it.
 * Several requests can hit the same wall at once, so they share one prompt.
 */
let passphrasePrompt = null;
function askAccessKey() {
  passphrasePrompt ??= (async () => {
    try {
      const entered = window.prompt('This server needs the team passphrase to create things. Enter it:');
      if (!entered) return false;
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: entered }),
      });
      if (response.status === 204) {
        storeAccessKey(entered);
        return true;
      }
      throw new Error(response.status === 429 ? await readError(response) : 'That passphrase is not right');
    } finally {
      passphrasePrompt = null;
    }
  })();
  return passphrasePrompt;
}

/** Asks for one item's PIN and unlocks it; concurrent requests share the prompt. */
const pinPrompts = new Map();
function askPin(target) {
  if (!pinPrompts.has(target.base)) {
    pinPrompts.set(target.base, (async () => {
      try {
        const entered = window.prompt(`This ${target.kind} is protected. Enter its PIN:`);
        if (!entered) return false;
        const response = await fetch(`${target.base}/unlock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: entered }),
        });
        if (response.status === 204) return true;
        throw new Error(response.status === 429 ? await readError(response) : 'That PIN is not right');
      } finally {
        pinPrompts.delete(target.base);
      }
    })());
  }
  return pinPrompts.get(target.base);
}

/** Prompts for an item's PIN on demand, e.g. from an "Unlock" button. */
export function unlockItem(kind, code) {
  const base = `/api/${kind === 'note' ? 'notes' : 'workspaces'}/${String(code).toUpperCase()}`;
  return askPin({ kind, base });
}

/**
 * fetch with the API's conventions: JSON in and out, readable errors, and the
 * two interactive gates answered in one place. A 401 `access_required` asks for
 * the team passphrase; `pin_required` asks for that item's PIN. Either way the
 * request is retried once. Pass `interactive: false` for background loads (such
 * as refreshing a list) so a locked item cannot trigger a wall of prompts.
 */
export async function request(path, options = {}) {
  const { json, interactive = true, ...rest } = options;

  const send = async () => {
    const init = { ...rest, headers: { ...(rest.headers ?? {}) } };
    if (json !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(json);
    }
    const key = readAccessKey();
    if (key) init.headers['X-Access-Key'] = key;

    try {
      return await fetch(path, init);
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
  };

  let response = await send();

  if (response.status === 401 && interactive) {
    const code = await errorCode(response);
    if (code === 'access_required' && (await askAccessKey())) {
      response = await send();
    } else if (code === 'pin_required') {
      const target = itemTarget(path);
      if (target && (await askPin(target))) response = await send();
    }
  }

  if (!response.ok) {
    const error = new Error(await readError(response));
    error.status = response.status;
    error.code = await errorCode(response);
    throw error;
  }
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

/** True when a record that can expire will do so within `windowMs`. */
export function isExpiringSoon(record, windowMs) {
  if (!record || record.isPersistent || !record.expiresAt) return false;
  const remaining = new Date(record.expiresAt).getTime() - Date.now();
  return Number.isFinite(remaining) && remaining > 0 && remaining <= windowMs;
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
