import { badRequest, conflict } from './errors.js';
import { generateSlug, isReservedSlug, isValidSlug, makeId, normalizeSlug } from './ids.js';
import { listLiveRecords, loadRecord, mutateRecord } from './records.js';
import { getStore, recordKeys, recordPrefixes } from './store/index.js';
import { now, toIso } from './time.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const MAX_TARGET_LENGTH = 2048;
const MAX_TITLE_LENGTH = 120;

export function linkKey(slug) {
  return recordKeys.link(normalizeSlug(slug));
}

/**
 * Only http(s) and mailto targets are accepted. Without this the redirect would
 * happily emit `javascript:` or `data:` URLs, turning every short link into a
 * stored-XSS vector against whoever opens it.
 */
export function normalizeTargetUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw badRequest('A destination URL is required');
  if (raw.length > MAX_TARGET_LENGTH) throw badRequest('That destination URL is too long');

  // A bare "example.com/x" is a common paste; assume https rather than reject it.
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw badRequest('That destination URL is not valid');
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw badRequest('Only http, https and mailto destinations are supported');
  }
  if (parsed.protocol !== 'mailto:' && !parsed.hostname) {
    throw badRequest('That destination URL is missing a hostname');
  }

  return parsed.toString();
}

function normalizeExpiry(input) {
  if (input == null || input === '') return null;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) throw badRequest('That expiry date is not valid');
  if (parsed.getTime() <= now()) throw badRequest('The expiry date must be in the future');
  return parsed.toISOString();
}

export function presentLink(link) {
  return {
    id: link.id,
    slug: link.slug,
    targetUrl: link.targetUrl,
    title: link.title ?? '',
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    expiresAt: link.expiresAt ?? null,
    isPersistent: Boolean(link.isPersistent),
    clicks: Number(link.clicks ?? 0),
    lastVisitedAt: link.lastVisitedAt ?? null,
  };
}

export async function getLink(slug) {
  return loadRecord(linkKey(slug));
}

export async function createLink({ targetUrl, alias, title, expiresAt }) {
  const store = getStore();
  const normalizedTarget = normalizeTargetUrl(targetUrl);
  const normalizedExpiry = normalizeExpiry(expiresAt);
  const cleanTitle = String(title ?? '').trim().slice(0, MAX_TITLE_LENGTH);
  const requestedAlias = normalizeSlug(alias);

  if (requestedAlias) {
    if (!isValidSlug(requestedAlias)) {
      throw badRequest('Aliases use 2-64 letters, numbers, dashes or underscores and must start with a letter or number');
    }
    if (isReservedSlug(requestedAlias)) throw conflict('That alias is reserved');
    if (await store.getRecord(linkKey(requestedAlias))) throw conflict('That alias is already in use');
  }

  const createdAt = now();
  const base = {
    id: makeId('lnk'),
    kind: 'link',
    targetUrl: normalizedTarget,
    title: cleanTitle,
    createdAt: toIso(createdAt),
    updatedAt: toIso(createdAt),
    expiresAt: normalizedExpiry,
    // Short links outlive workspaces by default; an expiry is opt-in.
    isPersistent: normalizedExpiry == null,
    clicks: 0,
    lastVisitedAt: null,
  };

  if (requestedAlias) {
    const link = { ...base, slug: requestedAlias };
    await store.putRecord(linkKey(requestedAlias), link);
    return link;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    // Widen the slug if short ones keep colliding.
    const slug = generateSlug(7 + Math.floor(attempt / 3));
    if (isReservedSlug(slug)) continue;
    const key = linkKey(slug);
    if (await store.getRecord(key)) continue;
    const link = { ...base, slug };
    await store.putRecord(key, link);
    return link;
  }

  throw conflict('Could not allocate a short code, please try again');
}

export async function updateLink(slug, { targetUrl, title, expiresAt }) {
  return mutateRecord(
    linkKey(slug),
    (current) => {
      const changes = { updatedAt: toIso(now()) };

      if (targetUrl !== undefined) changes.targetUrl = normalizeTargetUrl(targetUrl);
      if (title !== undefined) changes.title = String(title ?? '').trim().slice(0, MAX_TITLE_LENGTH);
      if (expiresAt !== undefined) {
        const normalized = normalizeExpiry(expiresAt);
        changes.expiresAt = normalized;
        changes.isPersistent = normalized == null;
      }

      return { ...current, ...changes };
    },
    { message: 'Short link not found or expired' },
  );
}

export async function deleteLink(slug) {
  const store = getStore();
  const key = linkKey(slug);
  if (!(await store.getRecord(key))) return false;
  await store.deleteRecord(key);
  return true;
}

/**
 * Resolves a slug for redirect and records the visit. A click counter must
 * never block the redirect, so a write failure is swallowed.
 */
export async function resolveForRedirect(slug) {
  const link = await getLink(slug);
  if (!link) return null;

  mutateRecord(
    linkKey(link.slug),
    (current) => ({
      ...current,
      clicks: Number(current.clicks ?? 0) + 1,
      lastVisitedAt: toIso(now()),
    }),
    { message: 'Short link not found or expired' },
  ).catch(() => undefined);

  return link;
}

export async function cleanupExpiredLinks() {
  const live = await listLiveRecords(recordPrefixes.link, {
    keyOf: (link) => recordKeys.link(normalizeSlug(link.slug)),
  });
  return live.length;
}
