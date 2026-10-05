import { randomInt, randomUUID } from 'node:crypto';

/** No I, O or 0 so codes stay readable when dictated out loud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789';
const SLUG_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Share codes are the only access key for a workspace or note, so they are
 * drawn from a CSPRNG rather than Math.random.
 */
export function generateCode(length = 6) {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

export function generateSlug(length = 7) {
  let slug = '';
  for (let index = 0; index < length; index += 1) {
    slug += SLUG_ALPHABET[randomInt(0, SLUG_ALPHABET.length)];
  }
  return slug;
}

export function makeId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function normalizeCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

export function isValidCode(code) {
  return /^[A-Z1-9]{6}$/.test(normalizeCode(code));
}

export function normalizeSlug(slug) {
  return String(slug ?? '').trim();
}

/** Aliases live in a URL path segment, so keep them to safe characters. */
export function isValidSlug(slug) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(normalizeSlug(slug));
}

/**
 * Reserved so a custom alias can never shadow an app route.
 * `s` is the redirect prefix itself and is therefore not reachable as a slug.
 */
const RESERVED_SLUGS = new Set([
  'api',
  'assets',
  'dist',
  'favicon.ico',
  'favicon.svg',
  'health',
  'icons.svg',
  'index.html',
  'links',
  'netlify',
  'note',
  'notes',
  's',
  'share',
  'static',
  'w',
  'workspace',
  'workspaces',
]);

export function isReservedSlug(slug) {
  return RESERVED_SLUGS.has(normalizeSlug(slug).toLowerCase());
}
