import { badRequest } from './errors.js';

export const MAX_NAME_LENGTH = 120;
export const MAX_PATH_DEPTH = 24;

/* eslint-disable-next-line no-control-regex */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Logical paths are metadata only: file bytes are stored under an opaque item
 * id, never under a caller-supplied path. Segments are still validated so a
 * `..` or a separator can never travel into a stored path, be echoed back to a
 * client, or reach the disk driver's own layout.
 */
export function sanitizeName(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw badRequest('A name is required');
  if (raw.length > MAX_NAME_LENGTH) throw badRequest(`Names must be ${MAX_NAME_LENGTH} characters or fewer`);
  if (raw === '.' || raw === '..') throw badRequest('That name is not allowed');
  if (CONTROL_CHARS.test(raw)) throw badRequest('Names cannot contain control characters');
  if (/[/\\]/.test(raw)) throw badRequest('Names cannot contain slashes');
  if (WINDOWS_RESERVED.test(raw)) throw badRequest('That name is reserved by the operating system');
  return raw;
}

/** Same rules, but tolerant: used for uploaded filenames we would rather fix than reject. */
export function sanitizeUploadName(input, fallback = 'file') {
  // Browsers may send a relative path for directory uploads; keep the leaf only.
  const leaf = String(input ?? '').split(/[/\\]/).filter(Boolean).at(-1) || '';
  /* eslint-disable-next-line no-control-regex */
  const cleaned = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  if (!cleaned || cleaned === '.' || cleaned === '..' || WINDOWS_RESERVED.test(cleaned)) return fallback;
  return cleaned;
}

/** Normalizes a logical folder path, rejecting any traversal segment. */
export function normalizePath(input) {
  const raw = String(input ?? '').trim().replace(/\\/g, '/');
  if (!raw || raw === '/') return '/';
  if (CONTROL_CHARS.test(raw)) throw badRequest('Paths cannot contain control characters');

  const segments = raw.split('/').filter(Boolean);
  if (segments.length > MAX_PATH_DEPTH) throw badRequest('That folder is nested too deeply');

  for (const segment of segments) {
    if (segment === '.' || segment === '..') throw badRequest('Invalid path');
    if (segment.length > MAX_NAME_LENGTH) throw badRequest('Invalid path');
  }

  return `/${segments.join('/')}`;
}

export function splitPath(targetPath) {
  return normalizePath(targetPath).split('/').filter(Boolean);
}

export function parentPathOf(targetPath) {
  const segments = splitPath(targetPath);
  segments.pop();
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export function buildChildPath(parentPath, name) {
  const parent = normalizePath(parentPath);
  const leaf = sanitizeName(name);
  const next = parent === '/' ? `/${leaf}` : `${parent}/${leaf}`;
  // Re-normalize so depth limits apply to the combined path too.
  return normalizePath(next);
}

export function isDescendantPath(candidate, ancestor) {
  if (ancestor === '/') return candidate !== '/';
  return candidate.startsWith(`${ancestor}/`);
}

/** Re-roots `candidate` from under `fromPath` to under `toPath`. */
export function rebasePath(candidate, fromPath, toPath) {
  if (candidate === fromPath) return toPath;
  if (!isDescendantPath(candidate, fromPath)) return candidate;
  const suffix = candidate.slice(fromPath.length);
  return `${toPath}${suffix}`;
}
