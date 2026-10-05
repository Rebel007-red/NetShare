import { notFound } from './errors.js';
import { getStore } from './store/index.js';
import { withLock } from './store/mutex.js';
import { isExpired } from './time.js';

/**
 * Loads a record and treats an expired one as absent, deleting it lazily so a
 * stale share code can never be reused to reach old content.
 */
export async function loadRecord(key, { onPurge } = {}) {
  const store = getStore();
  const record = await store.getRecord(key);
  if (!record) return null;
  if (!isExpired(record)) return record;

  await onPurge?.(record);
  await store.deleteRecord(key);
  return null;
}

export async function requireRecord(key, message, options) {
  const record = await loadRecord(key, options);
  if (!record) throw notFound(message);
  return record;
}

/**
 * Read-modify-write under a per-key lock. `mutator` receives the current record
 * and returns the next one; returning null leaves the record untouched.
 */
export async function mutateRecord(key, mutator, { message = 'Not found', onPurge } = {}) {
  return withLock(key, async () => {
    const current = await requireRecord(key, message, { onPurge });
    const next = await mutator(current);
    if (!next) return current;
    await getStore().putRecord(key, next);
    return next;
  });
}

/** Lists live records of one kind and purges any that have expired. */
export async function listLiveRecords(prefix, { onPurge, keyOf } = {}) {
  const store = getStore();
  const records = await store.listRecords(prefix);
  const live = [];

  for (const record of records) {
    if (!isExpired(record)) {
      live.push(record);
      continue;
    }
    await onPurge?.(record);
    if (keyOf) await store.deleteRecord(keyOf(record));
  }

  return live;
}
