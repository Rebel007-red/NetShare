import { request } from './apiClient.js';
import { createRecentStore } from './recentStore.js';

const RECENT_SLUGS_KEY = 'netfileshare-recent-links';

const recent = createRecentStore(RECENT_SLUGS_KEY);

function linkUrl(slug) {
  return `/api/links/${encodeURIComponent(String(slug ?? '').trim())}`;
}

export const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;

export function isValidAlias(alias) {
  return ALIAS_PATTERN.test(String(alias ?? '').trim());
}

/** The absolute short URL to hand out, e.g. https://host/s/abc1234 */
export function getShortUrl(link) {
  const slug = String(link?.slug ?? '').trim();
  if (!slug) return '';
  return new URL(`/s/${slug}`, window.location.origin).toString();
}

export async function listLinks() {
  const slugs = recent.list();
  if (slugs.length === 0) return [];

  const resolved = await Promise.all(slugs.map(async (slug) => {
    try {
      return await request(linkUrl(slug));
    } catch {
      return null;
    }
  }));

  const links = resolved.filter(Boolean);
  recent.replace(links.map((link) => link.slug));
  return links;
}

export async function createLink({ targetUrl, alias = '', title = '', expiresAt = null }) {
  const payload = { targetUrl, title };
  if (alias.trim()) payload.alias = alias.trim();
  if (expiresAt) payload.expiresAt = expiresAt;

  const link = await request('/api/links', { method: 'POST', json: payload });
  recent.remember(link.slug);
  return link;
}

export async function updateLink(slug, changes) {
  const link = await request(linkUrl(slug), { method: 'PATCH', json: changes });
  recent.remember(link.slug);
  return link;
}

export async function deleteLink(slug) {
  await request(linkUrl(slug), { method: 'DELETE' });
  recent.forget(slug);
}

/**
 * Converts a datetime-local value to an ISO string. The input is in the
 * viewer's own timezone, which `new Date(value)` already honours.
 */
export function toIsoFromLocalInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
