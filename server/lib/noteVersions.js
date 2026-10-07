import { makeId, normalizeCode } from './ids.js';
import { getStore, recordKeys } from './store/index.js';
import { withLock } from './store/mutex.js';
import { now, toIso } from './time.js';

const MAX_VERSIONS = 20;
/** Cap on stored text per note, so 20 large versions cannot balloon one record. */
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
const PREVIEW_CHARS = 160;

const keyFor = (code) => recordKeys.noteVersions(normalizeCode(code));

/**
 * Earlier texts of a note, newest first, kept apart from the note itself so the
 * live-editing poll never has to load them. This is the safety net for "anyone
 * with the code has full control": an accidental select-all and delete is one
 * click to undo.
 */
export async function addVersion(code, { content, title = '', reason = 'auto' }) {
  const text = String(content ?? '');
  if (!text.trim()) return;

  const key = keyFor(code);
  await withLock(key, async () => {
    const store = getStore();
    const record = (await store.getRecord(key)) ?? { code: normalizeCode(code), items: [] };
    if (record.items[0]?.content === text) return;

    const entry = {
      id: makeId('ver'),
      at: toIso(now()),
      size: Buffer.byteLength(text, 'utf8'),
      title: String(title ?? '').slice(0, 120),
      reason,
      content: text,
    };

    const items = [entry];
    let total = entry.size;
    for (const old of record.items) {
      if (items.length >= MAX_VERSIONS || total + old.size > MAX_TOTAL_BYTES) break;
      items.push(old);
      total += old.size;
    }
    await store.putRecord(key, { ...record, items });
  });
}

export async function listVersions(code) {
  const record = await getStore().getRecord(keyFor(code));
  return (record?.items ?? []).map(({ content, ...rest }) => ({
    ...rest,
    preview: content.slice(0, PREVIEW_CHARS),
  }));
}

export async function getVersion(code, id) {
  const record = await getStore().getRecord(keyFor(code));
  return (record?.items ?? []).find((item) => item.id === id) ?? null;
}

export async function deleteVersions(code) {
  await getStore().deleteRecord(keyFor(code));
}
