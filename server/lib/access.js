import { createHash, timingSafeEqual } from 'node:crypto';
import { ACCESS_KEY } from './config.js';
import { unauthorized } from './errors.js';

const digest = (value) => createHash('sha256').update(String(value)).digest();

/** Constant-time comparison; hashing first makes the lengths equal. */
export function accessKeyMatches(provided) {
  if (!ACCESS_KEY) return true;
  return timingSafeEqual(digest(provided ?? ''), digest(ACCESS_KEY));
}

/**
 * The team passphrase guards *creating* things (workspaces, links, notes), which
 * is what spends storage. It deliberately does not guard use: anyone holding a
 * share code can still read, edit and delete, because the code is the access key
 * (see CLAUDE.md decision 1). With no NETFILESHARE_ACCESS_KEY set this is a no-op.
 */
export function requireAccessKey(req, res, next) {
  if (accessKeyMatches(req.get('x-access-key'))) return next();
  // A wrong passphrase counts like a bad code guess, so it cannot be brute-forced.
  res.locals.miss = true;
  return next(unauthorized('Enter the team passphrase to create things', 'access_required'));
}
