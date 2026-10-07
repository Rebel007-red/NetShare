import { now, toIso } from './time.js';

const MAX_ENTRIES = 40;
/** Repeated events of one kind inside this window collapse into a single line. */
const COALESCE_MS = 10 * 60 * 1000;

/**
 * Appends one line to a record's activity log and returns the new record.
 *
 * There are no user accounts, so an entry says *what* happened and *when*, never
 * who. The log rides inside the record it describes, so it costs no extra
 * storage call and disappears with it.
 */
export function withActivity(record, type, detail = '', { coalesce = false } = {}) {
  const at = toIso(now());
  const log = [...(record.activity ?? [])];
  const last = log[log.length - 1];

  if (coalesce && last && last.type === type && now() - Date.parse(last.at) < COALESCE_MS) {
    log[log.length - 1] = { ...last, at, count: (last.count ?? 1) + 1 };
  } else {
    log.push({ at, type, ...(detail ? { detail: String(detail).slice(0, 120) } : {}) });
  }

  return { ...record, activity: log.slice(-MAX_ENTRIES) };
}

/** Newest first, with only the fields a client should see. */
export function presentActivity(record) {
  return [...(record.activity ?? [])]
    .reverse()
    .map(({ at, type, detail, count }) => ({ at, type, detail, count }));
}
