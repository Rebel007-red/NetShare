export function now() {
  return Date.now();
}

export function toIso(value) {
  return new Date(value).toISOString();
}

export function msUntil(isoValue) {
  const target = new Date(isoValue).getTime();
  if (Number.isNaN(target)) return 0;
  return target - now();
}

/** A record expires only when it is not pinned and its deadline has passed. */
export function isExpired(record) {
  if (!record) return true;
  if (record.isPersistent) return false;
  if (!record.expiresAt) return false;
  return msUntil(record.expiresAt) <= 0;
}

/** Extending from the later of now and the current deadline avoids losing time. */
export function extendFrom(record, durationMs) {
  const current = new Date(record?.expiresAt ?? 0).getTime();
  const base = Number.isNaN(current) ? now() : Math.max(now(), current);
  return toIso(base + durationMs);
}
